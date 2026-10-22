# AI Workspace Launch — scheduled reports dependency

## Decision boundary

AI Workspace Launch must not create or execute an automation workflow unless the organization has the existing `aiWorkflows` entitlement. The current automation API and scheduler are guarded by that entitlement; changing the guard, granting the entitlement implicitly, or changing plan access is out of scope.

## What exists today

- Agency Reporting Packs creates and verifies three persisted reports in one organization-scoped transaction.
- AI Executive Reporting can generate and persist an on-demand report, subject to its existing add-on and report/AI quotas.
- The `generate_report` automation action consumes the report-generation AI quota and sends an email, but it does not persist a `reports` record.

Neither existing report path provides scheduled report delivery for AI Workspace Launch without depending on `aiWorkflows`. A product decision is required to define whether AWL may use an existing reporting entitlement/scheduler or needs a separately authorized schedule mechanism. Do not claim scheduled reports are configured before that decision and a persisted, end-to-end schedule test.

## Current implementation scope

Keep `reportsScheduled` at zero and AI Workspace Launch marked “Bientôt”. The next eligible existing add-on to verify is Agency Reporting Packs, which has its own entitlement gate and no new external-service dependency; its creation flow must refresh and confirm the persisted reports in the existing Reports view.
