# Marketing staging security report

Scan date: 2026-11-21

## Scope

The staging application is isolated under `marketing/`. This report separates
findings in that application from findings in the existing SaaS base and other
workspace checkouts. No SaaS or `flowpoint-promotion` files are included in the
marketing subproject.

## Marketing dependency checks

- `pnpm audit --audit-level=high`: no known vulnerabilities.
- `pnpm audit --prod --audit-level=high`: no known vulnerabilities.
- The marketing dependency tree resolves `body-parser` to `2.4.0`, Vite to
  `7.3.7` (development only), and Zod to `4.6.7`. `uuid` is not in the marketing
  dependency tree.
- The marketing package no longer includes SaaS payment, MongoDB, or
  authentication dependencies.

## Inherited workspace findings

The Replit workspace scanners cover multiple checkouts, not only the marketing
deployment. The existing SaaS root lockfile on the `Test-Replit` base contains
these four high-severity dependency findings; that lockfile was not changed:

| Package in SaaS base | Reported version | Available fixed version | Marketing status |
| --- | --- | --- | --- |
| `body-parser` | `2.3.0` | `2.4.0` | Resolves to `2.4.0` |
| `uuid` | `8.3.2` | `11.1.1` | Not present |
| `vite` | `8.1.5` | `8.1.6` | `7.3.7`, development only |
| `zod` | `3.25.76` | `4.6.6` | Resolves to `4.6.7` |

The workspace dependency scan reports 32 high, 48 moderate, and 5 low findings
across its checkouts; it reports no critical dependency findings. Those totals
must not be read as findings in `marketing/`.

HoundDog reports two critical token-storage findings in
`flowpoint-promotion/tools/test-onboarding-browser.mjs`. That directory is not
part of the marketing subproject or the candidate branch contents.

## Static analysis limitation

The workspace SAST scan returned zero findings but marked the scan incomplete.
This is recorded as incomplete, not as a clean SAST pass. The workspace-wide
scan did not identify a SAST finding in the marketing files.

## Release boundary

The marketing-only `pnpm` audits reported no known vulnerabilities, and the
marketing security tests cover same-origin enforcement and contact-field
escaping. The inherited SaaS findings remain unchanged and outside the
marketing dependency tree. No security finding was detected in the marketing
dependency audit or the marketing-specific security tests.
