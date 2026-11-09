# Content-Security-Policy des pages HTML (constat C-18)

Document d'état, rédigé le 2026-11-08. **Aucun changement de comportement** : la CSP actuelle est conservée parce que la durcir casserait le front.

## État actuel

Les réponses JSON de l'API n'ont pas de CSP (`helmet({ contentSecurityPolicy: false })` dans `artifacts/api-server/src/app.ts`). Les pages HTML servies par `servePage()` reçoivent la constante `CSP_HTML` :

- `script-src 'self' 'unsafe-inline' 'unsafe-eval'` + `js.stripe.com`, `maps.googleapis.com`, `*.replit.dev`, `*.replit.app`
- `style-src 'self' 'unsafe-inline'` + Google Fonts
- `img-src 'self' data: blob: https: http:`
- `connect-src` : self, Stripe, Google Maps, `*.onrender.com`, `*.replit.*`, Resend
- `frame-src` : self + Stripe ; `object-src 'none'` ; `base-uri 'self'` ; `form-action 'self'`

## Pourquoi `unsafe-inline` ne peut pas être retiré aujourd'hui

Mesures sur `artifacts/flowpoint-export/dashboard.js` (même contenu que `src/frontend/dashboard.js`) :

| Gestionnaire inline généré | Occurrences |
| --- | --- |
| `onclick=` | 754 |
| `onchange=` | 30 |
| `oninput=` | 5 |
| `onsubmit=` | 2 |
| `onerror=` | 3 |

Plus des blocs `<script>` en ligne dans 10 pages HTML (`dashboard`, `login`, `checkout`, `pricing`, `report-view`, etc.) et des attributs `style=` (26 dans `dashboard.html`). Un `nonce` ne couvre pas les attributs `onclick=` : la seule voie est de les remplacer par des écouteurs (`addEventListener` / délégation d'événements).

`'unsafe-eval'` : aucune occurrence de `eval(` ni `new Function(` dans `dashboard.js`. Le commentaire du code l'attribue à Stripe.js / Google Maps, à **vérifier** (ces deux bibliothèques n'exigent plus `unsafe-eval` dans leur documentation actuelle). C'est la directive la plus facile à retirer.

## Risque

Une XSS stockée ou réfléchie qui arrive à injecter du HTML n'est pas bloquée par la CSP (les scripts en ligne sont autorisés). La CSP actuelle limite surtout `object-src`, `base-uri`, `form-action` et les origines de `connect-src` / `frame-src`. Les contrôles principaux restent l'échappement des sorties et les cookies `HttpOnly`.

## Plan de durcissement proposé (non réalisé)

1. **Observer** : ajouter `Content-Security-Policy-Report-Only` avec une politique cible et un `report-uri`, sans bloquer. Mesurer les violations sur l'environnement de test (`flowpoint-test`).
2. **Retirer `'unsafe-eval'`** si le rapport ne montre aucune violation (Stripe / Maps). Changement isolé et réversible.
3. **Migrer les gestionnaires inline** page par page : `data-action="..."` + un écouteur délégué unique, en commençant par les pages publiques (`login`, `pricing`, `checkout`), puis `dashboard.js` (754 `onclick`, à traiter par lots de modules).
4. **Introduire un `nonce`** par réponse (généré dans `servePage`) pour les rares scripts en ligne restants ; retirer `'unsafe-inline'` de `script-src`.
5. `style-src 'unsafe-inline'` en dernier (les attributs `style=` sont nombreux et présentent un risque bien moindre).
6. Restreindre `img-src` (retirer `http:`) et les jokers `*.replit.*` hors environnement de développement.

Ces étapes touchent `app.ts` (zone confiée à un autre chantier) et le front : à planifier séparément.
