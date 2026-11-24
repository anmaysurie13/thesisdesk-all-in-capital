import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications, backtestResults, jobs } from "@/db/schema";
import { ModelError } from "@/lib/ai/gateway";
import { QuotaError } from "@/lib/ai/quota";
import { env } from "@/lib/env";
import { startTrace } from "@/lib/obs/langfuse";
import { classifyReply, draftFirstEmail, followupScan } from "@/lib/outreach/flow";
import { PipelineError, runScreen } from "@/lib/pipeline/screen";
import { pollBookings } from "@/lib/scheduling/calendly";
import { getPause } from "@/lib/state";
import { claim, complete, enqueue, fail, park, type Job } from "./jobs";

async function handle(job: Job, workerId: string) {
  const traceId = `${job.runId}:${job.attempts}`;
  await startTrace({ traceId, name: `job.${job.kind}`, applicationId: job.applicationId, metadata: { jobId: job.id, runId: job.runId, attempt: job.attempts } });
  switch (job.kind) {
    case "screen":
      return runScreen(job, workerId, traceId);
    case "backtest_row": {
      const r = await runScreen(job, workerId, traceId);
      const [a] = await db().select().from(applications).where(eq(applications.id, job.applicationId!));
      const runId = String(job.payload.backtestRunId ?? "");
      if (runId) {
        const [row] = await db().select().from(backtestResults).where(and(eq(backtestResults.runId, runId), eq(backtestResults.applicationId, a.id)));
        if (row) {
          const actualGo = /^go$/i.test(row.actualOutcome);
          const agreed = a.recommendation ? (a.recommendation === "GO") === actualGo : null;
          await db().update(backtestResults).set({ predicted: a.recommendation, weightedScore: a.weightedScore, agreed }).where(eq(backtestResults.id, row.id));
        }
      }
      return r;
    }
    case "draft_email":
      return draftFirstEmail(job, traceId);
    case "classify_reply":
      return classifyReply(job, traceId);
    case "followup_scan":
      return followupScan(job, traceId);
    case "calendly_poll":
      return pollBookings();
  }
}

async function process(job: Job, workerId: string) {
  try {
    await handle(job, workerId);
    await complete(job);
    return "done";
  } catch (err) {
    if (err instanceof QuotaError) {
      await park(job, err.message, err.kind === "rate" ? 60_000 : undefined);
      return "parked";
    }
    const retryable = err instanceof ModelError || err instanceof PipelineError ? err.retryable : true;
    const exhausted = await fail(job, err instanceof Error ? err.message : String(err), retryable);
    return exhausted ? "needs_attention" : "retry";
  }
}

/** Housekeeping jobs, at most one per 15-minute window (idempotent keys). */
async function scheduleHousekeeping() {
  const slot = Math.floor(Date.now() / (15 * 60_000));
  await enqueue({ kind: "followup_scan", idempotencyKey: `followup_scan:${slot}`, env: env().APP_ENV });
  if (env().CALENDLY_PAT) await enqueue({ kind: "calendly_poll", idempotencyKey: `calendly_poll:${slot}`, env: env().APP_ENV });
}

/**
 * One worker tick (called by: after() on intake, GitHub Actions every 5 min, Vercel cron, or the "Process queue" button).
 * Bounded: concurrency, screening starts per minute (L8: 5/min), and a wall-clock budget below the function limit.
 */
export async function runTick(opts: { budgetMs?: number; workerId?: string } = {}) {
  const e = env();
  const workerId = opts.workerId ?? `w_${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const stats = { claimed: 0, done: 0, retry: 0, parked: 0, needs_attention: 0, paused: false };
  if ((await getPause()).paused) return { ...stats, paused: true };
  await scheduleHousekeeping();

  while (Date.now() < deadline - 20_000) {
    if ((await getPause()).paused) { stats.paused = true; break; }
    const [{ n }] = await db().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(jobs)
      .where(and(inArray(jobs.kind, ["screen", "backtest_row"]), gte(jobs.startedAt, new Date(Date.now() - 60_000))));
    const screenBudget = Math.max(0, e.SCREEN_PER_MINUTE - n);
    const other = await claim(Math.max(1, Math.floor(e.WORKER_CONCURRENCY / 2)), workerId, ["draft_email", "classify_reply", "followup_scan", "calendly_poll"]);
    const screens = await claim(Math.min(e.WORKER_CONCURRENCY, screenBudget), workerId, ["screen", "backtest_row"]);
    const batch = [...other, ...screens];
    if (!batch.length) {
      if (screenBudget === 0) { await new Promise((r) => setTimeout(r, 5_000)); continue; }
      break;
    }
    stats.claimed += batch.length;
    const results = await Promise.all(batch.map((j) => process(j, workerId)));
    for (const r of results) stats[r as "done" | "retry" | "parked" | "needs_attention"]++;
  }
  return stats;
}
