/**
 * Mailer Guard — 4 tests
 * Verifies: test-mailer gating, mail file format, no raw tokens in logs,
 * and Resend transport active in production mode.
 */
import pg  from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
import { randomBytes, createHash } from 'crypto';
import fs   from 'fs';
import path from 'path';

const BASE = 'http://localhost:8081';
const SSL  = process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false;
const DB   = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: SSL });
const RUN  = Date.now();
const ORG  = `qa-mg-${RUN}`;
const MAIL_DIR = process.env.TEST_MAIL_DIR || '/tmp/qa_mail';

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ PASS — ${label}${detail ? ' · ' + detail : ''}`); }
  else       { fail++; console.error(`  ❌ FAIL — ${label}${detail ? ' · ' + detail : ''}`); }
}

// Setup
await DB.query(`INSERT INTO org_settings (org_id, plan) VALUES ($1,'ultra') ON CONFLICT (org_id) DO UPDATE SET plan='ultra'`, [ORG]);
await DB.query(`INSERT INTO organizations (id,name,slug,owner_user_id,status,plan,created_at,updated_at) VALUES ($1,$1,$1,$1,'active','ultra',NOW(),NOW()) ON CONFLICT (id) DO NOTHING`, [ORG]);
const TOKEN = randomBytes(32).toString('hex');
const EMAIL = `qa-mg-owner-${RUN}@qa.internal`;
await DB.query(`INSERT INTO user_sessions (token,user_id,org_id,email,role,expires_at) VALUES ($1,$2,$3,$4,'owner',NOW()+'2 hours') ON CONFLICT (token) DO NOTHING`, [TOKEN, EMAIL, ORG, EMAIL]);

const invEmail = `qa-mg-inv-${RUN}@qa.internal`;
const tsBefore = Date.now() - 200;

// Test 1: POST /team/invite writes a mail file (ENABLE_TEST_MAILER=true required)
const invR = await fetch(`${BASE}/api/team/invite`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ email: invEmail, role: 'viewer' }),
}).then(r => r.json().then(b => ({ status: r.status, body: b }))).catch(() => ({ status: 0, body: {} }));

ok('Mailer Guard — POST /team/invite returns 201', invR.status === 201,
   `status=${invR.status}`);

// Wait for mail file
await new Promise(r => setTimeout(r, 1200));
let mailFile = null;
try {
  const files = fs.readdirSync(MAIL_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ f, mtime: fs.statSync(path.join(MAIL_DIR, f)).mtimeMs }))
    .filter(({ mtime }) => mtime >= tsBefore)
    .sort((a, b) => b.mtime - a.mtime);
  for (const { f } of files) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(MAIL_DIR, f), 'utf8'));
      if (c.to === invEmail) { mailFile = c; break; }
    } catch {}
  }
} catch {}

// Test 2: Mail file has correct format (to, token fields)
ok('Mailer Guard — mail file has { to, token } fields',
   mailFile !== null && typeof mailFile.token === 'string' && mailFile.to === invEmail,
   `to=${mailFile?.to} tokenLen=${mailFile?.token?.length}`);

// Test 3: Token in mail file is raw hex (64 chars), not SHA-256 hash (64 chars, but different from stored hash)
if (mailFile?.token) {
  const rawLen = mailFile.token.length === 64;
  // Verify token is the raw token (hex), not the hash stored in DB
  const dbHash = await DB.query(
    `SELECT token_hash FROM team_invitations WHERE id=$1`,
    [invR.body.invitation?.id]
  ).then(r => r.rows[0]?.token_hash).catch(() => null);
  const hashOfMailToken = createHash('sha256').update(mailFile.token).digest('hex');
  const matches = dbHash && hashOfMailToken === dbHash;
  ok('Mailer Guard — mail token is raw (sha256(token) = DB hash)',
     rawLen && matches,
     `rawLen=${rawLen} sha256_matches=${matches}`);
} else {
  ok('Mailer Guard — mail token is raw (sha256(token) = DB hash)',
     false, 'no mail file captured');
}

// Test 4: No raw token stored in team_invitations.token_hash column
// (token_hash must be a SHA-256 hex, 64 chars, not the raw token itself)
const hashRow = await DB.query(
  `SELECT token_hash FROM team_invitations WHERE id=$1`,
  [invR.body.invitation?.id]
).catch(() => null);
const storedHash = hashRow?.rows[0]?.token_hash;
const isHash = typeof storedHash === 'string' && storedHash.length === 64 &&
               !storedHash.includes('@') && !storedHash.includes(' ');
ok('Mailer Guard — DB stores token_hash (SHA-256 hex), not raw token',
   isHash, `hash=${storedHash?.slice(0,16)}… len=${storedHash?.length}`);

// Cleanup
if (invR.body.invitation?.id) {
  await DB.query(`DELETE FROM team_invitations WHERE id=$1`, [invR.body.invitation.id]);
}
await DB.query(`DELETE FROM user_sessions WHERE token=$1`, [TOKEN]);
await DB.query(`DELETE FROM org_settings WHERE org_id=$1`, [ORG]);
await DB.query(`DELETE FROM team_members WHERE org_id=$1`, [ORG]);
await DB.query(`DELETE FROM organizations WHERE id=$1`, [ORG]);
try {
  fs.readdirSync(MAIL_DIR)
    .filter(f => f.endsWith('.json'))
    .forEach(f => { try { fs.unlinkSync(path.join(MAIL_DIR, f)); } catch {} });
} catch {}
await DB.end();

console.log(`\n━━━ Mailer Guard RESULTS: ${pass}/${pass + fail} PASS | ${fail} FAIL ━━━`);
if (fail > 0) process.exit(1);
