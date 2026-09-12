---
name: Render/Stripe historical purge boundary
description: app.flowpoint.pro runs on a separate Render database; historical Stripe Customers must be matched through subscription metadata even when Customers are deleted.
---

The live FlowPoint app and database can run on Render independently of the Replit development database. A global account purge must identify the Render backend/database first and must scan Stripe subscriptions and deleted Customer references by `metadata.orgId`/`org_id`, not only current database references or currently retrievable Customers.

**Why:** The Render purge dry-run saw one current Customer and zero attached subscriptions while Stripe still retained historical canceled subscriptions for deleted Customers linked by FlowPoint organization metadata.

**How to apply:** Treat current Customer linkage, Customer email/metadata, and all historical subscription metadata as separate matching passes; include only exact target identities and exclude unrelated deleted Customers before any mutation.