# Certification du parcours anglais de FlowPoint

**Mise à jour finale :** 26 octobre 2026
**Cible :** Test-Replit
**Commit certifié :** `4d97f9e5f095f4512d4a0ff3e71b629df8a79763`
**PR de correction :** #302 (fusionnée; contrôle `Types, build, tests` réussi)

## Résultat

Les routes publiques revérifiées s’affichent en anglais avec `EN` sélectionné. La dernière correction couvre aussi les libellés révélés dans les add-ons, le comparatif et les détails des plans, ainsi que la description SEO et les métadonnées Open Graph de la page tarifs. Les onze langues et la préférence enregistrée de l’utilisateur sont conservées.

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
| `pricing.html`, add-ons, comparatif et détails de plans développés | `Monitors d'uptime`, `IA & Copilot`, `Review Intelligence IA`, `Copilot IA`, `Agency Lab complet`, `Complet`, `Basiques`, `Inclus`, `∞ (Inclus)` | Libellés anglais; `Agency Lab complet` devient `Full Agency Lab` |
| `pricing.html`, limites et packs | `100 000`, `500 000`, `4€`, `9€`, `19€` | Séparateurs anglais et prix formatés `100,000`, `500,000`, `€4`, `€9`, `€19` |
| `pricing.html`, description SEO et Open Graph | Description, `og:title` et `og:description` en français | Métadonnées traduites en anglais; `og:url` reste inchangé |

## Vérifications effectuées

- Navigateur KERNEL sur Test-Replit après déploiement : `/pricing.html`, `/signin.html`, `/login.html`, `/accept-invitation.html` sans jeton, `/login-verify.html` sans jeton, `/cancel.html`, `/success.html`, `/report-view.html` sans identifiant; `/dashboard.html` redirige vers `/signin.html`.
- Page tarifs réelle : 36 add-ons (8 initiaux et 28 après « View all add-ons »), 58 lignes du comparatif, trois listes de fonctionnalités de plan développées et sept réponses FAQ ouvertes successivement. Aucun résidu français ciblé; les carrousels exposent `Previous` et `Next`.
- Métadonnées de tarifs vérifiées dans le navigateur : description, titre Open Graph et description Open Graph en anglais. L’URL canonique `og:url` est restée inchangée.
- Aucune offre ni quantité sélectionnée, aucun formulaire soumis, aucun checkout ou paiement lancé. `/success.html` est une page statique et ne prouve pas une transaction.
- Vérification mobile après déploiement (viewport demandé 402 × 874) : largeur du document et largeur visible toutes deux à 385 px; aucun débordement horizontal. Le contrôle desktop à 1280 px avait également passé lors de l’audit précédent.
- Tests ciblés : 6 réussis; `pnpm run typecheck`, `node --check` et `git diff --check` réussis.

Après fusion, `/api/version` sur Test-Replit a confirmé le commit `4d97f9e5f095f4512d4a0ff3e71b629df8a79763` et `nodeEnv=test`. Les vérifications finales ont donc été faites sur le déploiement Test, et non sur un serveur local simulé.

## Matrice de certification par route et état

| Route / état vérifié | Statut | Preuve |
| --- | --- | --- |
| `/pricing.html` — catalogue, fonctionnalités, comparatif, FAQ et métadonnées | PASS | Navigateur KERNEL sur le déploiement Test; 36 add-ons, 58 lignes, sept réponses FAQ, libellés anglais ciblés et métadonnées SEO/Open Graph en anglais. |
| `/pricing.html` — chargement et erreur de catalogue | PASS, contrôle local antérieur | Le repli d’erreur statique avait été vérifié lors de l’audit précédent; aucune panne artificielle n’a été déclenchée sur Test. |
| `/signin.html` — formulaire initial | PASS | Navigateur Test en anglais; aucun champ rempli ni formulaire soumis. |
| `/login.html` — formulaire initial | PASS | Navigateur Test en anglais; aucune adresse saisie ni demande de lien envoyée. |
| `/accept-invitation.html` — jeton absent | PASS | Le lien invalide et l’absence de jeton sont affichés en anglais. |
| `/login-verify.html` — jeton absent | PASS | L’absence de jeton de connexion est affichée en anglais. |
| `/cancel.html` — page statique d’annulation | PASS | Copie anglaise vérifiée; aucun paiement ni checkout exécuté. |
| `/success.html` — copie statique de confirmation | PASS, rendu uniquement | Texte anglais vérifié; ne certifie pas une transaction réelle et aucun checkout n’a été lancé. |
| `/report-view.html` — identifiant absent | PASS | L’erreur d’absence d’identifiant est affichée en anglais; les contenus de rapport saisis par des utilisateurs restent exclus de la traduction. |
| `/dashboard.html` — accès anonyme | PASS, redirection uniquement | Redirection vers `/signin.html`, avec la page de connexion en anglais; aucune session authentifiée. |
| `/checkout-return.html` — retour avec une session de paiement | BLOCKED volontairement | Aucun checkout ou paiement ne devait être créé; cet état n’a pas été simulé avec une session réelle. |
| Routes privées — équipe, IA, add-ons, paramètres, rapports, facturation | BLOCKED | Aucune session QA authentifiée utilisée; aucun contournement d’authentification. |

Le résultat ne vaut donc pas certification complète : les routes privées et les états de paiement réels restent bloqués ou volontairement non testés.

## Diagnostic d’accès QA

- Le diagnostic du 25 octobre indiquait que le profil KERNEL QA nécessitait une authentification et qu’aucune connexion réussie n’était enregistrée.
- Pendant la vérification finale du 26 octobre, aucun login ni flux de réauthentification n’a été lancé. L’accès anonyme à `/dashboard.html` a redirigé vers `/signin.html`; aucun état authentifié n’a été testé.
- Aucun identifiant, `ADMIN_KEY` ou jeton de test n’a été utilisé. La certification des routes privées nécessitera une session QA autorisée; les identifiants ne doivent pas être envoyés dans le chat.

## CI et fusion

- PR #301 (`Suivant` → `Next`) : contrôle obligatoire `Types, build, tests` réussi; fusionnée avant le commit certifié `03c8e5e…`.
- PR #302 (libellés de prix et métadonnées) : contrôle obligatoire `Types, build, tests` réussi; fusionnée sur `Test-Replit` au commit `4d97f9e5…`.
- La CI est donc verte pour le code certifié; les routes privées et les retours avec une véritable session de paiement restent volontairement hors périmètre.
