---
name: QA self-contained session pattern
description: How all QA suites create their own DB sessions without /tmp token files
---

# QA Self-Contained Session Pattern

## Rule
Every QA suite must create its own org + sessions via pg; never read /tmp token files from another suite.

**Why:** /tmp token files vanish between runs and create hidden ordering dependencies between suites.

## How to apply

```javascript
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
import { randomBytes } from 'crypto';

const RUN = Date.now();
const ORG = `qa-<suite>-${RUN}`;
const SSL = process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false;
const DB  = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: SSL });

// Ensure org
await DB.query(`INSERT INTO org_settings (org_id, plan) VALUES ($1, 'ultra') ON CONFLICT (org_id) DO UPDATE SET plan='ultra'`, [ORG]);
await DB.query(`INSERT INTO organizations (id,name,slug,owner_user_id,status,plan,created_at,updated_at)
  VALUES ($1,$1,$1,$1,'active','ultra',NOW(),NOW()) ON CONFLICT (id) DO NOTHING`, [ORG]);

// Create session
async function createSession(role) {
  const email = `qa-${role}-${RUN}@qa.internal`;
  const token = randomBytes(32).toString('hex');
  await DB.query(`INSERT INTO user_sessions (token,user_id,org_id,email,role,expires_at)
    VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '2 hours') ON CONFLICT (token) DO NOTHING`,
    [token, email, ORG, email, role]);
  return token;
}
```

## Seat quota trap (Lot B)
- Ultra plan (limit=10) for Lot B main org — pro (5) fills up fast with test members + pending invitations
- E2E GROUP that tests invite→email→accept needs a **separate fresh org** (`E2E_ORG = qa-lot-b-e2e-${RUN}`) — active members (5) + pending invitations (5) from prior groups can saturate even ultra
- Count: 5 active inserts + 5 pending API invites = 10 = hits ultra limit before E2E invite

## Cleanup pattern
```javascript
await DB.query(`DELETE FROM user_sessions WHERE token = ANY($1)`, [ALL_TOKENS]);
await DB.query(`DELETE FROM org_settings WHERE org_id = ANY($1)`, [[ORG, E2E_ORG]]);
await DB.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[ORG, E2E_ORG]]);
await DB.query(`DELETE FROM team_members WHERE org_id = ANY($1)`, [[ORG, E2E_ORG]]);
await DB.query(`DELETE FROM team_invitations WHERE org_id = ANY($1)`, [[ORG, E2E_ORG]]);
```

## TEST_MAIL_DIR for E2E email tests
- Set via `setEnvVars({ values: { TEST_MAIL_DIR: '/tmp/qa_mail' }, environment: 'development' })` in code_execution
- mailer.ts writes `{to, subject, tag, token, inviteUrl}` as JSON; token extracted via regex `/[?&]token=([a-f0-9]{64})/`
- Requires server restart after setting env var; poll for file with 500ms sleep × 10 attempts
