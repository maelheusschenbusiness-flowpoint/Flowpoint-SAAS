---
name: AI Agents Phase 4 — Audit SEO tools
description: 9 audit tools registered, permissions, undo, destinations — Phase 4 frozen 2026-08-02, 63/63 QA certified
---

## Outils Phase 4 (9 total)

| Outil | Permission | Level | Write |
|---|---|---|---|
| search_audits | audits.read | none | false |
| run_audit | audits.write | preview | true |
| rerun_audit | audits.write | preview | true |
| compare_audits | audits.read | none | false |
| summarize_audit | audits.read | none | false |
| explain_audit_issue | audits.read | none | false |
| create_missions_from_audit | audits.write | full | true |
| delete_audit | audits.delete | full | true |
| export_audit | audits.export | none | false |

## Architecture

- `src/agent/audit-tools.ts` — AUDIT_TOOLS[], AUDIT_TOOL_BY_NAME, AUDIT_ARG_SCHEMAS, snapAudit(), fmtAuditStatus()
- `src/agent/permissions.ts` — added audits.write, audits.delete, audits.export to PERMISSION_CATALOG; member gets audits.write + audits.export
- `src/agent/tool-executor.ts` — imports AUDIT_TOOL_BY_NAME + AUDIT_ARG_SCHEMAS + analyzePSI; 9 dispatch branches before fallback
- `src/agent/undo.ts` — create_missions_from_audit batch undo (snap.batchType + snap.missions); auditTools targetType list
- `src/routes/ai.ts` — AUDIT_TOOLS added to ALL_TOOLS + ALL_TOOLS_MAP

## Key patterns

**Why:** run_audit/rerun_audit use fire-and-forget analyzePSI (takes 30-60s); executor returns immediately with "processing" status.

**How to apply:** Same weighted formula as routes/audits.ts: perf×0.40 + seo×0.30 + a11y×0.15 + bp×0.15

**Undo:** create_missions_from_audit snap = { batchType: "create_missions_from_audit", auditId, missions: [{id,...}] } — undo deletes all missions in a transaction.

**Undo route:** POST /api/ai/actions/:id/undo (NOT /api/ai/undo — common mistake)

## Destinations

No new destinations added — existing ones cover Phase 4:
- audits-list, audits-history, audits-compare (all in destinations.json)

## QA

63/63 certified 2026-08-02. Script: `qa_phase4_certification.cjs`.
