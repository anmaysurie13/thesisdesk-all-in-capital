# ThesisDesk — All In Capital

AI-assisted investment screening, founder outreach and learning for All In Capital (MESA Term 2, Case 03 · Case 04 · L7 Evals · L8 Prototype → Production).
**AI recommends. Riya reviews. Kushal decides.** Nothing is advanced, rejected or emailed automatically.

![Component map](docs/component-map.png)

## What it does

| Loop | Flow |
|---|---|
| **1 · Screening** | Single/batch/CSV intake → validate → content-hash dedupe → **one transaction** (application + job) in a Neon queue → worker (SKIP LOCKED claim, lease, checkpoints, 5/min) → parse PDF → redact PII to founder IDs → eligibility rules → extract founder claims → Tavily research (public identifiers only) → verify identity/recency/contradictions → portfolio overlap → criterion-wise scoring with cited evidence refs → **recommendation computed in code** (GO/PASS/HOLD/REQUEST INFO) → cited brief → Riya → (Aditya, deeptech/hardware) → Kushal |
| **2 · Outreach** | Partner GO → email draft in Riya's style (name is a placeholder, filled at send time) → Riya edits, ticks confirm → server gates (GO, not HOLD, not suppressed, cap) → Resend with idempotency key (simulation by default) → Svix-verified webhooks / manual reply entry → reply classification → drafted responses/follow-ups (D+3, D+7, max 2, each needs Riya's approval) → Calendly link with thread id → booking confirmed only by Calendly webhook/poll → call outcome |
| **3 · Learning** | Overturns, score corrections, partner notes and call outcomes → proposed corrections → partner approval → point-in-time retrieval (newest wins on the same topic). Thesis versions → point-in-time backtest (Riya's call hidden) → adjudication → partner approve → activate; rollback = re-activate |

Pages: Overview · Deal Inbox · Evidence Room · Partner Review · Founder Desk · Meetings · Thesis & Memory · Evaluations · System Health · Cost Centre · Settings. All metrics are read from the database.

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind 4 · shadcn/ui (Base UI) · Neon Postgres + Drizzle · Auth.js v5 credentials (bcrypt, lockout, roles) · Gemini via OpenRouter with a single gateway retry layer (Portkey optional — sign-ups disabled) · **Langfuse** (ingestion API, trace per job, span per step, generation per model call) · Tavily · Resend · Calendly · Vercel · GitHub Actions.

> **Model access is paid.** At the user's instruction the build uses their OpenRouter key, and no Gemini model on OpenRouter is free (checked 24 Nov 2026). Spend is capped in code ($1/day, $15/month, 800 calls/day by default). Hitting a cap pauses the system and raises an alert; there is no fallback model. Every request sends `provider.data_collection: "deny"`.

## Setup

```bash
npm install
cp .env.example .env.local          # fill in values — never commit
npm run db:migrate                  # test branch (DATABASE_URL_TEST); --live for main
npm run db:seed -- --data _source_materials   # users, thesis v0 (draft), Loop 1/2 exports
npm run dev
```

The seed writes generated passwords to `.seed-credentials.local` (git-ignored). Thesis v0 is a **draft**, so live screening stays blocked until a partner backtests, approves and activates it on Thesis & Memory.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | 47 unit + integration tests on an in-memory Postgres (PGlite), tagged `[check-N]` |
| `npm run prompt-audit` | Builds every production prompt from synthetic PII data and checks what would be sent |
| `npm run eval -- --target <url>` | Nine-check HTTP harness against the **test** deployment; writes `eval_runs` + `eval-results/*.md`; any critical failure exits 1 |
| `npm run volume -- --target <url> --scenario 20\|50\|100` | Concurrent intake test with synthetic applications; pass = zero missing, every item scored/queued/needs-attention with a reason |
| `npm run secret-scan` | Blocks commits that contain keys, `.env` files, case PDFs/exports |
| `npm run lint` · `npm run typecheck` · `npm run build` | |

## Design decisions

- **One door to the model** (`src/lib/ai/gateway.ts`). It runs a PII guard (blocks the call), a cache keyed on input+evidence+thesis+prompt+model version, and the quota/spend guard. It writes a ledger row and a Langfuse generation for every call.
- **One retry layer.** When Portkey is configured it does the retries (3, exponential backoff, on 429/5xx). Without it, the app retries with the same policy (1s/2s/4s plus jitter). Jobs get 3 attempts, then move to `needs_attention` with the reason. Quota stops park the job without spending an attempt.
- **Worker on Vercel Hobby.** Hobby cron runs at most once a day, so the worker is kicked in three other ways: `after()` on every intake, GitHub Actions every 5 minutes (template in `docs/github-worker.yml`; add it as `.github/workflows/worker.yml` from the GitHub web editor), and the "Process queue" button. The daily cron is only a safety net. Every route is authenticated with `WORKER_SECRET`/`CRON_SECRET`.
- **Test and live separation.** `APP_ENV` selects a separate Neon branch. The eval/volume token only works in test, and email defaults to `simulate`.
- **Point-in-time backtests.** As-of date = the original decision date. Live web research is off. Corrections and memos dated on or after that date are invisible. The tune and sealed splits stop thesis v0 from being graded on the rows it was built from.

## Data & privacy

Founder PII lives only in `founders`, and prompts see `F1/F2`. Decks are stored privately in Postgres (`bytea`). Langfuse gets metadata only. Tavily gets public identifiers only. Case PDFs, the exports, `.env*` and credentials are git-ignored and blocked by the secret scan. `DATA_MODE=case_study` refuses applications marked as real founder data.

## Acknowledgements

Functional references only (both repositories have no licence, so no code, prompts or seed text were copied, and none of their evaluation results are reused): [Ksrish018/All-in-capital](https://github.com/Ksrish018/All-in-capital), [Aritra11022003/all-in-capital](https://github.com/Aritra11022003/all-in-capital). Case material © MESA School of Business.

See `docs/01_gap_analysis_and_plan.md`, `docs/DEPLOYMENT.md` and `docs/PRODUCTION_READINESS.md`.
