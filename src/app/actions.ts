"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { backtestResults, emails, meetings, outreachThreads, portfolioCompanies, reviewTimings, users, OUTCOMES, ROLES } from "@/db/schema";
import { callModel } from "@/lib/ai/gateway";
import { CallOut, callPrompt } from "@/lib/ai/prompts";
import { audit } from "@/lib/audit";
import { adjudicate, startBacktest } from "@/lib/backtest";
import { applyIntent, approveAndSend, recordInbound, stopThread } from "@/lib/outreach/flow";
import { resumeParked, retryNeedsAttention } from "@/lib/queue/jobs";
import { runTick } from "@/lib/queue/worker";
import { associateReview, correctScore, partnerSignoff, resolveConflict, technicalReview } from "@/lib/review";
import { requirePermission } from "@/lib/session";
import { setPause } from "@/lib/state";
import { activateVersion, approveVersion, proposeVersion, rejectVersion } from "@/lib/thesis/service";
import { decideCorrection, proposeCorrection } from "@/lib/thesis/memory";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
const Outcome = z.enum(OUTCOMES);

export async function reviewAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const stage = String(fd.get("stage"));
    const appId = String(fd.get("applicationId"));
    const outcome = Outcome.parse(fd.get("outcome"));
    const note = String(fd.get("note") ?? "");
    if (stage === "associate") {
      const u = await requirePermission("associate_review");
      await associateReview(u.actor, appId, outcome, note, Number(fd.get("seconds") ?? 0) || undefined);
    } else if (stage === "technical") {
      const u = await requirePermission("technical_review");
      await technicalReview(u.actor, appId, outcome, note);
    } else {
      const u = await requirePermission("partner_signoff");
      await partnerSignoff(u.actor, appId, outcome, note);
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Decision recorded" };
  } catch (e) { return fail(e); }
}

export async function conflictAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("clear_conflict");
    await resolveConflict(u.actor, String(fd.get("conflictId")), fd.get("status") === "confirmed" ? "confirmed" : "cleared", String(fd.get("note") ?? ""));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function scoreCorrectionAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("propose_correction");
    await correctScore(u.actor, String(fd.get("applicationId")), String(fd.get("criterionKey")), z.coerce.number().int().min(1).max(5).parse(fd.get("score")), String(fd.get("reason") ?? ""));
    revalidatePath("/", "layout");
    return { ok: true, message: "Correction proposed — a partner approves it before it is reused" };
  } catch (e) { return fail(e); }
}

export async function reviewTimerAction(applicationId: string, openedAtIso: string, seconds: number) {
  const { currentUser } = await import("@/lib/session");
  if (!(await currentUser())) return; // guests' viewing time is not a review
  const u = await requirePermission("view");
  if (seconds <= 0 || seconds > 4 * 3600) return;
  await db().insert(reviewTimings).values({ applicationId, userId: u.id, openedAt: new Date(openedAtIso), closedAt: new Date(), seconds: Math.round(seconds) });
}

export async function sendEmailAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("approve_send_email");
    if (fd.get("confirm") !== "yes") return { ok: false, error: "Tick the confirmation box to send." };
    const r = await approveAndSend(u.actor, String(fd.get("emailId")), String(fd.get("body") ?? ""), String(fd.get("subject") ?? ""));
    revalidatePath("/", "layout");
    return { ok: true, message: r.mode === "simulate" ? "Simulated — nothing left the system" : `Sent via Resend (${r.mode})` };
  } catch (e) { return fail(e); }
}

export async function saveDraftAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    await requirePermission("edit_draft");
    await db().update(emails).set({ bodyFinal: String(fd.get("body") ?? ""), subject: String(fd.get("subject") ?? "") })
      .where(and(eq(emails.id, String(fd.get("emailId"))), eq(emails.status, "draft")));
    revalidatePath("/founders");
    return { ok: true, message: "Draft saved" };
  } catch (e) { return fail(e); }
}

export async function manualReplyAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("record_reply");
    const threadId = String(fd.get("threadId"));
    const body = String(fd.get("body") ?? "").trim();
    if (body.length < 2) return { ok: false, error: "Paste the founder's reply" };
    const r = await recordInbound(threadId, body, { source: "manual", subject: "Reply (entered manually)" });
    const intent = String(fd.get("intent") ?? "");
    if (intent && intent !== "auto") {
      await db().update(emails).set({ intent: intent as never, intentSource: "manual", intentConfidence: 1 }).where(eq(emails.id, r.emailId));
      await applyIntent(threadId, intent, [], null, null);
    }
    await audit(u.actor, "reply.manual", "thread", threadId, { intent: intent || "auto" });
    revalidatePath("/founders");
    return { ok: true, message: intent && intent !== "auto" ? "Reply recorded" : "Reply recorded — classification queued" };
  } catch (e) { return fail(e); }
}

export async function stopThreadAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("approve_send_email");
    await stopThread(String(fd.get("threadId")), String(fd.get("reason") || "Stopped by Riya"), fd.get("suppress") === "on");
    await audit(u.actor, "thread.stop", "thread", String(fd.get("threadId")), {});
    revalidatePath("/founders");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function manualMeetingAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("confirm_meeting");
    const threadId = String(fd.get("threadId"));
    const start = new Date(String(fd.get("start")));
    if (Number.isNaN(start.getTime())) return { ok: false, error: "Enter the confirmed start time" };
    const [t] = await db().select().from(outreachThreads).where(eq(outreachThreads.id, threadId));
    await db().update(meetings).set({ status: "rescheduled" }).where(and(eq(meetings.applicationId, t.applicationId), eq(meetings.status, "scheduled")));
    await db().insert(meetings).values({ applicationId: t.applicationId, threadId, status: "scheduled", startTime: start, endTime: new Date(start.getTime() + 30 * 60_000), confirmedVia: "manual", notes: String(fd.get("note") ?? "") });
    await db().update(outreachThreads).set({ status: "meeting_booked", nextFollowupAt: null }).where(eq(outreachThreads.id, threadId));
    await audit(u.actor, "meeting.confirm_manual", "thread", threadId, { start: start.toISOString() });
    revalidatePath("/meetings");
    return { ok: true, message: "Recorded as MANUALLY confirmed (not verified by Calendly)" };
  } catch (e) { return fail(e); }
}

export async function callOutcomeAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("record_call_outcome");
    const meetingId = String(fd.get("meetingId"));
    const notes = String(fd.get("notes") ?? "").trim();
    const status = fd.get("status") === "no_show" ? "no_show" : "completed";
    const [m] = await db().select().from(meetings).where(eq(meetings.id, meetingId));
    if (!m || m.status !== "scheduled") return { ok: false, error: "Only a scheduled meeting can get an outcome" };
    let lesson = notes;
    if (notes.length > 40) {
      const { data } = await callModel({ promptKey: callPrompt.key, promptVersion: callPrompt.version, tier: "fast", system: callPrompt.system, user: callPrompt.user(notes), schema: CallOut, ctx: { applicationId: m.applicationId, step: "call.summary" } });
      lesson = `${data.summary} Learnings: ${data.learnings.join("; ")}`;
    }
    await db().update(meetings).set({ status, outcome: String(fd.get("outcome") ?? ""), notes, updatedAt: new Date() }).where(eq(meetings.id, meetingId));
    if (lesson) await proposeCorrection(u.actor, { kind: "call_outcome", applicationId: m.applicationId, topic: `call:${meetingId}`, lesson: lesson.slice(0, 1500), authorLabel: u.name, provenance: `meeting ${meetingId}` });
    revalidatePath("/meetings");
    return { ok: true, message: "Call outcome stored; the learning awaits partner approval" };
  } catch (e) { return fail(e); }
}

export async function correctionDecisionAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("approve_correction");
    await decideCorrection(u.actor, String(fd.get("id")), fd.get("decision") === "approve");
    revalidatePath("/thesis");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function thesisAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const op = String(fd.get("op"));
    const id = String(fd.get("id"));
    if (op === "propose") {
      const u = await requirePermission("propose_thesis");
      const parentId = id;
      const weights = JSON.parse(String(fd.get("weights") ?? "{}")) as Record<string, number>;
      const { thesisById } = await import("@/lib/thesis/service");
      const parent = await thesisById(parentId);
      if (!parent) throw new Error("Parent not found");
      const criteria = parent.criteria.map((c) => ({ ...c, weight: weights[c.key] ?? c.weight }));
      await proposeVersion(u.actor, parentId, {
        criteria, goMin: Number(fd.get("goMin")) || parent.goMin, passMax: Number(fd.get("passMax")) || parent.passMax,
      }, String(fd.get("note") || "Proposed change"));
    } else if (op === "backtest") {
      const u = await requirePermission("run_backtest");
      await startBacktest(u.actor, id, (String(fd.get("split") || "tune") as "tune" | "sealed" | "all"));
    } else {
      const u = await requirePermission("approve_thesis");
      if (op === "approve") await approveVersion(u.actor, id);
      else if (op === "activate") await activateVersion(u.actor, id);
      else if (op === "reject") await rejectVersion(u.actor, id, String(fd.get("note") ?? ""));
    }
    revalidatePath("/", "layout");
    return { ok: true, message: op === "backtest" ? "Backtest queued — results appear under Evaluations" : "Done" };
  } catch (e) { return fail(e); }
}

export async function adjudicateAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("adjudicate");
    await adjudicate(u.actor, String(fd.get("id")), String(fd.get("verdict")) as "system_right" | "human_right" | "unclear", String(fd.get("note") ?? ""));
    revalidatePath("/evals");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function portfolioAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("propose_thesis");
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "Name is required" };
    await db().insert(portfolioCompanies).values({
      name, sector: String(fd.get("sector") || "") || null, description: String(fd.get("description") || "") || null,
      sourceUrl: String(fd.get("sourceUrl") || "") || null, sourceNote: String(fd.get("sourceNote") || "Added manually"), verified: fd.get("verified") === "on",
    }).onConflictDoNothing();
    await audit(u.actor, "portfolio.add", "portfolio", name, {});
    revalidatePath("/thesis");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function opsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("operate_system");
    const op = String(fd.get("op"));
    if (op === "pause") await setPause({ paused: true, reason: String(fd.get("reason") || "Paused manually"), by: u.name });
    if (op === "resume") {
      await setPause({ paused: false });
      const n = await resumeParked();
      await audit(u.actor, "system.resume", "system", null, { requeued: n });
      revalidatePath("/", "layout");
      return { ok: true, message: `Resumed; ${n} parked job(s) re-queued` };
    }
    if (op === "retry") await retryNeedsAttention(String(fd.get("jobId")));
    if (op === "tick") {
      const s = await runTick({ budgetMs: 50_000 });
      revalidatePath("/", "layout");
      return { ok: true, message: `Processed: ${s.done} done, ${s.retry} retrying, ${s.needs_attention} need attention${s.paused ? " (system paused)" : ""}` };
    }
    await audit(u.actor, `system.${op}`, "system", null, {});
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function userAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("manage_users");
    const parsed = z.object({ email: z.string().email(), name: z.string().min(2), role: z.enum(ROLES), password: z.string().min(12) }).safeParse(Object.fromEntries(fd));
    if (!parsed.success) return { ok: false, error: "Email, name, role and a 12+ character password are required" };
    await db().insert(users).values({ email: parsed.data.email.toLowerCase(), name: parsed.data.name, role: parsed.data.role, passwordHash: await bcrypt.hash(parsed.data.password, 12) });
    await audit(u.actor, "user.create", "user", parsed.data.email, { role: parsed.data.role });
    revalidatePath("/settings");
    return { ok: true, message: "User created" };
  } catch (e) { return fail(e); }
}

export async function deactivateUserAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission("manage_users");
    const id = String(fd.get("id"));
    if (id === u.id) return { ok: false, error: "You cannot deactivate yourself" };
    await db().update(users).set({ active: fd.get("active") === "true" }).where(eq(users.id, id));
    await audit(u.actor, "user.active", "user", id, { active: fd.get("active") });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function adjudicationList(runId: string) {
  await requirePermission("view");
  return db().select().from(backtestResults).where(eq(backtestResults.runId, runId));
}
