import { connection } from "next/server";
import Link from "next/link";
import { Empty, Notice, PageHeader, Panel, Stat, Table, usd } from "@/components/td/ui";
import { PRICES_CHECKED_AT, USD_INR_DISPLAY } from "@/lib/ai/pricing";
import { env } from "@/lib/env";
import { costBreakdown } from "@/lib/queries";

function Bar({ value, cap }: { value: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;
  return <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${pct >= 80 ? "bg-destructive" : "bg-[var(--sage)]"}`} style={{ width: `${pct}%` }} /></div>;
}

export default async function Costs() {
  await connection();
  const e = env();
  const c = await costBreakdown();
  const inr = (usdV: number) => `≈ ₹${(usdV * USD_INR_DISPLAY).toFixed(0)}`;
  return (
    <>
      <PageHeader kicker="Economics" title="Cost Centre" description="One ledger row per model call. Costs are OpenRouter's reported charge where the provider returns it; otherwise an estimate from list prices (labelled). Caps pause the system — there is no paid fallback." />
      <div className="grid gap-3 lg:grid-cols-4">
        <div><Stat label="Today" value={usd(c.day.cost)} hint={`${c.day.calls} calls · cap ${usd(e.DAILY_SPEND_CAP_USD)} · ${inr(c.day.cost)}`} /><Bar value={c.day.cost} cap={e.DAILY_SPEND_CAP_USD} /></div>
        <Stat label="This week" value={usd(c.week.cost)} hint={`${c.week.calls} calls`} />
        <div><Stat label="This month" value={usd(c.month.cost)} hint={`cap ${usd(e.MONTHLY_SPEND_CAP_USD)} · ${inr(c.month.cost)} (fund budget < ₹1,500)`} /><Bar value={c.month.cost} cap={e.MONTHLY_SPEND_CAP_USD} /></div>
        <div><Stat label="Calls today" value={c.day.calls} hint={`cap ${e.DAILY_MODEL_CALL_CAP}/day · ${e.MODEL_RPM_CAP}/min`} /><Bar value={c.day.calls} cap={e.DAILY_MODEL_CALL_CAP} /></div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-4">
        <Stat label="Actual (provider-reported)" value={usd(c.sources?.provider ?? 0)} hint="this month" />
        <Stat label="Estimated" value={usd(c.sources?.estimate ?? 0)} hint={`list prices checked ${PRICES_CHECKED_AT}`} />
        <Stat label="Tavily credits" value={`${c.tavily?.credits ?? 0} / ${e.TAVILY_MONTHLY_CREDIT_CAP}`} hint={`${c.tavily?.skipped ?? 0} research runs skipped (budget/unconfigured)`} />
        <Stat label="Resend sends today" value={`${c.resendToday} / 100`} hint="free plan: 100/day incl. inbound" />
      </div>
      {(c.sources?.blocked ?? 0) > 0 && <div className="mt-3"><Notice tone="bad">{c.sources?.blocked} model call(s) were blocked by a quota cap this month. See <Link href="/health" className="underline">System Health</Link>.</Notice></div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Per application (this month)" subtitle="Most expensive first">
          {c.byApp.length === 0 ? <Empty title="No model spend yet" /> : (
            <Table head={["Application", "Calls", "Cost"]}>{c.byApp.map((r) => <tr key={r.applicationId}><td className="px-3 py-1.5"><Link className="underline" href={`/applications/${r.applicationId}`}>{r.company ?? "—"}</Link> <span className="font-mono text-[11px] text-muted-foreground">{r.ref}</span></td><td className="px-3 py-1.5 tabular-nums">{Number(r.calls)}</td><td className="px-3 py-1.5 tabular-nums">{usd(r.cost)}</td></tr>)}</Table>
          )}
        </Panel>
        <Panel title="Per step and model (this month)">
          {c.byStep.length === 0 ? <Empty title="No calls yet" /> : (
            <Table head={["Prompt", "Model", "Calls", "Tokens in/out", "Avg ms", "Cost"]}>{c.byStep.map((r, i) => <tr key={i}><td className="px-3 py-1.5 font-mono text-[11px]">{r.step}</td><td className="px-3 py-1.5 text-[11px]">{r.model}</td><td className="px-3 py-1.5 tabular-nums">{Number(r.calls)}</td><td className="px-3 py-1.5 tabular-nums text-[11px]">{r.inTok ?? 0} / {r.outTok ?? 0}</td><td className="px-3 py-1.5 tabular-nums">{Math.round(r.avgMs ?? 0)}</td><td className="px-3 py-1.5 tabular-nums">{usd(r.cost)}</td></tr>)}</Table>
          )}
        </Panel>
      </div>
      <Panel title="Daily spend (last 30 days)" className="mt-4">
        {c.byDay.length === 0 ? <Empty title="No history yet" /> : (
          <div className="flex h-40 items-end gap-1" role="img" aria-label="Daily model spend">
            {[...c.byDay].reverse().map((d) => {
              const max = Math.max(...c.byDay.map((x) => x.cost), e.DAILY_SPEND_CAP_USD * 0.25);
              return <div key={d.day} className="group relative flex-1" title={`${d.day}: ${usd(d.cost)} · ${d.calls} calls · ${d.cached} cached`}><div className="w-full rounded-t bg-[var(--sage)]" style={{ height: `${Math.max(2, (d.cost / max) * 150)}px` }} /></div>;
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
