import { and, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alerts, applications, auditLog, backtestRuns, decisions, emails, evalRuns, jobs, meetings, modelCalls, outreachThreads,
  researchUsage, reviewTimings, systemState,
} from "@/db/schema";
import { istStart, usageSince } from "@/lib/ai/quota";

export async function statusCounts() {
  const rows = await db().select({ status: applications.status, n: count() }).from(applications).groupBy(applications.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}

export async function overviewMetrics() {
  const weekStart = istStart("week");
  const [byStatus, [week], [total], spendDay, spendMonth, [timing], agreement, [needsAttention], recentAlerts, recent, [queue]] = await Promise.all([
    statusCounts(),
    db().select({ n: count() }).from(applications).where(and(gte(applications.submittedAt, weekStart), inArray(applications.source, ["form", "batch"]))),
    db().select({ n: count() }).from(applications).where(inArray(applications.source, ["form", "batch"])),
    usageSince(istStart("day")),
    usageSince(istStart("month")),
    db().select({ avg: sql<number>`avg(${reviewTimings.seconds})`.mapWith(Number), n: count() }).from(reviewTimings),
    db().select({ ai: decisions.aiRecommendation, human: decisions.outcome }).from(decisions).where(eq(decisions.stage, "associate_review")),
    db().select({ n: count() }).from(jobs).where(eq(jobs.status, "needs_attention")),
    db().select().from(alerts).orderBy(desc(alerts.at)).limit(5),
    db().select().from(auditLog).orderBy(desc(auditLog.at)).limit(8),
    db().select({ n: count() }).from(jobs).where(inArray(jobs.status, ["queued", "running", "paused"])),
  ]);
  const agreed = agreement.filter((d) => d.ai && d.ai === d.human).length;
  return {
    byStatus, weekCount: Number(week.n), total: Number(total.n), spendDay, spendMonth,
    avgReviewSec: timing.n ? timing.avg : null, reviewSamples: Number(timing.n),
    agreement: agreement.length ? agreed / agreement.length : null, agreementN: agreement.length,
    needsAttention: Number(needsAttention.n), alerts: recentAlerts, recent, queueDepth: Number(queue.n),
  };
}

export async function costBreakdown() {
  const [day, week, month] = await Promise.all([usageSince(istStart("day")), usageSince(istStart("week")), usageSince(istStart("month"))]);
  const byDay = await db().select({
    day: sql<string>`to_char(${modelCalls.at} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
    cost: sql<number>`coalesce(sum(${modelCalls.costUsd}),0)`.mapWith(Number),
    calls: sql<number>`count(*) filter (where ${modelCalls.route} in ('portkey','direct'))`.mapWith(Number),
    cached: sql<number>`count(*) filter (where ${modelCalls.route} = 'cache')`.mapWith(Number),
  }).from(modelCalls).where(gte(modelCalls.at, new Date(Date.now() - 30 * 86400_000))).groupBy(sql`1`).orderBy(sql`1 desc`);
  const byStep = await db().select({
    step: modelCalls.promptKey, model: modelCalls.model,
    cost: sql<number>`coalesce(sum(${modelCalls.costUsd}),0)`.mapWith(Number),
    calls: count(), inTok: sql<number>`sum(${modelCalls.inputTokens})`.mapWith(Number), outTok: sql<number>`sum(${modelCalls.outputTokens})`.mapWith(Number),
    avgMs: sql<number>`avg(${modelCalls.latencyMs})`.mapWith(Number),
  }).from(modelCalls).where(gte(modelCalls.at, istStart("month"))).groupBy(modelCalls.promptKey, modelCalls.model).orderBy(sql`3 desc`);
  const byApp = await db().select({
    applicationId: modelCalls.applicationId, ref: applications.ref, company: applications.companyName,
    cost: sql<number>`coalesce(sum(${modelCalls.costUsd}),0)`.mapWith(Number), calls: count(),
  }).from(modelCalls).leftJoin(applications, eq(applications.id, modelCalls.applicationId))
    .where(and(isNotNull(modelCalls.applicationId), gte(modelCalls.at, istStart("month"))))
    .groupBy(modelCalls.applicationId, applications.ref, applications.companyName).orderBy(sql`4 desc`).limit(25);
  const [sources] = await db().select({
    provider: sql<number>`coalesce(sum(${modelCalls.costUsd}) filter (where ${modelCalls.costSource}='provider'),0)`.mapWith(Number),
    estimate: sql<number>`coalesce(sum(${modelCalls.costUsd}) filter (where ${modelCalls.costSource}='estimate'),0)`.mapWith(Number),
    blocked: sql<number>`count(*) filter (where ${modelCalls.status}='blocked_quota')`.mapWith(Number),
    errors: sql<number>`count(*) filter (where ${modelCalls.status} in ('error','invalid_output'))`.mapWith(Number),
  }).from(modelCalls).where(gte(modelCalls.at, istStart("month")));
  const [tavily] = await db().select({ credits: sql<number>`coalesce(sum(${researchUsage.credits}),0)`.mapWith(Number), skipped: sql<number>`count(*) filter (where ${researchUsage.status} like 'skipped%')`.mapWith(Number) })
    .from(researchUsage).where(gte(researchUsage.at, istStart("month")));
  const [sent] = await db().select({ n: count() }).from(emails).where(and(inArray(emails.status, ["sent", "delivered", "bounced"]), gte(emails.sentAt, istStart("day"))));
  return { day, week, month, byDay, byStep, byApp, sources, tavily, resendToday: Number(sent.n) };
}

export async function healthData() {
  const [jobStats, attention, states, alertRows, errors, webhooks, lastEval, lastBacktest] = await Promise.all([
    db().select({ kind: jobs.kind, status: jobs.status, n: count() }).from(jobs).groupBy(jobs.kind, jobs.status),
    db().select({ id: jobs.id, kind: jobs.kind, step: jobs.step, lastError: jobs.lastError, attempts: jobs.attempts, updatedAt: jobs.updatedAt, ref: applications.ref, company: applications.companyName, runId: jobs.runId })
      .from(jobs).leftJoin(applications, eq(applications.id, jobs.applicationId)).where(eq(jobs.status, "needs_attention")).orderBy(desc(jobs.updatedAt)).limit(30),
    db().select().from(systemState),
    db().select().from(alerts).orderBy(desc(alerts.at)).limit(15),
    db().select().from(modelCalls).where(inArray(modelCalls.status, ["error", "invalid_output", "blocked_quota"])).orderBy(desc(modelCalls.at)).limit(15),
    db().select({ provider: sql<string>`provider`, n: count(), failed: sql<number>`count(*) filter (where error is not null)`.mapWith(Number) }).from(sql`webhook_events`).groupBy(sql`provider`),
    db().select().from(evalRuns).orderBy(desc(evalRuns.startedAt)).limit(1),
    db().select().from(backtestRuns).orderBy(desc(backtestRuns.startedAt)).limit(1),
  ]);
  const traces = await db().select({ traceId: modelCalls.traceId, step: modelCalls.step, model: modelCalls.model, at: modelCalls.at, latencyMs: modelCalls.latencyMs, status: modelCalls.status, promptVersion: modelCalls.promptVersion, retries: modelCalls.retries })
    .from(modelCalls).where(isNotNull(modelCalls.traceId)).orderBy(desc(modelCalls.at)).limit(15);
  return { jobStats, attention, states: Object.fromEntries(states.map((s) => [s.key, s.value])), alerts: alertRows, errors, webhooks, lastEval: lastEval[0], lastBacktest: lastBacktest[0], traces };
}

export async function threadsWithEmails() {
  const threads = await db().select({ t: outreachThreads, ref: applications.ref, company: applications.companyName, finalOutcome: applications.finalOutcome, sector: applications.sector, stage: applications.stage })
    .from(outreachThreads).innerJoin(applications, eq(applications.id, outreachThreads.applicationId)).orderBy(desc(outreachThreads.updatedAt));
  const ids = threads.map((x) => x.t.id);
  const ems = ids.length ? await db().select().from(emails).where(inArray(emails.threadId, ids)).orderBy(emails.createdAt) : [];
  return threads.map((x) => ({ ...x, emails: ems.filter((e) => e.threadId === x.t.id) }));
}

export async function meetingRows() {
  return db().select({ m: meetings, ref: applications.ref, company: applications.companyName })
    .from(meetings).innerJoin(applications, eq(applications.id, meetings.applicationId)).orderBy(desc(meetings.updatedAt));
}
