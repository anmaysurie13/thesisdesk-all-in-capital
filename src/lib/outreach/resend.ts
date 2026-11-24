import { env } from "@/lib/env";

export type SendInput = {
  to: string; subject: string; text: string; idempotencyKey: string; replyTo?: string; inReplyTo?: string | null; references?: string | null;
};

/** Thin Resend REST client. Never retries automatically (a duplicate email is worse than a delayed one). */
export async function resendSend(i: SendInput): Promise<{ id: string }> {
  const e = env();
  if (!e.RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const headers: Record<string, string> = {};
  if (i.inReplyTo) headers["In-Reply-To"] = i.inReplyTo;
  if (i.references) headers["References"] = i.references;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": i.idempotencyKey },
    body: JSON.stringify({
      from: e.RESEND_FROM ?? "Riya · All In Capital <onboarding@resend.dev>",
      to: [i.to],
      subject: i.subject,
      text: i.text,
      reply_to: i.replyTo ? [i.replyTo] : undefined,
      headers: Object.keys(headers).length ? headers : undefined,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok || !body.id) throw new Error(`Resend ${res.status}: ${body.message ?? body.name ?? "send failed"}`.slice(0, 300));
  return { id: body.id };
}

/** Inbound content: the email.received webhook carries metadata only; the body is fetched separately. */
export async function resendGetReceived(emailId: string): Promise<{ text: string; from: string; subject: string; messageId: string | null; inReplyTo: string | null } | null> {
  const e = env();
  if (!e.RESEND_API_KEY) return null;
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const d = (await res.json()) as { text?: string; html?: string; from?: string; subject?: string; message_id?: string; headers?: Record<string, string> };
  const text = d.text ?? (d.html ? d.html.replace(/<[^>]+>/g, " ") : "");
  return { text, from: d.from ?? "", subject: d.subject ?? "", messageId: d.message_id ?? null, inReplyTo: d.headers?.["in-reply-to"] ?? d.headers?.["In-Reply-To"] ?? null };
}

/** Strips quoted history so the classifier only sees the founder's new text. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^On .+wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l) || /^>/.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join("\n").trim().slice(0, 4000);
}
