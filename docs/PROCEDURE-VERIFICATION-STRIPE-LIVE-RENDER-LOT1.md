# Vérification des 4 prix Stripe LIVE et des variables Render (lot 1) — procédure courte

Mes outils n'accèdent ni à Stripe LIVE ni aux valeurs des variables Render. Cette procédure vous permet de me transmettre les preuves **sans aucune clé secrète** : les identifiants `price_...` et `prod_...` ne sont pas des secrets.

## À copier-coller dans le chat (modèle)
```
ADD-ON: Organic Campaign Tracker        | Stripe LIVE: price_...  prod_...  12,00 EUR  mensuel  actif ? oui/non | Render Main: STRIPE_PRICE_ID_ORGANIC_CAMPAIGN_TRACKER = price_...
ADD-ON: Technical SEO Fix Verification  | Stripe LIVE: price_...  prod_...  19,00 EUR  mensuel  actif ? oui/non | Render Main: STRIPE_PRICE_ID_TECHNICAL_SEO_FIX_VERIFICATION = price_...
ADD-ON: SEO Change Impact               | Stripe LIVE: price_...  prod_...  15,00 EUR  mensuel  actif ? oui/non | Render Main: STRIPE_PRICE_ID_SEO_CHANGE_IMPACT = price_...
ADD-ON: Conversion Opportunity Engine   | Stripe LIVE: price_...  prod_...  12,00 EUR  mensuel  actif ? oui/non | Render Main: STRIPE_PRICE_ID_CONVERSION_OPPORTUNITY_ENGINE = price_...
Render Test (flowpoint-test): STRIPE_TEST_PRICE_ID_ADDON_TECHNICAL_SEO_FIX_VERIFICATION = price_...  (les 3 autres sont codés en dur côté code)
```

## Où lire chaque donnée
1. **Stripe → mode LIVE** (bascule « Mode test » désactivée) → Catalogue de produits → ouvrir le produit → section Tarifs : copier `price_...`, montant, devise (EUR), période (« Mensuel »), statut actif.
2. **Preuve que c'est bien du LIVE** : coller le même `price_...` dans la recherche du Dashboard **en mode test** : il doit être introuvable. Et dans le mode LIVE il doit être trouvé.
3. **Render → Flowpoint-Main → Environment** : copier uniquement les 4 lignes `STRIPE_PRICE_ID_*` listées ci-dessus (nom + valeur `price_...`). Ne copiez AUCUNE autre variable (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL`, etc.).
4. **Render → Flowpoint-Test → Environment** : la variable TEST ci-dessus (`price_...`).
5. Métadonnées LIVE (facultatif, ne bloque rien) : produit et prix → « Métadonnées » : `addonKey`, `flowpoint_addon_key`, `flowpoint_kind=addon`, `flowpoint_catalog_version=1`, `flowpoint_environment=live` (convention `docs/CONVENTION-METADONNEES-STRIPE.md`).

## Ce que je contrôle ensuite (sans clé)
- Chaque `price_...` de Main est distinct de ceux du compte TEST (lu via mon connecteur TEST) → preuve de non-mélange.
- Montants/devise/période = catalogue public `https://app.flowpoint.pro/api/plans/catalog` (12 / 19 / 15 / 12 € mensuel).
- Correspondance variable ↔ produit (clé d'add-on dans les métadonnées ou le nom du produit).
- Test navigateur en production sur un compte à vous (achat puis annulation), uniquement si vous me le demandez explicitement.
