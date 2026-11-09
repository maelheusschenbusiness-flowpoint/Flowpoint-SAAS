#!/usr/bin/env bash
# Base PostgreSQL JETABLE pour la certification navigateur.
#
#   pg-jetable.sh start   -> initialise (si besoin) et demarre un cluster local, puis cree la base,
#                            les roles Supabase factices, applique la migration du depot et les droits
#   pg-jetable.sh stop    -> arrete le cluster
#   pg-jetable.sh destroy -> arrete et supprime le repertoire de donnees
#   pg-jetable.sh url     -> affiche DATABASE_URL
#
# JAMAIS une base distante : le cluster ecoute uniquement 127.0.0.1 sur un port local et vit dans un
# repertoire temporaire. Aucune variable DATABASE_URL existante n'est lue ni modifiee.
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGROOT="${FP_CERT_PGROOT:-/tmp/fp-cert-pg}"
# Port : FP_CERT_PGPORT, sinon celui memorise lors d'un demarrage precedent, sinon un port libre.
if [ -n "${FP_CERT_PGPORT:-}" ]; then PGPORT="$FP_CERT_PGPORT"
elif [ -f "$PGROOT/port" ]; then PGPORT="$(cat "$PGROOT/port")"
else PGPORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
fi
DB_NAME="flowpoint_cert"
DB_USER="flowpoint_cert"
URL="postgresql://${DB_USER}:${DB_USER}@127.0.0.1:${PGPORT}/${DB_NAME}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$HERE/../../../.." && pwd)"

as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

cmd="${1:-url}"
case "$cmd" in
  url) echo "$URL" ;;
  start)
    [ -x "$PGBIN/postgres" ] || { echo "PostgreSQL introuvable (apt-get install -y postgresql)" >&2; exit 1; }
    mkdir -p "$PGROOT"; echo "$PGPORT" > "$PGROOT/port"
    [ "$(id -u)" = "0" ] && chown postgres:postgres "$PGROOT" || true
    if [ ! -d "$PGROOT/data" ]; then
      as_pg "$PGBIN/initdb" -D "$PGROOT/data" -A trust -E UTF8 --no-sync >/dev/null
    fi
    if ! as_pg "$PGBIN/pg_ctl" -D "$PGROOT/data" status >/dev/null 2>&1; then
      as_pg "$PGBIN/pg_ctl" -D "$PGROOT/data" -l "$PGROOT/pg.log" -w \
        -o "-p $PGPORT -k $PGROOT -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" start >/dev/null
    fi
    PSQL_SU=("$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q)
    # Le compte applicatif est super-utilisateur, comme POSTGRES_USER du conteneur de la CI : il contourne la RLS
    # (les 539 policies sont verifiees ailleurs, par les tests vitest d'isolation). Local uniquement.
    as_pg "${PSQL_SU[@]}" -d postgres -c "SELECT 1" >/dev/null 2>&1 || as_pg "$PGBIN/psql" -h "$PGROOT" -p "$PGPORT" -d postgres -c "CREATE ROLE postgres SUPERUSER LOGIN" >/dev/null 2>&1 || true
    PSQL=("$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q)
    as_pg "${PSQL[@]}" -d postgres <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}') THEN CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_USER}' SUPERUSER; END IF;
  ALTER ROLE ${DB_USER} SUPERUSER;
END \$\$;
SQL
    as_pg "${PSQL[@]}" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
      || as_pg "${PSQL[@]}" -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
    # Roles Supabase factices (comme .github/workflows/ci.yml).
    as_pg "${PSQL[@]}" -d "$DB_NAME" <<'SQL'
DO $$ DECLARE r text; BEGIN
  FOR r IN SELECT unnest(ARRAY['app_user','anon','authenticated','service_role','authenticator','supabase_admin']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP; END $$;
SQL
    # Migration DU DEPOT depuis zero (comme la CI), seulement si le schema est absent.
    HAS="$(as_pg "${PSQL[@]}" -d "$DB_NAME" -tAc "SELECT to_regclass('public.organizations') IS NOT NULL")"
    if [ "$HAS" != "t" ]; then
      ( cd "$API_DIR" && DATABASE_URL="$URL" NODE_ENV=test pnpm run migrate >"$PGROOT/migrate.log" 2>&1 ) \
        || { echo "Migration en echec, voir $PGROOT/migrate.log" >&2; tail -20 "$PGROOT/migrate.log" >&2; exit 1; }
    fi
    as_pg "${PSQL[@]}" -d "$DB_NAME" <<'SQL'
DO $$ DECLARE r text; BEGIN
  FOR r IN SELECT unnest(ARRAY['app_user','anon','authenticated','service_role']) LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA public TO %I', r);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO %I', r);
  END LOOP; END $$;
SQL
    echo "$URL"
    ;;
  stop)    as_pg "$PGBIN/pg_ctl" -D "$PGROOT/data" -m fast stop >/dev/null 2>&1 || true ;;
  destroy) as_pg "$PGBIN/pg_ctl" -D "$PGROOT/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$PGROOT" ;;
  *) echo "usage: $0 start|stop|destroy|url" >&2; exit 2 ;;
esac
