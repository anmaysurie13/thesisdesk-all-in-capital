import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { corrections, memoPassages } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";

type Correction = typeof corrections.$inferSelect;
const STOP = new Set("the a an and or of to in for on with is are was were be by at from as that this it its our we their they".split(" "));

export function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
function overlap(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/**
 * Relevant APPROVED corrections for a new application, point-in-time:
 * only corrections effective strictly before `asOf` (backtests never see the future).
 * Conflicts on the same topic → the most recent wins; the older is reported as superseded.
 */
export async function relevantCorrections(opts: { sector: string | null; stage: string | null; text: string; asOf: Date; limit?: number }) {
  const rows = await db().select().from(corrections).where(and(
    eq(corrections.status, "approved"),
    inArray(corrections.kind, ["overturn", "score", "partner_feedback", "call_outcome"]),
    lt(corrections.effectiveAt, opts.asOf),
  )).orderBy(desc(corrections.effectiveAt));
  const appTokens = tokens(opts.text);
  const scored = rows.map((c) => {
    let s = overlap(tokens(`${c.lesson} ${c.topic ?? ""}`), appTokens);
    if (c.sector && c.sector === opts.sector) s += 3;
    if (c.stage && c.stage === opts.stage) s += 1;
    if (!c.sector) s += 1; // generic lessons apply broadly
    return { c, s };
  }).filter((x) => x.s >= 3);

  const byTopic = new Map<string, { c: Correction; s: number }>();
  const superseded: string[] = [];
  for (const x of scored) {
    const topic = x.c.topic ?? x.c.id;
    const cur = byTopic.get(topic);
    if (!cur) byTopic.set(topic, x);
    else superseded.push(x.c.id); // rows are newest-first, so the first seen per topic wins
  }
  const chosen = [...byTopic.values()].sort((a, b) => b.s - a.s).slice(0, opts.limit ?? 5).map((x) => x.c);
  return { chosen, superseded };
}

export async function relevantMemoPassages(opts: { sector: string | null; text: string; asOf: Date; limit?: number }) {
  const rows = await db().select().from(memoPassages);
  const appTokens = tokens(opts.text);
  return rows
    .filter((m) => !m.memoDate || new Date(m.memoDate) < opts.asOf)
    .map((m) => ({ m, s: overlap(tokens(`${m.text} ${m.tags.join(" ")}`), appTokens) + (opts.sector && m.tags.includes(opts.sector) ? 3 : 0) }))
    .filter((x) => x.s > 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, opts.limit ?? 3)
    .map((x) => x.m);
}

export async function emailExamples(opts: { sector: string | null; stage: string | null; limit?: number }) {
  const rows = await db().select().from(corrections)
    .where(and(eq(corrections.kind, "email_edit"), eq(corrections.status, "approved")))
    .orderBy(desc(corrections.effectiveAt)).limit(200);
  const rank = (c: Correction) => (c.sector === opts.sector ? 2 : 0) + (c.stage === opts.stage ? 1 : 0) + (c.after.changed ? 1 : 0);
  return rows.sort((a, b) => rank(b) - rank(a)).slice(0, opts.limit ?? 3)
    .map((c) => ({ draft: String(c.before.text ?? ""), final: String(c.after.text ?? "") }));
}

export async function proposeCorrection(actor: Actor, input: Omit<typeof corrections.$inferInsert, "status" | "authorId">, autoApprove = false) {
  const [row] = await db().insert(corrections).values({
    ...input, authorId: actor.id, status: autoApprove ? "approved" : "proposed", approvedBy: autoApprove ? actor.id : null,
  }).returning();
  await audit(actor, "correction.propose", "correction", row.id, { kind: row.kind, autoApprove });
  return row;
}

export async function decideCorrection(actor: Actor, id: string, approve: boolean) {
  const [row] = await db().select().from(corrections).where(eq(corrections.id, id));
  if (!row || row.status !== "proposed") throw new Error("Correction is not awaiting approval");
  if (approve && row.topic) {
    // Versioning: an approved correction on the same topic supersedes the older one (kept for provenance).
    await db().update(corrections).set({ status: "superseded" })
      .where(and(eq(corrections.topic, row.topic), eq(corrections.status, "approved"), lt(corrections.effectiveAt, row.effectiveAt)));
  }
  await db().update(corrections).set({ status: approve ? "approved" : "rejected", approvedBy: actor.id }).where(eq(corrections.id, id));
  await audit(actor, approve ? "correction.approve" : "correction.reject", "correction", id, {});
}
