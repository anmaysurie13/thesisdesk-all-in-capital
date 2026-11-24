import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import {
  applications, backtestRuns, conflicts, corrections, emails, jobs, modelCalls, outreachThreads, founders, suppressionList, thesisVersions, users,
} from "@/db/schema";
import { callModel, ModelError } from "@/lib/ai/gateway";
import { assertQuota, QuotaError } from "@/lib/ai/quota";
import { ClaimsOut } from "@/lib/ai/prompts";
import { intake } from "@/lib/intake";
import { applyIntent, approveAndSend, GateError, hashEmail } from "@/lib/outreach/flow";
import { claim, enqueue, fail, park, resumeParked } from "@/lib/queue/jobs";
import { associateReview, partnerSignoff, resolveConflict, ReviewError } from "@/lib/review";
import { getPause, setPause } from "@/lib/state";
import { relevantCorrections } from "@/lib/thesis/memory";
import { activateVersion, approveVersion, ensureV0 } from "@/lib/thesis/service";
import { freshDb } from "./helpers";

let d: DB;
const A = { id: null, role: "harness" };
const app = (n: number, extra: object = {}) => ({ companyName: `Synthetic Co ${n}`, sector: "Fintech", stage: "Seed", summary: `Synthetic application ${n}: 120 customers, 40% repeat.`, dataClass: "synthetic", ...extra });

async function user(role: "associate" | "partner" | "technical_partner" | "analyst") {
  const [u] = await d.insert(users).values({ email: `${role}-${Math.random()}@t.test`, name: role, role, passwordHash: "x" }).returning();
  return { id: u.id, role };
}

beforeEach(async () => { d = await freshDb(); });

describe("[check-1] intake: nothing lost, nothing processed twice", () => {
  it("20 distinct applications submitted at once are all queued with exactly one job each", async () => {
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => intake(A, app(i), [], "volume_test")));
    expect(res.every((r) => r.status === "queued")).toBe(true);
    expect((await d.select().from(applications)).length).toBe(20);
    expect((await d.select().from(jobs)).length).toBe(20);
  });
  it("the same application submitted 20 times at once → 1 queued, 19 flagged duplicates, all retained", async () => {
    const res = await Promise.all(Array.from({ length: 20 }, () => intake(A, app(1), [], "volume_test")));
    expect(res.filter((r) => r.status === "queued").length).toBe(1);
    expect(res.filter((r) => r.status === "duplicate").length).toBe(19);
    expect((await d.select().from(applications)).length).toBe(20);
    expect((await d.select().from(jobs)).length).toBe(1);
  });
  it("missing data is retained as invalid with a reason (not dropped)", async () => {
    const r1 = await intake(A, { companyName: "" }, [], "form");
    const r2 = await intake(A, { companyName: "No Docs Co" }, [], "form");
    expect(r1.status).toBe("invalid");
    expect(r2.status).toBe("invalid");
    const rows = await d.select().from(applications);
    expect(rows.every((r) => r.status === "invalid" && !!r.statusReason)).toBe(true);
  });
  it("real founder data is refused in case-study mode", async () => {
    expect((await intake(A, app(2, { dataClass: "real" }), [], "form")).status).toBe("invalid");
  });
  it("a 50-application burst: zero lost", async () => {
    const res = await Promise.all(Array.from({ length: 50 }, (_, i) => intake(A, app(100 + i), [], "volume_test")));
    expect(res.length).toBe(50);
    expect((await d.select().from(applications)).length).toBe(50);
  });
});

describe("[check-9] durable queue", () => {
  it("concurrent claims never hand the same job to two workers", async () => {
    for (let i = 0; i < 10; i++) await enqueue({ kind: "screen", idempotencyKey: `k${i}`, env: "test" });
    const [a, b] = await Promise.all([claim(6, "w1"), claim(6, "w2")]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(10);
  });
  it("enqueue is idempotent", async () => {
    await enqueue({ kind: "screen", idempotencyKey: "same", env: "test" });
    const second = await enqueue({ kind: "screen", idempotencyKey: "same", env: "test" });
    expect(second.created).toBe(false);
    expect((await d.select().from(jobs)).length).toBe(1);
  });
  it("an expired lease (crashed worker) is reclaimed", async () => {
    await enqueue({ kind: "screen", idempotencyKey: "lease", env: "test" });
    const [j] = await claim(1, "w1");
    await d.update(jobs).set({ leaseUntil: new Date(Date.now() - 1000) }).where(eq(jobs.id, j.id));
    expect((await claim(1, "w2")).map((x) => x.id)).toEqual([j.id]);
  });
  it("retries are capped: after 3 attempts the job needs attention with a reason (boundary)", async () => {
    const r = await intake(A, app(7), [], "form");
    let [j] = await d.select().from(jobs);
    for (let i = 0; i < 3; i++) {
      const exhausted = await fail(j, "Provider HTTP 503", true);
      [j] = await d.select().from(jobs);
      expect(exhausted).toBe(i === 2);
    }
    expect(j.status).toBe("needs_attention");
    const [a] = await d.select().from(applications).where(eq(applications.id, (r as { applicationId: string }).applicationId));
    expect(a.status).toBe("needs_attention");
    expect(a.statusReason).toContain("503");
  });
  it("quota parking spends no attempt and resumes safely", async () => {
    await intake(A, app(8), [], "form");
    const [j] = await d.select().from(jobs);
    await park(j, "Daily spend cap reached");
    expect((await d.select().from(jobs))[0].status).toBe("paused");
    expect(await resumeParked()).toBe(1);
    const [after] = await d.select().from(jobs);
    expect(after.status).toBe("queued");
    expect(after.attempts).toBe(0);
  });
});

describe("[check-9] budget & privacy guards", () => {
  it("the daily spend cap pauses the system and blocks further calls", async () => {
    await d.insert(modelCalls).values({ env: "test", step: "x", promptKey: "x", promptVersion: "v1", model: "m", route: "direct", status: "ok", costUsd: "1.000001" });
    await expect(assertQuota()).rejects.toBeInstanceOf(QuotaError);
    expect((await getPause()).paused).toBe(true);
    await expect(assertQuota()).rejects.toThrow(/paused/i);
    await setPause({ paused: false });
  });
  it("a prompt containing founder PII is blocked before any network call and logged", async () => {
    await expect(callModel({
      promptKey: "t", promptVersion: "v1", tier: "fast", system: "s", user: "Founder Asha Verma, asha@x.com", schema: ClaimsOut, ctx: { step: "t" },
      forbidden: [{ code: "F1", name: "Asha Verma", email: "asha@x.com" }],
    })).rejects.toBeInstanceOf(ModelError);
    const [row] = await d.select().from(modelCalls);
    expect(row.error).toMatch(/PII/);
  });
});

async function decidedApp(outcome: "GO" | "HOLD", withEmail = true) {
  const r = (await intake(A, app(Math.floor(Math.random() * 1e6), { founders: [{ name: "Test Founder", email: "founder@example.com" }] }), [], "form")) as { applicationId: string };
  await d.update(applications).set({ status: "decided", finalOutcome: outcome, recommendation: outcome }).where(eq(applications.id, r.applicationId));
  const partner = await user("partner");
  await d.insert((await import("@/db/schema")).decisions).values({ applicationId: r.applicationId, stage: "partner_signoff", actorId: partner.id, outcome });
  const [f] = await d.select().from(founders).where(eq(founders.applicationId, r.applicationId));
  const [t] = await d.insert(outreachThreads).values({ applicationId: r.applicationId, founderId: f.id, status: "awaiting_approval" }).returning();
  const [e] = withEmail ? await d.insert(emails).values({ threadId: t.id, direction: "out", kind: "first", subject: "s", bodyDraft: "Hi {{first_name}},", bodyFinal: "Hi {{first_name}},", status: "draft" }).returning() : [];
  return { appId: r.applicationId, thread: t, email: e };
}

describe("[check-6/7] human gates on outreach", () => {
  it("HOLD blocks outreach even if a draft exists", async () => {
    const { email } = await decidedApp("HOLD");
    const riya = await user("associate");
    await expect(approveAndSend(riya, email.id, "Hi", "Subj")).rejects.toBeInstanceOf(GateError);
  });
  it("GO + Riya's approval sends once (simulation); a second send is refused", async () => {
    const { email } = await decidedApp("GO");
    const riya = await user("associate");
    const r = await approveAndSend(riya, email.id, "Hi {{first_name}}, body", "Subj");
    expect(r.mode).toBe("simulate");
    await expect(approveAndSend(riya, email.id, "Hi again", "Subj")).rejects.toThrow(/duplicate|Already/i);
    const [row] = await d.select().from(emails).where(eq(emails.id, email.id));
    expect(row.status).toBe("simulated");
  });
  it("suppressed recipients are never emailed", async () => {
    const { email } = await decidedApp("GO");
    await d.insert(suppressionList).values({ emailHash: hashEmail("founder@example.com"), reason: "declined" });
    await expect(approveAndSend(await user("associate"), email.id, "x", "y")).rejects.toThrow(/suppression/);
  });
  it("follow-up cap: a third follow-up is refused (boundary)", async () => {
    const { thread, email } = await decidedApp("GO");
    await d.update(outreachThreads).set({ followupsSent: 2 }).where(eq(outreachThreads.id, thread.id));
    await d.update(emails).set({ kind: "follow_up" }).where(eq(emails.id, email.id));
    await expect(approveAndSend(await user("associate"), email.id, "x", "y")).rejects.toThrow(/cap/);
  });
  it("a decline stops the thread, suppresses the founder and discards pending drafts", async () => {
    const { thread } = await decidedApp("GO");
    await applyIntent(thread.id, "not_interested", [], null, null);
    const [t] = await d.select().from(outreachThreads).where(eq(outreachThreads.id, thread.id));
    expect(t.status).toBe("stopped");
    expect((await d.select().from(suppressionList)).length).toBe(1);
    expect((await d.select().from(emails).where(eq(emails.threadId, thread.id)))[0].status).toBe("discarded");
  });
  it("ambiguous replies go to a human (thread stopped, no suppression)", async () => {
    const { thread } = await decidedApp("GO");
    await applyIntent(thread.id, "ambiguous", [], null, null);
    expect((await d.select().from(outreachThreads).where(eq(outreachThreads.id, thread.id)))[0].stopReason).toMatch(/Ambiguous/);
    expect((await d.select().from(suppressionList)).length).toBe(0);
  });
});

describe("[check-4/6] review state machine", () => {
  it("GO sign-off is impossible while a portfolio conflict is open; clearing it allows GO", async () => {
    const r = (await intake(A, app(55), [], "form")) as { applicationId: string };
    await d.update(applications).set({ status: "awaiting_partner", recommendation: "HOLD" }).where(eq(applications.id, r.applicationId));
    const [c] = await d.insert(conflicts).values({ applicationId: r.applicationId, portfolioCompany: "MeetRecord", reason: "direct" }).returning();
    const kushal = await user("partner");
    await expect(partnerSignoff(kushal, r.applicationId, "GO", "")).rejects.toBeInstanceOf(ReviewError);
    await resolveConflict(kushal, c.id, "cleared", "Different customer segment");
    await partnerSignoff(kushal, r.applicationId, "GO", "");
    expect((await d.select().from(applications).where(eq(applications.id, r.applicationId)))[0].finalOutcome).toBe("GO");
    expect((await d.select().from(jobs).where(eq(jobs.kind, "draft_email"))).length).toBe(1);
  });
  it("an overturn needs a reason and becomes a PROPOSED correction", async () => {
    const r = (await intake(A, app(56), [], "form")) as { applicationId: string };
    await d.update(applications).set({ status: "awaiting_review", recommendation: "GO" }).where(eq(applications.id, r.applicationId));
    const riya = await user("associate");
    await expect(associateReview(riya, r.applicationId, "PASS", "")).rejects.toBeInstanceOf(ReviewError);
    await associateReview(riya, r.applicationId, "PASS", "Repeat rate not tracked; should drag the score");
    const [c] = await d.select().from(corrections);
    expect(c.status).toBe("proposed");
  });
  it("cannot sign off an application that skipped Riya's review", async () => {
    const r = (await intake(A, app(57), [], "form")) as { applicationId: string };
    await expect(partnerSignoff(await user("partner"), r.applicationId, "GO", "")).rejects.toBeInstanceOf(ReviewError);
  });
});

describe("[check-8] thesis versioning and memory", () => {
  it("a draft thesis cannot be approved without a finished backtest, nor activated without approval", async () => {
    const v0 = await ensureV0();
    const kushal = await user("partner");
    await expect(activateVersion(kushal, v0.id)).rejects.toThrow();
    await expect(approveVersion(kushal, v0.id)).rejects.toThrow(/backtest/i);
    await d.insert(backtestRuns).values({ thesisVersionId: v0.id, split: "tune", status: "done", finishedAt: new Date() });
    await approveVersion(kushal, v0.id);
    await activateVersion(kushal, v0.id);
    expect((await d.select().from(thesisVersions).where(eq(thesisVersions.status, "active"))).length).toBe(1);
  });
  it("only approved corrections dated BEFORE the decision are retrieved (point-in-time)", async () => {
    const mk = (lesson: string, status: "approved" | "proposed", at: string, topic: string) => d.insert(corrections).values({ kind: "overturn", sector: "Fintech", lesson, status, effectiveAt: new Date(at), topic, authorLabel: "Riya", provenance: "test" });
    await mk("Lending founders must own credit risk", "approved", "2026-01-01", "credit");
    await mk("Future lesson about lending credit risk founders", "approved", "2026-09-01", "future");
    await mk("Unapproved lesson about lending credit risk", "proposed", "2025-01-01", "unapproved");
    const r = await relevantCorrections({ sector: "Fintech", stage: "Seed", text: "lending app, founders credit risk", asOf: new Date("2026-06-01") });
    expect(r.chosen.map((c) => c.lesson)).toEqual(["Lending founders must own credit risk"]);
  });
  it("conflicting corrections on the same topic: the newest wins", async () => {
    await d.insert(corrections).values([
      { kind: "overturn", sector: "Fintech", lesson: "Old: deeptech regulatory path is a dealbreaker", status: "approved", effectiveAt: new Date("2025-01-01"), topic: "reg", authorLabel: "Riya", provenance: "t" },
      { kind: "overturn", sector: "Fintech", lesson: "New: deeptech regulatory path is fine with strong team", status: "approved", effectiveAt: new Date("2026-01-01"), topic: "reg", authorLabel: "Riya", provenance: "t" },
    ]);
    const r = await relevantCorrections({ sector: "Fintech", stage: null, text: "deeptech regulatory path team", asOf: new Date("2026-06-01") });
    expect(r.chosen.length).toBe(1);
    expect(r.chosen[0].lesson).toMatch(/^New/);
    expect(r.superseded.length).toBe(1);
  });
  it("irrelevant corrections are not applied", async () => {
    await d.insert(corrections).values({ kind: "overturn", sector: "Consumer brands", lesson: "Ethnic wear brands need repeat beyond paid ads", status: "approved", effectiveAt: new Date("2025-01-01"), topic: "x", authorLabel: "Riya", provenance: "t" });
    const r = await relevantCorrections({ sector: "Deeptech", stage: null, text: "underwater inspection robots for dams", asOf: new Date() });
    expect(r.chosen.length).toBe(0);
  });
});

describe("[check-9] no unapproved thesis is used for live screening", () => {
  it("no active thesis → screening job ends in needs_attention with a reason", async () => {
    const { runScreen, PipelineError } = await import("@/lib/pipeline/screen");
    await intake(A, app(77), [], "form");
    const [j] = await d.select().from(jobs);
    await expect(runScreen(j, "w", "t")).rejects.toBeInstanceOf(PipelineError);
    expect((await d.select().from(thesisVersions).where(and(eq(thesisVersions.status, "active")))).length).toBe(0);
  });
});
