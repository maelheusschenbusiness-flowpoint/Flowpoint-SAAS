#!/usr/bin/env bash
# FlowPoint — Integration test suite (curl-based, no dependencies)
# Usage: ./scripts/integration-tests.sh [BASE_URL] [AUTH_TOKEN]
# Example: ./scripts/integration-tests.sh https://api.flowpoint.pro tok_xxx
set -uo pipefail

BASE="${1:-http://localhost:8080}"
TOKEN="${2:-${TEST_AUTH_TOKEN:-}}"

PASS=0; FAIL=0; SKIP=0
ERRORS=()

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'; BOLD='\033[1m'

header() { echo -e "\n${BOLD}▶ $1${NC}"; }
pass()   { echo -e "  ${GREEN}✅ $1${NC}"; PASS=$((PASS+1)); }
fail()   { echo -e "  ${RED}❌ $1${NC}"; FAIL=$((FAIL+1)); ERRORS+=("$1"); }
skip()   { echo -e "  ${YELLOW}⏭ $1${NC}"; SKIP=$((SKIP+1)); }

# curl returning HTTP status code — note: use -s NOT -sf (-f causes exit on 4xx and breaks || logic)
c_status() { curl -s -o /dev/null -w "%{http_code}" "$@" 2>/dev/null; }
c_body()   { curl -s "$@" 2>/dev/null; }
json_get() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',''))" 2>/dev/null || echo ""; }

expect_status() {
  local desc="$1"; shift; local expected="$1"; shift; local actual="$1"; shift
  if echo "$expected" | grep -qw "$actual"; then
    pass "$desc (HTTP $actual)"
  else
    fail "$desc — expected [$expected], got $actual"
  fi
}

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       FlowPoint — Integration Test Suite                 ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║  Target : $BASE"
echo -e "${BOLD}║  Auth   : ${TOKEN:+present (Bearer)}${TOKEN:-none (unauthenticated)}${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"

AUTH_HEADER=(-H "Authorization: Bearer $TOKEN")
JSON_HEADER=(-H "Content-Type: application/json")

# ── 1. Health ─────────────────────────────────────────────────────────────────
header "1. Health endpoints"

S=$(c_status "$BASE/api/healthz")
expect_status "GET /api/healthz → 200" "200" "$S"

HEALTH=$(c_body "$BASE/api/healthz")
STATUS_FIELD=$(json_get "$HEALTH" "status")
[ "$STATUS_FIELD" = "ok" ] && pass "  /api/healthz status=ok" || fail "  /api/healthz missing status=ok (got: $STATUS_FIELD)"

S=$(c_status "$BASE/api/healthz/deep")
expect_status "GET /api/healthz/deep → 200 or 503" "200 503" "$S"

# ── 2. Auth input validation ──────────────────────────────────────────────────
header "2. Auth input validation"
# Note: 429 is also accepted here — it means the rate limiter is active (correct behaviour).

S=$(c_status "${JSON_HEADER[@]}" -d '{}' -X POST "$BASE/api/auth/login-request")
expect_status "POST /auth/login-request empty body → 400 (or 429=rate-limited)" "400 429" "$S"

S=$(c_status "${JSON_HEADER[@]}" -d '{"email":"notanemail"}' -X POST "$BASE/api/auth/login-request")
expect_status "POST /auth/login-request bad email → 400 (or 429=rate-limited)" "400 429" "$S"

S=$(c_status "${JSON_HEADER[@]}" -d '{"email":"valid@example.com"}' -X POST "$BASE/api/auth/login-request")
expect_status "POST /auth/login-request valid email → 200 (or 429=rate-limited)" "200 429" "$S"

S=$(c_status "${JSON_HEADER[@]}" -d '{}' -X POST "$BASE/api/auth/register")
expect_status "POST /auth/register empty body → 400 (or 429=rate-limited)" "400 429" "$S"

# ── 3. Auth rate limiting ─────────────────────────────────────────────────────
header "3. Auth brute-force rate limiting"
# Note: rate limit window = 10 req/15 min per IP.
# Send 12 bursts on a unique email pattern to detect 429.
GOT_429=0
for i in $(seq 1 12); do
  S=$(c_status "${JSON_HEADER[@]}" -d "{\"email\":\"burst${i}@rl-test.invalid\"}" -X POST "$BASE/api/auth/login-request")
  [ "$S" = "429" ] && GOT_429=1 && break
done
[ "$GOT_429" = "1" ] && pass "Auth rate limiter triggers 429 within 12 requests" || fail "Auth rate limiter did NOT trigger — check authRateLimit middleware on /auth/login-request"

# ── 4. SSRF validation (auth-gated) ──────────────────────────────────────────
header "4. SSRF validation on pagespeed endpoints"
# Pagespeed routes require auth → unauthenticated requests get 401 before URL validation.
# This is the CORRECT behavior (auth runs first). Test confirms no 500 / no SSRF bypass.
for target in "http://localhost" "http://127.0.0.1:5432" "http://10.0.0.1" "http://192.168.1.1" "http://169.254.169.254/metadata"; do
  S=$(c_status "${JSON_HEADER[@]}" -d "{\"url\":\"$target\"}" -X POST "$BASE/api/pagespeed/analyze")
  expect_status "Pagespeed rejects $target (400=SSRF blocked, 401=auth required)" "400 401" "$S"
done

if [ -n "$TOKEN" ]; then
  for target in "http://localhost/admin" "http://127.0.0.1:6379"; do
    S=$(c_status "${AUTH_HEADER[@]}" "${JSON_HEADER[@]}" -d "{\"url\":\"$target\"}" -X POST "$BASE/api/pagespeed/analyze")
    expect_status "Authenticated SSRF blocked: $target → 400" "400" "$S"
  done
else
  skip "SSRF with-auth tests require TEST_AUTH_TOKEN — skipped"
fi

# ── 5. Protected routes require auth ─────────────────────────────────────────
header "5. Protected routes reject unauthenticated requests"
for path in /api/overview /api/competitors /api/automation/workflows /api/reports /api/monitors /api/billing/status; do
  S=$(c_status "$BASE$path")
  expect_status "GET $path → 401 (unauthenticated)" "401" "$S"
done

# ── 6. No mock data leaking (unauthenticated overview is just 401) ────────────
header "6. Mock data isolation"

if [ -n "$TOKEN" ]; then
  OVERVIEW=$(c_body "${AUTH_HEADER[@]}" "$BASE/api/overview")
  COMPUTED_AT=$(json_get "$OVERVIEW" "computedAt")
  [ -n "$COMPUTED_AT" ] && pass "  /api/overview has computedAt (real data path)" || fail "  /api/overview missing computedAt"

  COMP=$(c_body "${AUTH_HEADER[@]}" "$BASE/api/competitors")
  CONC_A=$(echo "$COMP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = d if isinstance(d, list) else d.get('competitors', [])
print(any('Concurrent A' in str(x.get('name','')) for x in items))
" 2>/dev/null || echo "False")
  [ "$CONC_A" = "False" ] && pass "  /api/competitors: no hardcoded 'Concurrent A'" || fail "  /api/competitors returned hardcoded mock"

  AUTO=$(c_body "${AUTH_HEADER[@]}" "$BASE/api/automation/workflows")
  HAS_FAKE=$(echo "$AUTO" | python3 -c "
import sys, json
d = json.load(sys.stdin)
wfs = d if isinstance(d, list) else d.get('workflows', [])
print(any(w.get('runsCount', 0) in [12, 8, 6, 5, 3] for w in wfs))
" 2>/dev/null || echo "False")
  [ "$HAS_FAKE" = "False" ] && pass "  /api/automation/workflows: no fake runsCount (12/8/6/5/3)" || fail "  /api/automation/workflows has hardcoded runsCount"
else
  skip "Mock data checks require TEST_AUTH_TOKEN — skipped"
fi

# ── 7. Billing safety ─────────────────────────────────────────────────────────
header "7. Billing endpoint safety"

S=$(c_status "${JSON_HEADER[@]}" -d '{"plan":"pro"}' -X POST "$BASE/api/billing/checkout")
expect_status "POST /billing/checkout unauthenticated → 401" "401" "$S"

S=$(c_status "$BASE/api/billing/status")
expect_status "GET /billing/status unauthenticated → 401" "401" "$S"

# ── 8. Input validation — key write endpoints ─────────────────────────────────
header "8. Input validation on write endpoints"

S=$(c_status "${JSON_HEADER[@]}" -d '{"name":"test"}' -X POST "$BASE/api/monitors")
expect_status "POST /monitors without URL → 400/401" "400 401" "$S"

S=$(c_status "${JSON_HEADER[@]}" -d '{}' -X POST "$BASE/api/audits")
expect_status "POST /audits empty → 400/401" "400 401" "$S"

S=$(c_status "${JSON_HEADER[@]}" -d '{}' -X POST "$BASE/api/keywords")
expect_status "POST /keywords empty → 400/401" "400 401" "$S"

# ── 9. No 500 on common paths ─────────────────────────────────────────────────
header "9. No 500 errors on public endpoints"

for path in /api/healthz /api/billing/status; do
  S=$(c_status "$BASE$path")
  if [ "$S" = "500" ]; then
    fail "$path returned 500"
  else
    pass "$path no 500 (got $S)"
  fi
done
# /api/auth/login-request may return 429 if rate-limited — both are correct
S=$(c_status "${JSON_HEADER[@]}" -d '{"email":"no500@test.com"}' -X POST "$BASE/api/auth/login-request")
[ "$S" = "500" ] && fail "/api/auth/login-request returned 500" || pass "/api/auth/login-request no 500 (got $S)"

# ── SUMMARY ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL + SKIP))
echo -e "${BOLD}  Results: ${GREEN}✅ $PASS passed${NC}  ${RED}❌ $FAIL failed${NC}  ${YELLOW}⏭ $SKIP skipped${NC}  — $TOTAL total${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"

if [ "${#ERRORS[@]}" -gt 0 ]; then
  echo ""
  echo -e "${RED}Failed checks:${NC}"
  for e in "${ERRORS[@]}"; do echo "  • $e"; done
fi

echo ""
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
