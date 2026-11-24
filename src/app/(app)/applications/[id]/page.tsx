import { connection } from "next/server";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, briefs, claims, conflicts, criterionScores, decisions, documents, evidence, jobs, thesisVersions, users } from "@/db/schema";
import { conflictAction, reviewAction, scoreCorrectionAction } from "@/app/actions";
import { ActionForm, inputCls, Submit } from "@/components/td/action-form";
import { DocViewer, ReviewTimer } from "@/components/td/evidence-client";
import { Empty, fmtDate, fmtDay, Notice, OutcomePill, PageHeader, Panel, Pill, StatusPill } from "@/components/td/ui";
import { can } from "@/lib/authz";
import { currentUser } from "@/lib/session";

const VER_TONE: Record<string, string> = { verified: "ok", contradicted: "bad", unverifiable: "muted", unverified: "warn" };

function OutcomeSelect({ def }: { def?: string | null }) {
  return (
    <select name="outcome" defaultValue={def ?? "HOLD"} className={inputCls}>
      <option value="GO">GO — take the call</option><option value="PASS">PASS</option><option value="HOLD">HOLD</option><option value="REQUEST_INFO">REQUEST INFO</option>
    </select>
  );
}

export default async function EvidenceRoom({ params }: PageProps<"/applications/[id]">) {
  await connection();
  const { id } = await params;
  const u = await currentUser();
  const [a] = await db().select().from(applications).where(eq(applications.id, id));
  if (!a) notFound();
  const [docs, sc, cl, ev, br, cf, dec, jb] = await Promise.all([
    db().select({ id: documents.id, kind: documents.kind, filename: documents.filename, redactedText: documents.redactedText, status: documents.status, error: documents.error }).from(documents).where(eq(documents.applicationId, id)),
    db().select().from(criterionScores).where(eq(criterionScores.applicationId, id)).orderBy(desc(criterionScores.createdAt)),
    db().select().from(claims).where(eq(claims.applicationId, id)),
    db().select().from(evidence).where(eq(evidence.applicationId, id)).orderBy(asc(evidence.retrievedAt)),
    db().select().from(briefs).where(eq(briefs.applicationId, id)).orderBy(desc(briefs.createdAt)).limit(1),
    db().select().from(conflicts).where(eq(conflicts.applicationId, id)),
    db().select({ d: decisions, name: users.name }).from(decisions).leftJoin(users, eq(users.id, decisions.actorId)).where(eq(decisions.applicationId, id)).orderBy(asc(decisions.createdAt)),
    db().select().from(jobs).where(eq(jobs.applicationId, id)).orderBy(desc(jobs.createdAt)).limit(1),
  ]);
  const thesis = a.thesisVersionId ? (await db().select().from(thesisVersions).where(eq(thesisVersions.id, a.thesisVersionId)))[0] : null;
  const latestRun = sc[0]?.runId;
  const scores = sc.filter((s) => s.runId === latestRun);
  const evByRef = new Map(ev.map((e) => [e.ref, e]));
  const brief = br[0];
  const label = (k: string) => thesis?.criteria.find((c) => c.key === k)?.label ?? k;

  return (
    <>
      <PageHeader kicker={`Evidence Room · ${a.ref}`} title={a.companyName} description={[a.sector, a.stage, a.city, a.founderType].filter(Boolean).join(" · ") || undefined}>
        <StatusPill status={a.status} />
        <span className="text-xs text-muted-foreground">AI recommends</span><OutcomePill outcome={a.recommendation} />
        {a.finalOutcome && (<><span className="text-xs text-muted-foreground">Partner decision</span><OutcomePill outcome={a.finalOutcome} /></>)}
        <ReviewTimer applicationId={a.id} />
      </PageHeader>

      {a.statusReason && <div className="mb-4"><Notice tone={a.status === "needs_attention" || a.status === "invalid" ? "bad" : "warn"}>{a.statusReason}{jb[0]?.lastError && a.status === "needs_attention" ? ` · last error: ${jb[0].lastError}` : ""}</Notice></div>}
      {a.flags.length > 0 && <div className="mb-4 flex flex-wrap gap-1.5">{a.flags.map((f) => <Pill key={f} tone={/injection|fabricated|mismatch/.test(f) ? "bad" : "warn"}>{f.replace("exclusion:", "exclusion · ")}</Pill>)}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title="Documents" subtitle={`${docs.length} file(s)`} className="xl:sticky xl:top-4 xl:self-start">
          <DocViewer docs={docs.map((d) => ({ id: d.id, label: `${d.kind} · ${d.filename}`, text: d.redactedText ?? "", status: d.status, error: d.error }))} />
        </Panel>

        <div className="space-y-4">
          <Panel title="Recommendation" subtitle={thesis ? `Thesis v${thesis.version} (${thesis.status}) · computed in code from the criterion scores` : "Not scored yet"}>
            {a.recommendation ? (
              <div className="flex flex-wrap items-start gap-6">
                <div><p className="font-[family-name:var(--font-display)] text-4xl text-primary">{a.weightedScore?.toFixed(2) ?? "—"}<span className="text-base text-muted-foreground"> / 5</span></p><p className="text-xs text-muted-foreground">confidence {a.confidence != null ? Math.round(a.confidence * 100) : "—"}%</p></div>
                <ul className="flex-1 list-disc space-y-1 pl-4 text-[13px]">{a.recommendationReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            ) : <Empty title="Waiting in the queue">The worker scores applications in order (5 per minute).</Empty>}
          </Panel>

          {scores.length > 0 && (
            <Panel title="Criterion by criterion" subtitle="Every score cites evidence; uncited scores are treated as insufficient">
              <div className="space-y-3">
                {scores.map((s) => (
                  <div key={s.id} className="rounded-lg border bg-white/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-primary">{label(s.criterionKey)} <span className="font-normal text-muted-foreground">· weight {Math.round(s.weight * 100)}%</span></p>
                      <span className={`rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${s.score == null ? "bg-muted text-muted-foreground" : s.score >= 4 ? "bg-[#dfe8e1] text-primary" : s.score <= 2 ? "bg-[#f4dcd8] text-[#7c2a21]" : "bg-[#f3e6cc] text-[#7a5a1e]"}`}>{s.score ?? "n/e"}</span>
                    </div>
                    <p className="mt-1 text-[13px]">{s.reasoning}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {s.evidenceRefs.map((r) => <span key={r} title={evByRef.get(r)?.excerpt} className="cursor-help rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] text-primary">{r}</span>)}
                      {s.invalidRefs.map((r) => <Pill key={r} tone="bad" title="Cited a source that does not exist">fake ref {r}</Pill>)}
                      {s.missingInfo.length > 0 && <span className="text-[11px] text-muted-foreground">missing: {s.missingInfo.join("; ")}</span>}
                    </div>
                  </div>
                ))}
              </div>
              {u && can(u.role, "propose_correction") && (
                <ActionForm action={scoreCorrectionAction} hidden={{ applicationId: a.id }} className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-[1fr_80px_2fr_auto]">
                  <select name="criterionKey" className={inputCls}>{scores.map((s) => <option key={s.criterionKey} value={s.criterionKey}>{label(s.criterionKey)}</option>)}</select>
                  <input name="score" type="number" min={1} max={5} required placeholder="1–5" className={inputCls} />
                  <input name="reason" required minLength={8} placeholder="Why the score should change (one line)" className={inputCls} />
                  <Submit variant="outline">Correct score</Submit>
                </ActionForm>
              )}
            </Panel>
          )}

          {brief && (
            <Panel title="Investment brief" subtitle={`${brief.model} · ${brief.promptVersion}`}>
              <p className="text-[13.5px] leading-relaxed">{brief.summary}</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--sage)]">Strengths</p><ul className="space-y-1 text-[13px]">{brief.strengths.map((x, i) => <li key={i}>{x.text} <span className="font-mono text-[11px] text-muted-foreground">{x.refs.join(" ")}</span></li>)}</ul></div>
                <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-destructive">Risks</p><ul className="space-y-1 text-[13px]">{brief.risks.map((x, i) => <li key={i}>{x.text} <span className="font-mono text-[11px] text-muted-foreground">{x.refs.join(" ")}</span></li>)}</ul></div>
              </div>
              {brief.gaps.length > 0 && <div className="mt-3"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--gold)]">What we could not find out</p><ul className="list-disc pl-4 text-[13px]">{brief.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div>}
              {brief.questions.length > 0 && <div className="mt-3"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Questions for the call</p><ul className="list-disc pl-4 text-[13px]">{brief.questions.map((g, i) => <li key={i}>{g}</li>)}</ul></div>}
            </Panel>
          )}

          <Panel title="Founder claims vs verified facts" subtitle="Claims come from the founder; only independent, recent, same-company sources can verify them">
            {cl.length === 0 ? <Empty title="No claims extracted yet" /> : (
              <ul className="space-y-1.5 text-[13px]">{cl.map((c) => <li key={c.id} className="flex gap-2"><Pill tone={VER_TONE[c.verification]}>{c.verification}</Pill><span>{c.text}{c.verificationNote ? <span className="text-muted-foreground"> — {c.verificationNote}</span> : null}</span></li>)}</ul>
            )}
          </Panel>

          <Panel title="Evidence ledger" subtitle="Provenance, recency and identity of every source">
            {ev.length === 0 ? <Empty title="No evidence yet" /> : (
              <ul className="divide-y text-[12.5px]">
                {ev.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start gap-2 py-1.5">
                    <span className="w-9 font-mono text-[11px] text-primary">{e.ref}</span>
                    <Pill tone={e.sourceType === "web" ? "info" : "muted"}>{e.sourceType}</Pill>
                    {e.stale && <Pill tone="warn">stale</Pill>}
                    {e.identityMatch === "mismatch" && <Pill tone="bad">different company</Pill>}
                    {e.injectionSuspected && <Pill tone="bad">injection text</Pill>}
                    <span className="min-w-0 flex-1">{e.url ? <a className="underline" href={e.url} target="_blank" rel="noreferrer noopener">{e.title ?? e.url}</a> : e.title}<span className="block text-muted-foreground">{e.excerpt.slice(0, 220)}</span></span>
                    <span className="text-[11px] text-muted-foreground">{e.publishedAt ? fmtDay(e.publishedAt) : "undated"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Portfolio conflicts" subtitle="Unresolved conflicts block a GO until a partner clears them">
            {cf.length === 0 ? <p className="text-[13px] text-muted-foreground">No overlap found against the recorded portfolio list.</p> : cf.map((c) => (
              <div key={c.id} className="mb-2 rounded-lg border p-3 text-[13px]">
                <p><b>{c.portfolioCompany}</b> · <Pill tone={c.status === "open" ? "bad" : "ok"}>{c.status}</Pill></p>
                <p className="text-muted-foreground">{c.reason}{c.note ? ` · partner note: ${c.note}` : ""}</p>
                {c.status === "open" && u && can(u.role, "clear_conflict") && (
                  <ActionForm action={conflictAction} hidden={{ conflictId: c.id }} className="mt-2 flex flex-wrap gap-2">
                    <input name="note" required placeholder="Partner note" className={`${inputCls} max-w-xs`} />
                    <Submit variant="outline" name="status" value="cleared">Clear conflict</Submit>
                    <Submit variant="danger" name="status" value="confirmed">Confirm conflict</Submit>
                  </ActionForm>
                )}
              </div>
            ))}
          </Panel>

          <Panel title="Decisions" subtitle="Riya reviews → Aditya (technical, when flagged) → Kushal signs off">
            {dec.length > 0 && <ol className="mb-4 space-y-1.5 text-[13px]">{dec.map(({ d, name }) => <li key={d.id} className="flex flex-wrap items-center gap-2"><Pill>{d.stage.replace("_", " ")}</Pill><b>{name}</b><OutcomePill outcome={d.outcome} />{d.aiRecommendation && d.aiRecommendation !== d.outcome && <Pill tone="warn">overturned AI</Pill>}<span className="text-muted-foreground">{d.note}</span><span className="ml-auto text-xs text-muted-foreground">{fmtDate(d.createdAt)}</span></li>)}</ol>}
            {a.status === "awaiting_review" && u && can(u.role, "associate_review") && (
              <ActionForm action={reviewAction} hidden={{ stage: "associate", applicationId: a.id }} className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
                <OutcomeSelect def={a.recommendation} />
                <input name="note" placeholder="Your call in one line (required if you overturn the AI)" className={inputCls} />
                <Submit>Record Riya&apos;s call</Submit>
              </ActionForm>
            )}
            {a.status === "awaiting_technical" && u && can(u.role, "technical_review") && (
              <ActionForm action={reviewAction} hidden={{ stage: "technical", applicationId: a.id }} className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
                <OutcomeSelect def={a.recommendation} /><input name="note" placeholder="Technical view" className={inputCls} /><Submit>Record technical review</Submit>
              </ActionForm>
            )}
            {a.status === "awaiting_partner" && u && can(u.role, "partner_signoff") && (
              <ActionForm action={reviewAction} hidden={{ stage: "partner", applicationId: a.id }} className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
                <OutcomeSelect def={dec.at(-1)?.d.outcome} /><input name="note" placeholder="Partner note (becomes memory)" className={inputCls} /><Submit variant="gold">Sign off</Submit>
              </ActionForm>
            )}
            {!["awaiting_review", "awaiting_technical", "awaiting_partner"].includes(a.status) && dec.length === 0 && <p className="text-[13px] text-muted-foreground">No decision possible until screening finishes.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
