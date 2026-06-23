---
name: FlowPoint demock final state
description: État final après session phase commerciale — tous boutons morts corrigés, 0 showToast success factice visible
---

## Règle absolue
Tout bouton visible doit appeler une API réelle OU écrire en base OU modifier un état persistant (localStorage avec raison valide, ou browser API comme push notifications).

## dashboard.js stats (post-session commerciale)
- **~30 750 lignes** — syntaxe ✅ OK (node --check)
- **124 appels aiBlock()** — toutes les pages couvertes
- **0 nom client hardcodé hors guard** — tous derrière PREVIEW_MODE ou STATE

## Corrections Phase Commerciale (session T001→T010)

### Settings form
- `prof-address / city / postalCode / country` inclus dans `PATCH /api/me` body
- `render()` appelé après save pour refléter les nouvelles valeurs

### Billing webhook (billing.ts)
- Boucles génériques `FLAG_ADDONS` + `QTY_ADDONS` dans `billing.ts`
- `upsertOrgSettings` persist en DB après chaque activation addon Stripe
- `subscription.updated/deleted/invoice.payment_succeeded/payment_failed` tous avec DB persist

### Team
- `data-remove-member` → `DELETE /api/team/:memberId` réel (était showToast factice)

### AI Settings
- `aiModules` et `aiIntensity` chargés depuis `STATE.settings` (DB via PATCH /api/me/prefs)

### A/B tests
- "Lancer le test" → `navigate('billing')` (supprimé bouton factice)

### Boutons morts corrigés (T010 audit global)
| Bouton | Avant | Fix |
|--------|-------|-----|
| "Changer le mot de passe" | showToast factice | Panel magic link → POST /api/auth/login-request |
| "#renew-access" (settings) | showToast factice | POST /api/auth/login-request avec STATE.me.email |
| "Exporter" Activity Command Center | showToast factice | exportActivityCsv() réelle |
| "📥 CSV" Campagnes & Attribution | showToast factice | Export réel depuis FP_DATA.campaigns |
| "Créer page" Local SEO zones | showToast factice | navigate('missions') |
| "Créer les missions CRO" | showToast factice | navigate('missions') + toast info |
| "Créer" Content gap table | showToast factice | navigate('missions') + click new-mission |

## Légitimes (non faux — à ne pas modifier)
- CSV exports → client-side depuis STATE data ✅
- Thème appliqué → CSS only, pas d'API nécessaire ✅
- Layout cards → `_fpSaveLayout()` (localStorage) ✅
- Calendrier RDV → `saveCalendarEvents()` (localStorage, feature locale) ✅
- Plan switcher → marqué "démo" dans le dropdown, feature de test ✅
- Branding White Label → `localStorage.setItem('fp-wl-branding',...)` (client-side) ✅
- `saveSettings()` → appelle `PATCH /api/me/prefs` en background ✅
- Logout all → clear localStorage + redirect /login.html ✅
- Alert rule toggle → try/catch avec API call dans le bloc ✅

## APIs existantes vérifiées ✅
- `FP_CRM_API` défini ligne ~29214, `_connectCrm` ligne ~29511
- `FP_AUTOMATION_API.run/toggle/create` wirés (POST /api/automation/workflows/:id/run)
- `saveSettings()` → `PATCH /api/me/prefs` ✅
- Auth: `POST /api/auth/login-request` existe et envoie magic link via Resend

## Clés STATE (dashboard prêt, endpoints API à créer si besoin)
- `STATE.reports` — historique rapports réels
- `STATE.threads` / `STATE.communications` — fils discussion client
- `STATE.shareLinks` — liens partage rapports
- `STATE.onboardings` — suivi onboarding clients

**Why:** Tout showToast('success') sans action réelle = utilisateur trompé = mauvaise réputation SaaS.
