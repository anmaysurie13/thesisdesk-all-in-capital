import { connection } from "next/server";
import Link from "next/link";
import { env } from "@/lib/env";
import { overviewMetrics } from "@/lib/queries";
import { Empty, fmtDate, PageHeader, Panel, Pill, Stat, usd } from "@/components/td/ui";

const BASELINE_MIN = 30; // Riya's manual triage time per application (Case 03/04)

export default async function Overview() {
  await connection();
  const m = await overviewMetrics();
  const e = env();
  const s = m.byStatus;
  const awaitingRiya = s.awaiting_review ?? 0;
  const awaitingPartner = (s.awaiting_partner ?? 0) + (s.awaiting_technical ?? 0);
  const avgMin = m.avgReviewSec != null ? m.avgReviewSec / 60 : null;
  return (
    <>
      <PageHeader kicker="Overview" title="Today at the desk" description="Every number below is read live from the database. Nothing is advanced or rejected automatically." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Applications this week" value={m.weekCount} hint={`${m.total} received in total`} />
        <Stat label="Waiting for Riya" value={awaitingRiya} tone={awaitingRiya ? "warn" : "default"} hint={`${awaitingPartner} waiting for partners`} />
        <Stat label="Needs attention" value={m.needsAttention} tone={m.needsAttention ? "bad" : "good"} hint={`${m.queueDepth} jobs queued or running`} />
        <Stat label="Spend today" value={usd(m.spendDay.cost)} tone={m.spendDay.cost >= e.DAILY_SPEND_CAP_USD * 0.8 ? "warn" : "default"} hint={`cap ${usd(e.DAILY_SPEND_CAP_USD)} · month ${usd(m.spendMonth.cost)} / ${usd(e.MONTHLY_SPEND_CAP_USD)}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Review time vs Riya's 30-minute baseline" subtitle="Measured from the Evidence Room review timer">
          {avgMin == null ? (
            <Empty title="No measured reviews yet">The timer records how long a reviewer spends on an application before deciding.</Empty>
          ) : (
            <div>
              <p className="font-[family-name:var(--font-display)] text-4xl text-primary">{avgMin.toFixed(1)} <span className="text-base text-muted-foreground">min</span></p>
              <p className="mt-1 text-sm text-muted-foreground">average over {m.reviewSamples} review session(s) · baseline {BASELINE_MIN} min</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-[var(--sage)]" style={{ width: `${Math.min(100, (avgMin / BASELINE_MIN) * 100)}%` }} /></div>
            </div>
          )}
        </Panel>
        <Panel title="AI vs Riya agreement" subtitle="Live decisions, associate stage">
          {m.agreement == null ? <Empty title="No associate decisions yet" /> : (
            <p className="font-[family-name:var(--font-display)] text-4xl text-primary">{Math.round(m.agreement * 100)}% <span className="text-base text-muted-foreground">of {m.agreementN}</span></p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Historical baseline from the Loop 1 export: 28 of 40 calls (70%). See <Link className="underline" href="/evals">Evaluations</Link> for the backtest.</p>
        </Panel>
        <Panel title="Pipeline" subtitle="Applications by status">
          {Object.keys(s).length === 0 ? <Empty title="No applications yet"><Link className="underline" href="/inbox">Add the first batch</Link></Empty> : (
            <ul className="space-y-1.5 text-[13px]">
              {Object.entries(s).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between"><span className="capitalize text-muted-foreground">{k.replaceAll("_", " ")}</span><span className="tabular-nums font-medium">{v}</span></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Alerts">
          {m.alerts.length === 0 ? <Empty title="No alerts" /> : (
            <ul className="space-y-2 text-[13px]">
              {m.alerts.map((a) => <li key={a.id} className="flex gap-2"><Pill tone={a.level === "critical" ? "bad" : a.level === "warning" ? "warn" : "info"}>{a.level}</Pill><span>{a.message}</span><span className="ml-auto text-xs text-muted-foreground">{fmtDate(a.at)}</span></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Recent activity" subtitle="Audit log">
          {m.recent.length === 0 ? <Empty title="Nothing yet" /> : (
            <ul className="space-y-1.5 text-[13px]">
              {m.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <Pill tone={r.allowed ? "muted" : "bad"}>{r.actorRole ?? "system"}</Pill>
                  <span className="font-mono text-xs">{r.action}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{fmtDate(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
