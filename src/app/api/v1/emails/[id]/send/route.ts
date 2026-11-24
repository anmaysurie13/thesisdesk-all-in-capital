import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/authz";
import { approveAndSend, GateError } from "@/lib/outreach/flow";
import { currentUser } from "@/lib/session";

const Body = z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(5000), confirm: z.literal(true) });

/** Only Riya (associate role, signed in) can send. Harness tokens are not accepted. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/emails/[id]/send">) {
  const { id } = await ctx.params;
  const u = await currentUser();
  if (!u || !can(u.role, "approve_send_email")) {
    await audit({ id: u?.id ?? null, role: u?.role ?? "anonymous" }, "denied.email_send", "email", id, {}, false);
    return NextResponse.json({ error: u ? "Forbidden" : "Unauthorized" }, { status: u ? 403 : 401 });
  }
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "subject, body and confirm:true are required" }, { status: 400 });
  try {
    const r = await approveAndSend({ id: u.id, role: u.role }, id, body.data.body, body.data.subject);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: e instanceof GateError ? 409 : 500 });
  }
}
