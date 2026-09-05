#!/bin/bash
set -e

# Post-merge setup script for Flowpoint SaaS
# Runs after task agent merges to install dependencies and rebuild

# Install workspace dependencies
pnpm install --frozen-lockfile

# Rebuild API server (dist is rebuilt from merged source)
cd artifacts/api-server
pnpm run build

# Rebuild any other artifacts that have build scripts
# (Add more as needed — each on its own line for clear error reporting)
