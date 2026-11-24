# Prompt audit

Generated 2026-11-24T16:48:02.937Z from synthetic data (no real founder data).

| Prompt | Version | ~Tokens | PII found | What is sent |
|---|---|---|---|---|
| claims.extract | v1 | 286 | ✅ none | redacted deck/form text (≤12k chars per doc) |
| evidence.verify | v1 | 290 | ✅ none | claims + evidence snippets (≤600 chars each), never whole pages |
| score.criteria | v2 | 1027 | ✅ none | relevant criteria, top-5 approved corrections, top-3 memo passages, claims, evidence refs |
| brief.write | v1 | 265 | ✅ none | scores, claims, evidence excerpts (≤300 chars) |
| email.draft | v1 | 410 | ✅ none | facts + {{first_name}} placeholder; name filled in only at send time |
| reply.classify | v1 | 241 | ✅ none | founder reply with contacts/names redacted |

Controls:
- `callModel` refuses any prompt in which `findPii` finds founder name/email/phone/LinkedIn (ledger row: `Blocked: PII in prompt`).
- External content is wrapped in `<application_data>/<evidence>/<reply>` tags and declared data, not instructions; a code-side injection detector flags applications and a flag blocks GO.
- Langfuse receives metadata only (bodies redacted) unless `LANGFUSE_LOG_BODIES=true` in the test environment.

**PASS: no PII in any prompt.**