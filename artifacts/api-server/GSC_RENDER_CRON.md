# GSC daily Render Cron Job (not active)

Create only after test/production database isolation is verified and the GSC schema is applied to the test database.

- Service: `flowpoint-test`
- Schedule: `15 3 * * *` (daily, UTC)
- Command: `cd artifacts/api-server && pnpm exec tsx src/scripts/gsc-daily-sync.ts`
- Required variables: the test service's `DATABASE_URL`, `GOOGLE_GSC_CLIENT_ID`,
  `GOOGLE_GSC_CLIENT_SECRET`, and `GOOGLE_GSC_TOKEN_ENCRYPTION_KEY`.
- Optional property selector: `GOOGLE_GSC_PROPERTY_URL` (otherwise the runner
  accepts only `sc-domain:flowpoint.pro` or `https://flowpoint.pro/`).

Do not run this command against production until database isolation has been
confirmed. The sync uses GSC-only tokens and existing idempotent GSC upserts.
