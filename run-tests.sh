#!/usr/bin/env bash
# Run the configured self-contained API regression suite from any directory.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"
exec pnpm --filter @workspace/api-server test "$@"
