#!/usr/bin/env bash
# Instance AI Lab de TEST, isolee et jetable : vrai code du moteur d'acquisition, Postgres local,
# aucun service paye, aucune donnee reelle. Usage : local-ailab.sh <chemin du depot flowpoint-acquisition-engine>
# Ecrit dans $OUT (defaut /tmp/ailab-cert) : fp_lid et secret (chmod 600, jamais affiches) et env.sh a sourcer.
set -euo pipefail
ENGINE="${1:?chemin du moteur}"; OUT="${OUT:-/tmp/ailab-cert}"; PORT_PG=55432; PORT_WEB=58080
PGBIN=/usr/lib/postgresql/16/bin
pkill -f "gunicorn src.dashboard" 2>/dev/null || true
su postgres -c "$PGBIN/pg_ctl -D $OUT/pg/data stop -m fast" >/dev/null 2>&1 || true
rm -rf "$OUT"; mkdir -p "$OUT/pg"; chown postgres "$OUT/pg"; chmod 755 "$OUT"
su postgres -c "$PGBIN/initdb -D $OUT/pg/data -A trust >/dev/null && $PGBIN/pg_ctl -D $OUT/pg/data -o '-p $PORT_PG -k $OUT/pg' -l $OUT/pg/log -w start >/dev/null"
for db in flowpoint_acquisition saas_cert; do su postgres -c "psql -q -h $OUT/pg -p $PORT_PG -c 'create database $db' postgres"; done
python3 -m venv "$OUT/venv" && "$OUT/venv/bin/pip" -q install -r "$ENGINE/requirements-dashboard.txt" >/dev/null 2>&1
ACQ="postgresql://postgres@127.0.0.1:$PORT_PG/flowpoint_acquisition"
# Le prospect synthetique est cree par le mecanisme existant (Store.upsert + fp_lid_for) : le validateur reste intact.
HERE="$(cd "$(dirname "$0")" && pwd)"
(cd "$ENGINE" && PYTHONPATH="$ENGINE" DATABASE_URL="$ACQ" "$OUT/venv/bin/python" "$HERE/mint-synthetic-prospect.py" "$OUT/fplid")
openssl rand -hex 24 > "$OUT/secret"; chmod 600 "$OUT/fplid" "$OUT/secret"
(cd "$ENGINE" && DATABASE_URL="$ACQ" CONVERSION_EVENT_SECRET="$(cat $OUT/secret)" nohup "$OUT/venv/bin/gunicorn" src.dashboard:app --bind 127.0.0.1:$PORT_WEB --workers 1 --threads 2 --timeout 30 >"$OUT/dashboard.log" 2>&1 &)
for i in $(seq 1 20); do curl -s -o /dev/null "http://127.0.0.1:$PORT_WEB/events/conversion" -X POST && break; sleep 1; done
cat > "$OUT/env.sh" <<ENV
export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT_PG/saas_cert"
export AI_LAB_VERIFY_DATABASE_URL="$ACQ"
export AI_LAB_CONVERSION_URL="http://127.0.0.1:$PORT_WEB/events/conversion"
export CONVERSION_EVENT_SECRET="\$(cat $OUT/secret)"
export CERT_FP_LID="\$(cat $OUT/fplid)"
ENV
echo "pret : source $OUT/env.sh && npx tsx tools/certification-conversion/real-ailab.ts"
