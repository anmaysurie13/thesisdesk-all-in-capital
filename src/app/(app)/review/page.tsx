import { connection } from "next/server";
import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { applications, conflicts, decisions, users } from "@/db/schema";
import { Empty, fmtDate, OutcomePill, PageHeader, Panel, Pill, StatusPill, Table } from "@/components/td/ui";

export default async function PartnerReview() {
  await connection();
  const [queue, openConflicts, history] = await Promise.all([
    db().select().from(applications).where(inArray(applications.status, ["awaiting_review", "awaiting_technical", "awaiting_partner"])).orderBy(applications.scoredAt),
    db().select({ c: conflicts, ref: applications.ref, company: applications.companyName, appId: applications.id }).from(conflicts).innerJoin(applications, eq(applications.id, conflicts.applicationId)).where(eq(conflicts.status, "open")),
    db().select({ d: decisions, name: users.name, ref: applications.ref, company: applications.companyName, appId: applications.id }).from(decisions)
      .leftJoin(users, eq(users.id, decisions.actorId)).innerJoin(applications, eq(applications.id, decisions.applicationId)).orderBy(desc(decisions.createdAt)).limit(60),
  ]);
  const stage = (s: string) => queue.filter((a) => a.status === s);
  const col = (title: string, s: string, who: string) => (
    <Panel title={title} subtitle={who}>
      {stage(s).length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing waiting.</p> : (
        <ul className="space-y-2">{stage(s).map((a) => (
          <li key={a.id}><Link href={`/applications/${a.id}`} className="flex items-center justify-between gap-2 rounded-lg border bg-white/50 px-3 py-2 text-[13px] hover:bg-muted/50">
            <span><b>{a.companyName}</b><span className="block text-[11px] text-muted-foreground">{a.ref} · {a.sector ?? "—"}</span></span>
            <span className="flex items-center gap-1.5">{a.flags.length > 0 && <Pill tone="warn">{a.flags.length} flag(s)</Pill>}<OutcomePill outcome={a.recommendation} /></span>
          </Link></li>
        ))}</ul>
      )}
    </Panel>
  );
  return (
    <>
      <PageHeader kicker="Human gates" title="Partner Review" description="AI recommends; humans decide. Gates are enforced on the server: only Riya records the associate call, only Aditya the technical review, only Kushal signs off." />
      <div className="grid gap-4 lg:grid-cols-3">
        {col("1 · Riya's review", "awaiting_review", "Associate")}
        {col("2 · Technical review", "awaiting_technical", "Aditya — deeptech / hardware only")}
        {col("3 · Partner sign-off", "awaiting_partner", "Kushal sees every outcome")}
      </div>
      <Panel title="Open portfolio conflicts" subtitle="Need partner clearance before any GO" className="mt-4">
        {openConflicts.length === 0 ? <p className="text-[13px] text-muted-foreground">None open.</p> : (
          <ul className="space-y-1.5 text-[13px]">{openConflicts.map(({ c, ref, company, appId }) => <li key={c.id}><Link className="underline" href={`/applications/${appId}`}>{company} ({ref})</Link> overlaps <b>{c.portfolioCompany}</b> — {c.reason}</li>)}</ul>
        )}
      </Panel>
      <h2 className="mb-2 mt-6 text-[15px] font-semibold text-primary">Decision history</h2>
      {history.length === 0 ? <Empty title="No decisions yet" /> : (
        <Table head={["When", "Application", "Stage", "By", "AI", "Human", "Note"]}>
          {history.map(({ d, name, ref, company, appId }) => (
            <tr key={d.id}>
              <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(d.createdAt)}</td>
              <td className="px-3 py-2"><Link className="underline" href={`/applications/${appId}`}>{company}</Link> <span className="font-mono text-[11px] text-muted-foreground">{ref}</span></td>
              <td className="px-3 py-2"><StatusPill status={d.stage} /></td>
              <td className="px-3 py-2">{name}</td>
              <td className="px-3 py-2"><OutcomePill outcome={d.aiRecommendation} /></td>
              <td className="px-3 py-2"><OutcomePill outcome={d.outcome} /></td>
              <td className="max-w-sm px-3 py-2 text-muted-foreground">{d.note}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
