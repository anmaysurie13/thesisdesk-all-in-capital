import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, briefs, claims, conflicts, criterionScores, evidence, jobs } from "@/db/schema";
import { can } from "@/lib/authz";
import { currentUser, harnessAuthorized } from "@/lib/session";

/** Read-only view of a screened application for the eval harness. Contains no founder PII. */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/applications/[id]">) {
  const u = harnessAuthorized(req) ? null : await currentUser();
  if (!harnessAuthorized(req) && !(u && can(u.role, "view"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const [a] = await db().select().from(applications).where(eq(applications.id, id));
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [sc, cl, ev, br, cf, jb] = await Promise.all([
    db().select().from(criterionScores).where(eq(criterionScores.applicationId, id)).orderBy(desc(criterionScores.createdAt)),
    db().select().from(claims).where(eq(claims.applicationId, id)),
    db().select().from(evidence).where(eq(evidence.applicationId, id)),
    db().select().from(briefs).where(eq(briefs.applicationId, id)).orderBy(desc(briefs.createdAt)).limit(1),
    db().select().from(conflicts).where(eq(conflicts.applicationId, id)),
    db().select({ status: jobs.status, attempts: jobs.attempts, lastError: jobs.lastError, step: jobs.step }).from(jobs).where(eq(jobs.applicationId, id)),
  ]);
  return NextResponse.json({
    application: {
      id: a.id, ref: a.ref, companyName: a.companyName, status: a.status, statusReason: a.statusReason, duplicateOf: a.duplicateOf,
      recommendation: a.recommendation, reasons: a.recommendationReasons, weightedScore: a.weightedScore, confidence: a.confidence,
      flags: a.flags, finalOutcome: a.finalOutcome, needsTechnicalReview: a.needsTechnicalReview, thesisVersionId: a.thesisVersionId,
    },
    scores: sc.map((s) => ({ criterion: s.criterionKey, score: s.score, reasoning: s.reasoning, refs: s.evidenceRefs, invalidRefs: s.invalidRefs, missing: s.missingInfo, confidence: s.confidence, promptVersion: s.promptVersion })),
    claims: cl.map((c) => ({ key: c.claimKey, text: c.text, verification: c.verification })),
    evidence: ev.map((e) => ({ ref: e.ref, type: e.sourceType, url: e.url, publishedAt: e.publishedAt, stale: e.stale, identity: e.identityMatch, injection: e.injectionSuspected })),
    brief: br[0] ? { summary: br[0].summary, risks: br[0].risks, gaps: br[0].gaps, strengths: br[0].strengths } : null,
    conflicts: cf.map((c) => ({ company: c.portfolioCompany, status: c.status, reason: c.reason })),
    jobs: jb,
  });
}
