# État de préparation — PR #556

État relevé le 26 novembre 2026. La PR reste ouverte vers
`marketing-render-staging`. Les conclusions PostgreSQL ci-dessous concernent
uniquement `flowpoint_audit_staging`, interrogée depuis le Web Shell de
`flowpoint-marketing-staging`; elles ne certifient aucune base de production.

## PostgreSQL staging — contrôles clôturés

Tous les contrôles communiqués sont acquis ; ne pas les relancer :

- Connexion psql au moyen de `PUBLIC_AUDIT_DATABASE_URL`; base visée
  `flowpoint_audit_staging`.
- 9/9 colonnes conformes au schéma attendu.
- `quota_delete`, `public_usage`, `quota_resolution_ok`,
  `slots_resolution_ok` et `purge_index_conforme` à `true`.
- Les droits SELECT, INSERT et UPDATE, les deux clés primaires, les contraintes
  attendues et l’absence de RLS ont été confirmés.
- Limites de connexions par rôle et par base : `-1` (aucune limite spécifique).
  Plafond PostgreSQL `103`; 8 connexions lors du relevé précédent.
- Deux slots et zéro compteur au relevé précédent. Les slots sont utilisables;
  le moteur crée ceux qui manquent par DML normal. Zéro compteur est un état
  initial attendu.

Aucune nouvelle requête SQL ni écriture PostgreSQL n’est demandée ou effectuée.

## Valeurs Render à corriger

Le service Render rapporte `production=true`, `session_secret_min_32=true` et
`audit_enabled_now=true`. En revanche, `test_mode_false`, `global_10`,
`network_5` et `concurrency_2` sont faux. Les indicateurs ne révèlent pas les
valeurs brutes.

Le code applique ces règles :

- Test mode est actif uniquement si `PUBLIC_AUDIT_TEST_MODE === "true"`.
  Une variable absente donne donc le comportement test mode false, mais une
  valeur littérale `"true"` l’active.
- `PUBLIC_AUDIT_DAILY_LIMIT` retombe à 10 si absente, invalide ou non positive;
  sinon la valeur est retenue, plafonnée à 10 en test mode ou 10 000 hors test.
- `PUBLIC_AUDIT_NETWORK_DAILY_LIMIT` retombe à 5 si absente, invalide ou non
  positive; sinon la valeur est retenue, plafonnée à 5 en test mode ou 500 hors
  test.
- `PUBLIC_AUDIT_MAX_CONCURRENT` retombe à 2 si absente, invalide ou non
  positive; sinon la valeur est retenue jusqu’au plafond de 4.

Les valeurs par défaut sont sûres, mais les indicateurs false ne permettent pas
de confirmer que ce sont bien les valeurs effectives : une valeur positive
différente serait appliquée. Pour obtenir sans ambiguïté le profil pilote
attendu, configurer ces quatre variables Render exactement ainsi :

```text
PUBLIC_AUDIT_TEST_MODE=false
PUBLIC_AUDIT_DAILY_LIMIT=10
PUBLIC_AUDIT_NETWORK_DAILY_LIMIT=5
PUBLIC_AUDIT_MAX_CONCURRENT=2
```

Ne pas afficher ni copier `SESSION_SECRET`. L’audit est déjà activé sur le
service Render mesuré. L’activation démarre une purge périodique par DELETE;
aucune modification de variable n’a été effectuée par cette préparation. Une
modification Render nécessite son propre redémarrage/déploiement contrôlé et
peut commencer les écritures normales du service.

## Proxy et IP client — résultat non certifié

Le code de la PR configure Express avec `trust proxy = 1`. Le moteur lit
`req.ip`, normalise l’adresse avec `ipaddr.process`, puis ne stocke qu’une clé
HMAC; il ne prend pas directement le premier élément fourni dans
`X-Forwarded-For`.

Un contrôle limité à `flowpoint-marketing-staging.onrender.com` a envoyé 31
requêtes **GET** à `/api/public-audit/quota`, chacune avec une valeur
`X-Forwarded-For` de test différente. Les 31 réponses étaient HTTP 200; aucune
requête POST d’audit n’a été lancée. Ce résultat ne démontre pas que l’IP client
est fiable : le limiteur en mémoire est propre à chaque processus, et le nombre
de processus/routage de Render n’a pas été établi. Il peut donc masquer des
compteurs séparés ou un en-tête usurpable. Le code seul ne prouve pas ce que
l’ingress Render met réellement dans le dernier saut de l’en-tête.

**La validation IP reste un blocage avant fusion/déploiement public.** Ne pas
publier l’audit gratuit sur `flowpoint.pro` tant qu’un contrôle qui tient compte
du routage Render ne montre pas que des `X-Forwarded-For` falsifiés ne changent
pas le client retenu. Ne pas ajouter de route publique divulguant une IP. Si le
comportement n’est pas vérifiable par les outils Render existants, il faut une
modification minimale et protégée à valider séparément avant la fusion.

## Préparation de la fusion et de la bascule

- La PR #556 demeure ouverte; cette mise à jour ne la fusionne pas.
- Au relevé précédent, le SHA de code examiné n’avait aucun check-run GitHub
  attaché. Les tests locaux réussis ne remplacent pas les validations requises
  par la branche cible ni l’approbation humaine.
- Avant une fusion autorisée : renseigner les quatre valeurs exactes ci-dessus,
  résoudre la vérification IP proxy, puis obtenir les checks/revues requis.
- Avant un déploiement manuel autorisé : vérifier le SHA approuvé, les commandes
  et le contrôle `/healthz` sur le service Render existant.
- Avant une bascule autorisée : vérifier sur le déploiement staging la santé,
  SSR, routes SEO, noindex et absence de tracking sur l’hôte staging; confirmer
  domaines/TLS, retour arrière et accès Replit. Ces tests ne nécessitent aucune
  écriture PostgreSQL ni audit réel.
- `flowpoint.pro` demeure servi par Replit. Aucun DNS, service public,
  branche `Flowpoint` ou `Test-Replit`, ni base de production n’a été modifié.
  Aucune nouvelle infrastructure payante n’a été créée.

Sans audit POST contrôlé, le parcours complet de l’audit n’est pas certifié.
Cette préparation n’en lance aucun.
