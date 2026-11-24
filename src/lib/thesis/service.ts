import { and, desc, eq, inArray, lt, max } from "drizzle-orm";
import { db } from "@/db";
import { backtestRuns, thesisVersions, type Criterion, type Exclusion } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { V0 } from "./v0";

export type Thesis = typeof thesisVersions.$inferSelect;

export async function activeThesis(): Promise<Thesis | null> {
  const [t] = await db().select().from(thesisVersions).where(eq(thesisVersions.status, "active"));
  return t ?? null;
}

export async function thesisById(id: string): Promise<Thesis | null> {
  const [t] = await db().select().from(thesisVersions).where(eq(thesisVersions.id, id));
  return t ?? null;
}

export async function ensureV0(): Promise<Thesis> {
  const [existing] = await db().select().from(thesisVersions).where(eq(thesisVersions.version, 0));
  if (existing) return existing;
  const [t] = await db().insert(thesisVersions).values({ ...V0, status: "draft" }).returning();
  return t;
}

export function criteriaFor(t: Thesis, sector: string | null, founderType: string | null): Criterion[] {
  return t.criteria.filter((c) => !c.appliesTo || c.appliesTo.some((a) => a === sector || a === founderType));
}

export async function proposeVersion(actor: Actor, parentId: string, changes: {
  criteria?: Criterion[]; exclusions?: Exclusion[]; goMin?: number; passMax?: number; minScoredCriteria?: number; sectors?: string[]; stages?: string[];
}, changeNote: string): Promise<Thesis> {
  const parent = await thesisById(parentId);
  if (!parent) throw new Error("Parent thesis not found");
  const weights = (changes.criteria ?? parent.criteria).reduce((s, c) => s + c.weight, 0);
  if (Math.abs(weights - 1) > 0.02) throw new Error(`Criterion weights must sum to 1 (got ${weights.toFixed(2)})`);
  const [{ v }] = await db().select({ v: max(thesisVersions.version) }).from(thesisVersions);
  const [t] = await db().insert(thesisVersions).values({
    version: (v ?? 0) + 1,
    status: "draft",
    sectors: changes.sectors ?? parent.sectors,
    stages: changes.stages ?? parent.stages,
    criteria: changes.criteria ?? parent.criteria,
    exclusions: changes.exclusions ?? parent.exclusions,
    goMin: changes.goMin ?? parent.goMin,
    passMax: changes.passMax ?? parent.passMax,
    minScoredCriteria: changes.minScoredCriteria ?? parent.minScoredCriteria,
    statements: parent.statements,
    changeNote,
    parentId,
    createdBy: actor.id,
  }).returning();
  await audit(actor, "thesis.propose", "thesis", t.id, { version: t.version, parent: parent.version, changeNote });
  return t;
}

/** Approval requires a finished backtest of THIS version (no unapproved or untested rule changes). */
export async function approveVersion(actor: Actor, id: string) {
  const t = await thesisById(id);
  if (!t) throw new Error("Thesis not found");
  if (t.status !== "draft") throw new Error(`Only drafts can be approved (status: ${t.status})`);
  const [run] = await db().select().from(backtestRuns)
    .where(and(eq(backtestRuns.thesisVersionId, id), eq(backtestRuns.status, "done"))).orderBy(desc(backtestRuns.finishedAt)).limit(1);
  if (!run) throw new Error("Run a backtest of this version before approving it.");
  await db().update(thesisVersions).set({ status: "approved", approvedBy: actor.id, approvedAt: new Date(), backtestRunId: run.id }).where(eq(thesisVersions.id, id));
  await audit(actor, "thesis.approve", "thesis", id, { version: t.version, backtestRunId: run.id });
}

/** Activate an approved (or previously active = rollback) version. Exactly one active version at a time. */
export async function activateVersion(actor: Actor, id: string) {
  const t = await thesisById(id);
  if (!t) throw new Error("Thesis not found");
  if (!["approved", "retired"].includes(t.status)) throw new Error("Only approved or retired (rollback) versions can be activated.");
  if (!t.approvedBy) throw new Error("Version was never approved by a partner.");
  const prev = await activeThesis();
  await db().transaction(async (tx) => {
    await tx.update(thesisVersions).set({ status: "retired" }).where(eq(thesisVersions.status, "active"));
    await tx.update(thesisVersions).set({ status: "active", activatedAt: new Date() }).where(eq(thesisVersions.id, id));
  });
  await audit(actor, t.status === "retired" ? "thesis.rollback" : "thesis.activate", "thesis", id, { version: t.version, previous: prev?.version ?? null });
}

export async function rejectVersion(actor: Actor, id: string, note: string) {
  await db().update(thesisVersions).set({ status: "rejected" }).where(and(eq(thesisVersions.id, id), inArray(thesisVersions.status, ["draft", "approved"])));
  await audit(actor, "thesis.reject", "thesis", id, { note });
}

export async function versionsBefore(version: number) {
  return db().select().from(thesisVersions).where(lt(thesisVersions.version, version)).orderBy(desc(thesisVersions.version));
}
