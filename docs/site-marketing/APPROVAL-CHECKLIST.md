# Checklist d'approbation (à remplir par le propriétaire avant toute publication)

Rien dans ce paquet n'est publié. Chaque case est une décision humaine.

## Technique (patches 01, 02, 06)
- [ ] Patch SaaS `saas-signin-plan-param.patch` relu et planifié (après la PR #374 ; déployé avant ou avec le patch 01)
- [ ] `fp_ref` copié dans le lien de l'app sans consentement : accepté / à conditionner au consentement
- [ ] `npm install compression@^1.8.2 @types/compression` fait, `package-lock.json` régénéré, `npm run check` et `npm run build` verts
- [ ] Redirection www→apex et http→https testée sur le déploiement (sinon `DISABLE_CANONICAL_REDIRECT=1`)
- [ ] Domaine `www.flowpoint.pro` lié dans Replit Deployments (ou redirection chez le registrar)
- [ ] En-têtes vérifiés après publication : `Content-Encoding`, `Cache-Control` immutable sur `/assets`, `HEAD` 200, `/pricing/` 301

## Consentement et légal (patches 03, 04)
- [ ] Position UTM/`fp_lid` sans consentement validée (voir README, section Consentement)
- [ ] Google Translate après consentement : conservé / remplacé par le clic explicite sur le sélecteur
- [ ] Script `i.replit.com` : option d'analytics de l'hébergeur désactivée ou documentée
- [ ] `LanguagePicker.tsx` vérifié (écriture du cookie `googtrans`)
- [ ] Champs `À COMPLÉTER PAR L'ÉDITEUR` renseignés (adresse postale, fournisseurs de base de données, clé du thème, durées de cookies, Apollo, Replit)
- [ ] Textes légaux relus par un juriste
- [ ] 4 nouvelles URL ajoutées à `client/public/sitemap.xml` et au `Footer`

## Promesses commerciales (patch 05, EN ATTENTE D'APPROBATION)
- [ ] Ligne 1 mots-clés 50 / 500 (correction factuelle)
- [ ] Ligne 3 méta `/tarifs` Standard / Pro / Ultra
- [ ] Ligne 4 langues : A ou B ; liste des langues natives confirmée (10 ou 11)
- [ ] Ligne 5 « Unlimited » API / Missions : A ou B
- [ ] Ligne 6 support prioritaire : A ou B (et trancher la contradiction `plans.ts` / `config.ts` côté produit)
- [ ] Ligne 7 avis Google : A ou B
- [ ] Lignes 10, 11 (rapports planifiés, partage) vérifiées dans le produit
- [ ] Lignes 12, 13 FAQ essai et changement de plan (correction factuelle)
- [ ] Ligne 14 phrase « payment card required » (mention seulement : règle de carte inchangée)
- [ ] Lignes 16, 17 corrigées à la main dans `LegalInfo.tsx`
- [ ] Prix 29 / 79 / 149 EUR, essai de 14 jours et carte obligatoire : inchangés (vérifié sur le diff)

## Divers (non patché)
- [ ] CSP Report-Only posée puis violations observées
- [ ] `<main>` / lien d'évitement, lien « Se connecter » (cible confirmée), JSON-LD Offer, contrastes, tableau `testimonials`, override `braces`
