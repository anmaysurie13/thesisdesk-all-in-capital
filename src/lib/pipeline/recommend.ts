import type { Criterion, Outcome } from "@/db/schema";

export type ScoredCriterion = { key: string; score: number | null; weight: number; confidence: number };
export type RecommendInput = {
  criteria: Criterion[];
  scores: ScoredCriterion[];
  goMin: number;
  passMax: number;
  minScoredCriteria: number;
  exclusionsTriggered: string[];
  openConflicts: string[];
  flags: string[]; // injection_suspected, fabricated_citation, identity_mismatch, contradiction…
};

/**
 * The recommendation is computed in CODE from criterion scores and rules — never taken from the model.
 * AI recommends; humans decide. Nothing here rejects or advances an application.
 */
export function recommend(i: RecommendInput): { outcome: Outcome; weighted: number | null; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  const scored = i.scores.filter((s) => s.score != null);
  const wSum = scored.reduce((a, s) => a + s.weight, 0);
  const weighted = wSum > 0 ? scored.reduce((a, s) => a + (s.score as number) * s.weight, 0) / wSum : null;
  const coverage = i.criteria.length ? scored.length / i.criteria.length : 0;
  const confidence = scored.length ? (scored.reduce((a, s) => a + s.confidence, 0) / scored.length) * coverage : 0;

  // A possible portfolio conflict always goes to a partner first, whatever else is missing.
  if (i.openConflicts.length) {
    reasons.push(`Possible portfolio conflict with ${i.openConflicts.join(", ")} — partner clearance required.`);
    if (scored.length < i.minScoredCriteria) reasons.push(`Also: only ${scored.length} of ${i.criteria.length} criteria had enough evidence.`);
    return { outcome: "HOLD", weighted, confidence, reasons };
  }
  if (scored.length < i.minScoredCriteria) {
    reasons.push(`Only ${scored.length} of ${i.criteria.length} criteria had enough evidence (minimum ${i.minScoredCriteria}).`);
    return { outcome: "REQUEST_INFO", weighted, confidence, reasons };
  }
  const blockers = i.flags.filter((f) => ["injection_suspected", "fabricated_citation", "identity_mismatch"].includes(f));
  if (blockers.length) {
    reasons.push(`Integrity flags need a human look first: ${blockers.join(", ")}.`);
    return { outcome: "HOLD", weighted, confidence, reasons };
  }
  const w = weighted as number;
  reasons.push(`Weighted score ${w.toFixed(2)} / 5 (GO ≥ ${i.goMin}, PASS ≤ ${i.passMax}).`);
  if (i.exclusionsTriggered.length) {
    reasons.push(`Thesis exclusion flagged: ${i.exclusionsTriggered.join(", ")}.`);
    return { outcome: w >= i.goMin ? "HOLD" : "PASS", weighted, confidence, reasons };
  }
  if (w >= i.goMin) return { outcome: "GO", weighted, confidence, reasons };
  if (w <= i.passMax) return { outcome: "PASS", weighted, confidence, reasons };
  reasons.push("Between thresholds — partner judgement needed.");
  return { outcome: "HOLD", weighted, confidence, reasons };
}

export function needsTechnicalReview(sector: string | null, founderType: string | null): boolean {
  return /deep\s?tech/i.test(sector ?? "") || /hardware/i.test(founderType ?? "");
}
