/** Runs a point-in-time backtest end to end in the TEST database and prints the report.
 *   npx tsx scripts/run-backtest.ts [--version 0] [--split tune|sealed|all]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.APP_ENV = "test";
import fs from "node:fs";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { thesisVersions } = await import("../src/db/schema");
  const { startBacktest, backtestReport } = await import("../src/lib/backtest");
  const { runTick } = await import("../src/lib/queue/worker");
  const { usageSince, istStart } = await import("../src/lib/ai/quota");
  const [t] = await db().select().from(thesisVersions).where(eq(thesisVersions.version, Number(arg("--version", "0"))));
  const split = arg("--split", "tune") as "tune" | "sealed" | "all";
  const before = await usageSince(istStart("day"));
  const run = await startBacktest({ id: null, role: "system" }, t.id, split);
  console.log(`Backtest ${run.id} · thesis v${t.version} · ${split}`);
  for (let i = 0; i < 40; i++) {
    const s = await runTick({ budgetMs: 120_000 });
    const r = await backtestReport(run.id);
    console.log(`tick ${i}: done ${s.done} retry ${s.retry} attention ${s.needs_attention} paused ${s.paused} · scored ${r.scored}/${r.total}`);
    if (s.paused || (s.claimed === 0 && r.scored + (r.total - r.scored) === r.total && s.retry === 0)) break;
  }
  const r = await backtestReport(run.id);
  const after = await usageSince(istStart("day"));
  const out = { ...r, thesisVersion: t.version, split, costUsd: +(after.cost - before.cost).toFixed(4), modelCalls: after.calls - before.calls };
  fs.mkdirSync("eval-results", { recursive: true });
  fs.writeFileSync(`eval-results/backtest-v${t.version}-${split}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
