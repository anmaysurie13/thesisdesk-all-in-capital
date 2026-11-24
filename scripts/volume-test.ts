/**
 * Volume test (Build 5, Task 2) — HTTP only, against a TEST deployment.
 *   npx tsx scripts/volume-test.ts --target https://<test-url> [--scenario 20|50|100] [--wait 900]
 * Uses SYNTHETIC applications (labelled), EVAL_TOKEN and WORKER_SECRET from .env.local.
 * Pass criterion: every submitted application ends up scored, queued/paused, or needs_attention WITH a reason. Zero missing.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "node:fs";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const target = (arg("--target") ?? process.env.APP_URL ?? "").replace(/\/$/, "");
const scenario = Number(arg("--scenario", "20"));
const waitSec = Number(arg("--wait", "900"));
if (!target || !process.env.EVAL_TOKEN) { console.error("Need --target and EVAL_TOKEN"); process.exit(2); }
const H = { Authorization: `Bearer ${process.env.EVAL_TOKEN}`, "Content-Type": "application/json" };
const SECTORS = ["Fintech", "Consumer brands", "Consumer tech", "Commerce infrastructure", "Deeptech"];

function synthetic(i: number, batchId: string) {
  return {
    companyName: `VolTest ${batchId.slice(-5)}-${i}`, sector: SECTORS[i % 5], stage: i % 3 ? "Pre-seed" : "Seed", city: "Pune", dataClass: "synthetic", batchId,
    summary: `SYNTHETIC volume-test application #${i}. ${100 + i * 7} paying customers, ${20 + (i % 40)}% repeat in 90 days, gross margin ${15 + (i % 30)}%. Founder ran a related business for ${3 + (i % 9)} years. Raising ₹${1 + (i % 4)} Cr.`,
  };
}

async function main() {
  const batchId = `vol_${scenario}_${Date.now()}`;
  const t0 = Date.now();
  const posts = await Promise.allSettled(Array.from({ length: scenario }, (_, i) =>
    fetch(`${target}/api/v1/applications`, { method: "POST", headers: H, body: JSON.stringify(synthetic(i, batchId)) })
      .then(async (r) => ({ status: r.status, ms: Date.now() - t0, body: await r.json().catch(() => ({})) }))));
  const accepted = posts.filter((p) => p.status === "fulfilled" && p.value.status === 202).length;
  const httpErrors = posts.map((p) => (p.status === "fulfilled" ? p.value.status : "network")).filter((s) => s !== 202);
  console.log(`Submitted ${scenario} at once: ${accepted} accepted (202), ${httpErrors.length} errors ${JSON.stringify(httpErrors)}`);

  const deadline = Date.now() + waitSec * 1000;
  let rows: { status: string; statusReason: string | null; companyName: string }[] = [];
  while (Date.now() < deadline) {
    if (process.env.WORKER_SECRET) await fetch(`${target}/api/worker/tick`, { method: "POST", headers: { Authorization: `Bearer ${process.env.WORKER_SECRET}` } }).catch(() => undefined);
    rows = ((await (await fetch(`${target}/api/v1/applications?batchId=${batchId}`, { headers: H })).json()) as { applications: typeof rows }).applications;
    const busy = rows.filter((r) => ["queued", "processing", "received"].includes(r.status)).length;
    console.log(`t+${Math.round((Date.now() - t0) / 1000)}s  found ${rows.length}/${scenario}  in-flight ${busy}`);
    if (rows.length === scenario && busy === 0) break;
    await new Promise((r) => setTimeout(r, 20_000));
  }
  const by = rows.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const missing = scenario - rows.length;
  const unexplained = rows.filter((r) => r.status === "needs_attention" && !r.statusReason).length;
  const pass = missing === 0 && unexplained === 0 && httpErrors.length === 0;
  const report = { scenario, batchId, target, startedAt: new Date(t0).toISOString(), seconds: Math.round((Date.now() - t0) / 1000), accepted, httpErrors, byStatus: by, missing, unexplainedNeedsAttention: unexplained, pass };
  fs.mkdirSync("eval-results", { recursive: true });
  fs.writeFileSync(`eval-results/volume-${scenario}-${Date.now()}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(pass ? 0 : 1);
}
main();
