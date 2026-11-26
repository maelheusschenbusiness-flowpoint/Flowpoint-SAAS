# FlowPoint public marketing service

This folder contains the FlowPoint public marketing application alongside the
existing SaaS monorepo. It does not replace or modify the SaaS package,
workspace lockfile, API, authentication, billing, or app database.

## Existing Render service

- Set the Render service **Root Directory** to `marketing`.
- Install with `corepack pnpm install --frozen-lockfile`.
- Build with `VITE_ANALYTICS_DISABLED=false corepack pnpm run build` when the
  existing service serves both the production apex and Render staging host.
- Host checks keep the staging host noindex and exclude it from commercial
  tracking; do not use one global robots setting for both hosts.
- Render may automatically create and redirect a `www` alias when the apex is
  attached. Keep the existing Namecheap CNAME unchanged; do not add another DNS
  record.
- Start with `corepack pnpm start`.
- Use `/healthz` as the health-check path.
- Keep the public audit disabled until its quota tables and settings have been
  reviewed and activation is authorized.

Use only the existing Render service and PostgreSQL resources. Do not create a
second service, database, paid add-on, or plan upgrade. Configure secrets only
in Render's private environment settings. Do not copy historical Replit data:
it remains untouched unless a separate migration is approved. The marketing
application does not need Stripe or SaaS authentication.

For the exact cutover, DNS, settings, and rollback gates, see
[`docs/flowpoint-render-cutover.md`](./docs/flowpoint-render-cutover.md). The
possible historical-data copy is documented but intentionally not executed in
[`docs/flowpoint-replit-data-migration.md`](./docs/flowpoint-replit-data-migration.md).
