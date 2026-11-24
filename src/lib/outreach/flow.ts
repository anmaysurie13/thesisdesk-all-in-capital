import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { applications, claims, decisions, emails, founders, meetings, outreachThreads, suppressionList } from "@/db/schema";
import { callModel } from "@/lib/ai/gateway";
import { EmailOut, emailPrompt, FollowupOut, followupPrompt, ReplyOut, replyPrompt } from "@/lib/ai/prompts";
import { audit, SYSTEM, type Actor } from "@/lib/audit";
import { env, followupDays } from "@/lib/env";
import { redact } from "@/lib/pii";
import { enqueue, type Job } from "@/lib/queue/jobs";
import { availableSlots, formatSlot, schedulingLink } from "@/lib/scheduling/calendly";
import { emailExamples, proposeCorrection } from "@/lib/thesis/memory";
import { resendSend, stripQuoted } from "./resend";

export const hashEmail = (e: string) => createHash("sha256").update(e.trim().toLowerCase()).digest("hex");

/** Code checks of Riya's standard; shown to Riya as warnings, never auto-fixed silently. */
export function lintDraft(body: string, needsLink: boolean): string[] {
  const issues: string[] = [];
  const words = body.replace(/\{\{[^}]+\}\}/g, "x").split(/\s+/).filter(Boolean).length;
  if (!/^Hi \{\{first_name\}\},/m.test(body.trim())) issues.push('Greeting should be "Hi {{first_name}},"');
  if (words > 110) issues.push(`Too long: ${words} words (Riya's emails are under ~90)`);
  if (!/Riya\s*\n\s*All In Capital\s*$/.test(body.trim())) issues.push('Sign-off must be "Riya / All In Capital"');
  if (/best regards|excited|thrilled|impressive/i.test(body)) issues.push("Generic praise or sign-off Riya removes");
  if ((body.match(/\?/g) ?? []).length > 2) issues.push("More than one clear ask");
  if (needsLink && !body.includes("{{scheduling_link}}") && !/calendly\.com/.test(body)) issues.push("Missing the scheduling link");
  return issues;
}

/** Called after partner sign-off = GO. HOLD/PASS never reach here (server-checked again at send time). */
export async function startOutreach(applicationId: string) {
  const [f] = await db().select().from(founders).where(eq(founders.applicationId, applicationId)).orderBy(founders.founderCode).limit(1);
  const [thread] = await db().insert(outreachThreads).values({ applicationId, founderId: f?.id ?? null, status: "drafting" })
    .onConflictDoNothing({ target: outreachThreads.applicationId }).returning();
  const t = thread ?? (await db().select().from(outreachThreads).where(eq(outreachThreads.applicationId, applicationId)))[0];
  await enqueue({ kind: "draft_email", applicationId, payload: { threadId: t.id }, idempotencyKey: `draft_first:${t.id}`, env: env().APP_ENV });
  return t;
}

export async function draftFirstEmail(job: Job, traceId: string) {
  const threadId = String(job.payload.threadId);
  const [t] = await db().select().from(outreachThreads).where(eq(outreachThreads.id, threadId));
  const [a] = await db().select().from(applications).where(eq(applications.id, t.applicationId));
  const fs = await db().select().from(founders).where(eq(founders.applicationId, a.id));
  const cl = await db().select().from(claims).where(eq(claims.applicationId, a.id));
  const forb = fs.map((f) => ({ code: f.founderCode, name: f.name, email: f.email, phone: f.phone, linkedin: f.linkedin }));
  const facts = cl.filter((c) => c.metric).sort((x, y) => (x.verification === "verified" ? -1 : 0) - (y.verification === "verified" ? -1 : 0))
    .slice(0, 5).map((c) => `${redact(c.text, forb)}${c.verification === "verified" ? " (verified)" : " (founder claim)"}`);
  const av = await availableSlots();
  const slots = av.slots.length ? av.slots.map(formatSlot) : ["Tuesday afternoon", "Thursday afternoon"];
  const examples = (await emailExamples({ sector: a.sector, stage: a.stage })).map((x) => ({ draft: redact(x.draft, forb), final: redact(x.final, forb) }));
  const { data } = await callModel({
    promptKey: emailPrompt.key, promptVersion: emailPrompt.version, tier: "primary", system: emailPrompt.system,
    user: emailPrompt.user({ company: a.companyName, stage: a.stage, sector: a.sector, facts, slots, technical_review: a.needsTechnicalReview, examples }),
    schema: EmailOut, forbidden: forb,
    ctx: { applicationId: a.id, jobId: job.id, runId: job.runId, step: "email.draft", traceId },
  });
  await db().insert(emails).values({
    threadId, direction: "out", kind: "first", subject: data.subject, bodyDraft: data.body, bodyFinal: data.body, status: "draft",
    promptVersion: `${emailPrompt.key}@${emailPrompt.version}`,
    error: av.source !== "calendly" ? "Slots are generic: Calendly availability not configured (not checked against the calendar)" : null,
  });
  await db().update(outreachThreads).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(outreachThreads.id, threadId));
  return { slots: av.source };
}

function render(body: string, firstName: string, link: string | null) {
  return body.replaceAll("{{first_name}}", firstName).replaceAll("{{scheduling_link}}", link ?? "(scheduling link not configured)");
}

export class GateError extends Error {}

/**
 * The ONLY path to send an email. Server-side gates:
 *  - actor is the associate (Riya) — checked by caller via requirePermission('approve_send_email')
 *  - partner sign-off exists with outcome GO; HOLD/PASS/REQUEST_INFO block
 *  - thread not stopped, recipient not suppressed, follow-up cap respected
 *  - atomic draft→sending claim + Resend Idempotency-Key → no duplicate sends
 */
export async function approveAndSend(actor: Actor, emailId: string, editedBody: string, editedSubject: string) {
  const e = env();
  const [em] = await db().select().from(emails).where(eq(emails.id, emailId));
  if (!em || em.direction !== "out") throw new GateError("Email not found");
  const [t] = await db().select().from(outreachThreads).where(eq(outreachThreads.id, em.threadId));
  const [a] = await db().select().from(applications).where(eq(applications.id, t.applicationId));
  const [signoff] = await db().select().from(decisions)
    .where(and(eq(decisions.applicationId, a.id), eq(decisions.stage, "partner_signoff"))).orderBy(desc(decisions.createdAt)).limit(1);
  if (!signoff || signoff.outcome !== "GO" || a.finalOutcome !== "GO") {
    await audit(actor, "email.send.blocked", "email", emailId, { reason: "no GO sign-off" }, false);
    throw new GateError("Blocked: outreach requires a partner GO sign-off (HOLD/PASS block outreach).");
  }
  if (t.status === "stopped" || t.status === "closed") throw new GateError(`Blocked: thread is ${t.status} (${t.stopReason ?? ""})`);
  if (em.kind === "follow_up" && t.followupsSent >= e.FOLLOWUP_MAX) throw new GateError("Blocked: follow-up cap reached");

  const [f] = t.founderId ? await db().select().from(founders).where(eq(founders.id, t.founderId)) : [];
  const realTo = f?.email ?? null;
  if (realTo) {
    const [sup] = await db().select().from(suppressionList).where(eq(suppressionList.emailHash, hashEmail(realTo)));
    if (sup) throw new GateError(`Blocked: recipient is on the suppression list (${sup.reason})`);
  }

  // Atomic claim: only one request can move this email out of draft.
  const claimed = await db().update(emails).set({ status: "sending", bodyFinal: editedBody, subject: editedSubject, approvedBy: actor.id, approvedAt: new Date() })
    .where(and(eq(emails.id, emailId), inArray(emails.status, ["draft", "approved"]))).returning({ id: emails.id });
  if (!claimed.length) throw new GateError("Already sent or in progress — duplicate send prevented.");

  const firstName = (f?.name ?? "").split(/\s+/)[0] || "there";
  const text = render(editedBody, firstName, schedulingLink(t.id));
  const mode = e.EMAIL_MODE;
  const allow = (e.EMAIL_TEST_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const to = mode === "test" ? allow[0] : realTo;
  const inbound = e.RESEND_INBOUND_ADDRESS;
  const replyTo = inbound ? inbound.replace(/^([^@]*)@/, (_m, local) => `${local ? `${local}+` : ""}t-${t.id}@`) : undefined;

  try {
    let resendId: string | null = null;
    if (mode === "simulate") {
      // No network call. Clearly labelled in the UI as SIMULATED.
    } else {
      if (!to) throw new GateError(mode === "test" ? "EMAIL_TEST_ALLOWLIST is empty" : "Founder has no email address");
      if (mode === "live" && !/@/.test(e.RESEND_FROM ?? "")) throw new GateError("Live mode needs a verified RESEND_FROM domain");
      const r = await resendSend({ to, subject: editedSubject, text, idempotencyKey: `email:${emailId}`, replyTo, inReplyTo: t.lastMessageId, references: t.references || null });
      resendId = r.id;
    }
    const sentAt = new Date();
    await db().update(emails).set({ status: mode === "simulate" ? "simulated" : "sent", mode, sentAt, resendId, toAddress: to ? (mode === "test" ? to : "[founder]") : null, idempotencyKey: `email:${emailId}` })
      .where(eq(emails.id, emailId));
    const days = followupDays();
    const n = em.kind === "follow_up" ? t.followupsSent + 1 : t.followupsSent;
    const nextDay = days[n];
    await db().update(outreachThreads).set({
      status: "sent", followupsSent: n, updatedAt: new Date(),
      nextFollowupAt: n < e.FOLLOWUP_MAX && nextDay ? new Date(sentAt.getTime() + (nextDay - (n ? days[n - 1] : 0)) * 86400_000) : null,
    }).where(eq(outreachThreads.id, t.id));
    if (schedulingLink(t.id) && em.kind === "first") {
      await db().insert(meetings).values({ applicationId: a.id, threadId: t.id, status: "link_sent" }).onConflictDoNothing();
    }
    // Loop 3 memory: Riya's edit (or no-edit) becomes a style example.
    await proposeCorrection(actor, {
      kind: "email_edit", applicationId: a.id, sector: a.sector, stage: a.stage, topic: `email:${em.kind}`,
      before: { text: em.bodyDraft ?? "" }, after: { text: editedBody, changed: (em.bodyDraft ?? "").trim() !== editedBody.trim() },
      lesson: (em.bodyDraft ?? "").trim() === editedBody.trim() ? "Draft sent unchanged" : "Riya edited the draft before sending",
      authorLabel: "Riya (associate)", provenance: `email ${emailId}`,
    }, true);
    await audit(actor, "email.send", "email", emailId, { mode, kind: em.kind });
    return { mode, resendId };
  } catch (err) {
    await db().update(emails).set({ status: "failed", error: err instanceof Error ? err.message.slice(0, 300) : "send failed" }).where(eq(emails.id, emailId));
    await audit(actor, "email.send.failed", "email", emailId, { error: String(err).slice(0, 200) }, false);
    throw err;
  }
}

/** Inbound reply (webhook or manual entry). Any reply stops scheduled follow-ups. */
export async function recordInbound(threadId: string, body: string, opts: { source: "webhook" | "manual"; messageId?: string | null; subject?: string }) {
  const [t] = await db().select().from(outreachThreads).where(eq(outreachThreads.id, threadId));
  if (!t) throw new Error("Thread not found");
  if (opts.messageId) {
    const [dupe] = await db().select({ id: emails.id }).from(emails).where(and(eq(emails.threadId, threadId), eq(emails.messageId, opts.messageId)));
    if (dupe) return { duplicate: true, emailId: dupe.id };
  }
  const [row] = await db().insert(emails).values({
    threadId, direction: "in", kind: "inbound", subject: opts.subject ?? "(reply)", bodyFinal: stripQuoted(body), status: "received",
    messageId: opts.messageId ?? null, intentSource: opts.source === "manual" ? "manual" : null,
  }).returning();
  const refs = [t.references, opts.messageId].filter(Boolean).join(" ").trim();
  await db().update(outreachThreads).set({ status: "replied", nextFollowupAt: null, lastMessageId: opts.messageId ?? t.lastMessageId, references: refs, updatedAt: new Date() })
    .where(eq(outreachThreads.id, threadId));
  await enqueue({ kind: "classify_reply", applicationId: t.applicationId, payload: { emailId: row.id, threadId }, idempotencyKey: `classify:${row.id}`, env: env().APP_ENV });
  return { duplicate: false, emailId: row.id };
}

export async function stopThread(threadId: string, reason: string, suppress: boolean) {
  const [t] = await db().update(outreachThreads).set({ status: "stopped", stopReason: reason, nextFollowupAt: null, updatedAt: new Date() })
    .where(eq(outreachThreads.id, threadId)).returning();
  if (suppress && t?.founderId) {
    const [f] = await db().select().from(founders).where(eq(founders.id, t.founderId));
    if (f?.email) await db().insert(suppressionList).values({ emailHash: hashEmail(f.email), reason }).onConflictDoNothing();
  }
  // Pending drafts on a stopped thread can never be sent.
  await db().update(emails).set({ status: "discarded" }).where(and(eq(emails.threadId, threadId), eq(emails.status, "draft")));
}

export async function classifyReply(job: Job, traceId: string) {
  const emailId = String(job.payload.emailId);
  const [em] = await db().select().from(emails).where(eq(emails.id, emailId));
  const [t] = await db().select().from(outreachThreads).where(eq(outreachThreads.id, em.threadId));
  const fs = await db().select().from(founders).where(eq(founders.applicationId, t.applicationId));
  const forb = fs.map((f) => ({ code: f.founderCode, name: f.name, email: f.email, phone: f.phone, linkedin: f.linkedin }));
  const { data } = await callModel({
    promptKey: replyPrompt.key, promptVersion: replyPrompt.version, tier: "fast", system: replyPrompt.system,
    user: replyPrompt.user(redact(em.bodyFinal ?? "", forb)), schema: ReplyOut, forbidden: forb,
    ctx: { applicationId: t.applicationId, jobId: job.id, runId: job.runId, step: "reply.classify", traceId },
  });
  const intent = data.confidence < 0.7 ? "ambiguous" : data.intent;
  await db().update(emails).set({ intent, intentConfidence: data.confidence, intentSource: "model", promptVersion: `${replyPrompt.key}@${replyPrompt.version}` }).where(eq(emails.id, emailId));
  await applyIntent(t.id, intent, data.proposed_times, job, traceId);
  return { intent };
}

/** Deterministic routing of a classified reply. Ambiguous → human; decline/bounce → stop + suppress. */
export async function applyIntent(threadId: string, intent: string, proposed: string[], job: Job | null, traceId: string | null) {
  const [t] = await db().select().from(outreachThreads).where(eq(outreachThreads.id, threadId));
  if (intent === "not_interested") return stopThread(threadId, "Founder declined", true);
  if (intent === "bounce") return stopThread(threadId, "Bounced", true);
  if (intent === "ambiguous") return stopThread(threadId, "Ambiguous reply — needs Riya", false);
  if (intent === "out_of_office") {
    await db().update(outreachThreads).set({ status: "sent", nextFollowupAt: new Date(Date.now() + 3 * 86400_000) }).where(eq(outreachThreads.id, threadId));
    return;
  }
  if (intent === "reschedule") {
    const [m] = await db().select().from(meetings).where(eq(meetings.threadId, threadId)).orderBy(desc(meetings.createdAt)).limit(1);
    const rounds = (m?.counterProposals ?? 0) + 1;
    if (m) await db().update(meetings).set({ counterProposals: rounds }).where(eq(meetings.id, m.id));
    if (rounds > 2) return stopThread(threadId, "Counter-proposal cap reached — escalated to Riya", false);
  }
  if (!job) return;
  const av = await availableSlots();
  const purpose = intent === "needs_info" ? "Answer the founder's questions briefly and keep the call ask." :
    intent === "reschedule" ? `Founder proposed other times (${proposed.join(", ") || "unspecified"}). Offer these free slots instead: ${av.slots.map(formatSlot).join(" or ") || "the scheduling link"}.` :
    "Founder is interested. Confirm and point to the scheduling link.";
  const { data } = await callModel({
    promptKey: followupPrompt.key, promptVersion: followupPrompt.version, tier: "fast", system: followupPrompt.system,
    user: followupPrompt.user({ purpose, context: `Intent: ${intent}` }), schema: FollowupOut,
    ctx: { applicationId: t.applicationId, jobId: job.id, runId: job.runId, step: "reply.respond", traceId },
  });
  await db().insert(emails).values({ threadId, direction: "out", kind: "response", subject: data.subject, bodyDraft: data.body, bodyFinal: data.body, status: "draft", promptVersion: `${followupPrompt.key}@${followupPrompt.version}` });
}

/** Day-3/day-7 follow-ups: drafted on schedule, sent only after Riya approves. Max FOLLOWUP_MAX. */
export async function followupScan(job: Job, traceId: string) {
  const due = await db().select().from(outreachThreads).where(and(eq(outreachThreads.status, "sent"), isNotNull(outreachThreads.nextFollowupAt), lte(outreachThreads.nextFollowupAt, new Date())));
  let drafted = 0;
  for (const t of due) {
    if (t.followupsSent >= env().FOLLOWUP_MAX) { await db().update(outreachThreads).set({ nextFollowupAt: null }).where(eq(outreachThreads.id, t.id)); continue; }
    const [pending] = await db().select({ id: emails.id }).from(emails).where(and(eq(emails.threadId, t.id), eq(emails.kind, "follow_up"), eq(emails.status, "draft")));
    if (pending) continue;
    const [a] = await db().select().from(applications).where(eq(applications.id, t.applicationId));
    if (a.finalOutcome !== "GO") continue;
    const { data } = await callModel({
      promptKey: followupPrompt.key, promptVersion: followupPrompt.version, tier: "fast", system: followupPrompt.system,
      user: followupPrompt.user({ purpose: `Follow-up #${t.followupsSent + 1}: no reply yet. Gentle nudge, keep the 30-minute call ask.`, context: `${a.companyName}, ${a.stage ?? ""} ${a.sector ?? ""}` }),
      schema: FollowupOut, ctx: { applicationId: a.id, jobId: job.id, runId: job.runId, step: "email.followup", traceId },
    });
    await db().insert(emails).values({ threadId: t.id, direction: "out", kind: "follow_up", subject: data.subject, bodyDraft: data.body, bodyFinal: data.body, status: "draft", promptVersion: `${followupPrompt.key}@${followupPrompt.version}` });
    await db().update(outreachThreads).set({ nextFollowupAt: null }).where(eq(outreachThreads.id, t.id));
    drafted++;
  }
  return { due: due.length, drafted };
}

/** Delivery webhooks. */
export async function applyDeliveryEvent(type: string, resendId: string) {
  const [em] = await db().select().from(emails).where(eq(emails.resendId, resendId));
  if (!em) return { matched: false };
  if (type === "email.delivered") await db().update(emails).set({ status: "delivered" }).where(and(eq(emails.id, em.id), ne(emails.status, "bounced")));
  if (type === "email.bounced" || type === "email.complained") {
    await db().update(emails).set({ status: "bounced" }).where(eq(emails.id, em.id));
    await stopThread(em.threadId, type === "email.bounced" ? "Bounced" : "Marked as spam", true);
  }
  if (type === "email.failed") await db().update(emails).set({ status: "failed", error: "Resend reported failure" }).where(eq(emails.id, em.id));
  await audit(SYSTEM, `webhook.${type}`, "email", em.id, {});
  return { matched: true };
}
