---
name: Clean reset AI schema bootstrap
description: A clean database reset must create AI billing tables before running self-healing ALTERs or the startup migration aborts.
---

## Rule
The bootstrap path must create `ai_usage_logs`, `ai_monthly_usage`, and `ai_credit_purchases` before any ALTER or strict AI migration verifies them.

**Why:** These tables were previously assumed to come from a legacy schema. After a full reset, swallowed ALTER warnings left them absent and the server exited during the strict `ai_usage_logs` migration.

**How to apply:** Keep the base CREATE TABLE statements in the idempotent data-table initializer, then let the AI migration add columns, RLS policies, indexes, and contract checks.