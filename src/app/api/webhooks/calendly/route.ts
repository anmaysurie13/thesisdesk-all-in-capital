import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { env } from "@/lib/env";
import { verifyCalendly } from "@/lib/outreach/signatures";
import { applyInvitee } from "@/lib/scheduling/calendly";

/** Calendly invitee.created / invitee.canceled. Meetings are marked booked ONLY from Calendly's confirmation. */
export async function POST(req: Request) {
  const key = env().CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!key) return NextResponse.json({ error: "Signing key not configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifyCalendly(raw, req.headers.get("calendly-webhook-signature"), key)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  const evt = JSON.parse(raw) as { event: string; payload: Record<string, unknown> };
  const eventId = createHash("sha256").update(`${evt.event}:${String(evt.payload.uri ?? raw)}`).digest("hex");
  const ins = await db().insert(webhookEvents).values({ provider: "calendly", eventId, type: evt.event, payload: evt as unknown as Record<string, unknown> })
    .onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!ins.length) return NextResponse.json({ ok: true, duplicate: true });
  let error: string | null = null;
  try {
    if (evt.event === "invitee.created" || evt.event === "invitee.canceled") {
      const r = await applyInvitee(evt.event === "invitee.created" ? "created" : "canceled", evt.payload, "webhook");
      if (!r.matched) error = r.reason ?? "not matched";
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "failed";
  }
  await db().update(webhookEvents).set({ processedAt: new Date(), error }).where(eq(webhookEvents.id, ins[0].id));
  return NextResponse.json({ ok: !error });
}
