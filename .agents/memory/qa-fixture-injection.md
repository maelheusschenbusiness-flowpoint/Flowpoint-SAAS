---
name: QA fixture injection pattern
description: How to test monitor check pipelines (uptime/latency/monitor_down) deterministically without SSRF issues
---

## The constraint
Monitor URLs pass two SSRF checks: string check (blocks localhost/127.x) and DNS resolution check (blocks hostnames that resolve to RFC 1918 ranges). `REPLIT_DEV_DOMAIN` resolves to `172.24.x.x` — still blocked by DNS check. There is no externally-accessible URL from inside Replit that resolves to a public IP and routes back to the server.

## The solution: `_qa_result` injection in handleCheck
`POST /monitors/:id/check` accepts an optional `_qa_result` body field when `!process.env["RENDER"]` (non-Render environment). When present, `performCheck` (the HTTP step) is bypassed and the injected `{ ok, statusCode, latencyMs, error }` is used directly. `saveCheckResult` (the real evaluator: uptime calc from DB, rule evaluation, event firing) **always runs**.

**Why:** This satisfies "ne pas mocker la fonction d'évaluation" — only the outbound HTTP request is bypassed, not the business logic. The DB uptime calculation, evaluateCondition, fireAlertEvent, and resolveAlertEvents all execute on real data.

**How to apply:**
```javascript
// In test scripts: inject a 503 check result
await api('POST', `/monitors/${monId}/check`, {
  _qa_result: { ok: false, statusCode: 503, latencyMs: 10, error: 'Service unreachable' }
});
// Inject a 200 check result
await api('POST', `/monitors/${monId}/check`, {
  _qa_result: { ok: true, statusCode: 200, latencyMs: 20 }
});
```

The monitor URL for QA monitors can be any public SSRF-safe URL (e.g. `https://httpbin.org/status/200?qa=${RUN_ID}`) — it's never actually fetched when `_qa_result` is present.

## QA fixture isProd() guard
`isProd()` in `qa-fixtures.ts` uses `!!process.env["RENDER"]` only (not `NODE_ENV`). Replit sets `NODE_ENV=production` even in dev environments, so `NODE_ENV === "production"` would block all QA fixtures in Replit.

## qa_w3a_tokens.json re-generation
This file is created by Python (not a .mjs script) — generate 5 tokens: `orgA_owner`, `orgA_admin`, `orgA_member`, `orgA_viewer`, `orgB_owner`. Orgs: `org-a@qa.test` and `org-b@qa.test`. Email pattern: `org-a-{role}@qa.test`.
