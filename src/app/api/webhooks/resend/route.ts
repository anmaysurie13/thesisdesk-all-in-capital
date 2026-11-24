import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outreachThreads, webhookEvents } from "@/db/schema";
import { env } from "@/lib/env";
import { applyDeliveryEvent, recordInbound } from "@/lib/outreach/flow";
import { resendGetReceived } from "@/lib/outreach/resend";
import { verifySvix } from "@/lib/outreach/signatures";

type ResendEvent = { type: string; data: { email_id?: string; to?: string[] | string; from?: string; subject?: string; message_id?: string } };

/**
 * Resend webhooks: delivery events + inbound replies (email.received).
 * Signature verified (Svix) on the RAW body; duplicates ignored via unique (provider, svix-id).
 */
export async function POST(req: Request) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  const raw = await req.text();
  const id = req.headers.get("svix-id");
  const ok = verifySvix(raw, { id, timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, secret);
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const evt = JSON.parse(raw) as ResendEvent;
  const inserted = await db().insert(webhookEvents).values({ provider: "resend", eventId: id!, type: evt.type, payload: evt as unknown as Record<string, unknown> })
    .onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!inserted.length) return NextResponse.json({ ok: true, duplicate: true });

  let error: string | null = null;
  try {
    if (evt.type === "email.received") {
      const to = ([] as string[]).concat(evt.data.to ?? []).join(" ");
      const threadId = /t-([0-9a-f-]{36})@/i.exec(to)?.[1];
      if (!threadId) error = "Inbound email not matched to a thread (no t-<id> address)";
      else {
        const [t] = await db().select({ id: outreachThreads.id }).from(outreachThreads).where(eq(outreachThreads.id, threadId));
        if (!t) error = "Unknown thread";
        else {
          const full = evt.data.email_id ? await resendGetReceived(evt.data.email_id) : null;
          await recordInbound(threadId, full?.text || "(body could not be fetched — open Resend to read it)", {
            source: "webhook", messageId: full?.messageId ?? evt.data.message_id ?? null, subject: full?.subject ?? evt.data.subject,
          });
        }
      }
    } else if (evt.data.email_id && /^email\.(delivered|bounced|complained|failed)$/.test(evt.type)) {
      await applyDeliveryEvent(evt.type, evt.data.email_id);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "processing failed";
  }
  await db().update(webhookEvents).set({ processedAt: new Date(), error }).where(eq(webhookEvents.id, inserted[0].id));
  return NextResponse.json({ ok: !error, error });
}
