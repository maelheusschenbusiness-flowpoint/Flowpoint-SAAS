---
name: De-mock completeness — side cards & derived projections
description: Where fabricated data hides after a route-centric de-mock audit, and the canonical fix patterns
---

# Lesson: fabricated data survives route-centric audits in two places

**Rule 1 — side cards of channel/detail sub-pages.** The main table of a sub-page (organic/paid/social/direct) can be honest while its companion cards (recommendations, "Analyse par réseau", ROI/budget, fidélité) carry ungated literals. Audit every card in a sub-route, not just the primary data table.
**Why:** July 2026 session: main channel tables were real, but 6 side cards (ROI 8.4×, budget 1 200€, LinkedIn 780 sess, 37% récurrents, Position 14.3, 48 200 impressions) shipped ungated after the "complete" audit and two architect PASSes on diffs (diff-scoped reviews never see untouched zones).
**How to apply:** grep for card titles (`fp-card-title`) inside each sub-route branch and check every `${[ ... ]}` literal array under them. Fix pattern: `${!PREVIEW_MODE ? \`<honest empty state>\` : [fabricated...]}` — the existing `.join('')}` closes the ternary.

**Rule 2 — "projection/forecast" pages fabricate both past and future.** Growth pages invented a fake past curve (base-12…base) and fixed future deltas (+7/+14/+17), fake sparkline histories, and hardcoded quarter labels/deadlines.
**Why:** projections look like features, so they escape "mock data" greps; but a fabricated history curve is fake data.
**How to apply:** canonical fix = derive slope from real `STATE.overview.auditHistory` (`_stepP` clamped [0.5,4], fallback 1.5), gate the whole page on `avgSc` truthy, label fallback estimates as "Estimation par défaut" (never "tendance mesurée" without ≥2 history points and positive slope), flat-fill sparklines with current value instead of invented progressions, compute quarter/months dynamically.
