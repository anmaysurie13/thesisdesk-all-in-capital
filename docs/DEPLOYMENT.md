# Deployment guide

1. **Neon.** Create a project. Use branch `main` (live) and create a branch `test`. Put the pooled connection strings in `DATABASE_URL` and `DATABASE_URL_TEST`.
2. **Migrate and seed.** Run `npm run db:migrate` (test), then `npm run db:migrate:live`. Seed: `npm run db:seed -- --data <folder with the AIC_B6 exports>`, and `npm run db:seed:live -- --data …` for live.
3. **Portkey.** Create an API key and set `PORTKEY_API_KEY`. The OpenRouter key is passed through (`x-portkey-provider: openrouter`), so no Model Catalog setup is required. Confirm on System Health that "Portkey gateway" is on.
4. **Langfuse.** Create a Hobby project and set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` (EU `https://cloud.langfuse.com` or US `https://us.cloud.langfuse.com`).
5. **Tavily.** Set `TAVILY_API_KEY`. The budget is set by `TAVILY_MONTHLY_CREDIT_CAP`.
6. **Resend.**
   - Sending: `RESEND_API_KEY`. Real sends to founders need a verified domain and `RESEND_FROM`. Without one, use `EMAIL_MODE=test` with your own address in `EMAIL_TEST_ALLOWLIST`.
   - Inbound: set `RESEND_INBOUND_ADDRESS` (your `<id>.resend.app` or domain address). Replies are routed by `t-<threadId>@`.
   - Webhook: add `https://<app>/api/webhooks/resend` for `email.received`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, and set `RESEND_WEBHOOK_SECRET`.
7. **Calendly.**
   - Create one 30-minute event type. Set `CALENDLY_PAT`, `CALENDLY_EVENT_TYPE_URI` and `CALENDLY_SCHEDULING_URL`.
   - Optional: a webhook subscription for `invitee.created` and `invitee.canceled` to `https://<app>/api/webhooks/calendly`, plus `CALENDLY_WEBHOOK_SIGNING_KEY`. Without it, bookings are picked up by polling every 15 minutes.
8. **Vercel.**
   - Link with `npx vercel link`.
   - Add every variable from `.env.example`, using separate values for Preview (test) and Production (live).
   - Set `APP_ENV=test` on Preview and `APP_ENV=live` on Production.
   - Deploy with `npx vercel --prod`. The daily cron in `vercel.json` calls `/api/worker/tick` with `CRON_SECRET`.
9. **GitHub Actions worker.** In the repository secrets, set `APP_URL` and `WORKER_SECRET`. The workflow ticks the worker every 5 minutes.
10. **Release gate.** Run `npm run eval -- --target <preview-url>` and `npm run volume -- --target <preview-url> --scenario 20`. Any critical failure blocks release.
11. **Live email.** Switch `EMAIL_MODE=live` only after explicit written authorisation.
