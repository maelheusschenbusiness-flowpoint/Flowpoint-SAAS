---
name: QA fixture injection pattern
description: How to test monitor check pipelines (uptime/latency/monitor_down) deterministically without SSRF issues; multi-condition guard and service-cred restriction
---

## The constraint
Monitor URLs pass two SSRF checks: string check (blocks localhost/127.x) and DNS resolution check (blocks hostnames that resolve to RFC 1918 ranges). `REPLIT_DEV_DOMAIN` resolves to `172.24.x.x` — still blocked by DNS check. There is no externally-accessible URL from inside Replit that resolves to a public IP and routes back to the server.

## The solution: `_qa_result` injection in handleCheck
`POST /monitors/:id/check` accepts an optional `_qa_result` body field when `isQaFixturesEnabled()` returns true AND the request carries a valid `X-Api-Key` service credential. When present, `performCheck` (the HTTP step) is bypassed and the injected `{ ok, statusCode, latencyMs, error }` is used directly. `saveCheckResult` (the real evaluator) **always runs**.

**Why:** Only the outbound HTTP request is bypassed, not the business logic. DB uptime calc, evaluateCondition, fireAlertEvent, resolveAlertEvents all execute on real data.

**How to apply — MUST use apiSvc() (X-Api-Key), NOT api() (Bearer token):**
```javascript
// CORRECT — service credential required
await apiSvc('POST', `/monitors/${monId}/check`, {
  _qa_result: { ok: false, statusCode: 503, latencyMs: 10, error: 'Service unreachable' }
});
// WRONG — user Bearer token returns 403
await api('POST', `/monitors/${monId}/check`, {
  _qa_result: { ok: false, statusCode: 503, latencyMs: 10 }
});
```

## isQaFixturesEnabled() multi-condition guard (qa-fixtures.ts)
Blocks when ANY of: `RENDER` set, `FLY_APP_NAME` set, `REPLIT_DEPLOYMENT=1`.
Allows when: `ENABLE_QA_FIXTURES=true` AND NOT in one of the above production envs.
Replit dev quirk: `NODE_ENV=production` is set even in dev (REPL_ID present, REPLIT_DEPLOYMENT absent) — guard waives NODE_ENV check when REPL_ID present + REPLIT_DEPLOYMENT absent.

## Service credential gate in index.ts whitelist
`POST /monitors/:id/check` with a `_qa_result` body field is whitelisted for the service credential (`bodyHasQaResult` check). This lets the request through auth so `handleCheck` can return 404 (fixtures disabled) vs 200 (fixtures enabled) correctly. Without the whitelist, the service cred gets 403 from the route-not-permitted gate before `handleCheck` even runs.

## Guard test structure (Phase 1 requires server restart)
- Phase 1 (T01-T04): fixtures DISABLED — requires server running WITHOUT `ENABLE_QA_FIXTURES`
- Phase 2 (T05-T12): fixtures ENABLED — requires server running WITH `ENABLE_QA_FIXTURES=true`
- To run Phase 1: `deleteEnvVars(['ENABLE_QA_FIXTURES'], 'development')` → restart → `PHASE=1 node .local/qa_fixture_guard.mjs`
- To run Phase 2: `setEnvVars({ENABLE_QA_FIXTURES:'true'}, 'development')` → restart → `PHASE=2 node ...`
- NEVER run guard tests and DB purge in parallel — purge deletes session tokens mid-test.

## QA token re-generation (Python, always after purge)
5 tokens: `orgA_owner`, `orgA_admin`, `orgA_member`, `orgA_viewer`, `orgB_owner` → `/tmp/qa_w3a_tokens.json`
1 owner token: `qa@flowpoint.test` / `qa@flowpoint.test` → `/tmp/qa_session_token.txt`
Always INSERT with ON CONFLICT DO NOTHING into `user_sessions`.
