import { connection } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { backtestResults, backtestRuns, evalResults, evalRuns, thesisVersions } from "@/db/schema";
import { adjudicateAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/td/action-form";
import { Empty, fmtDate, Notice, OutcomePill, PageHeader, Panel, Pill, Stat, Table } from "@/components/td/ui";
import { can } from "@/lib/authz";
import { backtestReport } from "@/lib/backtest";
import { NINE_CHECKS, PRELIM_CHECKS } from "@/lib/evals/checks";
import { currentUser } from "@/lib/session";

export default async function Evaluations() {
  await connection();
  const u = await currentUser();
  const [runs, evals] = await Promise.all([
    db().select({ r: backtestRuns, version: thesisVersions.version }).from(backtestRuns).leftJoin(thesisVersions, eq(thesisVersions.id, backtestRuns.thesisVersionId)).orderBy(desc(backtestRuns.startedAt)).limit(10),
    db().select().from(evalRuns).orderBy(desc(evalRuns.startedAt)).limit(5),
  ]);
  const latest = runs[0];
  const report = latest ? await backtestReport(latest.r.id) : null;
  const results = latest ? await db().select().from(backtestResults).where(eq(backtestResults.runId, latest.r.id)) : [];
  const lastEval = evals.find((e) => e.kind === "checks");
  const evRows = lastEval ? await db().select().from(evalResults).where(eq(evalResults.runId, lastEval.id)) : [];
  const byCheck = new Map<number, { pass: number; fail: number; critFail: number }>();
  for (const r of evRows) {
    const c = byCheck.get(r.checkNo) ?? { pass: 0, fail: 0, critFail: 0 };
    if (r.passed) c.pass++; else { c.fail++; if (r.severity === "critical") c.critFail++; }
    byCheck.set(r.checkNo, c);
  }
  return (
    <>
      <PageHeader kicker="Trust" title="Evaluations" description="Backtests against Riya's real decisions and the nine release gates. Results are shown only from runs that actually happened. The judge for soft assertions is a Gemini model from the same family as the agent — a known bias, so a human calibration sample is required." />

      <h2 className="mb-2 text-[15px] font-semibold text-primary">Historical backtest {latest ? `· thesis v${latest.version} · ${latest.r.split} split` : ""}</h2>
      {!report ? <Empty title="No backtest has run yet">Start one from Thesis & Memory. Rows are scored point-in-time with Riya&apos;s actual call hidden from the model.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Agreement (GO vs PASS)" value={report.agreement == null ? "—" : `${Math.round(report.agreement * 100)}%`} hint={`baseline 70% (28/40, old system)`} />
            <Stat label="False GO" value={report.falseGo} tone={report.falseGo ? "bad" : "good"} hint="baseline 8 of 40" />
            <Stat label="False PASS" value={report.falsePass} tone={report.falsePass ? "warn" : "good"} hint="baseline 4 of 40" />
            <Stat label="HOLD / REQUEST INFO" value={`${report.holds} / ${report.requestInfo}`} hint="routed to humans" />
            <Stat label="Scored" value={`${report.scored}/${report.total}`} hint={report.pending ? `${report.pending} pending or need attention` : "complete"} />
          </div>
          <Panel title="Disagreements for human adjudication" subtitle="“Were we wrong, or was it?” — Kushal" className="mt-4">
            {results.filter((r) => r.agreed === false || r.predicted === "HOLD").length === 0 ? <p className="text-[13px] text-muted-foreground">None yet.</p> : (
              <ul className="divide-y text-[13px]">
                {results.filter((r) => r.agreed === false || r.predicted === "HOLD").map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-mono text-xs">{r.rowRef}</span><b>{r.company}</b>
                    <span className="text-xs text-muted-foreground">system</span><OutcomePill outcome={r.predicted} />
                    <span className="text-xs text-muted-foreground">Riya</span><Pill>{r.actualOutcome}</Pill>
                    <Pill tone={r.adjudication === "pending" ? "warn" : "ok"}>{r.adjudication.replace("_", " ")}</Pill>
                    {u && can(u.role, "adjudicate") && r.adjudication === "pending" && (
                      <ActionForm action={adjudicateAction} hidden={{ id: r.id }} className="ml-auto flex gap-1">
                        <Submit variant="outline" name="verdict" value="system_right">System right</Submit>
                        <Submit variant="outline" name="verdict" value="human_right">We were right</Submit>
                        <Submit variant="outline" name="verdict" value="unclear">Unclear</Submit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      <h2 className="mb-2 mt-6 text-[15px] font-semibold text-primary">Nine evaluation checks</h2>
      {!lastEval ? <div className="mb-3"><Notice tone="warn">The eval harness has not been run against this environment yet (<code>npm run eval</code>). No results are shown until it has.</Notice></div> : (
        <div className="mb-3"><Notice tone={lastEval.releaseBlocked ? "bad" : "ok"}>Last run {fmtDate(lastEval.startedAt)} against {lastEval.target} · judge {lastEval.judgeModel ?? "—"} · release {lastEval.releaseBlocked ? "BLOCKED by a critical failure" : "not blocked"}</Notice></div>
      )}
      <Table head={["#", "Check", "Severity", "Kill criterion", "Last result"]}>
        {NINE_CHECKS.map((c) => {
          const r = byCheck.get(c.no);
          return (
            <tr key={c.no}>
              <td className="px-3 py-2 font-medium">{c.no}</td>
              <td className="px-3 py-2 font-medium">{c.name}</td>
              <td className="px-3 py-2"><Pill tone={c.severity === "critical" ? "bad" : "warn"}>{c.severity}</Pill></td>
              <td className="max-w-lg px-3 py-2 text-muted-foreground">{c.kill}</td>
              <td className="px-3 py-2">{r ? <Pill tone={r.critFail ? "bad" : r.fail ? "warn" : "ok"}>{r.pass} pass · {r.fail} fail</Pill> : <Pill>not run</Pill>}</td>
            </tr>
          );
        })}
      </Table>
      {evRows.some((r) => !r.passed) && (
        <Panel title="Failures" className="mt-4">
          <ul className="space-y-1 text-[13px]">{evRows.filter((r) => !r.passed).map((r) => <li key={r.id}><Pill tone={r.severity === "critical" ? "bad" : "warn"}>{r.severity}</Pill> <b>#{r.checkNo} {r.caseId}</b> ({r.category}, {r.assertionType}) — expected {r.expected}; got {r.actual}{r.diagnosis ? ` · ${r.diagnosis}` : ""}</li>)}</ul>
        </Panel>
      )}

      <h2 className="mb-2 mt-6 text-[15px] font-semibold text-primary">Nine preliminary checks</h2>
      <Table head={["#", "Check", "Verdict", "Evidence"]}>
        {PRELIM_CHECKS.map((c) => (
          <tr key={c.no}><td className="px-3 py-2">{c.no}</td><td className="px-3 py-2 font-medium">{c.name}</td><td className="px-3 py-2"><Pill tone={c.verdict === "supported" ? "ok" : "warn"}>{c.verdict}</Pill></td><td className="px-3 py-2 text-muted-foreground">{c.evidence}</td></tr>
        ))}
      </Table>
    </>
  );
}
