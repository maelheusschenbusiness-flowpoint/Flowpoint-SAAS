---
name: SSO API normalization pattern
description: providers_catalog is string[], stats fields mismatch, recentLogins alias — must normalize in renderSettingsSSO
---

## Rule
`/api/sso` returns data with mismatched field names vs what the dashboard expects. Always normalize in `renderSettingsSSO()` before use.

## Mismatches (API key → code expects)
- `providers_catalog`: `string[]` (e.g. `["google_workspace","okta"]`) → must map via `CATALOG_META` lookup to `{id,name,protocol,plan,icon,roadmap}` objects
- `stats.providers` → `totalProviders` (code expects `totalProviders`)
- `stats.*` missing: `activeProviders`, `activeSessions`, `suspiciousLogins` — derive: `activeProviders = providers.filter(p=>p.enabled!==false).length`
- `recentLogins` → `login_audits` (code used `ssoData.login_audits` but API returns `ssoData.recentLogins`)
- `active_sessions`: not returned by API — defaults to `[]`

## CATALOG_META lookup (canonical IDs)
google_workspace, github, auth0, microsoft_azure, azure_ad, okta, onelogin, saml, saml_generic

## Why
API schema diverged from dashboard rendering expectations. The normalization block in `renderSettingsSSO()` bridges the gap without changing the backend.

## How to apply
Whenever touching `renderSettingsSSO`, keep the normalization block at the top (rawStats → stats, rawCatalog → catalog, recentLogins → audits). If the API schema changes, update CATALOG_META and the field aliases here.
