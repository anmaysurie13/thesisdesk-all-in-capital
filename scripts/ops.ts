/** Small operational commands against the TEST (default) or --live database.
 *   npx tsx scripts/ops.ts backfill-costs
 *   npx tsx scripts/ops.ts propose-v1
 *   npx tsx scripts/ops.ts approve-activate <version>   (TEST ONLY — stands in for Kushal so evals can run; never on live)
 *   npx tsx scripts/ops.ts unpause
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.APP_ENV = process.argv.includes("--live") ? "live" : "test";

async function main() {
  const { and, eq, gt, sql } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { modelCalls, thesisVersions, users } = await import("../src/db/schema");
  const { PRICES } = await import("../src/lib/ai/pricing");
  const cmd = process.argv[2];

  if (cmd === "backfill-costs") {
    let n = 0;
    for (const [model, p] of Object.entries(PRICES)) {
      const r = await db().update(modelCalls).set({
        costUsd: sql`round((${modelCalls.inputTokens} * ${sql.raw(String(p.in))}::numeric + ${modelCalls.outputTokens} * ${sql.raw(String(p.out))}::numeric)::numeric, 6)`, costSource: "estimate",
      }).where(and(eq(modelCalls.model, model), eq(modelCalls.costUsd, "0"), gt(sql`${modelCalls.inputTokens} + ${modelCalls.outputTokens}`, 0))).returning({ id: modelCalls.id });
      n += r.length;
    }
    const [s] = await db().select({ cost: sql<number>`sum(${modelCalls.costUsd})`.mapWith(Number) }).from(modelCalls);
    console.log(`Backfilled ${n} rows with list-price estimates. Ledger total now $${s.cost.toFixed(4)}.`);
  }
  if (cmd === "propose-v1") {
    const { proposeVersion, ensureV0 } = await import("../src/lib/thesis/service");
    const v0 = await ensureV0();
    const t = await proposeVersion({ id: null, role: "system" }, v0.id, { minScoredCriteria: 3, goMin: 3.4, passMax: 2.6 },
      "v1 (tune split): v0 returned REQUEST_INFO on 11/20 summary-only rows. Lower minimum scored criteria 4→3; thresholds GO≥3.4, PASS≤2.6; scoring prompt v2 (unverified claims lower confidence, not the score).");
    console.log(`Proposed thesis v${t.version} (${t.id}) as draft.`);
  }
  if (cmd === "approve-activate") {
    if (process.env.APP_ENV !== "test") throw new Error("Refusing: test environment only.");
    const v = Number(process.argv[3]);
    const [kushal] = await db().select().from(users).where(eq(users.role, "partner"));
    const [t] = await db().select().from(thesisVersions).where(eq(thesisVersions.version, v));
    const { approveVersion, activateVersion } = await import("../src/lib/thesis/service");
    const actor = { id: kushal.id, role: "partner" };
    if (t.status === "draft") await approveVersion(actor, t.id);
    await activateVersion(actor, t.id);
    console.log(`TEST ONLY: thesis v${v} approved + activated using the seeded partner test account (not a real partner decision).`);
  }
  if (cmd === "unpause") {
    const { setPause } = await import("../src/lib/state");
    const { resumeParked } = await import("../src/lib/queue/jobs");
    await setPause({ paused: false });
    console.log(`Unpaused; ${await resumeParked()} parked jobs re-queued.`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
