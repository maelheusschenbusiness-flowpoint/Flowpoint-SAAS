#!/usr/bin/env bash
# Verification SQL en LECTURE SEULE apres un parcours Stripe TEST.
#   DATABASE_URL_VERIF=postgresql://... ./verifier-base.sh <email-d-essai> <sub_xxx> [seti_xxx]
# Refuse : le projet Supabase de PRODUCTION (sejbsuuaeokyuxuoaxzd) et tout hote qui n'est ni local ni le projet de test
# (rrjllaiodpvtsphrtdqd). Impose default_transaction_read_only=on. N'affiche jamais l'URL.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMAIL="${1:?usage: verifier-base.sh <email> <stripe_subscription_id>}"
SUB="${2:?usage: verifier-base.sh <email> <stripe_subscription_id> [seti_xxx]}"
SETI="${3:-none}"
URL="${DATABASE_URL_VERIF:?DATABASE_URL_VERIF requise (base jetable locale ou projet Supabase de test)}"
case "$URL" in *sejbsuuaeokyuxuoaxzd*) echo "REFUS : cette URL designe le projet de PRODUCTION." >&2; exit 2;; esac
case "$URL" in
  *@127.0.0.1[:/]*|*@localhost[:/]*|*rrjllaiodpvtsphrtdqd*) ;;
  *) echo "REFUS : base ni locale ni « Flowpoint test » (rrjllaiodpvtsphrtdqd)." >&2; exit 2;;
esac
export PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on"
exec psql "$URL" -X -v ON_ERROR_STOP=1 -v "email=$EMAIL" -v "stripe_sub=$SUB" -v "seti=$SETI" -P pager=off -f "$HERE/sql/verification-lecture-seule.sql"
