---
name: AI context enrichment (buildFlowpointContext)
description: How buildFlowpointContext works, what it queries, and the strict AI rules pattern
---

# buildFlowpointContext enrichment

## Signature
```ts
buildFlowpointContext(extra?: Record<string, unknown>, orgId?: string): Promise<string>
```
- All callers MUST pass orgId: `buildFlowpointContext(context, orgId)` or `buildFlowpointContext(undefined, orgId)`

## DB queries (all via pool.query, parallel)
- `tracked_keywords` WHERE org_id — top 15 by search_volume DESC
- `competitors` WHERE org_id — top 5 by domain_rating DESC (columns: name, url, domain_rating, keywords)
- `google_tokens` WHERE org_id — presence = GBP connected
- `gsc_sites` (if table exists) WHERE org_id
- `ga4_properties` (if table exists) WHERE org_id
- Drizzle ORM: auditsTable + monitorsTable

## competitors table schema
- Has: name, url, domain_rating, keywords, traffic, threat_level, delta (NO rating or reviews_count)
- Query maps: domain_rating → rating, keywords → reviews_count

## STRICT_AI_RULE constant
- Injected into EVERY chat system prompt after buildFlowpointContext
- Prevents: fabricated metrics, generic advice not anchored to real URLs
- Mandates: cite exact scores/positions from DB context
