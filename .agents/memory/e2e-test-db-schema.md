---
name: E2E test DB schema
description: Correct table/column names for creating test orgs and sessions in E2E scripts. Confirmed via information_schema queries.
---

# E2E Test DB Schema (confirmed live)

## organizations
- `id` — UUID (not TEXT)
- `name`, `slug`, `owner_user_id`, `status`, `plan`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`
- No `email` column — owner email is in `owner_email`
- Minimal INSERT: `(id::uuid, name, slug, owner_user_id, status, plan, subscription_status)`

## user_sessions (the sessions table)
- `token` TEXT, `user_id` TEXT, `org_id` TEXT, `email` TEXT, `role` TEXT
- `expires_at` TIMESTAMPTZ, `created_at` TIMESTAMPTZ
- `user_agent` TEXT, `ip_address` TEXT, `user_id_v2` UUID
- `org_id` is TEXT even though `organizations.id` is UUID — cast with `$n::text`
- Role and email are inline — no separate org_members table needed

## org_members table
- Does NOT exist in this database. Role is stored in `user_sessions.role`.

## Pattern (mirrors qa_agent_phase2.cjs)
```javascript
const orgId = crypto.randomUUID(); // UUID
const userId = `usr_${RUN}_${suffix}`; // TEXT
await pool.query(
  `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, subscription_status)
   VALUES ($1::uuid, $2, $2, $3, 'active', 'ultra', 'active')`,
  [orgId, orgId, userId]
);
await pool.query(
  `INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at, created_at, user_agent, ip_address)
   VALUES ($1,$2,$3::text,$4,'owner',NOW()+INTERVAL '1 hour',NOW(),'E2E','127.0.0.1')`,
  [token, userId, orgId, email]
);
```

## me.ts plan normalization
`plan` is stored lowercase in DB (`pro`, `standard`, `ultra`) but `/api/me` returns Title Case (`Pro`, `Standard`, `Ultra`). Test assertions must use `.toLowerCase()` when comparing against DB-stored values.
