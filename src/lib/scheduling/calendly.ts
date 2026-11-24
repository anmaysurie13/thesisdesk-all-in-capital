import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings, outreachThreads } from "@/db/schema";
import { env } from "@/lib/env";

const API = "https://api.calendly.com";
const headers = () => ({ Authorization: `Bearer ${env().CALENDLY_PAT}`, "Content-Type": "application/json" });

/** Personal scheduling link: thread id travels in utm_content so the booking can be matched without PII in the URL. */
export function schedulingLink(threadId: string): string | null {
  const base = env().CALENDLY_SCHEDULING_URL;
  if (!base) return null;
  const u = new URL(base);
  u.searchParams.set("utm_source", "thesisdesk");
  u.searchParams.set("utm_content", `t_${threadId}`);
  return u.toString();
}

/** Free 30-min slots from Calendly (never proposes a time Calendly says is busy → no double booking). */
export async function availableSlots(days = 7, max = 2): Promise<{ slots: string[]; source: "calendly" | "unconfigured" | "error" }> {
  const e = env();
  if (!e.CALENDLY_PAT || !e.CALENDLY_EVENT_TYPE_URI) return { slots: [], source: "unconfigured" };
  const start = new Date(Date.now() + 24 * 3600_000);
  const end = new Date(start.getTime() + days * 24 * 3600_000);
  const q = new URLSearchParams({ event_type: e.CALENDLY_EVENT_TYPE_URI, start_time: start.toISOString(), end_time: end.toISOString() });
  try {
    const res = await fetch(`${API}/event_type_available_times?${q}`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { slots: [], source: "error" };
    const data = (await res.json()) as { collection?: { status: string; start_time: string }[] };
    const free = (data.collection ?? []).filter((s) => s.status === "available").map((s) => s.start_time);
    // Prefer afternoons IST on different days (Riya's pattern: two afternoon options).
    const picked: string[] = [];
    const days_ = new Set<string>();
    for (const t of free) {
      const ist = new Date(new Date(t).getTime() + 5.5 * 3600_000);
      const h = ist.getUTCHours();
      const day = ist.toISOString().slice(0, 10);
      if (h >= 14 && h <= 17 && !days_.has(day)) { picked.push(t); days_.add(day); }
      if (picked.length >= max) break;
    }
    return { slots: picked, source: "calendly" };
  } catch {
    return { slots: [], source: "error" };
  }
}

export function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
}

type InviteePayload = {
  uri?: string; email?: string; rescheduled?: boolean; status?: string;
  tracking?: { utm_content?: string | null };
  scheduled_event?: { uri?: string; start_time?: string; end_time?: string; status?: string };
  event?: string;
};

/** Applies a Calendly invitee record (from webhook or polling). Idempotent on the event URI. */
export async function applyInvitee(kind: "created" | "canceled", p: InviteePayload, via: "webhook" | "poll") {
  const utm = p.tracking?.utm_content ?? "";
  const threadId = utm.startsWith("t_") ? utm.slice(2) : null;
  if (!threadId) return { matched: false, reason: "No ThesisDesk tracking id on booking" };
  const [thread] = await db().select().from(outreachThreads).where(eq(outreachThreads.id, threadId));
  if (!thread) return { matched: false, reason: "Unknown thread" };
  const eventUri = p.scheduled_event?.uri ?? p.event ?? null;
  if (!eventUri) return { matched: false, reason: "No event URI" };

  if (kind === "created") {
    const values = {
      applicationId: thread.applicationId, threadId, calendlyEventUri: eventUri, inviteeUri: p.uri ?? null, status: "scheduled" as const,
      startTime: p.scheduled_event?.start_time ? new Date(p.scheduled_event.start_time) : null,
      endTime: p.scheduled_event?.end_time ? new Date(p.scheduled_event.end_time) : null, confirmedVia: via,
    };
    // A reschedule cancels the old event first; any other scheduled meeting for the app is superseded, not double-booked.
    await db().update(meetings).set({ status: "rescheduled", updatedAt: new Date() })
      .where(and(eq(meetings.applicationId, thread.applicationId), eq(meetings.status, "scheduled")));
    await db().insert(meetings).values(values).onConflictDoUpdate({ target: meetings.calendlyEventUri, set: { ...values, updatedAt: new Date() } });
    await db().update(outreachThreads).set({ status: "meeting_booked", nextFollowupAt: null, updatedAt: new Date() }).where(eq(outreachThreads.id, threadId));
    return { matched: true, status: "scheduled" };
  }
  await db().update(meetings).set({ status: p.rescheduled ? "rescheduled" : "canceled", updatedAt: new Date() }).where(eq(meetings.calendlyEventUri, eventUri));
  if (!p.rescheduled) await db().update(outreachThreads).set({ status: "replied", updatedAt: new Date() }).where(eq(outreachThreads.id, threadId));
  return { matched: true, status: p.rescheduled ? "rescheduled" : "canceled" };
}

/** Polling fallback when webhooks are unavailable: reads recent scheduled events and their invitees. */
export async function pollBookings(): Promise<{ checked: number; applied: number; note?: string }> {
  const e = env();
  if (!e.CALENDLY_PAT) return { checked: 0, applied: 0, note: "Calendly not configured" };
  const me = await fetch(`${API}/users/me`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (!me.ok) return { checked: 0, applied: 0, note: `Calendly users/me ${me.status}` };
  const user = ((await me.json()) as { resource: { uri: string } }).resource.uri;
  const q = new URLSearchParams({ user, min_start_time: new Date(Date.now() - 2 * 86400_000).toISOString(), count: "50", sort: "start_time:asc" });
  const evRes = await fetch(`${API}/scheduled_events?${q}`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (!evRes.ok) return { checked: 0, applied: 0, note: `Calendly scheduled_events ${evRes.status}` };
  const events = ((await evRes.json()) as { collection: { uri: string; start_time: string; end_time: string; status: string }[] }).collection;
  let applied = 0;
  for (const ev of events) {
    const inv = await fetch(`${ev.uri}/invitees`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
    if (!inv.ok) continue;
    for (const i of ((await inv.json()) as { collection: InviteePayload[] }).collection) {
      const r = await applyInvitee(ev.status === "canceled" ? "canceled" : "created", { ...i, scheduled_event: { uri: ev.uri, start_time: ev.start_time, end_time: ev.end_time } }, "poll");
      if (r.matched) applied++;
    }
  }
  return { checked: events.length, applied };
}
