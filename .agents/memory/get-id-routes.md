---
name: GET :id routes missing
description: Five resource routes lacked GET :id endpoints — discovered during CRUD audit
---

**Rule:** Always add GET /resource/:id alongside POST/PATCH/DELETE. The list routes (GET /resource) do not substitute for single-item reads.

**Why:** CRUD audit revealed monitors, competitors, keywords, reports, alert-rules all returned 404 for GET :id. Dashboard JS panels that open a detail view depend on these.

**How to apply:** When adding any new resource router, include: GET list, GET :id, POST, PATCH :id, DELETE :id as the baseline set. Check with `grep -n "router.get.*:id"` in the route file before deploying.

**Fixed routes (all now return 200):**
- GET /api/monitors/:id — SELECT * FROM monitors WHERE id
- GET /api/competitors/:id — SELECT * FROM competitors WHERE id
- GET /api/keywords/:id — SELECT * FROM tracked_keywords WHERE id (requires orgId scoping)
- GET /api/reports/:id — SELECT * FROM reports WHERE id + org_id
- GET /api/alert-rules/:id — SELECT * FROM alert_rules WHERE id + org_id
