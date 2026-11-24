import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { applications, documents, founders, jobs } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { env } from "@/lib/env";
import { normaliseCompany } from "@/lib/pii";

export const FounderIn = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(40).optional(),
  linkedin: z.string().trim().max(300).optional(),
  background: z.string().trim().max(1000).optional(),
});

export const ApplicationIn = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(160),
  website: z.string().trim().max(300).optional(),
  sector: z.string().trim().max(80).optional(),
  stage: z.string().trim().max(40).optional(),
  city: z.string().trim().max(80).optional(),
  founderType: z.string().trim().max(40).optional(),
  summary: z.string().trim().max(20_000).optional(),
  formText: z.string().trim().max(40_000).optional(),
  founders: z.array(FounderIn).max(6).default([]),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  batchId: z.string().max(80).optional(),
  dataClass: z.enum(["case_study", "synthetic", "real"]).default("case_study"),
});
export type ApplicationInput = z.input<typeof ApplicationIn>;
export type UploadedDoc = { filename: string; mime: string; bytes: Buffer; kind: "deck" | "form" | "attachment" };

const MAX_FILE = 15 * 1024 * 1024;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const newRef = () => `AIC-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

export type IntakeResult =
  | { status: "queued"; applicationId: string; ref: string }
  | { status: "duplicate"; applicationId: string; ref: string; duplicateOf: string }
  | { status: "invalid"; applicationId: string | null; ref: string | null; reason: string };

/**
 * Validate → dedupe → persist application + documents + queued job in ONE transaction.
 * After this returns, the application cannot be lost: it is either queued, a flagged duplicate, or
 * retained as invalid with a reason.
 */
export async function intake(
  actor: Actor,
  raw: unknown,
  docs: UploadedDoc[],
  source: "form" | "batch" | "backtest" | "volume_test" | "eval" | "seed",
  extra: { thesisVersionId?: string; hashSalt?: string; jobPayload?: Record<string, unknown> } = {},
): Promise<IntakeResult> {
  const appEnv = env().APP_ENV;
  const parsed = ApplicationIn.safeParse(raw);
  const companyName = typeof (raw as { companyName?: unknown })?.companyName === "string" ? String((raw as { companyName: string }).companyName).slice(0, 160) : "";

  if (env().DATA_MODE === "case_study" && parsed.success && parsed.data.dataClass === "real") {
    return { status: "invalid", applicationId: null, ref: null, reason: "Real founder data is blocked in DATA_MODE=case_study (founder agreement). Switch data mode only after consent/paid-tier terms are in place." };
  }

  const docProblems: string[] = [];
  for (const d of docs) {
    if (d.bytes.length > MAX_FILE) docProblems.push(`${d.filename}: larger than 15 MB`);
    if (d.bytes.length === 0) docProblems.push(`${d.filename}: empty file`);
  }

  // Missing/invalid: retained with a reason so nothing silently disappears.
  if (!parsed.success || (!docs.length && !parsed.data.summary && !parsed.data.formText)) {
    const reason = !parsed.success
      ? parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")
      : "No deck, form or summary supplied";
    const ref = newRef();
    const [row] = await db().insert(applications).values({
      ref, env: appEnv, source, companyName: companyName || "(missing name)", companyKey: normaliseCompany(companyName || ref),
      status: "invalid", statusReason: reason, contentHash: `invalid:${ref}`, duplicateOf: null,
    }).returning({ id: applications.id });
    await audit(actor, "application.invalid", "application", row.id, { reason });
    return { status: "invalid", applicationId: row.id, ref, reason };
  }

  const a = parsed.data;
  const docHashes = docs.map((d) => sha(d.bytes)).sort();
  const contentHash = sha(JSON.stringify([normaliseCompany(a.companyName), docHashes, a.summary ?? "", a.formText ?? "", a.asOfDate ?? "", extra.hashSalt ?? ""]));

  const [existing] = await db().select({ id: applications.id, ref: applications.ref }).from(applications)
    .where(and(eq(applications.env, appEnv), eq(applications.contentHash, contentHash), isNull(applications.duplicateOf)));

  const ref = newRef();
  const insertDocsAndFounders = async (tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0], appId: string) => {
    for (const [i, f] of a.founders.entries()) {
      await tx.insert(founders).values({ applicationId: appId, founderCode: `F${i + 1}`, ...f });
    }
    for (const d of docs) {
      await tx.insert(documents).values({ applicationId: appId, kind: d.kind, filename: d.filename.slice(0, 200), mime: d.mime, bytes: d.bytes, sha256: sha(d.bytes),
        status: docProblems.some((p) => p.startsWith(d.filename)) ? "corrupt" : "pending", error: docProblems.find((p) => p.startsWith(d.filename)) ?? null });
    }
    if (a.summary) await tx.insert(documents).values({ applicationId: appId, kind: "summary", filename: "summary.txt", mime: "text/plain", sha256: sha(a.summary), rawText: a.summary, status: "ok" });
    if (a.formText) await tx.insert(documents).values({ applicationId: appId, kind: "form", filename: "form.txt", mime: "text/plain", sha256: sha(a.formText), rawText: a.formText, status: "ok" });
  };

  const base = {
    ref, env: appEnv, source, dataClass: a.dataClass, companyName: a.companyName, companyKey: normaliseCompany(a.companyName),
    website: a.website, sector: a.sector, stage: a.stage, city: a.city, founderType: a.founderType, asOfDate: a.asOfDate, batchId: a.batchId,
  };

  if (existing) {
    const [row] = await db().insert(applications).values({ ...base, contentHash: `${contentHash}:dup:${ref}`, duplicateOf: existing.id, status: "duplicate", statusReason: `Same content as ${existing.ref}` })
      .returning({ id: applications.id });
    await audit(actor, "application.duplicate", "application", row.id, { duplicateOf: existing.id });
    return { status: "duplicate", applicationId: row.id, ref, duplicateOf: existing.id };
  }

  try {
    const id = await db().transaction(async (tx) => {
      const [row] = await tx.insert(applications).values({ ...base, contentHash, status: "queued" }).returning({ id: applications.id });
      await insertDocsAndFounders(tx, row.id);
      await tx.insert(jobs).values({
        kind: source === "backtest" ? "backtest_row" : "screen", applicationId: row.id, idempotencyKey: `screen:${row.id}`, env: appEnv,
        runId: `run_${randomBytes(8).toString("hex")}`, payload: { ...(extra.jobPayload ?? {}), ...(extra.thesisVersionId ? { thesisVersionId: extra.thesisVersionId } : {}) },
      });
      return row.id;
    });
    await audit(actor, "application.intake", "application", id, { source, ref });
    return { status: "queued", applicationId: id, ref };
  } catch (err) {
    // Concurrent identical submissions race on the unique (env, content_hash) index → the loser is a flagged duplicate.
    const e = err as { code?: string; cause?: { code?: string; message?: string } };
    if (e.code === "23505" || e.cause?.code === "23505" || /duplicate key/i.test(`${String(err)} ${e.cause?.message ?? ""}`)) {
      const [winner] = await db().select({ id: applications.id, ref: applications.ref }).from(applications)
        .where(and(eq(applications.env, appEnv), eq(applications.contentHash, contentHash), isNull(applications.duplicateOf)));
      const [row] = await db().insert(applications).values({ ...base, contentHash: `${contentHash}:dup:${ref}`, duplicateOf: winner?.id ?? null, status: "duplicate", statusReason: `Same content as ${winner?.ref ?? "a concurrent submission"}` })
        .returning({ id: applications.id });
      return { status: "duplicate", applicationId: row.id, ref, duplicateOf: winner?.id ?? "" };
    }
    throw err;
  }
}
