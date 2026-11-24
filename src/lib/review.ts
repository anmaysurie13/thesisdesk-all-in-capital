import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, conflicts, criterionScores, decisions, type Outcome } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { startOutreach } from "@/lib/outreach/flow";
import { proposeCorrection } from "@/lib/thesis/memory";

export class ReviewError extends Error {}

async function load(appId: string) {
  const [a] = await db().select().from(applications).where(eq(applications.id, appId));
  if (!a) throw new ReviewError("Application not found");
  return a;
}

/** Riya's call. An overturn needs a one-line reason and becomes a proposed correction (Loop 3). */
export async function associateReview(actor: Actor, appId: string, outcome: Outcome, note: string, reviewSeconds?: number) {
  const a = await load(appId);
  if (a.status !== "awaiting_review") throw new ReviewError(`Not awaiting associate review (status: ${a.status})`);
  const overturn = a.recommendation && a.recommendation !== outcome;
  if (overturn && note.trim().length < 8) throw new ReviewError("Overturning the AI recommendation needs a one-line reason.");
  await db().insert(decisions).values({ applicationId: appId, stage: "associate_review", actorId: actor.id!, outcome, aiRecommendation: a.recommendation, note, reviewSeconds });
  const next = a.needsTechnicalReview ? "awaiting_technical" : "awaiting_partner";
  await db().update(applications).set({ status: next, updatedAt: new Date() }).where(eq(applications.id, appId));
  if (overturn) {
    await proposeCorrection(actor, {
      kind: "overturn", applicationId: appId, sector: a.sector, stage: a.stage, topic: `overturn:${a.sector ?? "any"}:${note.slice(0, 40).toLowerCase()}`,
      before: { recommendation: a.recommendation, score: a.weightedScore }, after: { outcome }, lesson: note.trim(),
      authorLabel: "Riya (associate)", provenance: `application ${a.ref}`, effectiveAt: new Date(),
    });
  }
  await audit(actor, "review.associate", "application", appId, { outcome, ai: a.recommendation, overturn });
}

export async function technicalReview(actor: Actor, appId: string, outcome: Outcome, note: string) {
  const a = await load(appId);
  if (a.status !== "awaiting_technical") throw new ReviewError(`Not awaiting technical review (status: ${a.status})`);
  await db().insert(decisions).values({ applicationId: appId, stage: "technical_review", actorId: actor.id!, outcome, aiRecommendation: a.recommendation, note });
  await db().update(applications).set({ status: "awaiting_partner", updatedAt: new Date() }).where(eq(applications.id, appId));
  await audit(actor, "review.technical", "application", appId, { outcome });
}

/** Kushal's sign-off. GO is impossible while a portfolio conflict is open. GO starts outreach drafting. */
export async function partnerSignoff(actor: Actor, appId: string, outcome: Outcome, note: string) {
  const a = await load(appId);
  if (a.status !== "awaiting_partner") throw new ReviewError(`Not awaiting partner sign-off (status: ${a.status})`);
  const open = await db().select().from(conflicts).where(and(eq(conflicts.applicationId, appId), eq(conflicts.status, "open")));
  if (outcome === "GO" && open.length) throw new ReviewError(`Clear the portfolio conflict(s) first: ${open.map((c) => c.portfolioCompany).join(", ")}`);
  await db().insert(decisions).values({ applicationId: appId, stage: "partner_signoff", actorId: actor.id!, outcome, aiRecommendation: a.recommendation, note });
  await db().update(applications).set({ status: "decided", finalOutcome: outcome, decidedAt: new Date(), updatedAt: new Date() }).where(eq(applications.id, appId));
  if (note.trim().length >= 8) {
    await proposeCorrection(actor, {
      kind: "partner_feedback", applicationId: appId, sector: a.sector, stage: a.stage, topic: `partner:${a.sector ?? "any"}:${note.slice(0, 40).toLowerCase()}`,
      lesson: note.trim(), authorLabel: "Partner", provenance: `sign-off ${a.ref}`, after: { outcome },
    }, true);
  }
  await audit(actor, "review.partner_signoff", "application", appId, { outcome, ai: a.recommendation });
  if (outcome === "GO") await startOutreach(appId);
}

export async function resolveConflict(actor: Actor, conflictId: string, status: "cleared" | "confirmed", note: string) {
  if (note.trim().length < 5) throw new ReviewError("Add a short note explaining the clearance.");
  const [c] = await db().update(conflicts).set({ status, note, resolvedBy: actor.id, resolvedAt: new Date() })
    .where(and(eq(conflicts.id, conflictId), eq(conflicts.status, "open"))).returning();
  if (!c) throw new ReviewError("Conflict is not open");
  await audit(actor, `conflict.${status}`, "conflict", conflictId, { applicationId: c.applicationId, company: c.portfolioCompany });
}

/** Riya corrects one criterion score → proposed correction (partner approves before it is retrieved). */
export async function correctScore(actor: Actor, appId: string, criterionKey: string, newScore: number, reason: string) {
  if (reason.trim().length < 8) throw new ReviewError("Give a one-line reason for the correction.");
  const a = await load(appId);
  const [s] = await db().select().from(criterionScores).where(and(eq(criterionScores.applicationId, appId), eq(criterionScores.criterionKey, criterionKey)));
  await proposeCorrection(actor, {
    kind: "score", applicationId: appId, criterionKey, sector: a.sector, stage: a.stage, topic: `score:${criterionKey}:${a.sector ?? "any"}`,
    before: { score: s?.score ?? null }, after: { score: newScore }, lesson: `${criterionKey}: ${reason.trim()}`,
    authorLabel: "Riya (associate)", provenance: `application ${a.ref}`,
  });
  await audit(actor, "score.correct", "application", appId, { criterionKey, from: s?.score ?? null, to: newScore });
}
