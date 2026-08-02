---
name: AI Agents Phase 5 — Recommandations SEO
description: 10 outils intelligence SEO, 6 permissions, 6 destinations, undo handlers, 89/89 QA certifiés 2026-08-02
---

## Outils (10)
search_recommendations, generate_recommendations, prioritize_recommendations, explain_recommendation, create_action_plan, generate_seo_strategy, compare_strategy, create_missions_from_strategy, dismiss_recommendation, restore_recommendation

## Permissions (6)
recommendations.read/generate/dismiss/restore/export | strategy.generate
All assigned to owner/admin/member; viewer gets .read only.

## Destinations (6)
recommendations, recommendation-detail, seo-strategy, seo-roadmap, seo-opportunities, seo-history
All require recommendations.read except seo-strategy (strategy.generate).

## Undo handlers added to undo.ts
- `dismiss_recommendation` → UPDATE status back to snap["status"] (pre-dismiss value)
- `restore_recommendation` → UPDATE status='dismissed'
- `generate_recommendations` / `generate_seo_strategy` → UPDATE status='dismissed' (soft-delete)
- `create_missions_from_strategy` → batch DELETE missions (same pattern as create_missions_from_audit)

**Why:** Without these handlers, POST /api/ai/actions/:id/undo threw "applySnapshot non implémenté pour l'outil : X" for all Phase 5 write tools.

## confirmationLevel behaviour
- `generate_seo_strategy`: confirmationLevel="preview" — AI asks for confirmation before executing in single-turn chat; tool runs fine when AI decides to call it.
- `create_missions_from_strategy`: confirmationLevel="full" — same; use multi-turn or direct DB fixture for QA.
- All others: "none" — AI executes directly.

## ai_action_logs schema (for QA fixtures)
Columns: id, org_id, user_id, conversation_id, message_id, proposal_id, provider, model, tool, args (JSONB), confirmation_level, result, error, undo_snapshot (JSONB), undone_at, version_after, created_at.
**NO** snapshot, duration_ms, or body columns — use undo_snapshot.

## Scoring formula (generate_recommendations)
priority = urgency×0.35 + impact×0.35 + (100−effort)×0.20 + confidence×0.10
Sources: audits (score), tracked_keywords (position/impressions), competitors (domain_rating), monitors (uptime/response_time).

## SEO INTELLIGENCE context block
Added in buildFlowpointContext() (routes/ai.ts) just before final return lines.filter().
Queries: ai_recommendations active top-5, dismissed count, latest strategy. Injects 10 STRICT_AI_RULE triggers.
