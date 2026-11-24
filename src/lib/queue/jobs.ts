import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications, jobs, jobSteps } from "@/db/schema";

export type Job = typeof jobs.$inferSelect;
export type JobKind = Job["kind"];
export const LEASE_MS = 150_000;

export async function enqueue(opts: {
  kind: JobKind; applicationId?: string | null; payload?: Record<string, unknown>; idempotencyKey: string; env: "test" | "live"; runAfter?: Date;
}): Promise<{ job: Job; created: boolean }> {
  const runId = `run_${randomUUID()}`;
  const inserted = await db()
    .insert(jobs)
    .values({
      kind: opts.kind, applicationId: opts.applicationId ?? null, payload: opts.payload ?? {}, idempotencyKey: opts.idempotencyKey,
      env: opts.env, runId, runAfter: opts.runAfter ?? new Date(),
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning();
  if (inserted[0]) return { job: inserted[0], created: true };
  const [existing] = await db().select().from(jobs).where(eq(jobs.idempotencyKey, opts.idempotencyKey));
  return { job: existing, created: false };
}

/**
 * Atomic claim with FOR UPDATE SKIP LOCKED: two workers can never take the same job.
 * Jobs whose lease expired (worker crashed mid-step) are reclaimed and resume from their last checkpoint.
 */
export async function claim(limit: number, workerId: string, kinds?: JobKind[]): Promise<Job[]> {
  if (limit <= 0) return [];
  const kindFilter = kinds?.length ? sql`and kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``;
  const res = await db().execute(sql`
    update jobs set status = 'running', locked_by = ${workerId},
      lease_until = now() + make_interval(secs => ${LEASE_MS / 1000}),
      started_at = coalesce(started_at, now()), updated_at = now()
    where id in (
      select id from jobs
      where ((status = 'queued' and run_after <= now()) or (status = 'running' and lease_until < now()))
      ${kindFilter}
      order by created_at
      for update skip locked
      limit ${limit}
    )
    returning id`);
  const ids = (res.rows as { id: string }[]).map((r) => r.id);
  if (!ids.length) return [];
  return db().select().from(jobs).where(sql`${jobs.id} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
}

export async function extendLease(jobId: string, workerId: string) {
  await db().update(jobs)
    .set({ leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId)));
}

export async function setStep(jobId: string, step: string) {
  await db().update(jobs).set({ step, updatedAt: new Date() }).where(eq(jobs.id, jobId));
}

/** Idempotent checkpoint: a step recorded once is skipped on resume. */
export async function checkpoint(jobId: string, step: string, status: "done" | "skipped" | "failed", output: Record<string, unknown>, durationMs: number) {
  await db().insert(jobSteps).values({ jobId, step, status, output, durationMs })
    .onConflictDoUpdate({ target: [jobSteps.jobId, jobSteps.step], set: { status, output, durationMs } });
}

export async function doneSteps(jobId: string): Promise<Map<string, Record<string, unknown>>> {
  const rows = await db().select().from(jobSteps).where(and(eq(jobSteps.jobId, jobId), sql`${jobSteps.status} in ('done','skipped')`));
  return new Map(rows.map((r) => [r.step, r.output]));
}

export async function complete(job: Job) {
  await db().update(jobs).set({ status: "done", finishedAt: new Date(), leaseUntil: null, lastError: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
}

/** Retryable failure → back to the queue with backoff. Out of attempts → needs_attention with a reason. Never deleted. */
export async function fail(job: Job, reason: string, retryable: boolean) {
  const attempts = job.attempts + 1;
  const exhausted = !retryable || attempts >= job.maxAttempts;
  const delayMs = [60_000, 300_000, 900_000][Math.min(attempts - 1, 2)];
  await db().update(jobs).set({
    status: exhausted ? "needs_attention" : "queued",
    attempts,
    lastError: reason.slice(0, 500),
    runAfter: new Date(Date.now() + (exhausted ? 0 : delayMs)),
    leaseUntil: null,
    lockedBy: null,
    updatedAt: new Date(),
  }).where(eq(jobs.id, job.id));
  if (exhausted && job.applicationId) {
    await db().update(applications)
      .set({ status: "needs_attention", statusReason: `${job.step ?? job.kind}: ${reason}`.slice(0, 500), updatedAt: new Date() })
      .where(eq(applications.id, job.applicationId));
  }
  return exhausted;
}

/** Quota / pause: park the job without spending an attempt. Resumes when the system is resumed. */
export async function park(job: Job, reason: string, retryInMs?: number) {
  await db().update(jobs).set({
    status: retryInMs ? "queued" : "paused",
    lastError: reason,
    runAfter: new Date(Date.now() + (retryInMs ?? 0)),
    leaseUntil: null,
    lockedBy: null,
    updatedAt: new Date(),
  }).where(eq(jobs.id, job.id));
  if (!retryInMs && job.applicationId) {
    await db().update(applications).set({ status: "paused", statusReason: reason, updatedAt: new Date() }).where(eq(applications.id, job.applicationId));
  }
}

export async function resumeParked() {
  const res = await db().update(jobs).set({ status: "queued", runAfter: new Date(), updatedAt: new Date() })
    .where(eq(jobs.status, "paused")).returning({ id: jobs.id, applicationId: jobs.applicationId });
  for (const r of res) {
    if (r.applicationId) await db().update(applications).set({ status: "queued", statusReason: null }).where(and(eq(applications.id, r.applicationId), eq(applications.status, "paused")));
  }
  return res.length;
}

export async function retryNeedsAttention(jobId: string) {
  await db().update(jobs).set({ status: "queued", attempts: 0, runAfter: new Date(), lastError: null, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "needs_attention")));
}
