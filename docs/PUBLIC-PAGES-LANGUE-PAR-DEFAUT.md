# Pages publiques : langue par défaut (anglais) — cause et preuves

Signalement du 17/11/2026 : création de compte, connexion et tarifs de `app.flowpoint.pro` s'affichent en français.

## Cause réelle

**La production ne sert pas le code de `Test-Replit`.** Mesures du 17/11 :

| Contrôle | Production (`app.flowpoint.pro`) | `Test-Replit` |
|---|---|---|
| `signin.html`, `login.html`, `pricing.html` | `<html lang="fr">`, rédigées en français | `<html lang="en">`, rédigées en anglais (tunnel) ou traduites à l'affichage |
| `fp-locale.js` (couche de traduction, langue par défaut) | **404** (le fichier n'existe pas) | présent |
| `funnel-theme.js` | absent de la branche `Flowpoint` | présent |
| Écart de la branche servie | `Flowpoint` : 33 fichiers de `flowpoint-export` diffèrent de `Test-Replit` (~15 700 lignes ajoutées) | — |

La production sert la branche `Flowpoint` (déploiement sur commit). Le travail « anglais par défaut » (tunnel en anglais, `fp-locale.js`, thèmes) est dans `Test-Replit` et n'a jamais été reporté dans `Flowpoint` : la réconciliation (PR #438) est en brouillon, jamais fusionnée, et GitHub la signale maintenant en conflit. Ce n'est donc pas une régression de configuration i18n, de détection du navigateur ou de stockage dans `Test-Replit` : c'est un **retard de la production sur `Test-Replit`**.

Autre cause possible, indépendante, à écarter navigateur par navigateur : une préférence `fp:language = fr` déjà enregistrée dans le `localStorage` de `app.flowpoint.pro` (choisie dans le tableau de bord, ou amorcée par un lien `?lang=fr`). La règle du produit la respecte, volontairement.

## Comportement de `Test-Replit` (mesuré)

Navigateur Chromium réel configuré en `fr-FR`, aucun `localStorage` :

- 11 pages publiques (`signin`, `login`, `login-verify`, `pricing`, `checkout`, `checkout-payment`, `checkout-return`, `success`, `cancel`, `accept-invitation`, `report-view`) : `lang="en"`, **0 texte français visible** (textes, infobulles, `aria-label`, placeholders, titre, métadonnées), sur 3 profils (bureau 1440, iPhone 13, Pixel 7).
- La langue n'est jamais lue depuis `navigator.language` ni `Accept-Language` (test : aucune occurrence dans `fp-locale.js` ni dans les pages).
- Une préférence explicite prise en charge est respectée ; `?lang=` n'amorce la langue que sans préférence existante, et seulement parmi la liste fermée des langues prises en charge.

## Défauts réels trouvés et corrigés dans `Test-Replit`

Relevés en navigateur réel, mode anglais :

1. **Tarifs, tableau comparatif ouvert** : 6 cellules « Bientôt disponible » restaient en français, ainsi que les infobulles (`title`) des boutons désactivés. → entrée « Bientôt disponible » / « Coming soon » dans le catalogue.
2. **Tarifs, packs de crédits IA** : l'étiquette d'accessibilité des boutons +/− assemblait un préfixe anglais et le nom français (« Decrease quantity of +50 000 crédits IA »). → `window.fpPublicTranslateToEnglish` exposé, utilisé par `_fpPricingQuantityLabel`.
3. **Invitation** : « Ce lien d'invitation est introuvable ou invalide. » et « Cette invitation a déjà été acceptée. Connectez-vous directement. » (messages d'erreur du lien) n'avaient pas de traduction exacte. → deux entrées ajoutées.

## Fichiers

- `artifacts/flowpoint-export/fp-locale.js`, `artifacts/flowpoint-export/pricing.html`
- Tests : `artifacts/api-server/src/tests/public-pages-default-english.test.ts` (jsdom, dans la CI) ; `artifacts/api-server/tests/browser/certification/08-langue-par-defaut.cert.ts` (navigateur réel `fr-FR`, harnais « Certification navigateur »).

## Ce que cette correction ne fait PAS

Elle ne change rien en production. Pour que `app.flowpoint.pro` s'affiche en anglais par défaut, il faut reporter dans `Flowpoint` les pages publiques de `Test-Replit` **avec leurs dépendances** (tunnel, thèmes, `fp-locale.js`, backend associé) : décision et autorisation du propriétaire, via une PR minimale vers `Flowpoint` ou la réconciliation (#438) à rebaser.
