import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications, backtestResults, backtestRows, backtestRuns } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { intake } from "@/lib/intake";

/**
 * Point-in-time backtest of a thesis version against historical decisions.
 *  - Only the application summary as it stood is scored; as_of = the original decision date.
 *  - Corrections/memos dated on or after as_of are invisible; live web research is disabled.
 *  - The actual outcome (Riya's call) is stored in backtest_results and NEVER enters the scoring context.
 */
export async function startBacktest(actor: Actor, thesisVersionId: string, split: "tune" | "sealed" | "all") {
  const rows = await db().select().from(backtestRows).where(split === "all" ? sql`true` : eq(backtestRows.split, split));
  if (!rows.length) throw new Error("No historical rows imported. Run the seed script first.");
  const [run] = await db().insert(backtestRuns).values({ thesisVersionId, split }).returning();
  for (const r of rows) {
    const res = await intake(actor, {
      companyName: r.company, sector: r.sector ?? undefined, stage: r.stage ?? undefined, city: r.city ?? undefined,
      founderType: r.founderType ?? undefined, summary: r.summary, asOfDate: r.asOf, batchId: `bt_${run.id}`, dataClass: "case_study",
    }, [], "backtest", { thesisVersionId, hashSalt: run.id, jobPayload: { backtestRunId: run.id } });
    await db().insert(backtestResults).values({
      runId: run.id, rowRef: r.rowRef, company: r.company, asOf: r.asOf, actualOutcome: r.actualOutcome,
      applicationId: res.applicationId,
    });
  }
  await audit(actor, "backtest.start", "thesis", thesisVersionId, { runId: run.id, split, rows: rows.length });
  return run;
}

export type BacktestReport = {
  runId: string; total: number; scored: number; pending: number; agreement: number | null;
  falseGo: number; falsePass: number; holds: number; requestInfo: number;
  disagreements: { rowRef: string; company: string; predicted: string | null; actual: string; adjudication: string }[];
};

/** Agreement treats GO vs not-GO (PASS) as the binary the fund records; HOLD/REQUEST_INFO are reported separately. */
export async function backtestReport(runId: string): Promise<BacktestReport> {
  // Sync predictions from scored applications (the worker may finish before the result row exists).
  const pendingRows = await db().select().from(backtestResults).where(and(eq(backtestResults.runId, runId), sql`${backtestResults.predicted} is null`));
  for (const r of pendingRows) {
    if (!r.applicationId) continue;
    const [a] = await db().select().from(applications).where(eq(applications.id, r.applicationId));
    if (a?.recommendation && a.scoredAt) {
      const agreed = (a.recommendation === "GO") === /^go$/i.test(r.actualOutcome);
      await db().update(backtestResults).set({ predicted: a.recommendation, weightedScore: a.weightedScore, agreed }).where(eq(backtestResults.id, r.id));
    }
  }
  const rows = await db().select().from(backtestResults).where(eq(backtestResults.runId, runId));
  const scored = rows.filter((r) => r.predicted);
  const decisive = scored.filter((r) => r.predicted === "GO" || r.predicted === "PASS");
  const isGo = (s: string) => /^go$/i.test(s);
  const falseGo = decisive.filter((r) => r.predicted === "GO" && !isGo(r.actualOutcome)).length;
  const falsePass = decisive.filter((r) => r.predicted === "PASS" && isGo(r.actualOutcome)).length;
  const agree = decisive.length - falseGo - falsePass;
  const report: BacktestReport = {
    runId, total: rows.length, scored: scored.length, pending: rows.length - scored.length,
    agreement: decisive.length ? agree / decisive.length : null, falseGo, falsePass,
    holds: scored.filter((r) => r.predicted === "HOLD").length, requestInfo: scored.filter((r) => r.predicted === "REQUEST_INFO").length,
    disagreements: scored.filter((r) => r.agreed === false || r.predicted === "HOLD").map((r) => ({
      rowRef: r.rowRef, company: r.company, predicted: r.predicted, actual: r.actualOutcome, adjudication: r.adjudication,
    })),
  };
  if (report.pending === 0) {
    await db().update(backtestRuns).set({ status: "done", finishedAt: new Date(), summary: { ...report, disagreements: report.disagreements.length } })
      .where(and(eq(backtestRuns.id, runId), eq(backtestRuns.status, "running")));
  }
  return report;
}

/** Refresh any running backtest whose applications are all scored or stuck. */
export async function refreshRunningBacktests() {
  const running = await db().select().from(backtestRuns).where(eq(backtestRuns.status, "running"));
  for (const r of running) {
    const res = await db().select({ appId: backtestResults.applicationId }).from(backtestResults).where(eq(backtestResults.runId, r.id));
    const ids = res.map((x) => x.appId).filter(Boolean) as string[];
    if (!ids.length) continue;
    const open = await db().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(applications)
      .where(and(inArray(applications.id, ids), inArray(applications.status, ["queued", "processing", "received", "paused"])));
    if ((open[0]?.n ?? 0) === 0) {
      // Rows that ended in needs_attention count as unscored (pending) and keep the run open for a human.
      await backtestReport(r.id);
    }
  }
}

export async function adjudicate(actor: Actor, resultId: string, verdict: "system_right" | "human_right" | "unclear", note: string) {
  await db().update(backtestResults).set({ adjudication: verdict, adjudicationNote: note }).where(eq(backtestResults.id, resultId));
  await audit(actor, "backtest.adjudicate", "backtest_result", resultId, { verdict });
}
