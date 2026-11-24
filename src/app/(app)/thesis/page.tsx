import { connection } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { corrections, memoPassages, portfolioCompanies, thesisVersions, users } from "@/db/schema";
import { correctionDecisionAction, portfolioAction, thesisAction } from "@/app/actions";
import { ActionForm, inputCls, Submit } from "@/components/td/action-form";
import { Empty, fmtDate, Notice, PageHeader, Panel, Pill, Table } from "@/components/td/ui";
import { can } from "@/lib/authz";
import { currentUser } from "@/lib/session";

export default async function ThesisMemory() {
  await connection();
  const u = await currentUser();
  const [versions, corr, memos, pf] = await Promise.all([
    db().select({ t: thesisVersions, approver: users.name }).from(thesisVersions).leftJoin(users, eq(users.id, thesisVersions.approvedBy)).orderBy(desc(thesisVersions.version)),
    db().select().from(corrections).orderBy(desc(corrections.effectiveAt)).limit(120),
    db().select({ id: memoPassages.id }).from(memoPassages),
    db().select().from(portfolioCompanies).orderBy(portfolioCompanies.name),
  ]);
  const active = versions.find((v) => v.t.status === "active")?.t;
  const latest = versions[0]?.t;
  const base = active ?? latest;
  const isPartner = !!u && can(u.role, "approve_thesis");
  return (
    <>
      <PageHeader kicker="Loop 3 · Learning" title="Thesis & Memory" description="Criteria, weights, exclusions and thresholds are versioned. A version must be backtested and approved by a partner before it can score live applications. Rollback re-activates an earlier approved version." />
      {!active && <div className="mb-4"><Notice tone="bad">No thesis version is active, so live screening is blocked. Backtest a draft, then a partner approves and activates it.</Notice></div>}
      {base && (
        <Panel title={`Thesis v${base.version} · ${base.status}`} subtitle={base.changeNote} className="mb-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Criteria (weights sum to 100%)</p>
              <ul className="space-y-1.5 text-[13px]">{base.criteria.map((c) => <li key={c.key}><b>{c.label}</b> · {Math.round(c.weight * 100)}%{c.appliesTo ? ` · only ${c.appliesTo.join("/")}` : ""}<span className="block text-muted-foreground">{c.description}</span></li>)}</ul>
              <p className="mt-3 text-[13px]">GO ≥ <b>{base.goMin}</b> · PASS ≤ <b>{base.passMax}</b> · at least <b>{base.minScoredCriteria}</b> criteria with evidence, otherwise REQUEST INFO</p>
              <p className="mt-1 text-[13px]">Sectors: {base.sectors.join(", ")} · Stages: {base.stages.join(", ")}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exclusions (flag for humans — never auto-reject)</p>
              <ul className="space-y-1 text-[13px]">{base.exclusions.map((x) => <li key={x.key}>{x.rule} <span className="text-[11px] text-muted-foreground">[{x.source}]</span></li>)}</ul>
              <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stated thesis vs revealed preferences</p>
              <ul className="space-y-1 text-[13px]">{base.statements.map((s, i) => <li key={i}><Pill tone={s.kind === "stated" ? "info" : "warn"}>{s.kind}</Pill> {s.text} <span className="text-[11px] text-muted-foreground">[{s.source} · {s.confidence}]</span></li>)}</ul>
            </div>
          </div>
          {u && can(u.role, "propose_thesis") && (
            <details className="mt-4 rounded-lg border bg-white/40 p-3">
              <summary className="cursor-pointer text-[13px] font-medium">Propose a new version from v{base.version}</summary>
              <ActionForm action={thesisAction} hidden={{ op: "propose", id: base.id }} className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">Edit weights as JSON (must sum to 1) and thresholds. The new version starts as a draft.</p>
                <textarea name="weights" rows={4} className={`${inputCls} font-mono text-xs`} defaultValue={JSON.stringify(Object.fromEntries(base.criteria.map((c) => [c.key, c.weight])), null, 1)} />
                <div className="flex flex-wrap gap-2">
                  <input name="goMin" type="number" step="0.1" defaultValue={base.goMin} className={`${inputCls} w-28`} aria-label="GO minimum" />
                  <input name="passMax" type="number" step="0.1" defaultValue={base.passMax} className={`${inputCls} w-28`} aria-label="PASS maximum" />
                  <input name="note" required placeholder="Why this change" className={`${inputCls} flex-1`} />
                  <Submit variant="outline">Propose</Submit>
                </div>
              </ActionForm>
            </details>
          )}
        </Panel>
      )}

      <h2 className="mb-2 text-[15px] font-semibold text-primary">Versions</h2>
      {versions.length === 0 ? <Empty title="No thesis yet">Run the seed script to create v0.</Empty> : (
        <Table head={["Version", "Status", "Note", "Approved", "Actions"]} className="mb-6">
          {versions.map(({ t, approver }) => (
            <tr key={t.id}>
              <td className="px-3 py-2 font-medium">v{t.version}</td>
              <td className="px-3 py-2"><Pill tone={t.status === "active" ? "ok" : t.status === "draft" ? "warn" : "muted"}>{t.status}</Pill></td>
              <td className="max-w-md px-3 py-2 text-muted-foreground">{t.changeNote}</td>
              <td className="px-3 py-2 text-xs">{approver ? `${approver} · ${fmtDate(t.approvedAt)}` : "—"}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {u && can(u.role, "run_backtest") && ["draft", "approved", "active"].includes(t.status) && (
                    <ActionForm action={thesisAction} hidden={{ op: "backtest", id: t.id }} className="flex gap-1">
                      <select name="split" className="rounded border bg-card px-1 text-xs"><option value="tune">tune half</option><option value="sealed">sealed half</option><option value="all">all rows</option></select>
                      <Submit variant="outline">Backtest</Submit>
                    </ActionForm>
                  )}
                  {isPartner && t.status === "draft" && <ActionForm action={thesisAction} hidden={{ op: "approve", id: t.id }}><Submit variant="gold">Approve</Submit></ActionForm>}
                  {isPartner && (t.status === "approved" || t.status === "retired") && <ActionForm action={thesisAction} hidden={{ op: "activate", id: t.id }}><Submit>{t.status === "retired" ? "Roll back to this" : "Activate"}</Submit></ActionForm>}
                  {isPartner && (t.status === "draft" || t.status === "approved") && <ActionForm action={thesisAction} hidden={{ op: "reject", id: t.id }}><Submit variant="danger">Reject</Submit></ActionForm>}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Panel title="Memory: corrections" subtitle="Riya's overturns and score corrections need partner approval before they are retrieved. Email edits are style memory.">
          {corr.length === 0 ? <Empty title="No corrections yet" /> : (
            <ul className="divide-y text-[13px]">
              {corr.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start gap-2 py-2">
                  <Pill tone={c.status === "approved" ? "ok" : c.status === "proposed" ? "warn" : "muted"}>{c.status}</Pill>
                  <Pill>{c.kind}</Pill>
                  <span className="min-w-0 flex-1">{c.kind === "email_edit" ? (c.after.changed ? "Riya rewrote a draft" : "Draft sent unchanged") : c.lesson}<span className="block text-[11px] text-muted-foreground">{c.authorLabel} · {c.provenance} · {fmtDate(c.effectiveAt)}{c.sector ? ` · ${c.sector}` : ""}</span></span>
                  {isPartner && c.status === "proposed" && (
                    <span className="flex gap-1">
                      <ActionForm action={correctionDecisionAction} hidden={{ id: c.id, decision: "approve" }}><Submit variant="outline">Approve</Submit></ActionForm>
                      <ActionForm action={correctionDecisionAction} hidden={{ id: c.id, decision: "reject" }}><Submit variant="danger">Reject</Submit></ActionForm>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Deal memo passages" subtitle="Retrieved by relevance (top 3) for scoring">
            {memos.length === 0 ? <Notice tone="warn">No memos imported. The Case 03 memo and partner-notes PDFs are not in the data folder, so memo retrieval is <b>conditional</b>.</Notice> : <p className="text-[13px]">{memos.length} passages indexed.</p>}
          </Panel>
          <Panel title="Portfolio (for overlap checks)" subtitle="Each entry cites its source; unverified entries are marked">
            {pf.length === 0 ? <p className="text-[13px] text-muted-foreground">Empty.</p> : <ul className="space-y-1 text-[13px]">{pf.map((p) => <li key={p.id}><b>{p.name}</b> {p.sector ? `· ${p.sector}` : ""} {!p.verified && <Pill tone="warn">unverified</Pill>}<span className="block text-[11px] text-muted-foreground">{p.sourceNote}</span></li>)}</ul>}
            {u && can(u.role, "propose_thesis") && (
              <ActionForm action={portfolioAction} className="mt-3 grid gap-2">
                <input name="name" required placeholder="Company" className={inputCls} />
                <input name="description" placeholder="What it does" className={inputCls} />
                <input name="sourceUrl" placeholder="Source URL" className={inputCls} />
                <input name="sourceNote" required placeholder="Source note (where this comes from)" className={inputCls} />
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="verified" /> verified from a public source</label>
                <Submit variant="outline">Add portfolio company</Submit>
              </ActionForm>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
