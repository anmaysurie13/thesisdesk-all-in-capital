import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, outreachThreads } from "@/db/schema";
import { callOutcomeAction, manualMeetingAction, opsAction } from "@/app/actions";
import { ActionForm, inputCls, Submit } from "@/components/td/action-form";
import { Empty, fmtDate, Notice, PageHeader, Panel, Pill, StatusPill, Table } from "@/components/td/ui";
import { can } from "@/lib/authz";
import { integrations } from "@/lib/env";
import { meetingRows } from "@/lib/queries";
import { currentUser } from "@/lib/session";

export default async function Meetings() {
  await connection();
  const u = await currentUser();
  const i = integrations();
  const rows = await meetingRows();
  const awaiting = await db().select({ id: outreachThreads.id, company: applications.companyName }).from(outreachThreads)
    .innerJoin(applications, eq(applications.id, outreachThreads.applicationId)).where(eq(outreachThreads.status, "replied"));
  return (
    <>
      <PageHeader kicker="Loop 2 · Scheduling" title="Meetings" description="A meeting counts as booked only when Calendly confirms it (webhook or polling). Manual confirmations are labelled as such.">
        <ActionForm action={opsAction} hidden={{ op: "tick" }}><Submit variant="outline">Poll Calendly now</Submit></ActionForm>
      </PageHeader>
      <div className="mb-4 space-y-2">
        {!i.calendly && <Notice tone="warn">Calendly is not configured (CALENDLY_PAT, CALENDLY_EVENT_TYPE_URI). Emails use generic slots and bookings can only be confirmed manually.</Notice>}
        {i.calendly && !i.calendlyWebhook && <Notice tone="info">Calendly webhooks not configured — bookings are picked up by polling every 15 minutes.</Notice>}
      </div>
      {rows.length === 0 ? <Empty title="No meetings yet">A scheduling link goes out with every approved GO email.</Empty> : (
        <Table head={["Company", "Status", "When (IST)", "Confirmed via", "Counter-proposals", "Outcome"]}>
          {rows.map(({ m, company, ref }) => (
            <tr key={m.id}>
              <td className="px-3 py-2"><b>{company}</b> <span className="font-mono text-[11px] text-muted-foreground">{ref}</span></td>
              <td className="px-3 py-2"><StatusPill status={m.status} /></td>
              <td className="px-3 py-2">{fmtDate(m.startTime)}</td>
              <td className="px-3 py-2">{m.confirmedVia ? <Pill tone={m.confirmedVia === "manual" ? "warn" : "ok"}>{m.confirmedVia === "manual" ? "manual (unverified)" : m.confirmedVia}</Pill> : "—"}</td>
              <td className="px-3 py-2 tabular-nums">{m.counterProposals}</td>
              <td className="px-3 py-2">
                {m.status === "scheduled" && u && can(u.role, "record_call_outcome") ? (
                  <ActionForm action={callOutcomeAction} hidden={{ meetingId: m.id }} className="flex flex-col gap-1.5">
                    <select name="status" className="rounded border bg-card px-2 py-1 text-xs"><option value="completed">Call happened</option><option value="no_show">No-show</option></select>
                    <input name="outcome" placeholder="Outcome (e.g. next: partner meeting)" className={inputCls} />
                    <textarea name="notes" rows={2} placeholder="Call notes → learnings (partner approves)" className={inputCls} />
                    <Submit variant="outline">Save outcome</Submit>
                  </ActionForm>
                ) : <span className="text-muted-foreground">{m.outcome ?? "—"}</span>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {u && can(u.role, "confirm_meeting") && awaiting.length > 0 && (
        <Panel title="Manual confirmation" subtitle="Only when Calendly cannot confirm. Recorded as manual and unverified." className="mt-4">
          <ActionForm action={manualMeetingAction} className="grid gap-2 sm:grid-cols-[1fr_220px_1fr_auto]">
            <select name="threadId" className={inputCls}>{awaiting.map((t) => <option key={t.id} value={t.id}>{t.company}</option>)}</select>
            <input name="start" type="datetime-local" required className={inputCls} />
            <input name="note" placeholder="How it was confirmed" className={inputCls} />
            <Submit variant="outline">Record</Submit>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
