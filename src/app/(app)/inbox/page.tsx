import { connection } from "next/server";
import Link from "next/link";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { Suspense } from "react";
import { db } from "@/db";
import { applications, APP_STATUSES } from "@/db/schema";
import { opsAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/td/action-form";
import { IntakeForm } from "@/components/td/intake-form";
import { Empty, fmtDate, OutcomePill, PageHeader, Panel, Pill, StatusPill, Table } from "@/components/td/ui";

async function Rows({ searchParams }: { searchParams: PageProps<"/inbox">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const where: SQL[] = [inArray(applications.source, ["form", "batch", "eval", "volume_test", "seed"])];
  if (typeof sp.status === "string" && (APP_STATUSES as readonly string[]).includes(sp.status)) where.push(eq(applications.status, sp.status as never));
  if (typeof sp.rec === "string" && sp.rec) where.push(eq(applications.recommendation, sp.rec as never));
  if (typeof sp.sector === "string" && sp.sector) where.push(eq(applications.sector, sp.sector));
  const rows = await db().select().from(applications).where(and(...where)).orderBy(desc(applications.submittedAt)).limit(200);
  if (!rows.length) return <Empty title="No applications match">Upload a batch above, or clear the filters.</Empty>;
  return (
    <Table head={["Ref", "Company", "Sector · stage", "Status", "AI recommends", "Score", "Flags", "Received"]}>
      {rows.map((a) => (
        <tr key={a.id} className="hover:bg-muted/40">
          <td className="px-3 py-2 font-mono text-xs"><Link className="underline-offset-2 hover:underline" href={`/applications/${a.id}`}>{a.ref}</Link></td>
          <td className="px-3 py-2 font-medium"><Link href={`/applications/${a.id}`}>{a.companyName}</Link></td>
          <td className="px-3 py-2 text-muted-foreground">{[a.sector, a.stage].filter(Boolean).join(" · ") || "—"}</td>
          <td className="px-3 py-2"><StatusPill status={a.status} />{a.statusReason && <p className="mt-0.5 max-w-[240px] truncate text-[11px] text-muted-foreground" title={a.statusReason}>{a.statusReason}</p>}</td>
          <td className="px-3 py-2"><OutcomePill outcome={a.recommendation} /></td>
          <td className="px-3 py-2 tabular-nums">{a.weightedScore != null ? a.weightedScore.toFixed(2) : "—"}</td>
          <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{a.flags.slice(0, 3).map((f) => <Pill key={f} tone="warn">{f.replace("exclusion:", "")}</Pill>)}</div></td>
          <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(a.submittedAt)}</td>
        </tr>
      ))}
    </Table>
  );
}

export default function Inbox({ searchParams }: PageProps<"/inbox">) {
  return (
    <>
      <PageHeader kicker="Loop 1 · Intake" title="Deal Inbox" description="Every upload is validated, de-duplicated and saved to a persistent queue before it is acknowledged. Missing, corrupted and duplicate applications are kept and flagged, never dropped.">
        <ActionForm action={opsAction} hidden={{ op: "tick" }}><Submit variant="outline">Process queue now</Submit></ActionForm>
      </PageHeader>
      <Panel title="Add applications" className="mb-5"><IntakeForm /></Panel>
      <form className="mb-3 flex flex-wrap gap-2 text-[13px]">
        <select name="status" className="rounded-lg border bg-card px-2 py-1.5"><option value="">Any status</option>{APP_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select>
        <select name="rec" className="rounded-lg border bg-card px-2 py-1.5"><option value="">Any recommendation</option>{["GO", "PASS", "HOLD", "REQUEST_INFO"].map((s) => <option key={s}>{s}</option>)}</select>
        <select name="sector" className="rounded-lg border bg-card px-2 py-1.5"><option value="">Any sector</option>{["Fintech", "Deeptech", "Consumer tech", "Consumer brands", "Commerce infrastructure"].map((s) => <option key={s}>{s}</option>)}</select>
        <button className="rounded-lg border bg-card px-3 py-1.5 hover:bg-muted">Filter</button>
      </form>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted/60" />}><Rows searchParams={searchParams} /></Suspense>
    </>
  );
}
