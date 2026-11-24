import { and, gte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { modelCalls } from "@/db/schema";
import { env } from "@/lib/env";
import { getPause, pauseSystem } from "@/lib/state";

export class QuotaError extends Error {
  constructor(message: string, public kind: "paused" | "daily_spend" | "monthly_spend" | "daily_calls" | "rate") {
    super(message);
  }
}

/** Start of the current day / month in India time (the fund's working day). */
export function istStart(unit: "day" | "month" | "week", from = new Date()): Date {
  const ist = new Date(from.getTime() + 5.5 * 3600_000);
  ist.setUTCHours(0, 0, 0, 0);
  if (unit === "month") ist.setUTCDate(1);
  if (unit === "week") ist.setUTCDate(ist.getUTCDate() - ((ist.getUTCDay() + 6) % 7));
  return new Date(ist.getTime() - 5.5 * 3600_000);
}

export async function usageSince(since: Date) {
  const [row] = await db()
    .select({
      calls: sql<number>`count(*) filter (where ${modelCalls.route} in ('portkey','direct'))`.mapWith(Number),
      cost: sql<number>`coalesce(sum(${modelCalls.costUsd}),0)`.mapWith(Number),
    })
    .from(modelCalls)
    .where(gte(modelCalls.at, since));
  return row ?? { calls: 0, cost: 0 };
}

/**
 * Called before every paid model call. Exceeding a cap pauses the whole system (no paid fallback,
 * no model switch) and raises a critical alert; jobs wait in the queue until a human resumes.
 */
export async function assertQuota() {
  const e = env();
  const pause = await getPause();
  if (pause.paused) throw new QuotaError(`System paused: ${pause.reason ?? "manual"}`, "paused");

  const [day, month] = await Promise.all([usageSince(istStart("day")), usageSince(istStart("month"))]);
  if (day.cost >= e.DAILY_SPEND_CAP_USD) {
    await pauseSystem(`Daily spend cap reached ($${day.cost.toFixed(4)} ≥ $${e.DAILY_SPEND_CAP_USD})`);
    throw new QuotaError("Daily spend cap reached", "daily_spend");
  }
  if (month.cost >= e.MONTHLY_SPEND_CAP_USD) {
    await pauseSystem(`Monthly spend cap reached ($${month.cost.toFixed(4)} ≥ $${e.MONTHLY_SPEND_CAP_USD})`);
    throw new QuotaError("Monthly spend cap reached", "monthly_spend");
  }
  if (day.calls >= e.DAILY_MODEL_CALL_CAP) {
    await pauseSystem(`Daily model-call cap reached (${day.calls} ≥ ${e.DAILY_MODEL_CALL_CAP})`);
    throw new QuotaError("Daily call cap reached", "daily_calls");
  }
  const [rpm] = await db()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(modelCalls)
    .where(and(gte(modelCalls.at, new Date(Date.now() - 60_000)), ne(modelCalls.route, "cache")));
  if ((rpm?.n ?? 0) >= e.MODEL_RPM_CAP) throw new QuotaError("Per-minute model cap reached; job will retry shortly", "rate");
}
