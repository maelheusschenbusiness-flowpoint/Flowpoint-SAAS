# Diagnostic — rejets 400 `unknown_fp_lid` (SaaS -> AI Lab `POST /events/conversion`)

Date : 2026-11-17. Branche : `Test-Replit`. Portée : lecture du code et des documents du dépôt, tests locaux sur base jetable. **Aucune lecture de la base de production ni de l'AI Lab réel** : ce qui n'est pas prouvé par le dépôt est marqué *inféré*.

## 1. Constat (journal du cron du moteur d'acquisition)

`conversion_ingest_health_v1 : called_but_rejected`, `rejected_by_reason: {unknown_fp_lid: 38}` sur 7 jours, étapes `signup`, `signup_page`, `signup_started`, `checkout`, `trial`.

`unknown_fp_lid` est le refus que l'AI Lab oppose à un `fp_lid` absent de sa table `lead_tokens` : il ne reçoit jamais un jeton qu'il n'a pas émis (documenté dans `CERTIFICATION-CONVERSION-AI-LAB-2026-11-14.md` §1, double de test `ai-lab-conversion-certification.test.ts`).

## 2. Cause

**Cause la plus probable (inférée, fortement étayée) : des parcours de certification exécutés sur `flowpoint-test` avec un `fp_lid` de test, alors que cette instance émet vers l'AI Lab de production.** Trois éléments du dépôt, indépendants :

1. **Signature d'étapes identique.** Le parcours `tests/browser/certification-stripe/13-ailab-test.stripe.ts` (inscription → SetupIntent → essai Stripe TEST, avec `CERT_FP_LID`) émet exactement `signup_page`, `signup_started`, `signup`, `checkout`, `trial` — et ni `visit` (émis par le site vitrine, absent du parcours) ni `paid` (pas de paiement dans un essai à 0 €). Ce sont, à l'identique, les cinq étapes rejetées. Un lead réel produirait aussi des `visit`, et un jour des `paid`.
2. **Le mécanisme est déjà documenté une fois.** Le 13-14/11, `flowpoint-test` a envoyé le `fp_lid` synthétique `AbCdEfGhIjKlMnOpQr_-12` à l'AI Lab de production : 400 à chaque essai, rejeu à 15/60/180/360 min (commentaire de `SYNTHETIC_FP_LIDS`, correctif `3a6a003f` du 14/11 qui bloque ce jeton avant l'émission). Ce correctif ne couvre pas un `fp_lid` **réel mais émis par l'AI Lab de test** (`CERT_FP_LID`), forcément inconnu de la production.
3. **Arithmétique.** Un jalon refusé en 400 est rejoué 5 fois (`ESSAIS_MAX_400`). Le compteur AI Lab compte des **appels refusés**, pas des jalons : 38 appels = au plus 8 jalons distincts, soit un à deux parcours de 5 étapes (5 × 5 = 25, plus un second parcours partiellement rejoué : 13). Ce n'est pas un flux continu de leads réels.

Autres causes possibles, **non écartées sans lecture de l'outbox** : un lead réel dont le `fp_lid` n'a pas encore été synchronisé vers `lead_tokens` (le cas que la reprise à 15/60/180/360 min prévoit), un `fp_lid` forgé dans une URL (le SaaS ne vérifie que la forme, 22 caractères). Le script §5 les distingue : un lead non synchronisé se livre à une reprise ultérieure ; un jeton de test jamais.

## 3. Impact

- **Événements touchés** : jalons dont le `fp_lid` est inconnu ; ils sont clos en `rejected:400:exhausted` après 5 essais, `fp_lid` effacé. Aucun effet sur l'inscription, le paiement ni les webhooks (l'émission est non bloquante, la file ne lève jamais).
- **Inscriptions réelles perdues pour l'attribution** : **non mesurable depuis le dépôt**. Si la cause du §2 est la bonne, **zéro** (tous les jalons rejetés sont des parcours de test, et le visiteur est `fp-test-…`, exclu des chiffres commerciaux). Pour le chiffrer : script §5, requête 3 (organisations créées avec `fp_lid` vs jalons `signup` livrés).
- **Le compteur AI Lab est gonflé** d'un facteur ≤ 5 par jalon à cause des reprises : lire « 38 » comme « ≤ 8 jalons ».

## 4. La file durable : vérification

`conversion_event_outbox` (échelle 15/60/180/360 min, épuisement au 5e rejet 400, compteur `rejets_400` distinct des échecs réseau) a été relue et testée :

- un `unknown_fp_lid` est réessayé **sur une fenêtre bornée seulement**, puis clos et son `fp_lid` effacé (`conversion-outbox-db.test.ts`) ; pas de rejeu sans fin, pas de doublon à la ré-inscription ;
- il **ne bloque pas la file** : replanifié dans le futur, il n'est plus « dû » ; les jalons sains partent pendant ce temps (test ajouté par la PR de compteurs : « un jalon en 400 répété ne bloque pas la file ») ;
- les échecs réseau ne consomment pas les essais réservés aux 400.

Le reessai de ce 400 n'est pas « inutile » en général (cas du lead pas encore synchronisé) ; il l'est pour un jeton de test. Le SaaS ne reçoit pas le motif du 400 (AI Lab le garde muet), il ne peut donc pas trancher seul : c'est pourquoi la correction est de configuration (§6).

## 5. Vérifier sur les données réelles (lecture seule, à lancer par vous)

`artifacts/api-server/tools/conversion/diagnostic-rejets-outbox-lecture-seule.sql` (transaction `READ ONLY`, aucun `fp_lid` lu) :

```bash
psql "$DATABASE_URL" -v jours=7 -f artifacts/api-server/tools/conversion/diagnostic-rejets-outbox-lecture-seule.sql
```

Lecture : (1) jalons par étape et statut avec le nombre d'appels ; (2) rejets épuisés par jour — un pic isolé daté d'un run de certification confirme la cause, un flux continu non ; (3) organisations avec `fp_lid` vs jalons `signup` livrés — l'écart est la perte d'attribution réelle.

## 6. Correction

**Dans le code (cette PR, minimale, prouvée par le dépôt)** : `SYNTHETIC_FP_LIDS` ne bloquait qu'un des trois jetons synthétiques présents dans le dépôt. Sont ajoutés `AbCdEfGhIjKlMnOpQrStUv` (certification navigateur) et `abcdefghijklmnopqrstuv` (exemple de contrat) : ils ne sont plus jamais postés à l'AI Lab (`invalid-input`, aucune ligne en file). Test : `ai-lab-conversion-emitters.test.ts`.

**Hors code, qui exige votre autorisation** (non fait) : faire pointer `AI_LAB_CONVERSION_URL` de `flowpoint-test` vers l'AI Lab **de test** (`infra/ailab-test/render.yaml`) — c'est la seule correction complète : un `fp_lid` émis par l'AI Lab de test n'a aucune raison d'exister dans celui de production, et aucun filtre côté SaaS ne peut le deviner. Tant que `flowpoint-test` émet vers la production, tout parcours `CERT_FP_LID` y produira ces 400.

## 7. Ce qui reste hors portée

Chiffrer l'impact réel et confirmer la cause demande la lecture de l'outbox SaaS et du journal AI Lab sur les données réelles (§5), non faite ici.
