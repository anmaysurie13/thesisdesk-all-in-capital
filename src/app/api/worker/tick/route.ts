import { NextResponse } from "next/server";
import { db } from "@/db";
import { systemState } from "@/db/schema";
import { refreshRunningBacktests } from "@/lib/backtest";
import { runTick } from "@/lib/queue/worker";
import { workerAuthorized } from "@/lib/session";

export const maxDuration = 300;

async function tick(req: Request) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = new Date().toISOString();
  const stats = await runTick({ budgetMs: 270_000 });
  await refreshRunningBacktests().catch(() => undefined);
  const value = { startedAt, finishedAt: new Date().toISOString(), ...stats, trigger: req.headers.get("user-agent")?.slice(0, 60) ?? "unknown" };
  await db().insert(systemState).values({ key: "worker", value }).onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
  return NextResponse.json(value);
}

/** Vercel cron sends GET with `Authorization: Bearer $CRON_SECRET`; GitHub Actions / manual callers use POST. */
export const GET = tick;
export const POST = tick;
