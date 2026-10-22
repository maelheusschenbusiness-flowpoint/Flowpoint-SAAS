# AI Workspace Launch — scheduled-report implementation proposal

## Entitlement boundary

AI Workspace Launch must not create or execute an automation workflow unless the organization has the existing `aiWorkflows` entitlement. Automation routes already require it, and the scheduled-workflow runner rechecks the entitlement before every run. Keep both protections. Do not infer `aiWorkflows` from `aiWorkspaceLaunch`, and do not change either gate, plan access, or activation.

## What exists today

- Agency Reporting Packs creates and verifies three persisted reports in one organization-scoped transaction.
- AI Executive Reporting can generate and persist an on-demand report, subject to its existing add-on and report/AI quotas.
- The scheduler supports cron expressions and IANA timezones, with duplicate-run claims, recovery, and an entitlement check.
- The `generate_report` automation action consumes AI quota and sends an email, but currently does not persist a `reports` record or enforce the report quota.

## Proposed implementation

1. Make report scheduling an explicit opt-in after AI Workspace Launch succeeds; do not schedule during onboarding by default.
2. Offer a weekly schedule in the organization’s chosen IANA timezone and persist it as an `automation_workflows` record using the existing workflow scheduler.
3. Use a dedicated schedule endpoint guarded by both `aiWorkspaceLaunch` and `aiWorkflows`. It must verify the session belongs to the organization and return the persisted workflow only after reading it back.
4. Make the existing `generate_report` action persist a tenant-scoped `reports` row, enforce the existing report and AI quotas, and use a stable run/action idempotency key so scheduler recovery cannot create duplicate reports.
5. Send the report link only after persistence succeeds. A missing audit, exhausted quota, missing recipient, or failed AI generation must produce an explicit failed run—not a successful zero-report run.
6. Return and display `reportsScheduled: 1` only after the workflow is confirmed in storage. Otherwise keep it at zero and explain that `aiWorkflows` access is required.

## Release proof required

Keep `reportsScheduled` at zero until the persisted schedule, due execution, stored report, email link, duplicate recovery, and entitlement-loss behavior are verified. `aiWorkflows` is currently unavailable for purchase; this implementation proposal does not change that status.
