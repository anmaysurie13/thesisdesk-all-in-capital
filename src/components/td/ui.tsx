import type { ReactNode } from "react";
import { cn } from "cn";

export function PageHeader({ title, kicker, children, description }: { title: string; kicker?: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <header className="td-rise mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {kicker && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--sage)]">{kicker}</p>}
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-tight text-primary">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Panel({ title, action, children, className, subtitle }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("td-rise rounded-xl border bg-card p-5 shadow-[0_1px_0_rgba(24,59,50,0.04)]", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-primary">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneCls = { default: "text-primary", good: "text-[var(--sage)]", warn: "text-[var(--gold)]", bad: "text-destructive" }[tone];
  return (
    <div className="td-rise rounded-xl border bg-card px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-[family-name:var(--font-display)] text-[26px] leading-none tabular-nums", toneCls)}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const PILL: Record<string, string> = {
  GO: "bg-[#183b32] text-[#f5f3ec]",
  PASS: "bg-[#ece9df] text-[#56635d] ring-1 ring-[#d6d1c2]",
  HOLD: "bg-[#f3e6cc] text-[#7a5a1e]",
  REQUEST_INFO: "bg-[#dfe8e1] text-[#183b32]",
  ok: "bg-[#dfe8e1] text-[#183b32]",
  warn: "bg-[#f3e6cc] text-[#7a5a1e]",
  bad: "bg-[#f4dcd8] text-[#8b2f25]",
  muted: "bg-muted text-muted-foreground",
  info: "bg-[#e6eef5] text-[#284b66]",
};

export function Pill({ children, tone = "muted", className, title }: { children: ReactNode; tone?: keyof typeof PILL | string; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", PILL[tone] ?? PILL.muted, className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  received: "muted", queued: "info", processing: "info", needs_attention: "bad", paused: "warn", duplicate: "warn", invalid: "bad",
  awaiting_review: "warn", awaiting_technical: "warn", awaiting_partner: "warn", decided: "ok",
  draft: "warn", simulated: "info", sent: "ok", delivered: "ok", bounced: "bad", failed: "bad", received_email: "info",
  scheduled: "ok", canceled: "bad", rescheduled: "warn", link_sent: "info", completed: "ok",
};
export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? "muted"}>{status.replaceAll("_", " ")}</Pill>;
}
export function OutcomePill({ outcome }: { outcome: string | null | undefined }) {
  if (!outcome) return <Pill>—</Pill>;
  return <Pill tone={outcome}>{outcome === "REQUEST_INFO" ? "REQUEST INFO" : outcome}</Pill>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/60 px-6 py-10 text-center">
      <p className="text-sm font-medium text-primary">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "info" | "ok"; children: ReactNode }) {
  const cls = { warn: "border-[#e5cf9f] bg-[#faf1de] text-[#6b4f1a]", bad: "border-[#e6b9b2] bg-[#f8e5e1] text-[#7c2a21]", info: "border-[#c9d8e4] bg-[#eef3f8] text-[#284b66]", ok: "border-[#c5d6ca] bg-[#e6efe8] text-[#183b32]" }[tone];
  return <div className={cn("rounded-lg border px-3.5 py-2.5 text-[13px]", cls)}>{children}</div>;
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border bg-card", className)}>
      <table className="w-full text-left text-[13px]">
        <thead className="border-b bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtDay = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—";
export const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
