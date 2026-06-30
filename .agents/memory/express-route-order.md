---
name: Express route order — sub-routes vs /:id
description: Specific named sub-routes must always be registered before the /:id wildcard
---

**Rule:** In Express, register ALL named sub-routes (e.g. `/audits/schedule`, `/audits/history`, `/reports/clients`) BEFORE the wildcard `/:id` route. Registration order = match priority.

**Why:** `/audits/schedule` and `/audits/:id` — Express matches routes top-down. If `/:id` is registered first, "schedule" is captured as the id param and the specific handler never fires. Symptoms: 404 (if handler returns 404 on missing row) or 500 (if the wrong handler throws on an unexpected id value).

**How to apply:** Whenever adding a new named GET sub-route to a router that has `/:id`, place it above the `/:id` block. Leave a comment: "Must be registered BEFORE /:id". This applied to: audits.ts (history, quick-scan, schedule, upcoming) and reports.ts (clients).
