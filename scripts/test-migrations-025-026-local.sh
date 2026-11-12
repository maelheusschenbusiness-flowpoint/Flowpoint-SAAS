#!/usr/bin/env bash
# Test LOCAL des migrations 025/026, de leurs diagnostics, du retour arriere et de la
# restauration. BASE JETABLE LOCALE UNIQUEMENT (refuse tout hote autre que localhost).
#
# Prerequis : PostgreSQL local, un role superuser, et une base « modele » dont le schema
# a ete construit par `pnpm run migrate` (CI : meme procedure).
#   PGHOST=127.0.0.1 PGUSER=... PGPASSWORD=... TEMPLATE_DB=flowpoint_runbook \
#     bash scripts/test-migrations-025-026-local.sh
set -euo pipefail
: "${PGHOST:=127.0.0.1}"; export PGHOST; : "${TEMPLATE_DB:?TEMPLATE_DB requis (base au schema migre)}"
case "$PGHOST" in 127.0.0.1|localhost|/*) ;; *) echo "REFUS : hote non local ($PGHOST)"; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; M="$ROOT/artifacts/api-server/migrations"
P="psql -X -q -v ON_ERROR_STOP=1 -At"
ok=0; ko=0
check() { # description, valeur attendue, valeur obtenue
  if [ "$2" = "$3" ]; then echo "  OK   $1 ($3)"; ok=$((ok+1)); else echo "  ECHEC $1 : attendu [$2] obtenu [$3]"; ko=$((ko+1)); fi; }
mk() { $P -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 TEMPLATE $TEMPLATE_DB"; }
seed() { # $1 db, $2 avec_doublons(0/1)
  $P -d "$1" <<SQL
INSERT INTO organizations (id, owner_email, plan, status, subscription_status, name, slug)
SELECT gen_random_uuid(), 'u'||g||'@example.test', 'starter', 'active', 'active', 'o'||g, 'o'||g||'-$1' FROM generate_series(1,50) g;
INSERT INTO organizations (id, owner_email, plan, status, subscription_status, name, slug)
SELECT gen_random_uuid(), '', 'starter', 'active', NULL, 'v'||g, 'v'||g||'-$1' FROM generate_series(1,3) g;
INSERT INTO organizations (id, owner_email, plan, status, subscription_status, name, slug) VALUES
 (gen_random_uuid(),'gone@example.test','starter','deleted','canceled','d1','d1-$1'),
 (gen_random_uuid(),'gone@example.test','starter','active','active','d2','d2-$1'),
 (gen_random_uuid(),'t@example.test','starter','active','trialing','t1','t1-$1');
INSERT INTO activity_logs (id, org_id, type) SELECT 'a'||g, (SELECT id::text FROM organizations ORDER BY slug LIMIT 1), 'test' FROM generate_series(1,20) g;
SQL
  if [ "$2" = 1 ]; then $P -d "$1" -c "INSERT INTO organizations (id, owner_email, plan, status, subscription_status, name, slug) VALUES (gen_random_uuid(),'U1@Example.test','starter','active','active','dup1','dup1-$1'),(gen_random_uuid(),'u1@example.test ','starter','active','active','dup2','dup2-$1'),(gen_random_uuid(),'U2@example.test','starter','active','active','dup3','dup3-$1')"; fi
}
idx() { $P -d "$1" -c "select count(*) from pg_index where indexrelid=to_regclass('public.organizations_owner_email_active_uniq') and indisvalid"; }
npol() { $P -d "$1" -c "select count(*) from pg_policies where tablename='activity_logs' and policyname like 'tenant\_%'"; }
cksum_() { $P -d "$1" -c "select md5(string_agg(t::text, '|' order by t::text)) from (select * from organizations) t" -c "select md5(string_agg(t::text, '|' order by t::text)) from (select * from activity_logs) t" | paste -sd:; }

echo "== Scenario A : donnees avec doublons (025 doit NOTICE et ne pas creer l'index) =="
DB=rb_dups; mk $DB; seed $DB 1
echo "-- diagnostic agrege:"; $P -d $DB -f "$M/diagnostics/025_026_preflight_aggregates.sql" | grep -E '^(025_groupes|a09|026_etat|025_hors)'
C0=$(cksum_ $DB)
out=$($P -d $DB -f "$M/025_organizations_owner_email_unique.sql" 2>&1 || true); echo "$out" | sed 's/^/    /'
check "A: index non cree" 0 "$(idx $DB)"
check "A: donnees inchangees" "$C0" "$(cksum_ $DB)"
check "A: diagnostic agrege = comptage direct (2 groupes; la variante avec espace final n est pas detectee, voir runbook)" "$($P -d $DB -c "select count(*) from (select 1 from organizations where owner_email<>'' and status is distinct from 'deleted' group by lower(owner_email) having count(*)>1) d")" "$($P -d $DB -f "$M/diagnostics/025_026_preflight_aggregates.sql" | grep '^025_groupes' | cut -d'|' -f2)"
# 025 rejoue : toujours sans erreur
$P -d $DB -f "$M/025_organizations_owner_email_unique.sql" >/dev/null 2>&1 && check "A: rejeu sans erreur" ok ok
# traitement manuel du doublon puis rejeu
$P -d $DB -c "update organizations set status='deleted' where slug in ('dup1-$DB','dup3-$DB')"
$P -d $DB -f "$M/025_organizations_owner_email_unique.sql" 2>&1 | sed 's/^/    /'
check "A: index cree apres traitement" 1 "$(idx $DB)"

echo "== Scenario B : sans doublon, 025 + 026 sur etat « chemin rapide » (0 policy) =="
DB=rb_clean; mk $DB; seed $DB 0
$P -d $DB -c "drop policy tenant_select on activity_logs; drop policy tenant_insert on activity_logs; drop policy tenant_update on activity_logs; drop policy tenant_delete on activity_logs"
check "B: etat initial 0 policy" 0 "$(npol $DB)"
RLS0=$($P -d $DB -c "select relrowsecurity::text||relforcerowsecurity::text from pg_class where oid='activity_logs'::regclass")
C0=$(cksum_ $DB)
echo "-- sauvegarde pg_dump (format custom) + SQL de repli"
BK=$(mktemp -d); pg_dump -Fc -d $DB -t organizations -t activity_logs -f "$BK/bk.dump"
$P -d $DB -v suffix=20261108 -f "$M/rollback/backup_025_026.sql" | sed 's/^/    /'
for i in 1 2; do $P -d $DB -f "$M/025_organizations_owner_email_unique.sql" 2>&1 | sed 's/^/    /'; done
check "B: 025 index valide (idempotent x2)" 1 "$(idx $DB)"
t0=$(date +%s%N); $P -d $DB -c "set lock_timeout='5s'" -f "$M/026_rls_activity_logs_tenant_policies.sql" 2>&1 | sed 's/^/    /'; t1=$(date +%s%N); echo "    duree 026: $(( (t1-t0)/1000000 )) ms (incl. connexion psql)"
$P -d $DB -f "$M/026_rls_activity_logs_tenant_policies.sql"
check "B: 026 pose 4 policies (idempotent x2)" 4 "$(npol $DB)"
check "B: RLS/FORCE inchanges" "$RLS0" "$($P -d $DB -c "select relrowsecurity::text||relforcerowsecurity::text from pg_class where oid='activity_logs'::regclass")"
check "B: donnees inchangees" "$C0" "$(cksum_ $DB)"
# unicite effective
if $P -d $DB -c "insert into organizations (id,owner_email,plan,status,name,slug) values (gen_random_uuid(),'U1@EXAMPLE.test','starter','active','x','x-$DB')" 2>/dev/null; then check "B: doublon refuse par l'index" refuse accepte; else check "B: doublon refuse par l'index" refuse refuse; fi
$P -d $DB -c "insert into organizations (id,owner_email,plan,status,name,slug) values (gen_random_uuid(),'','starter','active','y','y-$DB'),(gen_random_uuid(),'','starter','active','z','z-$DB')" && check "B: owner_email vide hors index (2 inserts ok)" ok ok
C1=$(cksum_ $DB)
# comportement role non BYPASSRLS
$P -d postgres -c "grant usage on schema public to app_user" -d $DB -c "grant usage on schema public to app_user; grant select,insert on activity_logs to app_user"
OID=$($P -d $DB -c "select org_id from activity_logs limit 1")
check "B: app_user sans GUC voit 0 ligne" 0 "$($P -d $DB -c "set role app_user; select count(*) from activity_logs" | tail -1)"
check "B: app_user avec GUC voit 20 lignes" 20 "$($P -d $DB -c "set role app_user; select set_config('app.current_org_id','$OID',false); select count(*) from activity_logs" | tail -1)"
check "B: app_user avec GUC autre org voit 0" 0 "$($P -d $DB -c "set role app_user; select set_config('app.current_org_id','autre',false); select count(*) from activity_logs" | tail -1)"
echo "-- post-controle"; $P -d $DB -f "$M/diagnostics/025_026_postcheck.sql" | sed 's/^/    /'

echo "== Retour arriere =="
$P -d $DB -f "$M/rollback/025_organizations_owner_email_unique.down.sql"; $P -d $DB -f "$M/rollback/025_organizations_owner_email_unique.down.sql"
check "R: index supprime (idempotent)" 0 "$(idx $DB)"
if $P -d $DB -f "$M/rollback/026_rls_activity_logs_tenant_policies.down.sql" >/dev/null 2>&1; then check "R: 026 down sans confirmation refuse" refuse accepte; else check "R: 026 down sans confirmation refuse" refuse refuse; fi
check "R: policies toujours 4 apres refus" 4 "$(npol $DB)"
$P -d $DB -v confirm_pre_state_no_policies=yes -f "$M/rollback/026_rls_activity_logs_tenant_policies.down.sql"
$P -d $DB -v confirm_pre_state_no_policies=yes -f "$M/rollback/026_rls_activity_logs_tenant_policies.down.sql"
check "R: 026 down -> 0 policy (idempotent)" 0 "$(npol $DB)"
check "R: etat RLS initial restaure" "$RLS0" "$($P -d $DB -c "select relrowsecurity::text||relforcerowsecurity::text from pg_class where oid='activity_logs'::regclass")"
check "R: donnees inchangees depuis 026" "$C1" "$(cksum_ $DB)"
$P -d $DB -v confirm_pre_state_no_policies=yes -v rls=on -v force=off -f "$M/rollback/026_rls_activity_logs_tenant_policies.down.sql"
check "R: variante force=off" "tf" "$($P -d $DB -c "select case when relrowsecurity then 't' else 'f' end||case when relforcerowsecurity then 't' else 'f' end from pg_class where oid='activity_logs'::regclass")"

echo "== Restauration depuis pg_dump (sur base vide du meme schema) =="
DB2=rb_restore; mk $DB2; $P -d $DB2 -c "truncate organizations, activity_logs cascade"
pg_restore -d $DB2 --data-only --disable-triggers "$BK/bk.dump" 2>&1 | sed 's/^/    /' || true
check "S: restauration = donnees d'avant migration" "$C0" "$(cksum_ $DB2)"
echo "-- restauration depuis tables bak_ (suppression accidentelle simulee)"
$P -d $DB -c "truncate activity_logs"; $P -d $DB -c "insert into activity_logs select * from bak_activity_logs_20261108"
check "S: restauration SQL de repli (activity_logs)" "${C0#*:}" "$(cksum_ $DB | cut -d: -f2)"
rm -rf "$BK"
for d in rb_dups rb_clean rb_restore; do $P -d postgres -c "DROP DATABASE IF EXISTS $d"; done
echo; echo "Resultat : $ok OK, $ko echec(s)"; [ "$ko" = 0 ]
