---
name: FlowPoint mock audit results
description: Results of exhaustive T001-T009 audit of dashboard.js — what was already gated vs what needed fixing
---

## Audit results (session June 2026)

### T001-T008 — ALL already properly gated before this session
- MOCK_TEAM → gated at line 821: `(_team?.length > 0) ? _team : (PREVIEW_MODE ? MOCK_TEAM : [])`
- CHANNEL_MSGS_DEFAULT → gated at lines 2677/2682/2690/2739/13073
- Concurrent A-E sidebar map → inside `PREVIEW_MODE ? [...] : []` block
- SVG `cx/cy` circles → feather icon defs, not data
- Math.random() at line ~17571 → inside `PREVIEW_MODE ? [...]` competitor fallback
- renderLocalSEOCompetitors _previewComps → `PREVIEW_MODE ? [...] : []`
- Growth section AI strategy messages → 100% derived from STATE.audits/monitors
- Keywords line ~17569 → part of PREVIEW_MODE competitor block

### T009 — Only 1 real violation found and fixed
- Enterprise Lab "workspaces" array (line ~7187): 3 hardcoded items without PREVIEW_MODE gate
- Fix: `STATE.workspaces || (PREVIEW_MODE ? demoArray : [{real derived workspace}])`
- In production now shows 1 real workspace derived from STATE.me.orgName + team/clients counts

### What was added this session
- `window.FP_COMPETITORS_API` — load/create/update/delete, normalizes domainRating→score
- `window.FP_CONNECTORS_API` — load/connect/disconnect/sync/isConnected
- Both defined at IIFE end (lines ~31037-31115), called by loadData() phase 5
- `window.FP_COMPETITORS_API.create()` opens a float panel form (replaces broken toast)
- `POST /api/admin/demo-seed` — seeds 4 audits, 3 monitors, 3 competitors, 5 keywords, 3 missions

### Patterns confirmed OK (don't re-audit these)
- Plan pricing literals (29€/79€/149€) — static UI, correct
- GBP "(démo)" statCards — properly gated: `gbpConnected ? real : PREVIEW_MODE ? demo : '—'`
- `statCard('Horizon stratégique', '60 jours', ...)` — static feature label, not user data
- ACTIVITY_FEED — gated in 5+ places as `PREVIEW_MODE ? ACTIVITY_FEED : []`
- CRM _DEMO_CLIENTS — `PREVIEW_MODE ? [...] : []`
- Reports client list _rClientsRaw — `STATE.clients || (PREVIEW_MODE ? [...] : [])`
- Zone data (market intel + local SEO) — `STATE.localSeo?.zones || (PREVIEW_MODE ? [...] : [])`

**Why:** Future sessions should skip re-auditing these — they've been confirmed clean. Start any new audit at the business logic layer, not the rendering layer.
