import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { env, integrations } from "@/lib/env";
import { getPause } from "@/lib/state";

/** Liveness + configuration flags only — no secrets, no data. */
export async function GET() {
  let database = false;
  let paused: boolean | null = null;
  try {
    await db().execute(sql`select 1`);
    database = true;
    paused = (await getPause()).paused;
  } catch {
    database = false;
  }
  const i = integrations();
  // Exactly one retry layer is always active: Portkey when configured, otherwise the gateway's own (4 tries, 1/2/4 s + jitter).
  const retryLayer = i.portkey ? "portkey" : "app";
  return NextResponse.json({ ok: database, env: env().APP_ENV, emailMode: env().EMAIL_MODE, paused, retryLayer, integrations: { ...i, database } }, { status: database ? 200 : 503 });
}
