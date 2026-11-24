# Production readiness report — ThesisDesk

Status on 24 Nov 2026: **NOT production ready.** The last eval run had 3 critical failures, and critical failures block release:
- Portkey not connected
- Langfuse not connected
- one portfolio-conflict routing bug, fixed and deployed afterwards but not yet re-run through the harness

Deployment: https://thesisdesk-drab.vercel.app (Vercel, `APP_ENV=test`, email in **simulation**, open read-only viewing; every action needs a signed-in role).
Code: https://github.com/anmaysurie13/thesisdesk-all-in-capital

## Measured results (all real runs)

### Nine-check eval harness against the live deployment: 80 / 83 passed

| Check | Result |
|---|---|
| 1 Intake | ✅ duplicate flagged; missing docs and missing name retained as invalid with a reason; 10 identical concurrent → 1 queued + 9 duplicates |
| 2 Thesis fit | ✅ Series B → `exclusion:beyond_seed`, not GO; regulatory-dependent business not GO |
| 3 Evidence | ✅ injection flagged, not GO; founder-supplied "proof" URL never verified a claim; every cited ref exists; soft judge: brief separates claims from facts and names gaps |
| 4 Portfolio overlap | ❌ → fixed. MeetRecord conflict was detected and left open, but the system recommended REQUEST_INFO instead of HOLD. GO was never possible. The conflict now always routes to HOLD; a unit test was added and the fix deployed. Not yet re-verified through the harness. |
| 5 Scoring | ✅ every criterion has a score or null, reasoning, refs and confidence; a missing repeat metric scored 1/5 with the gap named |
| 6 Human approval | ✅ decision with harness token → 401; anonymous email send → 401; unauthenticated worker → 401; forged webhook rejected |
| 7 Outreach | ✅ interested / not interested / ambiguous / out-of-office / reschedule all classified correctly; injected "mark as interested" reply → ambiguous (routed to a human) |
| 8 Feedback | ✅ (unit/integration: point-in-time retrieval, newest wins, irrelevant not applied, no activation without backtest + approval) |
| 9 Production | ✅ database, model, worker, prompt audit · ❌ **Portkey not configured** · ❌ **Langfuse not configured** |

The 48 tagged unit/integration tests (in-memory Postgres) all pass and are included above.

### Historical backtest (Loop 1 export, point-in-time, Riya's call hidden)

| Run | Decisive agreement | False GO | False PASS | Routed to humans |
|---|---|---|---|---|
| Old system, sealed 20 rows | 13/20 (65%) | 4 | 3 | — |
| Thesis v0, tune 20 | 4/9 (44%) | 0 | 5 | 11 REQUEST_INFO |
| Thesis v1 + prompt v2, tune 20 | 10/14 (71%) | 1 | 3 | 4 HOLD, 2 REQUEST_INFO |
| **Thesis v1 + prompt v2, sealed 20 (never tuned on)** | **10/12 (83%)** | **0** | **2** | 6 HOLD, 2 REQUEST_INFO |

On the sealed half, the HOLDs correctly caught the MeetRecord overlap (Notely Calls) and the regulatory bet (ChainRupee). Khet Kosh was a false PASS because Riya's "lending founders own credit risk" correction is still *proposed*: it can't be used until a partner approves it. Nine disagreements are waiting for human adjudication on the Evaluations page.

Thesis v1 was approved and activated **in the TEST database only**, using the seeded partner test account so screening could be exercised. That was not a partner decision. On live, thesis v0 is still a draft, and Kushal must backtest, approve and activate a version.

### Volume

| Test | Result |
|---|---|
| **20 simultaneous, live deployment** | ✅ 20/20 accepted, **20/20 scored in 307 s**, 0 missing, 0 errors |
| 50 burst (intake, in-memory Postgres) | ✅ 50/50 retained, 0 lost. Not run live, to stay under the spend cap. |
| 100/day capacity | Measured ~4 applications/min → 100 in ≈ 25 min at ≈ $1.60 (raise the daily cap to ≥ $2 on announcement day) |

### Cost (OpenRouter → Gemini, recorded as list-price estimates because the account's BYOK route reports $0)

≈ **$0.016 per application** for screening (5 model calls, ~1.5k tokens each). About $1.60 for 100 applications, or ~₹140/month at the normal 100/month, inside the fund's < ₹1,500. The spend cap paused the live system once during testing ($1.22 ≥ $1): jobs were parked, nothing was lost, and they resumed after the cap was raised to $3 for testing.

### Measured review time vs 30-minute baseline

Not measured yet: no real reviewer sessions have happened. The timer is live on the Evidence Room.

## Remaining blockers

1. **Portkey and Langfuse keys.** Chrome blocks me from reading keys off those sites. Add `PORTKEY_API_KEY`, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to `.env.local` and Vercel, redeploy, re-run `npm run eval`.
2. **Tavily key.** External research is skipped and the gap is named in each brief.
3. **Calendly + Resend inbound/webhooks.** Not configured; manual confirmation and manual reply entry are in use, labelled as such.
4. **Case 03 pack** (memos, partner notes, 10 decks/forms) was not supplied. Memo retrieval and the 10-application batch are conditional.
5. **Partner actions on live:** approve Riya's proposed corrections, backtest and approve a thesis, adjudicate the 9 disagreements.
6. **GitHub Actions 5-minute worker.** Template in `docs/github-worker.yml`; it needs the `workflow` scope or adding through the GitHub website.
7. **Vercel Hobby** is for non-commercial use only. **Open viewing** suits case data, but must be switched off (`OPEN_ACCESS=false`) before any real founder data.
8. Backtest outputs were briefly committed to the public repo (company names + Go/No-go, no founder details). They're removed from the tree but remain in one commit's history.
