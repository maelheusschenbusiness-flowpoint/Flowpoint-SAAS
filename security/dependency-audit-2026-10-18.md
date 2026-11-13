# FlowPoint dependency security audit — 2026-10-18

## Scope and baseline

Fresh dependency scan: **22 alerts** — 1 critical, 9 high, 11 moderate, 1 low.
The project uses pnpm; the only applicable lockfile is the root `pnpm-lock.yaml`.
Runtime packages are under `artifacts/api-server`; Vitest, Vite, esbuild and
`pino-pretty` paths are development/build-time dependencies.

The security branch is based on the latest `Test-Replit`. No production
configuration, production database, live Stripe account, or Conversion/add-on
feature code is included.

## Finding-by-finding disposition

| Advisory | Package / installed | Dependency path and use | Fix / reachability | Result and regression risk |
|---|---|---|---|---|
| GHSA-82fw-gwwq-j7x9 (CVE-2026-84373) | `@vitest/mocker` 4.1.10 | `api-server` devDependency: Vitest → mocker | Vitest 4.1.12 brings mocker 4.1.12; dev-server mock path only | Fixed; compatible patch update, test tooling only |
| GHSA-6j4f-fj2g-mc7p (CVE-2026-102276) | `brace-expansion` 1.1.18 | ExcelJS → archiver/glob → minimatch 3 | Override to 1.1.21 | Fixed; transitive parser used by archive/glob tooling |
| GHSA-q2hr-2g5m-vwhr (CVE-2026-102277) | `brace-expansion` 1.1.18 | Same minimatch 3 path | Override to 1.1.21 | Fixed; same compatible override |
| GHSA-qhr7-859c-m2p7 (CVE-2026-102278) | `brace-expansion` 1.1.18 | Same minimatch 3 path | Override to 1.1.21 | Fixed; same compatible override |
| GHSA-6j4f-fj2g-mc7p (CVE-2026-102276) | `brace-expansion` 2.1.4 | ExcelJS → archiver/readdir-glob → minimatch 5 | Override to 2.1.7 | Fixed; transitive parser used by archive/glob tooling |
| GHSA-q2hr-2g5m-vwhr (CVE-2026-102277) | `brace-expansion` 2.1.4 | Same minimatch 5 path | Override to 2.1.7 | Fixed; same compatible override |
| GHSA-qhr7-859c-m2p7 (CVE-2026-102278) | `brace-expansion` 2.1.4 | Same minimatch 5 path | Override to 2.1.7 | Fixed; same compatible override |
| GHSA-vc2v-76pw-4v95 (CVE-2026-87776) | `compression` 1.8.1 | Direct API runtime middleware in Express | Direct update to 1.8.2 | Fixed; patch update, middleware behavior unchanged |
| GHSA-g7r4-m6w7-qqqr | `esbuild` 0.27.7 | `tsx` development/build path; finding concerns Windows dev-server file reads | Workspace override to 0.28.1 | Fixed; same supported minor line; app does not expose esbuild's dev server |
| GHSA-jggr-w7fw-pc2j | `fast-copy` 4.0.2 | `pino-pretty` → build/dev logging tooling | Override to 4.1.0 | Fixed; dev-only deep-copy utility |
| GHSA-2x7j-588g-ccc2 (CVE-2026-92596) | `nodemailer` 9.0.3 | Direct runtime SMTP fallback in `mailer.ts`; recipient values can originate from signup/profile flows | Direct update to 9.1.1 | Fixed; compatible 9.x update |
| GHSA-6vj9-mwq6-2f5v (CVE-2026-100701) | `nodemailer` 9.1.1 → 10.1.7 | Same SMTP fallback; process-global DNS/TLS cache | 10.1.7 includes fix (10.0.2+) | Fixed; FlowPoint uses one environment-configured SMTP host without tenant-specific `tls.servername`; authenticated through mocked-transport test |
| GHSA-8m3c-c648-2xjj (CVE-2026-92595) | `nodemailer` 9.0.3 | Same SMTP fallback; legacy `resolveContent()` signature | Direct update to 9.1.1 | Fixed; compatible 9.x update |
| GHSA-8vvx-rff5-p5rq (CVE-2026-100702) | `nodemailer` 9.1.1 → 10.1.7 | Same SMTP fallback; nested structured recipients | 10.1.7 includes fix (10.0.2+) | Fixed; FlowPoint mailer passes recipient strings, not nested arrays |
| GHSA-cc9r-2j5m-2m83 (CVE-2026-92597) | `nodemailer` 9.0.3 | Same SMTP fallback; RFC 5322 comment recipient parsing | Direct update to 9.1.1 | Fixed; compatible 9.x update |
| GHSA-v53p-9fqp-m79j (CVE-2026-100700) | `nodemailer` 9.1.1 → 10.1.7 | Same SMTP fallback; address parser backtracking | 10.1.7 includes fix (10.0.6+) | Fixed; mocked error and malformed-recipient tests pass; no real SMTP used |
| GHSA-wmmp-3585-3rmp (CVE-2026-92598) | `nodemailer` 9.0.3 | Same SMTP fallback; IDN normalization discrepancy | Direct update to 9.1.1 | Fixed; compatible 9.x update |
| GHSA-g57g-f23g-4646 (CVE-2026-100699; found on rescan) | `nodemailer` 9.1.1 → 10.1.7 | Same SMTP fallback; quoted local-part/comment parsing | 10.1.7 includes fix (10.0.9+) | Fixed; external and malformed recipient behavior is covered without network delivery |
| GHSA-prgh-xp8r-p3m5 (CVE-2026-90776; found on rescan) | `nodemailer` 9.1.1 → 10.1.7 | Address parser complexity; advisory describes inbound `mailparser` path, which this app does not import | 10.1.7 includes fix (10.0.5+) | Fixed in package; inbound parser path remains unused |
| GHSA-jqcg-44mw-7w3h (CVE-2026-90711) | `proxy-addr` 2.0.7 | Express runtime request-IP resolution | Override to 2.0.8 | Fixed. The advisory's vulnerable IPv4-mapped IPv6 CIDR form is not configured; app uses one trusted proxy hop. Separately, raw leftmost `X-Forwarded-For` reads were spoofable and are now replaced by Express `req.ip`. |
| GHSA-68fv-2mgg-jv7q (CVE-2026-93749) | `source-map-js` 1.2.1 | PostCSS → Vite → Vitest; dev/test only, no production runtime import | Override to 1.2.2 | Fixed; compatible patch update |
| GHSA-hp3w-g68c-fv3c (CVE-2026-97058) | `sprintf-js` 1.0.3 | Mammoth → argparse → sprintf-js; app uses Mammoth's library API, not its CLI/argument parser | Scanner reports no fixed version; no safe package update identified | Open but not reachable through the application's Mammoth API path; re-evaluate when upstream publishes a compatible fix |
| GHSA-w5hq-g745-h8pq (CVE-2026-41907) | `uuid` 8.3.2 | ExcelJS → uuid; inspected ExcelJS call sites use `v4()` without caller-supplied buffers | Fixed version 11.1.1 is a major upgrade | Open; affected `v3/v5/v6` buffer APIs are not used by ExcelJS here; major override deferred |
| GHSA-82fw-gwwq-j7x9 (CVE-2026-84373) | `vitest` 4.1.10 | `api-server` devDependency | Direct update to 4.1.12 | Fixed; patch-level test-runner update |

## Proxy and IP handling

`app.ts` configures Express `trust proxy` to one hop, consistent with the Replit
deployment guidance and Render's documented Express configuration. Public
checkout, auth, behavioral token rate limits, QA provisioning, and team audit
records now use Express's resolved `req.ip`; no application code reads
`X-Forwarded-For` directly. This prevents a caller-supplied leftmost value from
choosing its own rate-limit/audit identity. A unit test covers a forged
forwarded header alongside a different proxy-resolved `req.ip`.

## Verification

- Dependency tree/lockfile checked after overrides: patched versions are
  `proxy-addr` 2.0.8, `brace-expansion` 1.1.21 and 2.1.7, `compression` 1.8.2,
  `esbuild` 0.28.1, `fast-copy` 4.1.0, `nodemailer` 10.1.7, `source-map-js`
  1.2.2, and Vitest/`@vitest/mocker` 4.1.12.
- Nodemailer 10.1.7 compatibility follow-up: the five Nodemailer alerts from
  9.1.1 no longer apply at the patched version. No Nodemailer finding or new
  dependency alert appeared in the post-upgrade dependency scan.
- Post-upgrade rescan: **2 alerts remain** — `uuid` 8.3.2 (high; fixed in 11.1.1)
  and `sprintf-js` 1.0.3 (moderate; no fix reported through 1.1.3). They were
  not upgraded; see the reachability assessment in the advisory table above.
- The Node 10 upgrade was restricted to Nodemailer, its type package, the
  mailer declaration, and the lock entries for those packages. Other task #709
  changes were not copied into this PR.
- TypeScript check, server build, proxy/rate-limit, auth-enumeration, and
  OAuth-scope tests pass. The Nodemailer follow-up adds mocked SMTP tests for
  auth/TLS/port options, transactional/signup/alert messages, and error
  handling, plus stream-transport checks for external and malformed addresses.
- SAST recheck: both GitHub redirects use the configured `PUBLIC_URL`; request
  values are encoded and cannot choose the destination. The MD5 is only a
  short-lived, organization-prefixed in-memory cache key, not an integrity or
  authentication mechanism. No exploitable redirect or weak-crypto use was
  confirmed; no unrelated code changes were made.
- HoundDog scan returned a schema-validation error, so no clean HoundDog result
  is claimed.
- No Stripe API calls were made; billing code was not modified.
