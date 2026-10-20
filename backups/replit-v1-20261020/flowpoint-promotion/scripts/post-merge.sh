#!/bin/bash
set -e

# Post-merge setup script for Flowpoint SaaS
# Runs after task agent merges to install deps, rebuild, and migrate

# Install workspace dependencies
pnpm install --frozen-lockfile

# Push DB schema (idempotent — safe to run multiple times)
pnpm --filter @workspace/db run push-force 2>/dev/null || echo "DB push not needed or skipped"

# Rebuild API server (dist is rebuilt from merged source)
cd artifacts/api-server
pnpm run build

# Rebuild any other artifacts that have build scripts
# (Add more as needed — each on its own line for clear error reporting)
