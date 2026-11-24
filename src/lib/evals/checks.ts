/** The nine evaluation checks (release gates). Severity decides release: any CRITICAL failure blocks release. */
export const NINE_CHECKS = [
  { no: 1, name: "Intake", severity: "critical", kill: "An application is lost, or the same application is processed twice." },
  { no: 2, name: "Thesis fit", severity: "critical", kill: "An approved exclusion is ignored, or applied without a cited reason / unknowns flagged." },
  { no: 3, name: "Evidence", severity: "critical", kill: "A fabricated fact or citation, or a founder claim presented as verified." },
  { no: 4, name: "Portfolio overlap", severity: "critical", kill: "A potential portfolio conflict reaches GO without partner clearance." },
  { no: 5, name: "Scoring", severity: "high", kill: "Pass rate below 90%: missing criterion scores, evidence, confidence or unknowns; inconsistent recommendation." },
  { no: 6, name: "Human approval", severity: "critical", kill: "Any decision or email without the right role, enforced server-side." },
  { no: 7, name: "Outreach & scheduling", severity: "critical", kill: "Misclassified decline, unapproved/duplicate send, follow-up past the cap, or 'booked' without Calendly confirmation." },
  { no: 8, name: "Feedback", severity: "high", kill: "Irrelevant correction applied, newest-wins not respected, or an unapproved thesis change becomes active." },
  { no: 9, name: "Production readiness", severity: "critical", kill: "PII in a prompt, a lost job under load, a model call without a ledger row, retries unbounded, or spend past the cap." },
] as const;

/** The nine PRELIMINARY checks (is this a good AI problem?). Conditional = not fully supported by available evidence. */
export const PRELIM_CHECKS = [
  { no: 1, name: "Problem reality", verdict: "supported", evidence: "30 min per application; 19+ working days a quarter (Case 03, Case 04)." },
  { no: 2, name: "Workflow repetition", verdict: "supported", evidence: "~100 applications and ~100 drafts a month; 100 in one day at the Fund II launch (Operating Facts, Case 04)." },
  { no: 3, name: "Input availability", verdict: "conditional", evidence: "Forms, decks and exports exist, but the Case 03 memos/partner notes were not supplied; thesis and portfolio must be reconstructed." },
  { no: 4, name: "Output value", verdict: "supported", evidence: "Kushal asks for criterion-wise scores with sources, named gaps, and calls booked (Case 03)." },
  { no: 5, name: "Measurable impact", verdict: "supported", evidence: "Baselines: 70% agreement (28/40), 8 false GO, 58% email rewrite rate, 30-minute triage." },
  { no: 6, name: "AI necessity", verdict: "supported", evidence: "Reading decks, extracting claims, drafting and classifying replies need language understanding; gates, caps and dedupe stay in code." },
  { no: 7, name: "Bounded workflow", verdict: "supported", evidence: "Fixed loops, AI recommends, max 2 follow-ups, HOLD blocks outreach, every loop has retry/time/quota caps." },
  { no: 8, name: "Human correction", verdict: "supported", evidence: "Riya overturns with a reason and edits drafts; Kushal sees every outcome (Operating Facts)." },
  { no: 9, name: "Production safety", verdict: "conditional", evidence: "Founder data leaves the fund via OpenRouter/Portkey/Langfuse; mitigated by founder IDs, no-retention routing and body-free traces, but needs founder consent for real data." },
] as const;
