#!/usr/bin/env bash
# FlowPoint — Run full test suite against a live server
# Usage: TEST_BASE_URL=https://your-api.com TEST_AUTH_TOKEN=<token> ADMIN_KEY=<key> ./scripts/run-tests.sh
set -euo pipefail

BASE_URL="${TEST_BASE_URL:-http://localhost:8080}"
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║          FlowPoint — Test Suite                          ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Target: $BASE_URL"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Check server reachability (health is at /api/healthz)
if ! curl -s "$BASE_URL/api/healthz" | grep -q '"status"'; then
  echo "❌  ERROR: Server not reachable at $BASE_URL"
  echo "    Start the server and retry."
  exit 1
fi
echo "✅  Server reachable at $BASE_URL"
echo ""

PASS=0
FAIL=0
SKIP=0

run_test_file() {
  local file="$1"
  local name
  name=$(basename "$file" .test.ts)
  echo "▶  Running $name tests..."

  if TEST_BASE_URL="$BASE_URL" \
     TEST_AUTH_TOKEN="${TEST_AUTH_TOKEN:-}" \
     ADMIN_KEY="${ADMIN_KEY:-}" \
     node --import tsx/esm --test "$file" 2>&1; then
    echo "  ✅ $name — PASSED"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name — FAILED"
    FAIL=$((FAIL + 1))
  fi
  echo ""
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$SCRIPT_DIR/../src/__tests__"

for f in "$TEST_DIR"/*.test.ts; do
  run_test_file "$f"
done

echo "══════════════════════════════════════════════════════════"
echo "  Results:  ✅ $PASS passed  ❌ $FAIL failed  ⏭ $SKIP skipped"
echo "══════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
