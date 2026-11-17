# Validation de #476 (anglais par défaut sur les pages publiques de production) — protocole préparé

Statut : préparé, **non exécuté**. Rien n'est fusionné vers `Flowpoint`, rien n'est déployé.

## 1. Ce que la bêta peut et ne peut pas prouver
`flowpoint-test` se déploie depuis `Test-Replit`, dont les pages publiques sont déjà rédigées en anglais (PR #475) : elle ne contient pas les fichiers de #476 (pages de production + `fp-locale.js` de la couche de langue). La bêta ne valide donc pas #476 telle quelle. Ce qui est déjà prouvé pour #476 : fichiers statiques seulement, aucun appel API ni champ modifié (diff contre `origin/Flowpoint`), 11 pages × 2 profils sans français visible ni erreur JavaScript contre le backend de production local (voir la description de la PR).

## 2. Validation avant production, sans toucher à Flowpoint
1. Contrôle local (déjà fait, à rejouer sur le commit final) : `node scripts/verifier-langue-pages-publiques.cjs http://127.0.0.1:<port>` avec le backend de `Flowpoint` et les pages de #476.
2. Option si une bêta dédiée est souhaitée : un service Render temporaire construit depuis la branche de #476 avec une base jetable et sans clé réelle. **Décision du propriétaire requise** (création d'un service) ; non fait.

## 3. Contrôle en lecture seule le jour du déploiement (jamais avant)
Le script accepte maintenant, en plus du local, `app.flowpoint.pro` ou `flowpoint-test.onrender.com` si `FP_VERIFY_READONLY_REMOTE=1` : chargements de pages (GET) et JavaScript côté navigateur, aucune saisie, aucun formulaire.

```bash
FP_VERIFY_READONLY_REMOTE=1 node scripts/verifier-langue-pages-publiques.cjs https://app.flowpoint.pro
```
Attendu : 11 pages × bureau/mobile → `lang="en"`, `français_visible=0`, `erreurs_js=0`.

## 4. Critères d'arrêt et retour arrière
- Tout texte français visible, toute erreur JavaScript, ou un tableau comparatif vide sur `pricing.html` = arrêt.
- Retour arrière : revert du commit de fusion (fichiers statiques, aucune migration), effet immédiat au redéploiement.
- Hors périmètre : e-mails, factures et pages Stripe (`preferred_locales:["fr"]` côté backend), messages d'erreur serveur absents du catalogue, formulaire à 8 champs.

## 5. Preuves du 17/11/2026 (backend de production de `Flowpoint` local, base jetable, pages de #476)
Script : `node scripts/verifier-parcours-pages-publiques.cjs http://127.0.0.1:<port>` (lecture seule : échoue si une requête POST/PUT/PATCH/DELETE part ; même option distante que ci-dessus).
Bureau 1440, iPhone 13, Pixel 7, navigateur en `fr-FR` sans préférence : **« Tout est conforme »**.
- Tarifs : `lang="en"`, 3 plans, le prix de chaque plan de `/api/plans/catalog` figure sur sa carte, 0 français visible.
- Choix du plan : le plan est sélectionné sur place (aucune redirection forcée) ; retour/changement de plan : le second choix remplace le premier dans `fp_cart`.
- Inscription : `lang="en"`, **8 champs obligatoires** (contrat de production conservé), 0 français visible, aucune soumission.
- Connexion : `lang="en"`, champ e-mail visible, 0 français visible.
- Checkout sans panier : renvoi vers `/signin.html`, 0 français visible.
- 0 requête d'écriture, 0 erreur JavaScript sur les 3 profils.
Contrat, événements de conversion et protections Stripe inchangés : le diff des 11 pages contre `origin/Flowpoint` ne contient aucune ligne de suivi, de consentement, d'attribution ou d'appel API ; la seule ligne liée à Stripe est l'option `locale` de `stripe.elements` ; `fp-locale.js` ne contient aucun `fetch`, `XMLHttpRequest`, `sendBeacon` ni code de suivi.
Non couvert ici : soumission réelle de l'inscription, paiement (Stripe TEST réel non disponible), connexion avec un compte réel.
