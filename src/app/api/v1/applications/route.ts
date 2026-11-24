import { after, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import Papa from "papaparse";
import { db } from "@/db";
import { applications } from "@/db/schema";
import { can } from "@/lib/authz";
import type { Actor } from "@/lib/audit";
import { intake, type UploadedDoc } from "@/lib/intake";
import { runTick } from "@/lib/queue/worker";
import { currentUser, harnessAuthorized } from "@/lib/session";

export const maxDuration = 300;
const MAX_BATCH = 60;

async function resolveActor(req: Request): Promise<Actor | null> {
  if (harnessAuthorized(req)) return { id: null, role: "harness" };
  const u = await currentUser();
  return u && can(u.role, "intake") ? { id: u.id, role: u.role } : null;
}

const fileKind = (name: string): UploadedDoc["kind"] => (/form/i.test(name) ? "form" : /deck|pitch/i.test(name) ? "deck" : "attachment");
const companyFromFile = (name: string) => name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+(deck|form|pitch|response).*$/i, "").replace(/[_-]+/g, " ").trim();

/** Single or batch intake (JSON, multipart files, or CSV). Every item gets a status; nothing is silently dropped. */
export async function POST(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const source = actor.role === "harness" ? "eval" : "form";
  const results: unknown[] = [];
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const items: unknown[] = Array.isArray(body?.applications) ? body.applications : [body];
    if (items.length > MAX_BATCH) return NextResponse.json({ error: `Batch limit is ${MAX_BATCH}` }, { status: 413 });
    const batchId = items.length > 1 ? `b_${Date.now()}` : undefined;
    for (const it of items) {
      const item = (it ?? {}) as { batchId?: string };
      results.push(await intake(actor, { ...item, batchId: item.batchId ?? batchId }, [], items.length > 1 ? (source === "eval" ? "volume_test" : "batch") : source));
    }
  } else if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size >= 0);
    const csv = fd.get("csv");
    const batchId = `b_${Date.now()}`;
    if (csv instanceof File && csv.size) {
      const parsed = Papa.parse<Record<string, string>>(await csv.text(), { header: true, skipEmptyLines: true });
      if (parsed.data.length > MAX_BATCH) return NextResponse.json({ error: `Batch limit is ${MAX_BATCH}` }, { status: 413 });
      for (const r of parsed.data) {
        results.push(await intake(actor, {
          companyName: r.companyName ?? r.startup ?? r.company, sector: r.sector, stage: r.stage, city: r.city, website: r.website,
          founderType: r.founderType ?? r.founder_type, summary: r.summary ?? r.application_summary, batchId,
          founders: r.founder_name || r.founder_email ? [{ name: r.founder_name, email: r.founder_email }] : [],
        }, [], "batch"));
      }
    } else if (fd.get("mode") === "batch") {
      if (files.length > MAX_BATCH) return NextResponse.json({ error: `Batch limit is ${MAX_BATCH}` }, { status: 413 });
      // One application per company: files are grouped by the company name in the filename (Acme_Deck.pdf + Acme_Form.pdf).
      const groups = new Map<string, File[]>();
      for (const f of files) groups.set(companyFromFile(f.name).toLowerCase(), [...(groups.get(companyFromFile(f.name).toLowerCase()) ?? []), f]);
      for (const [, fs] of groups) {
        const docs = await Promise.all(fs.map(async (f) => ({ filename: f.name, mime: f.type || "application/pdf", bytes: Buffer.from(await f.arrayBuffer()), kind: fileKind(f.name) })));
        results.push(await intake(actor, { companyName: companyFromFile(fs[0].name), batchId, dataClass: String(fd.get("dataClass") || "case_study") }, docs, "batch"));
      }
    } else {
      const docs = await Promise.all(files.map(async (f) => ({ filename: f.name, mime: f.type || "application/pdf", bytes: Buffer.from(await f.arrayBuffer()), kind: fileKind(f.name) })));
      const field = (k: string) => (fd.get(k) ? String(fd.get(k)) : undefined);
      results.push(await intake(actor, {
        companyName: field("companyName"), website: field("website"), sector: field("sector"), stage: field("stage"), city: field("city"),
        founderType: field("founderType"), summary: field("summary"), formText: field("formText"), dataClass: field("dataClass") ?? "case_study",
        founders: field("founderName") || field("founderEmail") ? [{ name: field("founderName"), email: field("founderEmail"), linkedin: field("founderLinkedin"), phone: field("founderPhone") }] : [],
      }, docs, "form"));
    }
  } else {
    return NextResponse.json({ error: "Send JSON or multipart/form-data" }, { status: 415 });
  }

  after(() => runTick({ budgetMs: 270_000 }).catch(() => undefined));
  return NextResponse.json({ results }, { status: 202 });
}

/** Status listing for the harness / volume test (no PII). */
export async function GET(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const batch = new URL(req.url).searchParams.get("batchId");
  const q = db().select({ id: applications.id, ref: applications.ref, companyName: applications.companyName, status: applications.status, statusReason: applications.statusReason, recommendation: applications.recommendation, weightedScore: applications.weightedScore, batchId: applications.batchId })
    .from(applications);
  const rows = batch ? await q.where(eq(applications.batchId, batch)) : await q.orderBy(desc(applications.submittedAt)).limit(200);
  return NextResponse.json({ applications: rows });
}
