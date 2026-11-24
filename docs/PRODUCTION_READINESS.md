# Production readiness report — ThesisDesk

Status on 24 Nov 2026: **NOT production ready.** The code is complete and passes its local test suite. The mandatory live tests (eval harness, volume test, live integrations) have **not run yet**, because the database and three integration keys are still missing. Nothing below claims a result that was not actually produced.

## What has actually passed (local, today)

| Gate | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | ✅ clean |
| Lint (`eslint src scripts tests`) | ✅ clean |
| Production build (`next build`) | ✅ 21 routes, pages partially prerendered and streamed |
| Unit + integration tests (`npm test`, in-memory Postgres) | ✅ **47 / 47**. They found and fixed one real bug: concurrent duplicate submissions crashed instead of being flagged |
| Prompt audit (`npm run prompt-audit`) | ✅ 6 / 6 prompts carry no PII; largest prompt ~905 tokens (L8 "after" target ~3,000) |

Local volume evidence (integration tests, not the deployed system): 20 distinct concurrent intakes → 20 queued with 20 jobs. 20 identical → 1 queued and 19 flagged duplicates. A 50-intake burst → 50 retained. **0 lost** in each case.

## Not yet run (blocked on credentials)

| Mandatory item | Blocker |
|---|---|
| Nine-check eval harness on the deployed test environment | `DATABASE_URL(_TEST)`, deployment |
| Volume test against the deployment: 20 simultaneous, 50 burst, 100/day | same |
| Historical backtest (40 Loop 1 rows, tune and sealed) | database + model calls |
| Portkey retries verified live | `PORTKEY_API_KEY` |
| Langfuse traces verified live | Langfuse keys |
| Tavily research | `TAVILY_API_KEY` (until then research is skipped and the gap is named) |
| Resend inbound + webhooks | verified domain or `resend.app` inbound address, webhook secret |
| Calendly booking confirmation | PAT, event type, optional webhook key |
| Measured review time vs the 30-minute baseline | real reviewer sessions |

## Known limitations

- **Paid model.** OpenRouter has no free Gemini models; spend is capped in code. Prices were read from the OpenRouter models API on 24 Nov 2026.
- **Same-family judge.** The soft-assertion judge is Gemini (`gemini-3.6-flash`) judging Gemini output. A 5–10% human calibration sample is required before its verdicts are trusted.
- **Case 03 pack missing.** The memos, partner notes, decks and forms were not supplied. Memo retrieval and the 10-application batch are conditional. Thesis v0 rests on Case 03 plus Riya's reasons only, and its weights and thresholds are proposals.
- **Portfolio.** Only MeetRecord (evidenced in L1-08) is recorded, and it is unverified. Other overlaps cannot be detected until the portfolio list is completed.
- **Vercel Hobby.** Hobby is non-commercial. Cron runs once a day, so GitHub Actions is the main 5-minute trigger, and its schedule can lag under load.
- **Backtest scope.** The Loop 1 export holds summaries only, not decks, so backtests test scoring rather than extraction.
- **Calendly direct booking.** The Scheduling API (POST invitees) is not implemented. Founders book through the personal link, and counter-proposals get new free slots.
