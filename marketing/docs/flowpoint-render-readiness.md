# Rapport de migration — état au 26 novembre 2026

## Conclusion

La base Render n’est plus un blocage général : les vérifications en lecture
seule communiquées par l’utilisateur depuis le Web Shell de
`flowpoint-marketing-staging` confirment la connexion à
`flowpoint_audit_staging` et les principaux objets attendus. Elles ne certifient
pas encore la forme exacte des colonnes ni le droit DELETE nécessaire au moteur.
La bascule n’est donc pas encore déclarée prête.

Comparaison effectuée avec la PR #556 à
`339fe3325015f5b3e3d0aac72e6574d1e62e92a1`, ouverte vers
`marketing-render-staging`. Les fichiers du moteur de quotas et du schéma de
référence ont également été comparés à cette branche cible : mêmes contenus.

## Résultats acquis — ne pas les relancer sans changement pertinent

| Résultat communiqué | Conclusion par rapport au moteur |
| --- | --- |
| Les deux URL de base sont configurées ; psql est disponible ; connexion à `flowpoint_audit_staging` réussie | Accès établi depuis Render. Le bloc ci-dessous utilise exclusivement `PUBLIC_AUDIT_DATABASE_URL`, comme le moteur. |
| Les deux tables existent | Conforme au besoin ; aucun DDL à exécuter. |
| SELECT, INSERT, UPDATE sur les deux tables | Conforme pour lecture, incréments transactionnels, création et libération des slots. DELETE sur les quotas reste à confirmer séparément. |
| RLS désactivé sur les deux tables techniques | Pas de blocage RLS identifié. Ne modifier aucune politique, notamment celles de production. |
| PK quotas `(quota_type, quota_key, day_utc)` ; PK slots `(slot_id)` | Correspond aux `ON CONFLICT` du moteur. |
| Contraintes `visitor/network/global` et `used >= 0` | Correspond aux valeurs et invariants du moteur. |
| Index sur `expires_at` | Présence acquise ; sa forme exploitable exacte reste à confirmer, sans recréer l’index. |
| Deux lignes de concurrence | Pas de préremplissage nécessaire. Le moteur insère lui-même les identifiants manquants de 1 à 2 avec `ON CONFLICT DO NOTHING`. |
| Aucun compteur de quota | État initial normal ; ne pas créer de compteur de test. |
| `max_connections=103`, 8 lignes dans `pg_stat_activity` au moment du contrôle | Pas de saturation observée pour un pool de quotas limité à 4. Ce n’est pas une garantie de 95 connexions utilisables : réserves, autres pools et éventuelles limites du rôle/de la base s’appliquent. Seules ces limites spécifiques non relevées sont ajoutées ci-dessous. |

Ces résultats proviennent du contrôle Render rapporté par l’utilisateur,
pas d’une connexion effectuée depuis Replit.

## Vérifications restantes, au bon moment

### Avant la fusion

- Confirmer les neuf colonnes, types, nullabilité et valeurs par défaut du
  schéma de référence, notamment `quota_key character(64)`, les timestamps
  avec fuseau et les champs de bail nullable. Leur liste n’était pas lisible.
- Confirmer DELETE sur les quotas : la réservation commence par une purge et
  échoue si ce droit manque, même lorsque la table est vide.
- Compléter uniquement les détails non relevés : résolution des tables non
  qualifiées via le `search_path`, USAGE du schéma public, index btree valide
  et prêt sur `expires_at`, limites de connexion propres au rôle et à la base.
- Relire/autoriser la PR vers `marketing-render-staging`. Aucun statut CI ni
  check-run GitHub n’était attaché au SHA examiné ; ne pas présenter les tests
  locaux comme des checks GitHub. Les validations locales précédentes restent
  acquises pour le code inchangé : TypeScript, build, 42 tests SSR/SEO,
  35 tests audit, 12 tests sécurité/robots/contact ; SEO anglais `/resources`
  validé sur 38 articles, 44 pages principales, 55 URLs sitemap, 57 routes.

Une divergence SQL n’autorise ni correction automatique, ni GRANT, ni DDL.
La signaler et décider d’une correction ciblée séparément.

### Avant le déploiement manuel autorisé

- Confirmer le profil réel du service : production, test mode false,
  plafonds global 10 / réseau 5 / simultanés 2 ; visiteur 3 fixé dans le code.
  Le secret doit avoir au moins 32 caractères et être propre au service.
  Le bloc ci-dessous n’affiche que des booléens de conformité, jamais sa valeur.
- Vérifier le SHA choisi, le répertoire `marketing`, les commandes build/start
  et `/healthz` du runbook ; garder l’auto-déploiement désactivé. Pas de nouveau
  service, base, plan, Blueprint ou infrastructure.
- Avant d’activer l’audit, confirmer les points SQL et le secret. L’activation
  n’est pas une opération strictement en lecture seule : au démarrage,
  le moteur lance immédiatement une purge DELETE des compteurs expirés,
  puis la répète chaque heure. Ne pas démarrer/redémarrer avec l’audit activé
  pendant cette phase de vérification sans autorisation d’écriture.
- Pour le site entier, confirmer sans envoi réel la configuration Resend
  existante (expéditeur vérifié et destinataire approuvé). Resend n’est pas
  une dépendance du moteur d’audit gratuit.

### Après le déploiement autorisé, avant la bascule

- Valider sur le SHA réellement déployé : `/healthz`, accueil SSR, page d’audit,
  canonicals anglais `/resources`, 404, favicon ; staging toujours
  `noindex, nofollow` et sans tracking commercial. Pas de nouvelle campagne
  complète de tests locaux si le code n’a pas changé.
- Confirmer l’IP client réellement obtenue par Express derrière Render :
  le code utilise `trust proxy = 1` et `req.ip`, pas le premier champ d’un
  en-tête reçu. La lecture de cette configuration ne prouve pas le chemin
  réseau réel. Il faut une observation côté application sur une requête GET
  inoffensive, y compris avec un `X-Forwarded-For` falsifié : l’identité retenue
  ne doit être ni celle falsifiée ni une IP de proxy partagée entre visiteurs.
  Aucune route de diagnostic IP n’existe actuellement ; le bloc ci-dessous
  ne prétend donc pas certifier ce point. Utiliser une observation déjà
  disponible ou autoriser séparément un diagnostic temporaire minimal.
- Dans Render, confirmer les domaines existants, absence de surcoût, cible DNS
  affichée, et possibilité d’émission TLS. Un certificat en attente du DNS
  n’est pas un motif pour créer une autre infrastructure.
- Confirmer la disponibilité du retour arrière (Replit accessible et ancienne
  valeur A conservée) et le moyen de restauration/sauvegarde déjà disponible
  pour la base Render ; aucune nouvelle sauvegarde ni infrastructure n’est
  créée par ce rapport.
- Préparer `PUBLIC_AUDIT_ENABLED=true` après validation et autorisation,
  puis obtenir l’accord explicite de bascule. Le booléen false pendant les
  vérifications est normal ; true est obligatoire pour la mise en service.

### À la bascule autorisée et après

Appliquer uniquement la procédure DNS approuvée du runbook ; vérifier TLS,
redirection www, indexation de l’apex et protections du staging. Conserver
Replit accessible pendant toute la propagation et jusqu’à validation définitive.
Ne toucher ni aux branches `Flowpoint` et `Test-Replit`, ni aux RLS de production.

Sans exécution d’audit réel, la compatibilité et la préparation peuvent être
validées, mais pas le fonctionnement complet de bout en bout. Un audit réel
contrôlé nécessite une autorisation distincte : il consomme un quota et écrit
des compteurs/baux. Ce rapport ne l’exécute pas et ne le présente pas comme passé.

## Bloc unique — derniers relevés depuis le Web Shell Render

À copier tel quel dans le Web Shell du service existant. Utilise le même pilote
`pg` et la même URL que le moteur, sans afficher URL, secret, IP, clé de quota,
lead ou conversation. Aucune installation, requête HTTP, DDL, DML, activation
ou modification de configuration. Toutes les requêtes SQL sont protégées par
une transaction READ ONLY ; erreurs réduites à leur code, sans message brut.
Les résultats `false` sont à examiner, pas à corriger automatiquement.

```bash
(
set +x
node --input-type=module <<'NODE'
import pg from 'pg';
const env = process.env;
const profile = {
  production: env.NODE_ENV === 'production',
  test_mode_false: env.PUBLIC_AUDIT_TEST_MODE === 'false',
  global_10: env.PUBLIC_AUDIT_DAILY_LIMIT === '10',
  network_5: env.PUBLIC_AUDIT_NETWORK_DAILY_LIMIT === '5',
  concurrency_2: env.PUBLIC_AUDIT_MAX_CONCURRENT === '2',
  session_secret_min_32: (env.SESSION_SECRET?.length ?? 0) >= 32,
  audit_enabled_now: env.PUBLIC_AUDIT_ENABLED === 'true',
};
console.log('Profil (false peut être normal avant activation) :', profile);
if (!env.PUBLIC_AUDIT_DATABASE_URL) {
  console.error('STOP : URL audit absente.'); process.exit(1);
}
const client = new pg.Client({
  connectionString: env.PUBLIC_AUDIT_DATABASE_URL,
  connectionTimeoutMillis: 10000,
  application_name: 'audit_readonly_remaining_checks',
});
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '10s'");
  const checks = [
    ['Colonnes attendues / réelles (9 lignes, toutes conformes)', `
      WITH expected(t,n,typ,nn,def) AS (VALUES
        ('public_audit_quota_counters','quota_type','text',true,NULL::text),
        ('public_audit_quota_counters','quota_key','character(64)',true,NULL),
        ('public_audit_quota_counters','day_utc','date',true,NULL),
        ('public_audit_quota_counters','used','integer',true,'0'),
        ('public_audit_quota_counters','expires_at','timestamp with time zone',true,NULL),
        ('public_audit_quota_counters','updated_at','timestamp with time zone',true,'now()'),
        ('public_audit_concurrency_slots','slot_id','smallint',true,NULL),
        ('public_audit_concurrency_slots','lease_id','uuid',false,NULL),
        ('public_audit_concurrency_slots','lease_expires_at','timestamp with time zone',false,NULL)
      ), actual AS (
        SELECT c.relname::text t, a.attname::text n,
          format_type(a.atttypid,a.atttypmod) typ, a.attnotnull nn,
          pg_get_expr(d.adbin,d.adrelid) def,
          a.attidentity, a.attgenerated
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace s ON s.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE s.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
          AND c.relname IN ('public_audit_quota_counters','public_audit_concurrency_slots')
      )
      SELECT COALESCE(e.t,a.t) AS table_name, COALESCE(e.n,a.n) AS column_name,
        e.typ AS expected_type, a.typ AS actual_type, a.nn AS not_null,
        a.def AS actual_default,
        (e.n IS NOT NULL AND a.n IS NOT NULL AND e.typ=a.typ AND e.nn=a.nn
          AND e.def IS NOT DISTINCT FROM a.def
          AND a.attidentity='' AND a.attgenerated='') AS conforme
      FROM expected e FULL JOIN actual a USING(t,n)
      ORDER BY table_name,column_name`],
    ['Droits et résolution utilisés par les SQL non qualifiés', `
      SELECT has_table_privilege(current_user,
          'public.public_audit_quota_counters','DELETE') AS quota_delete,
        has_schema_privilege(current_user,'public','USAGE') AS public_usage,
        to_regclass('public_audit_quota_counters') =
          to_regclass('public.public_audit_quota_counters') AS quota_resolution_ok,
        to_regclass('public_audit_concurrency_slots') =
          to_regclass('public.public_audit_concurrency_slots') AS slots_resolution_ok`],
    ['Forme exacte de l’index de purge (true attendu)', `
      SELECT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
        JOIN pg_am am ON am.oid=c.relam
        WHERE c.relnamespace='public'::regnamespace
          AND c.relname='public_audit_quota_counters_expires_at_idx'
          AND i.indrelid='public.public_audit_quota_counters'::regclass
          AND i.indisvalid AND i.indisready AND NOT i.indisunique
          AND i.indpred IS NULL AND i.indexprs IS NULL
          AND i.indnatts=1 AND i.indnkeyatts=1 AND am.amname='btree'
          AND pg_get_indexdef(c.oid,1,true)='expires_at'
      ) AS purge_index_conforme`],
    ['Limites spécifiques non encore relevées (-1 = sans limite spécifique)', `
      SELECT r.rolconnlimit AS role_connection_limit,
        d.datconnlimit AS database_connection_limit
      FROM pg_roles r CROSS JOIN pg_database d
      WHERE r.rolname=current_user AND d.datname=current_database()`],
  ];
  for (const [label, sql] of checks) {
    console.log('\n' + label);
    console.table((await client.query(sql)).rows);
  }
  await client.query('ROLLBACK');
  console.log('\nLectures terminées. Aucun audit ni écriture déclenché par ce bloc.');
} catch (error) {
  const code = /^[A-Z0-9_]{2,40}$/.test(String(error?.code ?? ''))
    ? error.code : 'NON_DETAILLEE';
  console.error('STOP : vérification interrompue, code=' + code);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
NODE
)
```

Si `pg` n’est pas résolu, exécuter ce bloc depuis le répertoire applicatif
`marketing` du déploiement existant, sans installer de paquet.
Pour une limite spécifique finie, vérifier qu’elle couvre les autres pools du
service plus les 4 connexions du pool audit ; ne pas augmenter le plan d’office.

## Actions effectuées pour cette mise à jour

Comparaison du moteur et de la PR, puis documentation seulement. Aucun merge,
déploiement, changement DNS, secret, DDL/DML, GRANT, RLS, test d’audit réel,
formulaire ou e-mail. Aucun contrôle PostgreSQL Render déjà acquis n’a été
relancé. Le bloc ci-dessus est fourni pour exécution par l’utilisateur, pas
présenté comme exécuté.
