import { NextResponse } from "next/server";
import { z } from "zod";
import { OUTCOMES } from "@/db/schema";
import { audit } from "@/lib/audit";
import { can, type Permission } from "@/lib/authz";
import { associateReview, partnerSignoff, ReviewError, technicalReview } from "@/lib/review";
import { currentUser } from "@/lib/session";

const Body = z.object({ stage: z.enum(["associate", "technical", "partner"]), outcome: z.enum(OUTCOMES), note: z.string().max(2000).default("") });
const PERM: Record<string, Permission> = { associate: "associate_review", technical: "technical_review", partner: "partner_signoff" };

/** Human gate over HTTP. Requires a signed-in user with the right role; harness tokens are NEVER accepted here. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/applications/[id]/decision">) {
  const { id } = await ctx.params;
  const u = await currentUser();
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (!u) {
    await audit({ id: null, role: "anonymous" }, "denied.decision", "application", id, { stage: body.data.stage }, false);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!can(u.role, PERM[body.data.stage])) {
    await audit({ id: u.id, role: u.role }, "denied.decision", "application", id, { stage: body.data.stage }, false);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const actor = { id: u.id, role: u.role };
    if (body.data.stage === "associate") await associateReview(actor, id, body.data.outcome, body.data.note);
    else if (body.data.stage === "technical") await technicalReview(actor, id, body.data.outcome, body.data.note);
    else await partnerSignoff(actor, id, body.data.outcome, body.data.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: e instanceof ReviewError ? 409 : 500 });
  }
}
