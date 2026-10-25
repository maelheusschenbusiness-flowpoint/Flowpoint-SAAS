# Certification du parcours anglais de FlowPoint

**Date :** 25 octobre 2026
**Cible :** Test-Replit
**Branche :** `feature/i18n-en-certification-20261025`
**Base :** `Test-Replit` à `c27f36ef254cb4da51357ee235b7b0985fa706a3`

## Résultat

Les états publics vérifiés s’affichent en anglais avec `EN` sélectionné. Les résidus visibles repérés pendant l’audit ont été corrigés dans le dictionnaire anglais et les textes dynamiques. Les onze langues et la préférence enregistrée de l’utilisateur sont conservées.

## Résidus français corrigés

| Emplacement | Texte relevé | Correction |
| --- | --- | --- |
| `pricing.html`, liste de fonctionnalités Standard | `Local SEO basique` | `Basic Local SEO` |
| `pricing.html`, cartes de crédits IA | `Achat unique`, `une fois`, `Acheter →` | `One-time purchase`, `one-time`, `Buy →` |
| `pricing.html`, catalogue et comparatif | Libellés de plan et d’add-on tels que `Facturation client`, `Analytics concurrents`, `Support dédié <1h`, `Veille concurrentielle IA`, `+10 monitors actifs` et `Multi-clients (agence)` | Libellés anglais explicites; variantes avec espaces et ponctuation également couvertes |
| `pricing.html`, chargement/erreur du catalogue | `Chargement du catalogue…`, `Impossible de charger les add-ons. Actualisez la page pour réessayer.` | `Loading catalog…`, `Unable to load add-ons. Refresh the page to try again.` |
| `success.html`, état de confirmation | `Votre espace FlowPoint est prêt.` | `Your FlowPoint workspace is ready.` |
| `login.html`, `signin.html`, `accept-invitation.html`, `login-verify.html` | Erreurs API et réseau en français ou inconnues du dictionnaire | Messages de repli anglais; les champs et valeurs fournis par l’utilisateur ne sont pas traduits |
| `report-view.html` | Libellés d’erreur, de chargement et de rapport | Libellés anglais; titre, résumé, métriques et contenu du rapport restent protégés comme contenu utilisateur |

## Vérifications effectuées

- Parcours Playwright local en anglais : `pricing.html`, `signin.html`, `login.html`, `accept-invitation.html` sans jeton, `login-verify.html` sans jeton, `cancel.html`, `success.html` et `report-view.html` sans identifiant.
- Catalogue public de Test-Replit récupéré en lecture seule puis injecté comme réponse simulée dans le navigateur local : 36 add-ons affichés, aucun texte français visible après ouverture des fonctionnalités, du comparatif et des FAQ.
- Aucun plan sélectionné, panier toujours à zéro, aucune requête autre que GET/HEAD, aucun checkout ni paiement lancé.
- Vérification desktop (1280 px) et mobile (402 px) : aucun débordement horizontal.
- Formattage anglais contrôlé : `October 1, 2026` et `1,234,567.89`.
- `node --check` sur les scripts JavaScript concernés et `git diff --check` réussis.

Le serveur de prévisualisation local ne fournit pas l’API : ses réponses 404 sont attendues. Le message de repli du catalogue a été vérifié; les cartes dynamiques ont été vérifiées avec la réponse publique actuelle de Test-Replit.

## Limites restantes

- Le tableau de bord privé n’a pas été certifié dans un navigateur : le profil QA disponible ne donnait pas accès (`NEEDS_AUTH`). Aucun contournement d’authentification n’a été tenté; les scripts concernés ont seulement été vérifiés syntaxiquement.
- `checkout-return.html` n’a pas été ouvert avec une session de paiement. Aucun checkout ou paiement ne devait être lancé pour cet audit.
- Les corrections de l’interface privée devront être confirmées après obtention d’un accès QA autorisé.
