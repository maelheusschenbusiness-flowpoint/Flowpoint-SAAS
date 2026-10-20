# FlowPoint API — Certification Test Suite

Wave 3 Lot B — Team Invitations & Member Management

## Prerequisites

```bash
# Server must be running:
cd artifacts/api-server && PORT=8081 pnpm run dev

# Required env vars:
DATABASE_URL=...          # PostgreSQL connection string
ENABLE_QA_FIXTURES=true   # Enable QA fixture endpoints
ENABLE_TEST_MAILER=true   # Write emails to TEST_MAIL_DIR (not Resend)
TEST_MAIL_DIR=/tmp/qa_mail
```

## Run all suites

**Important:** Run suites sequentially. Parallel execution causes cleanup race conditions
between suites that share the same QA org patterns, leaving residual QA orgs in the DB.
Always run `schema_checks.mjs` last.

```bash
# From workspace root (sequential — required for schema_checks to pass):
for f in \
  artifacts/api-server/tests/certification/lot_a_cert.mjs \
  artifacts/api-server/tests/certification/security_w3a.mjs \
  artifacts/api-server/tests/certification/security_w3a2.mjs \
  artifacts/api-server/tests/certification/service_cred.mjs \
  artifacts/api-server/tests/certification/fixture_guard.mjs \
  artifacts/api-server/tests/certification/lot_b1.mjs \
  artifacts/api-server/tests/certification/lot_b2.mjs \
  artifacts/api-server/tests/certification/lot_b3.mjs \
  artifacts/api-server/tests/certification/lot_b_team.mjs \
  artifacts/api-server/tests/certification/lot_b_frontend.mjs \
  artifacts/api-server/tests/certification/mailer_guard.mjs \
  artifacts/api-server/tests/certification/schema_checks.mjs; do
  echo "=== Running $f ==="; node "$f"; echo "";
done
```

## Suites

| File                  | Description                        | Tests |
|-----------------------|------------------------------------|-------|
| lot_a_cert.mjs        | Lot A Playwright certification     |   5/5 |
| security_w3a.mjs      | Wave 3A security tests             | 24/24 |
| security_w3a2.mjs     | Wave 3A2 (role isolation)          | 21/21 |
| service_cred.mjs      | Service credential audit           | 10/10 |
| fixture_guard.mjs     | QA fixture guard                   | 12/12 |
| lot_b1.mjs            | Wave 2 Lot B1 (monitors, alerts)   | 38/38 |
| lot_b2.mjs            | Wave 2 Lot B2 (CRUD ops)           | 16/16 |
| lot_b3.mjs            | Wave 2 Lot B3 (alert rules, AI)    | 63/63 |
| lot_b_team.mjs        | Lot B Team (invitations, members)  | 83/83 |
| lot_b_frontend.mjs    | Lot B Frontend (Playwright)        | 21/21 |
| mailer_guard.mjs      | Mailer guard (test/prod isolation) |   4/4 |
| schema_checks.mjs     | DB schema invariants               | 13/13 |

**Total: 310/310**

## Key security properties (Wave 3 Lot B)

- Resend atomically invalidates old token (SHA-256 hash replaced in DB)
- Old token returns 404 immediately after resend
- Broader uniqueness: one live row per `(org_id, email)` across `active+pending+suspended`
- canAdmin middleware enforces API-level role check (403 for viewers)
- All token_hash values are SHA-256 hex (64 chars) — raw tokens never stored
