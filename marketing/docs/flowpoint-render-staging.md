# FlowPoint marketing staging on Render

This guide prepares the public marketing service only. It does not configure or publish a Render service. Confirm the real account costs and the GitHub source branch before creating staging resources.

## Build and health checks

- Node.js version: `.node-version` (20.20.0).
- Use the pinned `pnpm-lock.yaml`; the npm lockfile contains Replit-only package URLs.
- Build command: `corepack pnpm install --frozen-lockfile && VITE_ANALYTICS_DISABLED=true corepack pnpm run build`
- Start command: `corepack pnpm start`
- Health check path: `/healthz`
- Set `ROBOTS_NOINDEX=true` on the staging service.

## Isolated staging environment

- `DATABASE_URL`: a staging-only database for leads and support conversations. Do not point it at the existing production database or copy production data.
- `PUBLIC_AUDIT_DATABASE_URL`: a different, staging-only PostgreSQL database used only for audit quota counters and concurrency slots. Never use `DATABASE_URL` as a fallback.
- `SESSION_SECRET`: a staging-only random value at least 32 characters long.
- Keep `PUBLIC_AUDIT_ENABLED=false` until the dedicated quota database is ready and the reviewed quota schema is applied there.
- If the audit pilot is explicitly enabled for staging, use `PUBLIC_AUDIT_TEST_MODE=true`, `PUBLIC_AUDIT_DAILY_LIMIT=10`, `PUBLIC_AUDIT_NETWORK_DAILY_LIMIT=5`, and `PUBLIC_AUDIT_MAX_CONCURRENT=2`. The per-visitor limit remains three.
- `OPENAI_API_KEY` and optional `OPENAI_BASE_URL`: staging-only chat credentials. Without a key, the site starts normally and chat returns an unavailable response.
- `RESEND_API_KEY` and optional `RESEND_FROM_EMAIL`: a controlled staging sender only. Outside Replit the app does not try to use a Replit connector; without the key, contact delivery fails explicitly.

The build command disables the production Google Analytics and Apollo trackers for staging, including after analytics consent is accepted. Conversion and consent behavior remains covered by the local tests, without sending staging traffic to production analytics.

Do not run `db:push` against the existing production database. This service does not need its schema changed for the quota pool.
