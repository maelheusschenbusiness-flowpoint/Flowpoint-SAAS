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

## Matrice de certification par route et état

| Route / état vérifié | Statut | Preuve |
| --- | --- | --- |
| `/pricing.html` — catalogue, fonctionnalités développées, comparatif et FAQ | PASS | Playwright local avec les 36 add-ons de la réponse publique Test-Replit simulée; aucun texte français visible; vues 1280 px et 402 px sans débordement. |
| `/pricing.html` — chargement et erreur de catalogue | PASS | Le repli d’erreur du serveur statique local est affiché en anglais; aucune sélection de plan ni écriture API. |
| `/signin.html` — formulaire initial | PASS | Route rendue en anglais dans le navigateur local; aucune inscription soumise. |
| `/login.html` — formulaire initial | PASS | Route rendue en anglais dans le navigateur local; aucun identifiant réel ni demande de lien envoyés. |
| `/accept-invitation.html` — jeton absent | PASS | État « invitation token missing » rendu en anglais. |
| `/login-verify.html` — jeton absent | PASS | État « sign-in token missing » rendu en anglais. |
| `/cancel.html` — page statique d’annulation | PASS | Copie anglaise vérifiée; aucun paiement ni checkout exécuté. |
| `/success.html` — copie statique de confirmation | PASS, rendu uniquement | Texte anglais vérifié; ne certifie pas une transaction réelle et aucun checkout n’a été lancé. |
| `/report-view.html` — identifiant absent | PASS | État d’erreur rendu en anglais; les contenus de rapport saisis par des utilisateurs restent exclus de la traduction. |
| `/checkout-return.html` — retour avec une session de paiement | BLOCKED volontairement | Aucun checkout ou paiement ne devait être créé; cet état n’a pas été simulé avec une session réelle. |
| `/dashboard.html` et routes privées — équipe, IA, add-ons, paramètres, rapports, facturation | BLOCKED | Le navigateur KERNEL QA n’a pas accédé au dashboard; voir le diagnostic d’authentification ci-dessous. |

Le résultat ne vaut donc pas certification complète : les routes privées et les états de paiement réels restent bloqués ou volontairement non testés.

## Diagnostic d’accès QA

- La connexion KERNEL du profil `QA` pour `flowpoint-test.onrender.com` indique `NEEDS_AUTH`. Le dernier flux enregistré est `LOGIN / FAILED`, avec `error_code=awaiting_input_timeout` : il a expiré en attendant une action utilisateur. `can_reauth=false` et `can_reauth_reason=no_prior_successful_login`; aucun login réussi n’est enregistré. La réauthentification automatique et les contrôles de santé sont désactivés.
- Le navigateur KERNEL existant a demandé `/dashboard.html` et a terminé sur `/signin.html` (HTTP 200), avec le titre « FlowPoint — Créer votre compte » et le formulaire de création de compte. Il n’a donc pas fourni d’état dashboard authentifié.
- Aucun login n’a été relancé et aucun identifiant, `ADMIN_KEY` ou jeton de test n’a été utilisé. La reprise autorisée nécessite un flux KERNEL `login` sécurisé pour le profil QA, complété par une personne autorisée dans l’écran hébergé; les identifiants ne doivent pas être envoyés dans le chat. Le statut `no_prior_successful_login` indique qu’il faut un nouveau login, pas une réauthentification automatique.

## CI de la PR

- La CI du commit initial `82c49d0` a échoué sur la parité entre `src/frontend/dashboard.js` et `artifacts/flowpoint-export/dashboard.js`, ainsi que sur un test isolé qui n’injectait pas le helper de locale du chat.
- La parité a été rétablie et les tests ciblés de ces régressions, plus les nouveaux tests de localisation publique, passent localement : 66 tests réussis sur 7 fichiers. La CI distante doit être relancée et verte avant toute fusion.
