# AI Workspace Launch — scheduled-report behavior

## Entitlement boundary

AI Workspace Launch must not create or execute an automation workflow unless the organization has the existing `aiWorkflows` entitlement. Automation routes already require it, and the scheduled-workflow runner rechecks the entitlement before every run. Keep both protections. Do not infer `aiWorkflows` from `aiWorkspaceLaunch`, and do not change either gate, plan access, or activation.

## What exists today

- Agency Reporting Packs creates and verifies three persisted reports in one organization-scoped transaction.
- AI Executive Reporting can generate and persist an on-demand report, subject to its existing add-on and report/AI quotas.
- The scheduler supports cron expressions and IANA timezones, with duplicate-run claims, recovery, and an entitlement check.
- AI Workspace Launch scheduling is an explicit opt-in. The weekly schedule is persisted in the organization’s IANA timezone.
- The `generate_report` automation action consumes AI and report quotas, persists a tenant-scoped `reports` row, and uses idempotent run/action handling.

## Current delivery limit

- Scheduled reports are saved in FlowPoint’s Reports list; the workflow does not send email or Slack.
- Both add-on entitlements remain required when a schedule is created and when it runs. `aiWorkflows` remains unavailable for purchase.
- Do not advertise scheduled email delivery or change either entitlement gate until delivery is implemented and verified.

## Existing verification

- `automation-service-awl-report-postgres.test.ts` covers both missing-entitlement cases, report/AI quota failures, tenant isolation, and weekly schedule persistence/disable behavior.
- Email or Slack delivery is not covered because it is not implemented.
