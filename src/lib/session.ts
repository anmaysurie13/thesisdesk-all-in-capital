import { timingSafeEqual } from "node:crypto";
import { auth } from "@/auth";
import type { Role } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { can, ForbiddenError, type Permission } from "@/lib/authz";
import { env } from "@/lib/env";

export type SessionUser = { id: string; role: Role; name: string; email: string };

export async function currentUser(): Promise<SessionUser | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  return { id: s.user.id, role: s.user.role, name: s.user.name ?? "", email: s.user.email ?? "" };
}

/** Server-side gate used by every server action and route. Denials are audited. */
export async function requirePermission(p: Permission): Promise<SessionUser & { actor: Actor }> {
  const u = await currentUser();
  if (!u) throw new ForbiddenError(p);
  if (!can(u.role, p)) {
    await audit({ id: u.id, role: u.role }, `denied.${p}`, "permission", null, {}, false);
    throw new ForbiddenError(p);
  }
  return { ...u, actor: { id: u.id, role: u.role } };
}

export function safeEqual(a: string | undefined | null, b: string | undefined | null) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Worker/cron bearer token. */
export function workerAuthorized(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return safeEqual(token, env().WORKER_SECRET) || safeEqual(token, env().CRON_SECRET);
}

/** Eval/volume harness token: only honoured in the TEST environment. */
export function harnessAuthorized(req: Request): boolean {
  if (env().APP_ENV !== "test") return false;
  const h = req.headers.get("authorization") ?? "";
  return safeEqual(h.startsWith("Bearer ") ? h.slice(7) : "", env().EVAL_TOKEN);
}
