---
name: FlowPoint demock final state
description: État final du démockage complet dashboard.js — ce qui est fait, ce qui reste côté API
---

## État au 23 juin 2026 — après session T001-T007

### dashboard.js stats
- **30 728 lignes** — syntaxe ✅ OK (node --check)
- **124 appels aiBlock()** — toutes les pages couvertes
- **0 nom client hardcodé hors guard** — tous derrière PREVIEW_MODE ou STATE

### Pages avec aiBlock
Overview ✅ (3), Audits ✅ (6), Monitors ✅ (7), Missions ✅ (4), Reports ✅ (5), LocalSEO ✅ (7), Team ✅ (4), Billing ✅ (2), Settings ✅ (3), Growth ✅ (6), GA4 Analytics ✅ (1, ajouté session finale), AI ✅, ClientMode ✅, Conversion ✅, Competitors ✅

### Mécanismes de garde
- `PREVIEW_MODE` (`?preview=1`) — fallback démo nouveaux utilisateurs
- `isDemoMode()` — guard Math.random fake data
- `displayStat(liveVal, previewFallback)` — KPI cards
- `_fpMQ(title, cat, prio, navAfter?)` — ~25 boutons Mission → FP_MISSIONS_API.create()

### Clés STATE nouvelles (dashboard prêt, endpoints API à créer si besoin)
- `STATE.reports` — historique rapports réels
- `STATE.threads` / `STATE.communications` — fils discussion client
- `STATE.shareLinks` — liens partage rapports
- `STATE.onboardings` — suivi onboarding clients
- `STATE.scheduledReports` — rapports planifiés
- `STATE.approvals` — approbations en attente

**Why:** Ces clés sont lues par le dashboard avec fallback PREVIEW_MODE propre si null/vide — aucun crash. À implémenter côté API quand les fonctionnalités seront activées.

**How to apply:** Quand un endpoint est créé (ex: GET /api/reports), peupler STATE.reports dans le loader principal (loadState() ou apiAction) — le dashboard s'adapte automatiquement.
