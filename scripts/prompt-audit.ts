/**
 * Prompt audit (Build 5, Task 1). Builds every production prompt from a SYNTHETIC application that contains
 * founder PII, applies the same redaction the pipeline uses, and checks what would be sent.
 * Offline: no model call, no database. Output: eval-results/prompt-audit.md
 */
import fs from "node:fs";
import { briefPrompt, claimsPrompt, emailPrompt, PROMPT_REGISTRY, replyPrompt, scorePrompt, verifyPrompt } from "../src/lib/ai/prompts";
import { findPii, redact } from "../src/lib/pii";
import { V0 } from "../src/lib/thesis/v0";

const founders = [{ code: "F1", name: "Asha Verma", email: "asha.verma@example.com", phone: "+91 98200 12345", linkedin: "https://linkedin.com/in/ashaverma" }];
const deck = `Synthetic deck. Founder Asha Verma (asha.verma@example.com, +91 98200 12345, https://linkedin.com/in/ashaverma) ran a flour mill for 12 years.
Atta subscriptions: 3,200 subscribers, 52% active after six months, gross margin 41%. Raising ₹2 Cr.`;
const red = redact(deck, founders);
const approxTokens = (s: string) => Math.ceil(s.length / 4);

const cases = [
  { key: claimsPrompt.key, text: claimsPrompt.system + claimsPrompt.user([{ id: "D1", kind: "deck", text: red }]), sends: "redacted deck/form text (≤12k chars per doc)" },
  { key: verifyPrompt.key, text: verifyPrompt.system + verifyPrompt.user("Atta Co", [{ key: "subs", text: "3,200 subscribers" }], [{ ref: "E1", type: "web", excerpt: "snippet ≤600 chars" }]), sends: "claims + evidence snippets (≤600 chars each), never whole pages" },
  { key: scorePrompt.key, text: scorePrompt.system + scorePrompt.user({ thesis: V0.criteria.map(({ key, label, description }) => ({ key, label, description })), exclusions: V0.exclusions.map(({ key, rule }) => ({ key, rule })), memory: [{ lesson: "Missing repeat drags the score" }], memos: [], applicant: { company: "Atta Co", sector: "Consumer brands" }, claims: [{ key: "subs", text: redact("Asha says 3,200 subscribers", founders) }], evidence: [{ ref: "E1", excerpt: red.slice(0, 500) }] }), sends: "relevant criteria, top-5 approved corrections, top-3 memo passages, claims, evidence refs" },
  { key: briefPrompt.key, text: briefPrompt.system + briefPrompt.user({ company: "Atta Co", claims: [{ text: red.slice(0, 200) }] }), sends: "scores, claims, evidence excerpts (≤300 chars)" },
  { key: emailPrompt.key, text: emailPrompt.system + emailPrompt.user({ company: "Atta Co", stage: "Pre-seed", sector: "Consumer brands", facts: ["3,200 subscribers (founder claim)"], slots: ["Tuesday afternoon"], technical_review: false, examples: [{ draft: "Hi {{first_name}}, …", final: "Hi {{first_name}}, …" }] }), sends: "facts + {{first_name}} placeholder; name filled in only at send time" },
  { key: replyPrompt.key, text: replyPrompt.system + replyPrompt.user(redact("Hi Riya, call me on +91 98200 12345 — Asha", founders)), sends: "founder reply with contacts/names redacted" },
];

const lines = ["# Prompt audit", "", `Generated ${new Date().toISOString()} from synthetic data (no real founder data).`, "", "| Prompt | Version | ~Tokens | PII found | What is sent |", "|---|---|---|---|---|"];
let failures = 0;
for (const c of cases) {
  const leaks = findPii(c.text, founders);
  if (leaks.length) failures++;
  const v = PROMPT_REGISTRY.find((p) => p.key === c.key)?.version;
  lines.push(`| ${c.key} | ${v} | ${approxTokens(c.text)} | ${leaks.length ? `❌ ${leaks.join(", ")}` : "✅ none"} | ${c.sends} |`);
}
lines.push("", "Controls:", "- `callModel` refuses any prompt in which `findPii` finds founder name/email/phone/LinkedIn (ledger row: `Blocked: PII in prompt`).", "- External content is wrapped in `<application_data>/<evidence>/<reply>` tags and declared data, not instructions; a code-side injection detector flags applications and a flag blocks GO.", "- Langfuse receives metadata only (bodies redacted) unless `LANGFUSE_LOG_BODIES=true` in the test environment.", "", failures ? `**FAIL: ${failures} prompt(s) leak PII.**` : "**PASS: no PII in any prompt.**");
fs.mkdirSync("eval-results", { recursive: true });
fs.writeFileSync("eval-results/prompt-audit.md", lines.join("\n"));
console.log(lines.join("\n"));
process.exit(failures ? 1 : 0);
