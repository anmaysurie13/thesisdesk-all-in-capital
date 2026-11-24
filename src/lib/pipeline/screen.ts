import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications, briefs, claims, conflicts, criterionScores, documents, evidence, founders, portfolioCompanies,
} from "@/db/schema";
import { callModel } from "@/lib/ai/gateway";
import {
  BriefOut, briefPrompt, ClaimsOut, claimsPrompt, PortfolioOut, portfolioPrompt, ScoreOut, scorePrompt, VerifyOut, verifyPrompt,
} from "@/lib/ai/prompts";
import { logSpan } from "@/lib/obs/langfuse";
import { detectInjection, redact } from "@/lib/pii";
import { checkpoint, doneSteps, extendLease, setStep, type Job } from "@/lib/queue/jobs";
import { isFuture, isStale, research } from "@/lib/research/tavily";
import { activeThesis, criteriaFor, thesisById, type Thesis } from "@/lib/thesis/service";
import { relevantCorrections, relevantMemoPassages } from "@/lib/thesis/memory";
import { extractPdfText } from "./pdf";
import { needsTechnicalReview, recommend } from "./recommend";

export class PipelineError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

type App = typeof applications.$inferSelect;
type Ctx = { job: Job; app: App; thesis: Thesis; asOf: Date; workerId: string; traceId: string };

const STEPS = ["parse", "redact", "eligibility", "claims", "research", "verify", "portfolio", "score", "brief"] as const;

async function loadFounders(appId: string) {
  return db().select().from(founders).where(eq(founders.applicationId, appId));
}
const forbidden = (fs: Awaited<ReturnType<typeof loadFounders>>) =>
  fs.map((f) => ({ code: f.founderCode, name: f.name, email: f.email, phone: f.phone, linkedin: f.linkedin }));

async function nextRefStart(appId: string) {
  const rows = await db().select({ ref: evidence.ref }).from(evidence).where(eq(evidence.applicationId, appId));
  return rows.reduce((m, r) => Math.max(m, Number(r.ref.slice(1)) || 0), 0) + 1;
}

async function evidenceList(appId: string) {
  return db().select().from(evidence).where(eq(evidence.applicationId, appId)).orderBy(asc(evidence.retrievedAt));
}

/* ------------------------------ steps ------------------------------ */

async function stepParse(c: Ctx) {
  const docs = await db().select().from(documents).where(eq(documents.applicationId, c.app.id));
  if (!docs.length) throw new PipelineError("No documents attached to the application", false);
  let usable = 0;
  for (const d of docs) {
    if (d.status === "ok" && d.rawText) { usable++; continue; }
    if (d.rawText && d.rawText.trim().length > 20) {
      await db().update(documents).set({ status: "ok" }).where(eq(documents.id, d.id));
      usable++;
      continue;
    }
    if (d.bytes && d.mime === "application/pdf") {
      const r = await extractPdfText(d.bytes);
      await db().update(documents).set({ rawText: r.text, pages: r.pages, status: r.status, error: r.error }).where(eq(documents.id, d.id));
      if (r.status === "ok") usable++;
    } else if (d.status === "pending") {
      await db().update(documents).set({ status: "unsupported", error: `Unsupported type ${d.mime}` }).where(eq(documents.id, d.id));
    }
  }
  if (!usable) throw new PipelineError("No readable document (corrupt, empty or unsupported) — application retained for a human", false);
  return { usable, total: docs.length };
}

async function stepRedact(c: Ctx) {
  const fs = await loadFounders(c.app.id);
  const docs = await db().select().from(documents).where(and(eq(documents.applicationId, c.app.id), eq(documents.status, "ok")));
  let injection = false;
  for (const d of docs) {
    const red = redact(d.rawText ?? "", forbidden(fs));
    if (detectInjection(red)) injection = true;
    await db().update(documents).set({ redactedText: red }).where(eq(documents.id, d.id));
  }
  if (injection) await addFlag(c.app.id, "injection_suspected");
  return { docs: docs.length, injection };
}

async function addFlag(appId: string, flag: string) {
  const [a] = await db().select({ flags: applications.flags }).from(applications).where(eq(applications.id, appId));
  if (a && !a.flags.includes(flag)) await db().update(applications).set({ flags: [...a.flags, flag] }).where(eq(applications.id, appId));
}

async function stepEligibility(c: Ctx) {
  const flags: string[] = [];
  if (c.app.stage && !c.thesis.stages.some((s) => s.toLowerCase() === c.app.stage!.toLowerCase())) flags.push("exclusion:beyond_seed");
  if (c.app.sector && !c.thesis.sectors.some((s) => s.toLowerCase() === c.app.sector!.toLowerCase())) flags.push("exclusion:outside_sectors");
  if (!c.app.sector) flags.push("unknown_sector");
  if (!c.app.stage) flags.push("unknown_stage");
  for (const f of flags) await addFlag(c.app.id, f);
  return { flags };
}

async function stepClaims(c: Ctx) {
  const fs = await loadFounders(c.app.id);
  const docs = await db().select().from(documents).where(and(eq(documents.applicationId, c.app.id), eq(documents.status, "ok")));
  const docIds = new Map(docs.map((d, i) => [`D${i + 1}`, d]));
  const input = [...docIds].map(([id, d]) => ({ id, kind: d.kind, text: (d.redactedText ?? "").slice(0, 12_000) }));
  const { data } = await callModel({
    promptKey: claimsPrompt.key, promptVersion: claimsPrompt.version, tier: "fast",
    system: claimsPrompt.system, user: claimsPrompt.user(input), schema: ClaimsOut, forbidden: forbidden(fs),
    ctx: { applicationId: c.app.id, jobId: c.job.id, runId: c.job.runId, step: "claims", traceId: c.traceId },
  });
  if (data.injection_attempt) await addFlag(c.app.id, "injection_suspected");

  // Idempotent rebuild of application-sourced evidence.
  await db().delete(claims).where(eq(claims.applicationId, c.app.id));
  await db().delete(evidence).where(and(eq(evidence.applicationId, c.app.id), inArray(evidence.sourceType, ["deck", "form", "summary"])));
  let n = await nextRefStart(c.app.id);
  const seen = new Set<string>();
  for (const cl of data.claims) {
    const key = seen.has(cl.key) ? `${cl.key}_${n}` : cl.key;
    seen.add(key);
    const doc = docIds.get(cl.source_doc) ?? docs[0];
    const ref = `E${n++}`;
    const [ev] = await db().insert(evidence).values({
      applicationId: c.app.id, ref, sourceType: doc.kind === "attachment" ? "deck" : doc.kind, title: `${doc.filename}${cl.locator ? ` · ${cl.locator}` : ""}`,
      excerpt: `Founder claim: ${cl.text}`, injectionSuspected: detectInjection(cl.text),
    }).returning();
    await db().insert(claims).values({
      applicationId: c.app.id, claimKey: key, text: cl.text, metric: cl.metric, value: cl.value,
      sourceDocumentId: doc.id, sourceLocator: cl.locator, evidenceIds: [ev.id],
    });
  }
  return { claims: data.claims.length, missingCore: data.missing_core_metrics, oneLiner: data.company_one_liner, sectorGuess: data.sector_guess, stageGuess: data.stage_guess };
}

async function stepResearch(c: Ctx) {
  await db().delete(evidence).where(and(eq(evidence.applicationId, c.app.id), eq(evidence.sourceType, "web")));
  if (c.app.asOfDate) {
    return { skipped: true, note: "Point-in-time backtest: live web research disabled (cannot guarantee evidence predates the decision)." };
  }
  const r = await research(c.app.id, { company: c.app.companyName, city: c.app.city, sector: c.app.sector, website: c.app.website });
  let n = await nextRefStart(c.app.id);
  let kept = 0;
  for (const h of r.hits) {
    if (isFuture(h.publishedAt, c.asOf)) continue;
    await db().insert(evidence).values({
      applicationId: c.app.id, ref: `E${n++}`, sourceType: "web", url: h.url, title: h.title, publishedAt: h.publishedAt,
      excerpt: h.snippet, stale: isStale(h.publishedAt, c.asOf), identityMatch: "uncertain", injectionSuspected: detectInjection(h.snippet),
    });
    kept++;
  }
  return { hits: kept, note: r.note };
}

async function stepVerify(c: Ctx) {
  const ev = await evidenceList(c.app.id);
  const web = ev.filter((e) => e.sourceType === "web");
  const cl = await db().select().from(claims).where(eq(claims.applicationId, c.app.id));
  if (!cl.length) return { skipped: true, note: "No claims to verify" };
  const fs = await loadFounders(c.app.id);
  const evInput = ev.map((e) => ({ ref: e.ref, type: e.sourceType, date: e.publishedAt, stale: e.stale, url: e.url, excerpt: redact(e.excerpt, forbidden(fs)).slice(0, 600) }));
  const { data } = await callModel({
    promptKey: verifyPrompt.key, promptVersion: verifyPrompt.version, tier: "fast", system: verifyPrompt.system,
    user: verifyPrompt.user(c.app.companyName, cl.map((x) => ({ key: x.claimKey, text: x.text, metric: x.metric, value: x.value })), evInput),
    schema: VerifyOut, forbidden: forbidden(fs),
    ctx: { applicationId: c.app.id, jobId: c.job.id, runId: c.job.runId, step: "verify", traceId: c.traceId },
  });
  const refs = new Map(ev.map((e) => [e.ref, e]));
  const independent = new Set(web.filter((e) => !e.stale).map((e) => e.ref));
  for (const v of data.claims) {
    const valid = v.evidence_refs.filter((r) => refs.has(r));
    // Code rule: "verified" requires at least one independent, non-stale, identity-matched source.
    let verification = v.verification;
    if (verification === "verified" && !valid.some((r) => independent.has(r))) verification = "unverifiable";
    await db().update(claims).set({
      verification, verificationNote: v.note.slice(0, 500),
      evidenceIds: valid.map((r) => refs.get(r)!.id),
    }).where(and(eq(claims.applicationId, c.app.id), eq(claims.claimKey, v.key)));
  }
  let mismatches = 0;
  for (const idm of data.identity) {
    const e = refs.get(idm.ref);
    if (!e || e.sourceType !== "web") continue;
    if (idm.match === "mismatch") mismatches++;
    await db().update(evidence).set({ identityMatch: idm.match }).where(eq(evidence.id, e.id));
  }
  if (data.contradictions.length) await addFlag(c.app.id, "contradiction");
  if (mismatches && mismatches === web.length && web.length > 0) await addFlag(c.app.id, "identity_mismatch");
  if (data.injection_attempt) await addFlag(c.app.id, "injection_suspected");
  return { verified: data.claims.filter((x) => x.verification === "verified").length, contradictions: data.contradictions, mismatches };
}

async function stepPortfolio(c: Ctx, oneLiner: string) {
  const pf = await db().select().from(portfolioCompanies);
  if (!pf.length) return { skipped: true, note: "Portfolio list is empty — overlap check could not run (gap named in brief)." };
  const fs = await loadFounders(c.app.id);
  const { data } = await callModel({
    promptKey: portfolioPrompt.key, promptVersion: portfolioPrompt.version, tier: "fast", system: portfolioPrompt.system,
    user: portfolioPrompt.user(`${c.app.companyName} (${c.app.sector ?? "sector unknown"}): ${redact(oneLiner, forbidden(fs))}`, pf),
    schema: PortfolioOut, forbidden: forbidden(fs),
    ctx: { applicationId: c.app.id, jobId: c.job.id, runId: c.job.runId, step: "portfolio", traceId: c.traceId },
  });
  const names = new Set(pf.map((p) => p.name));
  const hits = data.overlaps.filter((o) => o.overlap !== "none" && names.has(o.company));
  for (const h of hits) {
    await db().insert(conflicts).values({ applicationId: c.app.id, portfolioCompany: h.company, reason: `${h.overlap}: ${h.reason}`.slice(0, 500) })
      .onConflictDoNothing();
  }
  return { overlaps: hits.map((h) => `${h.company} (${h.overlap})`) };
}

async function stepScore(c: Ctx, missingCore: string[]) {
  const cl = await db().select().from(claims).where(eq(claims.applicationId, c.app.id));
  const fs = await loadFounders(c.app.id);
  const crit = criteriaFor(c.thesis, c.app.sector, c.app.founderType);
  const appText = `${c.app.companyName} ${c.app.sector ?? ""} ${cl.map((x) => x.text).join(" ")}`;
  const mem = await relevantCorrections({ sector: c.app.sector, stage: c.app.stage, text: appText, asOf: c.asOf });
  const memos = await relevantMemoPassages({ sector: c.app.sector, text: appText, asOf: c.asOf });
  let n = await nextRefStart(c.app.id);
  await db().delete(evidence).where(and(eq(evidence.applicationId, c.app.id), eq(evidence.sourceType, "memo")));
  for (const m of memos) {
    await db().insert(evidence).values({ applicationId: c.app.id, ref: `E${n++}`, sourceType: "memo", title: `${m.memoCompany} memo · ${m.section}`, excerpt: m.text.slice(0, 700) });
  }
  const evAll = await evidenceList(c.app.id);
  const usable = evAll.filter((e) => e.identityMatch !== "mismatch");
  const { data } = await callModel({
    promptKey: scorePrompt.key, promptVersion: scorePrompt.version, tier: "primary", system: scorePrompt.system,
    user: scorePrompt.user({
      thesis: { version: c.thesis.version, criteria: crit.map(({ key, label, description }) => ({ key, label, description })) },
      exclusions: c.thesis.exclusions.map(({ key, rule }) => ({ key, rule })),
      memory: mem.chosen.map((m) => ({ lesson: m.lesson, topic: m.topic, when: m.effectiveAt.toISOString().slice(0, 10), from: m.authorLabel })),
      memos: memos.map((m) => ({ company: m.memoCompany, decision: m.decision, section: m.section })),
      applicant: { company: c.app.companyName, sector: c.app.sector, stage: c.app.stage, city: c.app.city, founder_type: c.app.founderType, missing_core_metrics: missingCore },
      claims: cl.map((x) => ({ key: x.claimKey, text: redact(x.text, forbidden(fs)), verification: x.verification })),
      evidence: usable.map((e) => ({ ref: e.ref, type: e.sourceType, date: e.publishedAt, stale: e.stale, excerpt: redact(e.excerpt, forbidden(fs)).slice(0, 500) })),
    }),
    schema: ScoreOut, forbidden: forbidden(fs),
    ctx: { applicationId: c.app.id, jobId: c.job.id, runId: c.job.runId, step: "score", traceId: c.traceId },
  });
  const validRefs = new Set(usable.map((e) => e.ref));
  await db().delete(criterionScores).where(and(eq(criterionScores.applicationId, c.app.id), eq(criterionScores.runId, c.job.runId)));
  let fabricated = 0;
  const scores = crit.map((cr) => {
    const s = data.criteria.find((x) => x.key === cr.key);
    const refs = s?.evidence_refs ?? [];
    const invalid = refs.filter((r) => !validRefs.has(r));
    fabricated += invalid.length;
    const valid = refs.filter((r) => validRefs.has(r));
    // A score without any valid citation is not trustworthy → treated as insufficient evidence.
    const score = s && s.score != null && valid.length > 0 ? s.score : null;
    return {
      cr, score, reasoning: s?.reasoning ?? "Model returned no assessment for this criterion.",
      valid, invalid, missing: s?.missing_info ?? ["No assessment returned"], confidence: s?.confidence ?? 0,
    };
  });
  for (const s of scores) {
    await db().insert(criterionScores).values({
      applicationId: c.app.id, runId: c.job.runId, criterionKey: s.cr.key, score: s.score, weight: s.cr.weight,
      reasoning: s.reasoning, evidenceRefs: s.valid, missingInfo: s.missing, confidence: s.confidence, invalidRefs: s.invalid,
      thesisVersionId: c.thesis.id, promptVersion: `${scorePrompt.key}@${scorePrompt.version}`,
    });
  }
  if (fabricated) await addFlag(c.app.id, "fabricated_citation");
  if (data.injection_attempt) await addFlag(c.app.id, "injection_suspected");

  const [appNow] = await db().select().from(applications).where(eq(applications.id, c.app.id));
  const openConf = await db().select().from(conflicts).where(and(eq(conflicts.applicationId, c.app.id), eq(conflicts.status, "open")));
  const exclusionsTriggered = [
    ...data.exclusion_hits.filter((x) => x.triggered && c.thesis.exclusions.some((e) => e.key === x.key)).map((x) => x.key),
    ...appNow.flags.filter((f) => f.startsWith("exclusion:")).map((f) => f.slice(10)),
  ];
  const rec = recommend({
    criteria: crit,
    scores: scores.map((s) => ({ key: s.cr.key, score: s.score, weight: s.cr.weight, confidence: s.confidence })),
    goMin: c.thesis.goMin, passMax: c.thesis.passMax, minScoredCriteria: Math.min(c.thesis.minScoredCriteria, crit.length),
    exclusionsTriggered: [...new Set(exclusionsTriggered)], openConflicts: openConf.map((x) => x.portfolioCompany), flags: appNow.flags,
  });
  await db().update(applications).set({
    weightedScore: rec.weighted, confidence: rec.confidence, recommendation: rec.outcome, recommendationReasons: rec.reasons,
    thesisVersionId: c.thesis.id, needsTechnicalReview: needsTechnicalReview(c.app.sector, c.app.founderType),
  }).where(eq(applications.id, c.app.id));
  return { outcome: rec.outcome, weighted: rec.weighted, fabricated, memory: mem.chosen.map((m) => m.id), superseded: mem.superseded };
}

async function stepBrief(c: Ctx, researchNote: string | null) {
  const [a] = await db().select().from(applications).where(eq(applications.id, c.app.id));
  const ev = await evidenceList(c.app.id);
  const cl = await db().select().from(claims).where(eq(claims.applicationId, c.app.id));
  const sc = await db().select().from(criterionScores).where(and(eq(criterionScores.applicationId, c.app.id), eq(criterionScores.runId, c.job.runId)));
  const conf = await db().select().from(conflicts).where(eq(conflicts.applicationId, c.app.id));
  const fs = await loadFounders(c.app.id);
  const { data, model } = await callModel({
    promptKey: briefPrompt.key, promptVersion: briefPrompt.version, tier: "primary", system: briefPrompt.system,
    user: briefPrompt.user({
      company: a.companyName, sector: a.sector, stage: a.stage, recommendation: a.recommendation, reasons: a.recommendationReasons, flags: a.flags,
      scores: sc.map((s) => ({ criterion: s.criterionKey, score: s.score, reasoning: redact(s.reasoning, forbidden(fs)), refs: s.evidenceRefs, missing: s.missingInfo })),
      claims: cl.map((x) => ({ text: redact(x.text, forbidden(fs)), verification: x.verification })),
      evidence: ev.filter((e) => e.identityMatch !== "mismatch").map((e) => ({ ref: e.ref, type: e.sourceType, excerpt: redact(e.excerpt, forbidden(fs)).slice(0, 300) })),
      conflicts: conf.map((x) => ({ company: x.portfolioCompany, reason: x.reason, status: x.status })),
      research_note: researchNote,
    }),
    schema: BriefOut, forbidden: forbidden(fs),
    ctx: { applicationId: c.app.id, jobId: c.job.id, runId: c.job.runId, step: "brief", traceId: c.traceId },
  });
  const valid = new Set(ev.map((e) => e.ref));
  const clean = (xs: { text: string; refs: string[] }[]) => xs.map((x) => ({ text: x.text, refs: x.refs.filter((r) => valid.has(r)) }));
  const gaps = [...data.gaps, ...(researchNote ? [researchNote] : [])];
  await db().delete(briefs).where(and(eq(briefs.applicationId, c.app.id), eq(briefs.runId, c.job.runId)));
  await db().insert(briefs).values({
    applicationId: c.app.id, runId: c.job.runId, summary: data.summary, strengths: clean(data.strengths), risks: clean(data.risks),
    gaps, questions: data.questions, promptVersion: `${briefPrompt.key}@${briefPrompt.version}`, model,
  });
  return { ok: true };
}

/* ------------------------------ runner ------------------------------ */

export async function runScreen(job: Job, workerId: string, traceId: string) {
  const [app] = await db().select().from(applications).where(eq(applications.id, job.applicationId!));
  if (!app) throw new PipelineError("Application not found", false);
  if (app.status === "duplicate" || app.status === "invalid") return { skipped: app.status };

  const thesisId = (job.payload.thesisVersionId as string | undefined) ?? null;
  const thesis = thesisId ? await thesisById(thesisId) : await activeThesis();
  if (!thesis) throw new PipelineError("No approved thesis is active. A partner must approve and activate a thesis version before live screening.", false);

  const asOf = app.asOfDate ? new Date(`${app.asOfDate}T23:59:59+05:30`) : new Date();
  const ctx: Ctx = { job, app, thesis, asOf, workerId, traceId };
  await db().update(applications).set({ status: "processing", statusReason: null, updatedAt: new Date() }).where(eq(applications.id, app.id));

  const done = await doneSteps(job.id);
  const out = (s: string) => done.get(s) ?? {};
  for (const step of STEPS) {
    if (done.has(step)) continue;
    await setStep(job.id, step);
    await extendLease(job.id, workerId);
    const start = new Date();
    try {
      let result: Record<string, unknown>;
      switch (step) {
        case "parse": result = await stepParse(ctx); break;
        case "redact": result = await stepRedact(ctx); break;
        case "eligibility": result = await stepEligibility(ctx); break;
        case "claims": result = await stepClaims(ctx); break;
        case "research": result = await stepResearch(ctx); break;
        case "verify": result = await stepVerify(ctx); break;
        case "portfolio": result = await stepPortfolio(ctx, String(out("claims").oneLiner ?? app.companyName)); break;
        case "score": result = await stepScore(ctx, (out("claims").missingCore as string[]) ?? []); break;
        case "brief": result = await stepBrief(ctx, (out("research").note as string | null) ?? null); break;
      }
      const end = new Date();
      await checkpoint(job.id, step, "done", result, end.getTime() - start.getTime());
      done.set(step, result);
      await logSpan({ traceId, name: `step.${step}`, start, end, metadata: { applicationId: app.id, jobId: job.id } });
    } catch (err) {
      const end = new Date();
      await logSpan({ traceId, name: `step.${step}`, start, end, error: err instanceof Error ? err.message : String(err), metadata: { applicationId: app.id } });
      throw err;
    }
  }
  await db().update(applications).set({ status: "awaiting_review", scoredAt: new Date(), updatedAt: new Date() }).where(eq(applications.id, app.id));
  return { recommendation: out("score").outcome };
}
