import type { Criterion, Exclusion, Sourced } from "@/db/schema";

/**
 * Thesis v0 — a RECONSTRUCTION, not fund policy. Status starts as "draft"; it cannot score live
 * applications until a partner approves and activates it. Every statement carries its source.
 *  - "stated": from the case brief (Case 03) — the only stated-thesis source available offline.
 *  - "revealed": from Riya's overturn reasons in the Loop 1 export (row ids cited).
 * Criteria, weights and thresholds are ThesisDesk proposals to be calibrated on the backtest tune split.
 */
export const V0_STATEMENTS: Sourced[] = [
  { kind: "stated", text: "Mumbai-based early-stage fund founded by Aditya Singh and Kushal Bhagia; Fund II is raising.", source: "Case 03 p1", confidence: "high" },
  { kind: "stated", text: "Invests at pre-seed across fintech, deeptech, consumer tech and consumer brands.", source: "Case 03 p1", confidence: "high" },
  { kind: "stated", text: "The fund publishes no scoring rubric, ownership target or formal exclusion list.", source: "Case 03 p1", confidence: "high" },
  { kind: "stated", text: "Case 05 describes the fund as seed-stage; the Loop 1 export contains both pre-seed and seed applications.", source: "Case 05 p1; Loop 1 export", confidence: "medium" },
  { kind: "revealed", text: "A missing core metric (repeat, retention) should drag the score, not be skipped.", source: "Loop 1 L1-03, L1-33", confidence: "high" },
  { kind: "revealed", text: "Founder pedigree does not substitute for business evidence.", source: "Loop 1 L1-10", confidence: "high" },
  { kind: "revealed", text: "Real repeat behaviour is the strongest signal; leaning towards businesses with real repeat.", source: "Loop 1 L1-20, L1-22, L1-30", confidence: "high" },
  { kind: "revealed", text: "Lending founders must own credit risk themselves.", source: "Loop 1 L1-16, L1-19", confidence: "high" },
  { kind: "revealed", text: "Deeptech with a long regulatory path is acceptable with a strong technical team and field demonstrations; lab-only technology bets without a revenue path are not.", source: "Loop 1 L1-05 vs L1-20", confidence: "medium" },
  { kind: "revealed", text: "Capital-intensive density plays that need capital the fund cannot help build are a poor fit.", source: "Loop 1 L1-29", confidence: "medium" },
  { kind: "revealed", text: "Businesses that depend on a regulatory change going their way are outside what the fund backs.", source: "Loop 1 L1-36", confidence: "medium" },
  { kind: "revealed", text: "Undisclosed overlap with a portfolio company (MeetRecord) is disqualifying without partner clearance.", source: "Loop 1 L1-08", confidence: "high" },
  { kind: "revealed", text: "A plain deck is not a negative when the business has real repeat.", source: "Loop 1 L1-30", confidence: "medium" },
  { kind: "revealed", text: "Founder defensiveness when asked about core metrics is a negative signal (human judgement).", source: "Loop 1 L1-33", confidence: "medium" },
];

export const V0_CRITERIA: Criterion[] = [
  { key: "founder_market_fit", label: "Founder–market fit", weight: 0.18, description: "Founders' direct operating experience in this market, evidenced in the application (not pedigree)." },
  { key: "traction_evidence", label: "Traction evidence", weight: 0.17, description: "Quantified demand: revenue, volume, customers — and whether it is verified or only claimed." },
  { key: "repeat_behaviour", label: "Repeat & retention", weight: 0.2, description: "Repeat purchase, renewal, retention or churn. Missing data lowers this score." },
  { key: "unit_economics", label: "Unit economics", weight: 0.13, description: "Gross/contribution margin and take rate; negative contribution needs a credible path." },
  { key: "risk_ownership", label: "Risk ownership", weight: 0.12, description: "Founders own the core risk of the model (e.g. credit risk in lending, regulatory exposure)." },
  { key: "capital_fit", label: "Capital fit", weight: 0.1, description: "Capital needs match an early-stage cheque; not a density/capex race the fund cannot help win." },
  { key: "technical_validation", label: "Technical validation", weight: 0.1, appliesTo: ["Deeptech", "hardware"], description: "Field demonstrations, pilots or paying users beyond a lab prototype. Only for deeptech/hardware." },
];

export const V0_EXCLUSIONS: Exclusion[] = [
  { key: "regulatory_dependency", rule: "Business depends on a favourable regulatory or tax ruling that has not happened yet.", effect: "flag", source: "Loop 1 L1-36" },
  { key: "outside_sectors", rule: "Sector is outside fintech, deeptech, consumer tech, consumer brands (and commerce infrastructure seen in the export).", effect: "flag", source: "Case 03 p1; Loop 1 export sectors" },
  { key: "beyond_seed", rule: "Stage is beyond seed (Series A or later).", effect: "flag", source: "Case 03 p1; Case 05 p1" },
  { key: "density_capex", rule: "Model requires heavy capital for density (e.g. dark stores) before unit economics are proven.", effect: "flag", source: "Loop 1 L1-29" },
  { key: "lab_only", rule: "Deeptech with no pilot, customer or field demonstration and no revenue path.", effect: "flag", source: "Loop 1 L1-20" },
];

export const V0 = {
  version: 0,
  sectors: ["Fintech", "Deeptech", "Consumer tech", "Consumer brands", "Commerce infrastructure"],
  stages: ["Pre-seed", "Seed"],
  criteria: V0_CRITERIA,
  exclusions: V0_EXCLUSIONS,
  goMin: 3.6,
  passMax: 2.8,
  minScoredCriteria: 4,
  statements: V0_STATEMENTS,
  changeNote: "v0: reconstructed from Case 03 and Riya's Loop 1 overturn reasons. Weights/thresholds are proposals pending backtest calibration and partner approval.",
};
