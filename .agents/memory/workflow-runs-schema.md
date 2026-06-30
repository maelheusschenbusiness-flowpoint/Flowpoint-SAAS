---
name: workflow_runs schema gaps
description: workflow_runs needs 4 extra columns that automation-service.ts reads/writes
---

**Rule:** init-automation.ts must ADD COLUMN IF NOT EXISTS for: ended_at, duration_ms, steps_completed, steps_failed.

**Why:** automation-service.ts uses these in both SELECT (getWorkflowsData) and UPDATE (success/failure paths). The original CREATE TABLE only has: id, workflow_id, status, started_at, completed_at, error, output. Missing columns → "column does not exist" on every call to /api/automation/workflows.

**How to apply:** Already patched in init-automation.ts ALTER TABLE block (runs at startup). Any new columns used by automation-service.ts must be added here with DEFAULT values.
