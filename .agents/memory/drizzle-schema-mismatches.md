---
name: Drizzle schema vs actual DB mismatches
description: 4 Drizzle table schemas did not match actual DB columns — caused silent INSERT failures and runtime SELECT errors
---

## The rule
Always verify Drizzle schema matches actual DB columns before shipping. Mismatches cause:
- Silent INSERT failures (Drizzle includes `created_at = NOW()` for `.defaultNow()` even if column absent)
- Runtime SELECT errors swallowed by catch blocks → empty responses

## Tables fixed (Wave 4 Lot 4B-S)
- `behaviorSessionsTable`: had `createdAt (created_at)` — not in DB; removed. DB has `startedAt/endedAt/exitPage`
- `behaviorSiteTokensTable`: had `id/siteSecret/active` — not in DB; removed
- `croScoresTable`: `score` → `overallScore (overall_score)`. DB also has `issues` column
- `croExperimentsTable`: had `type` (doesn't exist in DB); `controlVariant/testVariant` → `variantA/variantB`
- `revenueLeaksTable`: `type` → `leakType`, `severity` absent, `estimatedLoss` → `estimatedMonthlyLoss`, `created_at` absent, DB has `detected_at/page/impactScore/fixDifficultyMin/quickFix/metadata`

**Why:** Drizzle `.defaultNow()` inserts the column in the SQL even when value isn't explicitly set, causing "column does not exist" errors. Silent catch blocks in services return 200/201 masking the failure.

**How to apply:** Before any new service, run `SELECT column_name FROM information_schema.columns WHERE table_name='...'` and compare to Drizzle schema field by field.
