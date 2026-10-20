# SEO Strategy

## In scope
- Public marketing pages
- Feature and pricing pages
- Contact, about, careers, legal, updates, resources, and any published educational pages
- Public thank-you page if reachable from marketing flows (accessibility and metadata behavior, not a search landing page)
- Published resource articles at `/ressources/:slug`, including audit, local SEO, monitoring, reporting, and competitor-analysis clusters

## Out of scope
- Authenticated product area at `app.flowpoint.pro`
- API routes under `/api/**`
- Payment and webhook endpoints
- Internal admin or dashboard surfaces if added later
- Unpublished content drafts and test-only resource articles excluded from production

## Target audience
- French-speaking local businesses that want better online visibility and more leads.

## Primary keywords
- local SEO
- SEO local
- visibilité locale
- génération de leads
- landing pages pour entreprises locales
- audit SEO
- monitoring SEO
- reporting SEO
- analyse concurrentielle SEO

## Content and crawler assumptions
- Public marketing and published resource pages should be discoverable and shareable by search, social-preview, and AI retrieval crawlers.
- Express injects route-specific metadata, and the Vite-built React server entry renders public route content. Do not classify the site as a client-only SPA merely because it uses Vite/Wouter.
- Production resource discovery is driven by the shared article registry and generated sitemap; draft/test-only entries should not be promoted to production indexation.
- `/merci` intentionally has noindex; do not report its exclusion as a defect.
- The source canonical origin is `https://flowpoint.pro`.

## Dismissed categories
- (None yet)

## Notes from scans
- `client/src/pages/SeoGuide.tsx` exists in source but is not currently routed or linked publicly. Treat it as an unpublished draft unless it is re-added to `client/src/App.tsx` and `server/routes/public-paths.ts`.
