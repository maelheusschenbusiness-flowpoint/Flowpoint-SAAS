---
name: Confirm endpoint content→error bridge
description: Why the confirm endpoint must populate both `content` AND `error` when ok:false, and why fail-closed permissions need a table-missing fallback.
---

## Rules

**Rule 1 — content→error bridge in confirm endpoint (ai.ts)**
When `executeTool` returns `{ok: false, content: "reason"}`, the confirm endpoint must spread `{ error: execResult.content }` into the response JSON. The frontend (`fpAiChatConfirmAction`, `fpAiPanelConfirm`) checks `r.error || fallback` for error display — `r.content` is never used in the failure branch.

**Rule 2 — Frontend error display**
Both confirm handlers in dashboard.js use `r.content || r.error || fpT('Échec de l\'exécution.')` for the failure branch (as of this fix). Belt + suspenders.

**Rule 3 — permissions.ts fail-open for missing table**
`resolveEffectivePermissions` is FAIL-CLOSED for real DB errors, but FAIL-OPEN (returns role bundle) when the `org_member_permissions` table doesn't exist. The table holds only *overrides*; if it's absent, "no overrides" → role bundle is correct. Without this, any new Render deploy without the table ran `init-agent-tables.ts` only at startup and every AI tool call failed with "Permission refusée" until the server booted.

**Why:**
The symptom was consistent "Échec de l'exécution." after clicking Confirmer. The AI correctly called `run_audit` and the confirm endpoint returned HTTP 200 `{ok:false, content:"...24h..."}` — but `r.error` was undefined so the frontend showed the generic fallback. Also: if `org_member_permissions` table is absent, effectivePerms = empty Set → `audits.write` missing → same fallback.

**How to apply:**
- Any new tool that returns `ok:false, content:"..."` will now surface properly in the UI (backend fix).
- If a new Render deploy shows "Permission refusée" for all AI tools: check if `org_member_permissions` exists. If not, the server restart (init-agent-tables.ts) will create it.
- traceId is now in every confirm response — search Render logs by `traceId` to correlate an exact request.
