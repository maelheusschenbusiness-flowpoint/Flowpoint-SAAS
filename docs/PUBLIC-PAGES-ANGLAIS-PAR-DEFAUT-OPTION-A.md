# Pages publiques de production : anglais par défaut (option A — couche de langue, backend inchangé)

Orientation technique validée par le propriétaire le 17/11/2026. **Pas de fusion, pas de déploiement sans son accord.**

## Contenu
- `artifacts/flowpoint-export/fp-locale.js` (nouveau) : traduction FR -> EN à l'affichage, anglais par défaut, `?lang=` amorce sans écraser une préférence, jamais `navigator.language` ni `Accept-Language`.
  - `FUNNEL_PAGES = {}` : toutes les pages de production sont rédigées en français.
  - Catalogue : descriptions des cartes d'add-ons de `pricing.html`, textes de paiement/connexion, libellés renvoyés par `/api/plans/definitions`, motifs pour les messages assemblés (jours d'essai, codes d'erreur, plans).
  - `window.fpPublicSourceText(el)` : texte français d'ORIGINE d'un élément traduit (voir ci-dessous).
- 11 pages publiques : `<html lang="en">` + `<script src="/fp-locale.js">`.
- `checkout-payment.html` : langue de Stripe Elements explicite (sans elle, le formulaire de carte suit le navigateur).
- `pricing.html` : 11 comparaisons de libellés français (4 boutons de plan, 7 lignes du tableau comparatif) lisent maintenant le texte d'origine via `_fpSource()` : sans cela, une fois traduit, le tableau n'était plus rempli avec les limites de l'API et les boutons « ✓ Votre plan actuel / Actif / Dans le panier » n'étaient plus remis à zéro.

## Contrat backend de production : inchangé
Aucune requête n'est modifiée : le formulaire d'inscription garde ses huit champs obligatoires, le prix, l'essai et l'éligibilité restent décidés par le serveur. Aucun fichier de `artifacts/api-server` n'est touché.

## Mesures (serveur de production `Flowpoint` + pages candidates, base jetable : 631 étapes de migration, 0 échec)
Script : `node scripts/verifier-langue-pages-publiques.cjs http://127.0.0.1:<port>` (serveur local seulement).
- Navigateur `fr-FR`, aucune préférence, 11 pages × bureau 1440 / mobile 390 : `lang="en"`, **0 texte français visible** (textes, infobulles, étiquettes, placeholders), **0 erreur JavaScript**, API réelle de production, tableau comparatif et add-ons ouverts.
- Tableau comparatif (58 lignes) : les valeurs numériques en anglais sont identiques à celles du français ; seul le séparateur de milliers change (« 100,000 » / « 100 000 »).
- Logique de libellé : bouton réglé sur « ✓ Votre plan actuel » -> affiché « ✓ Your current plan », texte d'origine lu « ✓ Votre plan actuel ».

## Non couvert (à décider)
- E-mails, factures et pages hébergées Stripe : la production crée les clients Stripe avec `preferred_locales: ["fr"]` (backend).
- Messages d'erreur renvoyés par le serveur : traduits seulement s'ils sont dans le catalogue.
- Stripe TEST réel (3DS, webhooks), Google OAuth réel, e-mails réels : non exécutés ici.
