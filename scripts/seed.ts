/**
 * Seeds the database from the REAL case files (never invented):
 *  - users (Riya, Kushal, Aditya, analyst) with generated passwords → written to .seed-credentials.local (git-ignored)
 *  - thesis v0 (draft, needs partner approval) — see src/lib/thesis/v0.ts for sources
 *  - Loop 1 export → backtest_rows (tune/sealed split) + Riya's overturn reasons as PROPOSED corrections
 *  - Loop 2 export → Riya's email edits as style memory (approved: they are her own sent emails)
 *  - portfolio: only MeetRecord, the one portfolio company evidenced in the data (L1-08), marked unverified
 * Usage: npx tsx scripts/seed.ts [--data <folder>] [--live]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import Papa from "papaparse";
import { eq } from "drizzle-orm";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
process.env.APP_ENV = process.argv.includes("--live") ? "live" : "test";

async function main() {
  const { db } = await import("../src/db");
  const { backtestRows, corrections, portfolioCompanies, users } = await import("../src/db/schema");
  const { ensureV0 } = await import("../src/lib/thesis/service");
  const dataDir = arg("--data") ?? "_source_materials";
  const read = (f: string) => {
    const p = path.join(dataDir, f);
    if (!fs.existsSync(p)) throw new Error(`Missing ${p}. Pass --data <folder with the AIC_B6 exports>.`);
    return Papa.parse<Record<string, string>>(fs.readFileSync(p, "utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: true }).data;
  };

  // Users
  const team = [
    { email: "riya@thesisdesk.test", name: "Riya", role: "associate" as const },
    { email: "kushal@thesisdesk.test", name: "Kushal Bhagia", role: "partner" as const },
    { email: "aditya@thesisdesk.test", name: "Aditya Singh", role: "technical_partner" as const },
    { email: "analyst@thesisdesk.test", name: "Analyst", role: "analyst" as const },
  ];
  const creds: string[] = [];
  for (const t of team) {
    const [exists] = await db().select({ id: users.id }).from(users).where(eq(users.email, t.email));
    if (exists) continue;
    const pw = randomBytes(12).toString("base64url");
    await db().insert(users).values({ ...t, passwordHash: await bcrypt.hash(pw, 12) });
    creds.push(`${t.email}  ${pw}  (${t.role})`);
  }
  if (creds.length) {
    fs.appendFileSync(".seed-credentials.local", `# ${process.env.APP_ENV} — generated ${new Date().toISOString()}\n${creds.join("\n")}\n`);
    console.log(`Created ${creds.length} users; passwords written to .seed-credentials.local (git-ignored).`);
  }

  // Thesis v0 (draft)
  const v0 = await ensureV0();
  console.log(`Thesis v${v0.version}: ${v0.status}`);

  // Loop 1 → backtest rows + proposed corrections (Riya's reasons)
  const l1 = read("AIC_B6_Loop1_Screening_Export.csv");
  let i = 0;
  for (const r of l1) {
    const split = i++ % 2 === 0 ? "tune" : "sealed";
    await db().insert(backtestRows).values({
      rowRef: r.row_id, asOf: r.date, company: r.startup, sector: r.sector, stage: r.stage, city: r.city, founderType: r.founder_type,
      summary: r.application_summary, actualOutcome: r.riya_final_call, split, source: "AIC_B6_Loop1_Screening_Export.csv",
    }).onConflictDoNothing();
    if (r.riya_reason?.trim()) {
      const [dupe] = await db().select({ id: corrections.id }).from(corrections).where(eq(corrections.provenance, `Loop 1 export ${r.row_id}`));
      if (!dupe) await db().insert(corrections).values({
        kind: "overturn", sector: r.sector, stage: r.stage, topic: `overturn:${r.row_id}`, lesson: r.riya_reason.trim(),
        before: { system_call: r.system_call }, after: { riya_call: r.riya_final_call }, authorLabel: "Riya (associate)",
        status: "proposed", provenance: `Loop 1 export ${r.row_id}`, effectiveAt: new Date(`${r.date}T21:00:00+05:30`),
      });
    }
  }
  console.log(`Loop 1: ${l1.length} backtest rows (tune/sealed alternating by date).`);

  // Loop 2 → email style memory. Founder names are replaced by {{first_name}} before storage.
  const l2 = read("AIC_B6_Loop2_Email_Export.csv");
  for (const r of l2) {
    const first = (r.founder_name ?? "").split(/\s+/)[0];
    const scrub = (s: string) => (first ? s.replaceAll(first, "{{first_name}}") : s);
    const [dupe] = await db().select({ id: corrections.id }).from(corrections).where(eq(corrections.provenance, `Loop 2 export ${r.row_id}`));
    if (dupe) continue;
    await db().insert(corrections).values({
      kind: "email_edit", sector: r.sector, stage: r.stage, topic: `email:${r.row_id}`,
      before: { text: scrub(r.system_draft) }, after: { text: scrub(r.riya_final_email), changed: r.system_draft.trim() !== r.riya_final_email.trim() },
      lesson: r.system_draft.trim() === r.riya_final_email.trim() ? "Draft sent unchanged" : "Riya rewrote the draft",
      authorLabel: "Riya (associate)", status: "approved", provenance: `Loop 2 export ${r.row_id}`, effectiveAt: new Date(`${r.date_sent}T20:00:00+05:30`),
    });
  }
  console.log(`Loop 2: ${l2.length} email pairs stored as style memory (names replaced).`);

  await db().insert(portfolioCompanies).values({
    name: "MeetRecord", sector: "Consumer tech", description: "Records sales calls and writes summaries (inferred from the overlap reason in L1-08).",
    keywords: ["sales calls", "call recording", "meeting summaries"], sourceNote: "Loop 1 export L1-08 (Riya: 'Overlaps with MeetRecord in our portfolio'). Not independently verified.", verified: false,
  }).onConflictDoNothing();
  console.log("Portfolio: MeetRecord (unverified). Add the rest from public sources on Thesis & Memory.");
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
