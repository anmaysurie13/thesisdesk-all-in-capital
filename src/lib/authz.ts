import type { Role } from "@/db/schema";

/** Single source of truth for who may do what. Enforced server-side on every mutation. */
export const PERMISSIONS = {
  intake: ["associate", "analyst", "partner", "technical_partner", "admin"],
  view: ["associate", "analyst", "partner", "technical_partner", "admin"],
  associate_review: ["associate"],
  technical_review: ["technical_partner"],
  partner_signoff: ["partner"],
  clear_conflict: ["partner", "technical_partner"],
  edit_draft: ["associate", "analyst"],
  approve_send_email: ["associate"],
  record_reply: ["associate", "analyst"],
  confirm_meeting: ["associate"],
  record_call_outcome: ["associate", "partner", "technical_partner"],
  propose_correction: ["associate", "analyst", "partner", "technical_partner"],
  approve_correction: ["partner"],
  propose_thesis: ["associate", "analyst", "partner"],
  approve_thesis: ["partner"],
  run_backtest: ["associate", "analyst", "partner", "admin"],
  adjudicate: ["associate", "partner"],
  operate_system: ["associate", "analyst", "partner", "admin"],
  manage_users: ["partner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, p: Permission): boolean {
  return !!role && (PERMISSIONS[p] as readonly Role[]).includes(role);
}

export const ROLE_LABEL: Record<Role, string> = {
  associate: "Associate",
  partner: "Partner",
  technical_partner: "Partner · Technical",
  analyst: "Analyst",
  admin: "Admin",
};

export class ForbiddenError extends Error {
  constructor(public permission: Permission) {
    super(`Not permitted: ${permission}`);
  }
}
