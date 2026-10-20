#!/usr/bin/env bash
# FlowPoint — Run the internal suite, or the HTTP suite when explicitly requested.
# Usage:
#   ./run-tests.sh
#   TEST_BASE_URL=https://your-api.com TEST_AUTH_TOKEN=<token> ./run-tests.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Keep the existing curl-based HTTP capability explicit and opt-in.  The
# internal Vitest suite remains the default and does not require a live server.
if [[ -n "${TEST_BASE_URL:-}" ]]; then
  exec "$SCRIPT_DIR/integration-tests.sh" "$TEST_BASE_URL" "${TEST_AUTH_TOKEN:-}"
fi

cd "$SCRIPT_DIR"
exec pnpm --filter @workspace/api-server test "$@"
