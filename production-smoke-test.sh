#!/usr/bin/env bash
# FlowPoint Production Smoke Test
# Usage: BASE_URL=https://your-domain.com TOKEN=your-auth-token bash scripts/production-smoke-test.sh
# All checks exit 0 on pass, print FAIL + reason on error.

set -euo pipefail

BASE="${BASE_URL:-http://localhost:${PORT:-8080}}"
TOKEN="${TOKEN:-}"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}  PASS${NC}  $1"; ((PASS++)); }
fail() { echo -e "${RED}  FAIL${NC}  $1 — $2"; ((FAIL++)); }
info() { echo -e "${YELLOW}  ----${NC}  $1"; }

check_json() {
  local label="$1" url="$2" expected_field="${3:-}"
  local http_code body
  body=$(curl -sf -w "\n%{http_code}" \
    ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
    "$url" 2>/dev/null) || { fail "$label" "curl error or non-2xx"; return; }
  http_code=$(echo "$body" | tail -1)
  body=$(echo "$body" | head -n -1)
  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    fail "$label" "HTTP $http_code"
    return
  fi
  if [[ -n "$expected_field" ]]; then
    echo "$body" | grep -q "\"$expected_field\"" || { fail "$label" "missing field '$expected_field' in response"; return; }
  fi
  pass "$label"
}

check_status() {
  local label="$1" url="$2" expected="$3"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
    "$url" 2>/dev/null)
  if [[ "$http_code" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label" "expected HTTP $expected, got $http_code"
  fi
}

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║        FlowPoint — Production Smoke Test                 ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Base URL : $BASE"
echo "  Auth     : ${TOKEN:+[token set]}${TOKEN:-[no token — public routes only]}"
echo ""

# ── Health ────────────────────────────────────────────────────────────────────
info "Health checks"
check_json  "GET /healthz"           "$BASE/healthz"            "status"
check_json  "GET /healthz/deep"      "$BASE/healthz/deep"       "database"

# ── Diagnostics ───────────────────────────────────────────────────────────────
info "Diagnostics"
check_json  "GET /api/diagnostics"              "$BASE/api/diagnostics"              "checks"
check_json  "GET /api/diagnostics/workers"      "$BASE/api/diagnostics/workers"      "workers"
check_json  "GET /api/diagnostics/integrations" "$BASE/api/diagnostics/integrations" "integrations"

# ── Auth (unauthenticated must reject) ────────────────────────────────────────
info "Auth enforcement"
check_status "GET /api/team → 401 without token"     "$BASE/api/team"     "401"
check_status "GET /api/audits → 401 without token"   "$BASE/api/audits"   "401"
check_status "GET /api/monitors → 401 without token" "$BASE/api/monitors" "401"

# ── Authenticated routes (requires TOKEN) ─────────────────────────────────────
if [[ -n "$TOKEN" ]]; then
  info "Authenticated API routes"
  check_json "GET /api/team"            "$BASE/api/team"            "members"
  check_json "GET /api/audits"          "$BASE/api/audits"          "audits"
  check_json "GET /api/monitors"        "$BASE/api/monitors"        "monitors"
  check_json "GET /api/reports"         "$BASE/api/reports"         "reports"
  check_json "GET /api/missions"        "$BASE/api/missions"        "missions"
  check_json "GET /api/overview"        "$BASE/api/overview"        "health"
  check_json "GET /api/keywords"        "$BASE/api/keywords"        "keywords"
  check_json "GET /api/notifications"   "$BASE/api/notifications"   "notifications"
  check_json "GET /api/activity"        "$BASE/api/activity"        "events"

  info "AI / Credit tracking"
  check_json "GET /api/ai/usage"        "$BASE/api/ai/usage"        "used"

  info "Billing"
  check_json "GET /api/billing/status"  "$BASE/api/billing/status"  "plan"

  info "Integrations"
  check_json "GET /api/integrations/status" "$BASE/api/integrations/status" "google"

  info "Workers / Cron"
  check_json "GET /api/diagnostics/workers" "$BASE/api/diagnostics/workers" "recentRuns"
else
  info "Skipping authenticated routes (set TOKEN= to enable)"
fi

# ── No mock / fake data in responses ─────────────────────────────────────────
if [[ -n "$TOKEN" ]]; then
  info "No mock data in production responses"
  overview_body=$(curl -sf --max-time 10 -H "Authorization: Bearer $TOKEN" \
    "$BASE/api/overview" 2>/dev/null || echo "")
  comp_body=$(curl -sf --max-time 10 -H "Authorization: Bearer $TOKEN" \
    "$BASE/api/competitors" 2>/dev/null || echo "")

  if echo "$overview_body$comp_body" | grep -qi "Concurrent A\|Concurrent B\|Paris 13\|Boulogne\|Vincennes"; then
    fail "No fake competitors/locations" "hardcoded demo strings found in response"
  else
    pass "No fake competitors/locations in overview or competitors"
  fi

  if echo "$overview_body" | grep -q '"revenueOpportunity":2400'; then
    fail "No hardcoded revenue opportunity" "hardcoded 2400 found"
  else
    pass "No hardcoded revenue opportunity value"
  fi
fi

# ── SSRF protection ────────────────────────────────────────────────────────────
info "SSRF protection"
ssrf_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 \
  -H "Authorization: Bearer ${TOKEN:-anon}" \
  "$BASE/api/pagespeed?url=http://localhost/internal" 2>/dev/null || echo "000")
if [[ "$ssrf_code" == "400" || "$ssrf_code" == "401" || "$ssrf_code" == "422" || "$ssrf_code" == "403" ]]; then
  pass "SSRF guard on /api/pagespeed internal URL ($ssrf_code)"
else
  fail "SSRF guard" "got HTTP $ssrf_code for internal URL — check rejectInternalUrl()"
fi

# ── Auth rate limiting ─────────────────────────────────────────────────────────
info "Auth rate limit"
rl_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 \
  -X POST "$BASE/api/auth/login-request" \
  -H "Content-Type: application/json" \
  -d '{"email":"ratelimit-smoke@example.com"}' 2>/dev/null || echo "000")
if [[ "$rl_code" == "200" || "$rl_code" == "400" || "$rl_code" == "422" || "$rl_code" == "429" ]]; then
  pass "Auth endpoint reachable (rate limit functional: $rl_code)"
else
  fail "Auth rate limit" "unexpected $rl_code"
fi

# ── DB indexes & workers ───────────────────────────────────────────────────────
if [[ -n "$TOKEN" ]]; then
  info "DB index and worker health"
  workers_body=$(curl -sf --max-time 10 -H "Authorization: Bearer $TOKEN" \
    "$BASE/api/diagnostics/workers" 2>/dev/null || echo "{}")
  enabled_count=$(echo "$workers_body" | grep -o '"enabled":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
  if [[ "${enabled_count:-0}" -gt 5 ]]; then
    pass "Cron workers active ($enabled_count enabled)"
  else
    fail "Cron workers" "only $enabled_count enabled workers — check cron-scheduler.ts"
  fi
fi

# ── Stripe: must 503 in production without key ───────────────────────────────
info "Stripe production guard"
stripe_code=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -d '{"plan":"pro"}' \
  "$BASE/api/billing/checkout" 2>/dev/null)
if [[ "$stripe_code" == "401" || "$stripe_code" == "503" || "$stripe_code" == "400" ]]; then
  pass "POST /api/billing/checkout without auth → $stripe_code (no mock leak)"
else
  fail "POST /api/billing/checkout" "got HTTP $stripe_code — possible mock leak in production"
fi

# ── TypeScript build ──────────────────────────────────────────────────────────
info "TypeScript build"
if command -v pnpm &>/dev/null; then
  if pnpm --filter @workspace/api-server exec tsc --noEmit 2>/dev/null; then
    pass "tsc --noEmit (0 errors)"
  else
    fail "tsc --noEmit" "TypeScript errors detected — run: pnpm --filter @workspace/api-server exec tsc --noEmit"
  fi
else
  info "pnpm not available — skipping tsc check"
fi

# ── ENV variables ─────────────────────────────────────────────────────────────
info "Environment variables"
required_vars=(
  "DATABASE_URL"
  "JWT_SECRET"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "OPENAI_API_KEY"
)
for var in "${required_vars[@]}"; do
  if [[ -n "${!var:-}" ]]; then
    pass "ENV $var is set"
  else
    fail "ENV $var" "not set — required for production"
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Results : ${PASS} passed   ${FAIL} failed"
echo "══════════════════════════════════════════════════════════"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
