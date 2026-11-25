import { connection } from "next/server";
import Link from "next/link";
import { manualReplyAction, saveDraftAction, sendEmailAction, stopThreadAction } from "@/app/actions";
import { ActionForm, inputCls, Submit } from "@/components/td/action-form";
import { Empty, fmtDate, Notice, PageHeader, Panel, Pill, StatusPill } from "@/components/td/ui";
import { can } from "@/lib/authz";
import { env, integrations } from "@/lib/env";
import { lintDraft } from "@/lib/outreach/flow";
import { threadsWithEmails } from "@/lib/queries";
import { currentUser } from "@/lib/session";

export default async function FounderDesk() {
  await connection();
  const u = await currentUser();
  const e = env();
  const i = integrations();
  const threads = await threadsWithEmails();
  const canSend = !!u && can(u.role, "approve_send_email");
  return (
    <>
      <PageHeader kicker="Loop 2 · Outreach" title="Founder Desk" description="Drafts appear only after a partner GO. Nothing is sent until Riya edits, ticks the confirmation and presses Send." />
      {/* Email mode is shown in the top bar on every page; here we only flag live sending, and the reply limitation once threads exist. */}
      {(e.EMAIL_MODE === "live" || (threads.length > 0 && !i.resendWebhook)) && (
        <div className="mb-4 space-y-2">
          {e.EMAIL_MODE === "live" && <Notice tone="bad"><b>Live sending.</b> Approved emails go to founders.</Notice>}
          {threads.length > 0 && !i.resendWebhook && <p className="text-xs text-muted-foreground">Founder replies aren&apos;t synced automatically yet — paste them with “Enter a reply manually”.</p>}
        </div>
      )}
      {threads.length === 0 ? <Empty title="No outreach yet">A thread opens when Kushal signs off an application as GO.</Empty> : (
        <div className="space-y-4">
          {threads.map(({ t, ref, company, emails }) => (
            <Panel key={t.id} title={<span>{company} <Link href={`/applications/${t.applicationId}`} className="font-mono text-[11px] font-normal text-muted-foreground underline">{ref}</Link></span>}
              subtitle={<span className="flex flex-wrap items-center gap-1.5"><StatusPill status={t.status} /> follow-ups {t.followupsSent}/{e.FOLLOWUP_MAX}{t.nextFollowupAt ? ` · next draft due ${fmtDate(t.nextFollowupAt)}` : ""}{t.stopReason ? ` · stopped: ${t.stopReason}` : ""}</span>}>
              <div className="space-y-3">
                {emails.map((m) => m.direction === "in" ? (
                  <div key={m.id} className="rounded-lg border-l-4 border-[var(--sage)] bg-white/60 p-3 text-[13px]">
                    <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">Founder reply · {fmtDate(m.createdAt)} {m.intent && <Pill tone={m.intent === "interested" ? "ok" : m.intent === "ambiguous" || m.intent === "not_interested" ? "bad" : "warn"}>{m.intent}{m.intentConfidence != null ? ` ${Math.round(m.intentConfidence * 100)}%` : ""}</Pill>}{m.intentSource && <Pill>{m.intentSource}</Pill>}</p>
                    <p className="whitespace-pre-wrap">{m.bodyFinal}</p>
                  </div>
                ) : m.status === "draft" ? (
                  <div key={m.id} className="rounded-lg border bg-[#fffdf6] p-3">
                    <p className="mb-2 text-xs text-muted-foreground">Draft · {m.kind} · {m.promptVersion}</p>
                    {lintDraft(m.bodyFinal ?? "", m.kind === "first").map((w) => <p key={w} className="text-xs text-[#7a5a1e]">⚠ {w}</p>)}
                    {m.error && <p className="text-xs text-[#7a5a1e]">⚠ {m.error}</p>}
                    <ActionForm action={canSend ? sendEmailAction : saveDraftAction} hidden={{ emailId: m.id }} className="mt-2 space-y-2">
                      <input name="subject" defaultValue={m.subject} className={inputCls} aria-label="Subject" />
                      <textarea name="body" defaultValue={m.bodyFinal ?? ""} rows={9} className={`${inputCls} font-mono text-[12.5px]`} aria-label="Body" />
                      <p className="text-[11px] text-muted-foreground">{"{{first_name}}"} and {"{{scheduling_link}}"} are filled in only at send time — the model never sees the founder&apos;s name.</p>
                      {canSend ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="confirm" value="yes" /> I have read this email and approve sending it ({e.EMAIL_MODE})</label>
                          <Submit variant="gold">Send</Submit>
                        </div>
                      ) : <Submit variant="outline">Save draft</Submit>}
                    </ActionForm>
                  </div>
                ) : (
                  <div key={m.id} className="rounded-lg border bg-card p-3 text-[13px]">
                    <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">{m.kind} · <StatusPill status={m.status} />{m.mode && <Pill tone={m.mode === "simulate" ? "info" : "warn"}>{m.mode === "simulate" ? "SIMULATED" : m.mode}</Pill>} {fmtDate(m.sentAt ?? m.createdAt)}</p>
                    <p className="font-medium">{m.subject}</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{m.bodyFinal}</p>
                    {m.error && <p className="text-xs text-destructive">{m.error}</p>}
                  </div>
                ))}
              </div>
              {u && can(u.role, "record_reply") && !["stopped", "closed"].includes(t.status) && t.status !== "drafting" && (
                <details className="mt-3 rounded-lg border bg-white/40 p-3">
                  <summary className="cursor-pointer text-[13px] font-medium">Enter a reply manually</summary>
                  <ActionForm action={manualReplyAction} hidden={{ threadId: t.id }} className="mt-2 space-y-2">
                    <textarea name="body" rows={4} placeholder="Paste the founder's reply" className={inputCls} />
                    <div className="flex flex-wrap gap-2">
                      <select name="intent" defaultValue="auto" className="rounded-lg border bg-card px-2 py-1.5 text-[13px]">
                        <option value="auto">Classify with AI</option><option value="interested">Interested</option><option value="not_interested">Not interested</option><option value="needs_info">Needs info</option><option value="reschedule">Reschedule</option><option value="out_of_office">Out of office</option><option value="ambiguous">Ambiguous</option>
                      </select>
                      <Submit variant="outline">Record reply</Submit>
                    </div>
                  </ActionForm>
                </details>
              )}
              {canSend && !["stopped", "closed"].includes(t.status) && (
                <ActionForm action={stopThreadAction} hidden={{ threadId: t.id }} className="mt-2 flex flex-wrap items-center gap-2">
                  <input name="reason" placeholder="Reason to stop outreach" className={`${inputCls} max-w-xs`} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="suppress" /> suppress future emails</label>
                  <Submit variant="danger">Stop thread</Submit>
                </ActionForm>
              )}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
