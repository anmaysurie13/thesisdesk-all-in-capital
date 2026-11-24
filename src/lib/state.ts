import { eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, systemState } from "@/db/schema";

export type PauseState = { paused: boolean; reason?: string; since?: string; by?: string };

export async function getPause(): Promise<PauseState> {
  const [row] = await db().select().from(systemState).where(eq(systemState.key, "pause"));
  return (row?.value as PauseState) ?? { paused: false };
}

export async function setPause(state: PauseState) {
  const value = { ...state, since: state.paused ? new Date().toISOString() : undefined };
  await db()
    .insert(systemState)
    .values({ key: "pause", value })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
}

export async function raiseAlert(level: "info" | "warning" | "critical", kind: string, message: string) {
  await db().insert(alerts).values({ level, kind, message });
}

/** Pause once; repeated triggers don't spam alerts. */
export async function pauseSystem(reason: string, kind = "quota") {
  const cur = await getPause();
  if (cur.paused) return;
  await setPause({ paused: true, reason, by: "system" });
  await raiseAlert("critical", kind, `System paused: ${reason}`);
}
