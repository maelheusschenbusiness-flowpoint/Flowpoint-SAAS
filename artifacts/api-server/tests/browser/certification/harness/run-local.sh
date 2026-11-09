#!/usr/bin/env bash
# Demarre (ou arrete) le serveur de certification local.
#   run-local.sh up     -> base jetable + serveur (arriere-plan, PID dans $FP_CERT_DIR/server.pid)
#   run-local.sh down   -> arrete le serveur (la base reste ; "destroy" pour la supprimer)
#   run-local.sh destroy
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$HERE/../../../.." && pwd)"
FP_CERT_DIR="${FP_CERT_DIR:-/tmp/fp-cert-run}"
PORT="${PORT:-4321}"
mkdir -p "$FP_CERT_DIR"

case "${1:-up}" in
  up)
    # Si DATABASE_URL est fournie (CI : service postgres), on l'utilise, a condition qu'elle soit locale.
    if [ -n "${DATABASE_URL:-}" ]; then
      case "$DATABASE_URL" in *@127.0.0.1*|*@localhost*) ;; *) echo "DATABASE_URL non locale : refus." >&2; exit 1;; esac
    else
      DATABASE_URL="$("$HERE/pg-jetable.sh" start | tail -1)"
    fi
    export DATABASE_URL
    export NODE_ENV=test STRIPE_TEST_MODE=true PORT
    export PUBLIC_URL="http://127.0.0.1:$PORT" PUBLIC_BASE_URL="http://127.0.0.1:$PORT"
    export JWT_SECRET="${JWT_SECRET:-cert-jwt-secret-0123456789abcdef0123456789}" SESSION_SECRET="${SESSION_SECRET:-cert-session-secret-0123456789abcdef}"
    export ADMIN_KEY="${ADMIN_KEY:-cert-admin-key-0123456789abcdef0123456789abcd}"
    # Cles de TEST factices : aucune valeur reelle, jamais de cle live.
    export STRIPE_TEST_KEY="sk_test_harness_fake_0000000000" STRIPE_TEST_PUBLISHABLE_KEY="pk_test_harness_fake_0000000000"
    export STRIPE_TEST_WEBHOOK_SECRET="whsec_harness_fake_0000000000"
    export STRIPE_TEST_PRICE_ID_STANDARD="price_fake_standard" STRIPE_TEST_PRICE_ID_PRO="price_fake_pro" STRIPE_TEST_PRICE_ID_ULTRA="price_fake_ultra"
    # E-mails : capture sur disque (hook existant), aucun transport reel.
    export TEST_MAIL_DIR="$FP_CERT_DIR/mails" ENABLE_TEST_MAILER=true
    unset RESEND_API_KEY SMTP_HOST SMTP_PASS STRIPE_SECRET_KEY STRIPE_LIVE_API_KEY STRIPE_PUBLISHABLE_KEY PUBLIC_STRIPE_API_KEY
    # Google : identifiants factices ; les appels sortants sont interceptes par server.ts.
    export GOOGLE_CLIENT_ID="cert-google-client-id.apps.googleusercontent.com" GOOGLE_CLIENT_SECRET="cert-google-secret"
    rm -rf "$TEST_MAIL_DIR"; mkdir -p "$TEST_MAIL_DIR"
    cd "$API_DIR"
    nohup ./node_modules/.bin/tsx "$HERE/server.ts" >"$FP_CERT_DIR/server.log" 2>&1 &
    echo $! > "$FP_CERT_DIR/server.pid"
    for _ in $(seq 1 90); do
      if curl -fsS "http://127.0.0.1:$PORT/__fake/health" >/dev/null 2>&1; then echo "http://127.0.0.1:$PORT"; exit 0; fi
      kill -0 "$(cat "$FP_CERT_DIR/server.pid")" 2>/dev/null || { echo "Le serveur s'est arrete :" >&2; tail -30 "$FP_CERT_DIR/server.log" >&2; exit 1; }
      sleep 1
    done
    echo "Delai depasse au demarrage" >&2; tail -30 "$FP_CERT_DIR/server.log" >&2; exit 1
    ;;
  down)
    [ -f "$FP_CERT_DIR/server.pid" ] && kill "$(cat "$FP_CERT_DIR/server.pid")" 2>/dev/null || true
    rm -f "$FP_CERT_DIR/server.pid" ;;
  destroy) "$0" down; "$HERE/pg-jetable.sh" destroy ;;
esac
