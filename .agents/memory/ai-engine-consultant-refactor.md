---
name: AI Engine Consultant Refactor
description: Changes made to turn the FlowPoint AI engine into a data-driven senior SEO consultant
---

# AI Engine Consultant Refactor

## What changed

**`artifacts/api-server/src/routes/ai.ts`**
- `buildFlowpointContext`: now queries `psi_cache` for real critical_issues per URL; keyword position buckets (top3/4-10/hors-20); competitor DR gap; frontend-provided `auditIssues` array; maps psi issues per URL.
- `STRICT_AI_RULE`: strengthened — bans "je ne peux pas deviner"/"copiez-collez"/"autorisez-moi"; mandates Priorité N format with Pourquoi/Où/Impact/Temps blocks.
- `/ai/chat` system prompt: consultant persona who already knows the site, cites real scores, structured recommendations.
- `/ai/audit`: queries DB for real audit row + psi_cache before building prompt; structured Priorité N blocks; score evolution vs previous audit.
- `/ai/seo`: calls `buildFlowpointContext`; queries DB for real audit score/speed/PSI issues; reads real tracked keywords from DB.
- `/ai/reports`: dynamic dates (`monthNames[now.getMonth()] + year`); queries DB for current vs previous month score avg; real data in prompt.
- `/ai/missions`: data-anchored prompt — cites real URLs, scores, issues; bans generic missions; calculates realistic gains.

**`artifacts/api-server/src/services/mission-engine.ts`**
- Full rewrite: reads real audit + psi_cache data from DB; calls OpenAI to generate data-specific missions; fallback chain: AI → derived-from-audit templates → static templates.

**`artifacts/flowpoint-export/dashboard.js`**
- Context enriched: `auditIssues` (derived from audit score/speed/issues), `keywordsBelowPos10`, `keywordsAbove20`.

## Key rules

**Why:** The old engine produced generic checklists not anchored to real data.
**How to apply:** Any new AI endpoint must call `buildFlowpointContext` and query `psi_cache` before constructing prompts. Never hardcode month names — use `new Date()`.
