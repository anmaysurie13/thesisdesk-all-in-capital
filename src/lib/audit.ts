import { db } from "@/db";
import { auditLog } from "@/db/schema";

export type Actor = { id: string | null; role: string | null };
export const SYSTEM: Actor = { id: null, role: "system" };

export async function audit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
  allowed = true,
) {
  await db().insert(auditLog).values({ actorId: actor.id, actorRole: actor.role, action, entity, entityId, detail, allowed });
}
