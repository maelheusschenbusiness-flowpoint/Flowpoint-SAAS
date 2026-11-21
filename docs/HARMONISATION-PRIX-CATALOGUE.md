# Harmonisation des prix du catalogue — 21 novembre 2026

Référence provisoire : Flowpoint-Main (catalogue public `https://app.flowpoint.pro/api/plans/catalog`, prix LIVE codés). Test-Replit est aligné sur Main pour les 6 divergences ; aucun abonnement ni prix Stripe n'est modifié.

| Add-on | Main (référence) | Test-Replit avant | Test-Replit après | Prix Stripe TEST existant | Reste à faire |
|---|---:|---:|---:|---|---|
| Agency Reporting Packs | 49 € | 12 € | 49 € | 12 € (fixture `[TEST]`) | créer un prix TEST à 49 € avant toute certification (ou décider 12 € en LIVE) |
| AI GBP Posting | 29 € | 12 € | 29 € | aucun | créer le prix TEST au besoin |
| Global Monitoring | 49 € | 15 € | 49 € | aucun | idem |
| AI Workspace Launch | 49 € | 15 € | 49 € | aucun | idem |
| Review Intelligence | 19 € | 9 € | 19 € | aucun (add-on retiré en Test-Replit) | aucun |
| Local Domination Maps | 24 € | 15 € | 24 € | aucun (add-on retiré en Test-Replit) | aucun |

Autre divergence (non modifiée) : la clé `aiContentStrategist` est « AI Content Strategist » 34 € dans Main et « SEO Content Decay Radar » 12 € dans Test-Replit : produit différent sous une même clé, à découpler par une nouvelle clé avant toute publication.

Les montants LIVE réellement configurés dans Stripe ne sont pas lisibles depuis cet outil : à confirmer dans le Dashboard LIVE. Les montants affichés (`priceEur`) et les prix Stripe (`price_id`) sont deux sources distinctes ; un test de cohérence entre les deux n'existe pas encore.
