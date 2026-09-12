---
name: PSI categories must be requested explicitly
description: PageSpeed Insights only returns the performance category by default; missing categories were fabricated as 0 and rendered as fake loaders.
---

## The rule

Every PageSpeed Insights API call must pass explicit `category` params for ALL categories needed (`performance`, `seo`, `accessibility`, `best-practices`). Without them, PSI returns only `performance`, and any code that reads the other categories gets `undefined`.

**Why:** the backend coerced missing categories to `0`, producing gray "0/100" rings on Performance Web / Core Web Vitals / Audit Technique that looked like stuck circular loaders, plus fabricated pass/fail claims. Legacy fake zeros persist in localStorage `fp-psi-last` and DB `psi_cache`.

**How to apply:**
- `services/pagespeed-service.ts` requests all 4 categories; `PSIScores.seo/accessibility/bestPractices` are `number | null` — never invent 0.
- Score blending (audit tools) must renormalize weights over AVAILABLE categories (`blend2()` in tool-executor), never blend nulls as zeros.
- Frontend render-time heuristic `psiRealScore()` in dashboard.js: treat seo/accessibility/bestPractices all-0-while-performance>0 as legacy fake data → render "—" / "Indisponible — relancez une analyse" instead of a ring.
- Old fake-zero rows may still sit in `psi_cache` — a purge is optional cleanup, the render heuristic already neutralizes them.
