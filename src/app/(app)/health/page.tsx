import { connection } from "next/server";
import { opsAction } from "@/app/actions";
import { ActionForm, inputCls, Submit } from "@/components/td/action-form";
import { Empty, fmtDate, Notice, PageHeader, Panel, Pill, Table } from "@/components/td/ui";
import { can } from "@/lib/authz";
import { env, integrations, langfuseBaseUrl } from "@/lib/env";
import { healthData } from "@/lib/queries";
import { currentUser } from "@/lib/session";
import { getPause } from "@/lib/state";

export default async function Health() {
  await connection();
  const u = await currentUser();
  const [h, pause] = await Promise.all([healthData(), getPause()]);
  const i = integrations();
  const lf = h.states.langfuse as { ok?: boolean; lastError?: string; lastOkAt?: string; lastErrorAt?: string } | undefined;
  const worker = h.states.worker as { finishedAt?: string; claimed?: number; done?: number; trigger?: string } | undefined;
  const ops = !!u && can(u.role, "operate_system");
  const integ: [string, boolean, string][] = [
    ["Neon database", i.database, env().APP_ENV === "test" ? "test branch" : "live branch"],
    ["Gemini via OpenRouter", i.model, env().GEMINI_MODEL_PRIMARY],
    ["Portkey gateway + retries", i.portkey, i.portkey ? "all model calls routed through Portkey" : "NOT connected — app-level retry fallback in use"],
    ["Langfuse tracing", i.langfuse, langfuseBaseUrl()],
    ["Tavily research", i.tavily, i.tavily ? "budgeted" : "research skipped, gaps named"],
    ["Resend sending", i.resend, i.resendDomain ? "verified domain" : "no verified domain — own inbox only"],
    ["Resend webhooks", i.resendWebhook, "delivery + inbound"],
    ["Calendly", i.calendly, i.calendlyWebhook ? "webhooks" : "polling / manual"],
    ["Worker secret", i.worker, "authenticated /api/worker/tick"],
  ];
  const statuses = ["queued", "running", "paused", "needs_attention", "done"];
  const kinds = [...new Set(h.jobStats.map((j) => j.kind))];
  return (
    <>
      <PageHeader kicker="Operate" title="System Health" description="Queues, failures, integrations and traces. Anyone on the team can pause, resume or retry — no engineer needed.">
        {ops && (pause.paused
          ? <ActionForm action={opsAction} hidden={{ op: "resume" }}><Submit variant="gold">Resume system</Submit></ActionForm>
          : <ActionForm action={opsAction} hidden={{ op: "pause" }} className="flex gap-1"><input name="reason" placeholder="Reason" className={`${inputCls} w-44`} /><Submit variant="danger">Pause</Submit></ActionForm>)}
        {ops && <ActionForm action={opsAction} hidden={{ op: "tick" }}><Submit variant="outline">Run worker now</Submit></ActionForm>}
      </PageHeader>
      {pause.paused && <div className="mb-4"><Notice tone="bad">Paused since {fmtDate(pause.since)} — {pause.reason}. Resuming re-queues parked jobs; nothing was lost.</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Queues" subtitle={worker?.finishedAt ? `Last worker tick ${fmtDate(worker.finishedAt)} (${worker.trigger ?? ""}) · claimed ${worker.claimed ?? 0}` : "No worker tick recorded yet"}>
          {kinds.length === 0 ? <Empty title="No jobs yet" /> : (
            <Table head={["Job", ...statuses]}>
              {kinds.map((k) => <tr key={k}><td className="px-3 py-1.5 font-mono text-xs">{k}</td>{statuses.map((s) => <td key={s} className="px-3 py-1.5 tabular-nums">{Number(h.jobStats.find((j) => j.kind === k && j.status === s)?.n ?? 0)}</td>)}</tr>)}
            </Table>
          )}
        </Panel>
        <Panel title="Integrations" subtitle="Configured from environment variables (values never shown)">
          <ul className="space-y-1.5 text-[13px]">{integ.map(([n, ok, note]) => <li key={n} className="flex items-center gap-2"><Pill tone={ok ? "ok" : "bad"}>{ok ? "on" : "off"}</Pill><b>{n}</b><span className="text-muted-foreground">{note}</span></li>)}</ul>
          <p className="mt-3 text-xs text-muted-foreground">Langfuse: {lf ? (lf.ok ? `last ingest OK ${fmtDate(lf.lastOkAt)}` : `last error ${fmtDate(lf.lastErrorAt)} — ${lf.lastError}`) : "no traces sent yet"}</p>
        </Panel>
      </div>

      <Panel title="Needs attention" subtitle="Failed after bounded retries — kept with the reason, never dropped" className="mt-4">
        {h.attention.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing needs attention.</p> : (
          <ul className="divide-y text-[13px]">{h.attention.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-2 py-2">
              <Pill tone="bad">{j.kind}</Pill><b>{j.company ?? "—"}</b><span className="font-mono text-[11px]">{j.ref}</span>
              <span className="text-muted-foreground">step {j.step ?? "—"} · {j.attempts} attempt(s) · {j.lastError}</span>
              {ops && <ActionForm action={opsAction} hidden={{ op: "retry", jobId: j.id }} className="ml-auto"><Submit variant="outline">Retry</Submit></ActionForm>}
            </li>
          ))}</ul>
        )}
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Recent traces" subtitle="Trace ids match Langfuse (one trace per job run; spans per step; generation per model call)">
          {h.traces.length === 0 ? <Empty title="No model calls yet" /> : (
            <ul className="space-y-1 text-[12.5px]">{h.traces.map((t, i) => <li key={i} className="flex gap-2"><Pill tone={t.status === "ok" || t.status === "cached" ? "ok" : "bad"}>{t.status}</Pill><span className="font-mono text-[11px]">{t.traceId?.slice(0, 22)}</span><span>{t.step}</span><span className="text-muted-foreground">{t.promptVersion} · {t.latencyMs} ms · {t.retries} retries</span></li>)}</ul>
          )}
        </Panel>
        <Panel title="Errors & alerts">
          {h.errors.length + h.alerts.length === 0 ? <p className="text-[13px] text-muted-foreground">None.</p> : (
            <ul className="space-y-1 text-[12.5px]">
              {h.alerts.map((a) => <li key={a.id}><Pill tone={a.level === "critical" ? "bad" : "warn"}>{a.kind}</Pill> {a.message} <span className="text-muted-foreground">{fmtDate(a.at)}</span></li>)}
              {h.errors.map((e) => <li key={e.id}><Pill tone="bad">{e.status}</Pill> {e.promptKey}: {e.error} <span className="text-muted-foreground">{fmtDate(e.at)}</span></li>)}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
