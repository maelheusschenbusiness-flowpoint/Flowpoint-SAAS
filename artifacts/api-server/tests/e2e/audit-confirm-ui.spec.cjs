/**
 * Playwright UI test — Full audit confirmation flow
 * =================================================
 * Verifies that sending "Audite https://example.com" in the AI chat,
 * then clicking "Confirmer", does NOT display "Échec de l'exécution."
 *
 * Run from workspace root:
 *   APP_URL=https://app.flowpoint.pro \
 *   DATABASE_URL=<your-prod-db-url>  \
 *   npx playwright test artifacts/api-server/tests/e2e/audit-confirm-ui.spec.cjs \
 *     --headed --reporter=list
 *
 * Or against the local dev server:
 *   APP_URL=http://127.0.0.1:8081 \
 *   DATABASE_URL=<dev-db-url>  \
 *   npx playwright test artifacts/api-server/tests/e2e/audit-confirm-ui.spec.cjs \
 *     --headed --reporter=list
 *
 * Requirements: Playwright browsers installed (`npx playwright install chromium`).
 */

'use strict';
const { test, expect } = require('@playwright/test');
const { Pool } = require('pg');
const crypto = require('crypto');

const BASE_URL = process.env.APP_URL || 'http://127.0.0.1:8081';
const DB_URL   = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL must be set to run this test.');

// ── Helpers ──────────────────────────────────────────────────────────────────

let pool;
test.beforeAll(async () => {
  pool = new Pool({ connectionString: DB_URL });
});
test.afterAll(async () => {
  if (pool) await pool.end();
});

// Shorten the global test timeout — audit SSE may take up to 90 s.
test.setTimeout(120_000);

// ── Test suite ───────────────────────────────────────────────────────────────

test.describe('AI audit confirmation flow', () => {

  test('Confirmer button — shows result, never "Échec de l\'exécution."', async ({ page }) => {
    // ── Step 1: create an isolated test org + session ────────────────────────
    const RUN   = Date.now();
    const orgId = randomUUID();
    const userId= randomUUID();
    const email = `pw_audit_${RUN}@fp.test`;
    const token = randomBytes(32).toString('hex');
    const target= 'https://httpstat.us/200'; // stable, externally reachable URL

    await pool.query(
      `INSERT INTO organizations(id,name,plan,status)
       VALUES($1,'PW Audit Test','pro','active') ON CONFLICT DO NOTHING`, [orgId]);
    await pool.query(
      `INSERT INTO users(id,email,org_id,role,status,first_name)
       VALUES($1,$2,$3,'owner','active','PW') ON CONFLICT DO NOTHING`, [userId, email, orgId]);
    await pool.query(
      `INSERT INTO user_sessions(token,user_id,org_id,expires_at)
       VALUES($1,$2,$3,NOW()+INTERVAL '2 hours') ON CONFLICT DO NOTHING`, [token, userId, orgId]);

    // ── Step 2: inject session token into sessionStorage before page loads ───
    // The app reads sessionStorage.fp_session_token as a per-tab Bearer token.
    await page.addInitScript((t) => {
      sessionStorage.setItem('fp_session_token', t);
    }, token);

    // ── Step 3: open the dashboard and navigate to the AI section ────────────
    await page.goto(`${BASE_URL}/dashboard.html`, { waitUntil: 'domcontentloaded' });

    // Navigate to the AI section (via hash or programmatic nav)
    await page.evaluate(() => {
      // Call the dashboard's navigate() helper if available
      if (typeof window.navigate === 'function') {
        window.navigate('ai');
      } else {
        window.location.hash = '#ai';
      }
    });

    // Wait for the chat input to be present and visible
    const inputSel = '#ai-input, #fp-ai-chat-input';
    await page.waitForSelector(inputSel, { state: 'visible', timeout: 20_000 });

    // ── Step 4: type the audit request and send ───────────────────────────────
    const inputEl = await page.locator('#ai-input').first();
    await inputEl.click();
    await inputEl.fill(`Audite ${target}`);

    const sendEl = await page.locator('#ai-send').first();
    await sendEl.click();

    // ── Step 5: wait for the Confirm button to appear ────────────────────────
    // The AI will emit a confirmation_request SSE event that renders a card with
    // a "Confirmer" button carrying data-pid (proposal ID).
    const confirmBtnSel = 'button[data-pid]';
    await page.waitForSelector(confirmBtnSel, { state: 'visible', timeout: 60_000 });

    // ── Step 6: click "Confirmer" ─────────────────────────────────────────────
    const confirmBtn = page.locator(confirmBtnSel).first();
    await confirmBtn.click();

    // ── Step 7: wait briefly for the result to render ─────────────────────────
    // The confirm endpoint is synchronous on the happy path (audit row created,
    // background PSI fired). Give the UI up to 15 s to render the result.
    await page.waitForTimeout(8_000);

    // ── Step 8: assertions ────────────────────────────────────────────────────
    const messageArea = page.locator('#ai-messages, #fp-ai-chat-messages').first();
    const areaText = await messageArea.textContent({ timeout: 5_000 }).catch(() => '');

    // PRIMARY assertion: "Échec de l'exécution." must NOT appear in the UI.
    expect(areaText).not.toContain("Échec de l'exécution.");

    // SECONDARY assertion: whole body should not contain the generic failure text.
    await expect(page.locator('body')).not.toContainText("Échec de l'exécution.");

    // ── Step 9: verify the audit row was actually created in the DB ──────────
    const { rows } = await pool.query(
      `SELECT id, url, status FROM audits
       WHERE org_id = $1 AND url ILIKE $2 LIMIT 1`,
      [orgId, '%httpstat%']);
    expect(rows.length, 'audit row must be created in DB').toBeGreaterThan(0);
    expect(rows[0].url).toContain('httpstat');
    // status should be "processing" (background PSI not yet done) or "ok"/"warn"/"error"
    expect(['processing', 'ok', 'warn', 'error']).toContain(rows[0].status);

    // ── Cleanup: remove test data (best-effort) ───────────────────────────────
    await pool.query(`DELETE FROM audits WHERE org_id = $1`, [orgId]).catch(() => {});
    await pool.query(`DELETE FROM user_sessions WHERE org_id = $1`, [orgId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
  });

  test('Confirm with duplicate URL — shows real rejection reason, not generic fallback', async ({ page }) => {
    // This test verifies the content→error mapping fix in the confirm endpoint:
    // a 24-hour duplicate audit returns ok:false with a meaningful message,
    // and the UI must show that message instead of "Échec de l'exécution.".
    const RUN    = Date.now();
    const orgId  = randomUUID();
    const userId = randomUUID();
    const email  = `pw_dup_${RUN}@fp.test`;
    const token  = randomBytes(32).toString('hex');
    const dupUrl = `https://dup-${RUN}.example.com`;

    await pool.query(
      `INSERT INTO organizations(id,name,plan,status)
       VALUES($1,'PW Dup Test','pro','active') ON CONFLICT DO NOTHING`, [orgId]);
    await pool.query(
      `INSERT INTO users(id,email,org_id,role,status,first_name)
       VALUES($1,$2,$3,'owner','active','PW') ON CONFLICT DO NOTHING`, [userId, email, orgId]);
    await pool.query(
      `INSERT INTO user_sessions(token,user_id,org_id,expires_at)
       VALUES($1,$2,$3,NOW()+INTERVAL '2 hours') ON CONFLICT DO NOTHING`, [token, userId, orgId]);

    // Pre-insert a recent audit for this URL to trigger the duplicate check
    await pool.query(
      `INSERT INTO audits(id,org_id,url,name,score,status,speed,date,issues,origin,created_at)
       VALUES($1,$2,$3,$4,75,'ok',80,'${new Date().toISOString().slice(0,10)}',0,'manual',NOW()-INTERVAL '1 hour')`,
      [`dup_${RUN}`, orgId, dupUrl, dupUrl]);

    // Inject a synthetic pending proposal for run_audit with the duplicate URL
    const convId  = `pwdup${RUN}`.slice(0, 63);
    const propId  = `pwdupp${RUN}`.slice(0, 99);
    await pool.query(
      `INSERT INTO ai_action_proposals
         (id,org_id,user_id,conversation_id,kind,payload,status,created_at,expires_at)
       VALUES($1,$2,$3,$4,'pending_tool_call',$5,'pending',NOW(),NOW()+INTERVAL '10 minutes')
       ON CONFLICT DO NOTHING`,
      [propId, orgId, userId, convId,
       JSON.stringify({ toolName: 'run_audit', toolCallId: propId, args: { url: dupUrl } })]);

    // Call the confirm endpoint directly and verify the response has an 'error' field
    const resp = await fetch(
      `${BASE_URL}/api/ai/conversations/${convId}/confirm`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ proposalId: propId }),
      });
    const body = await resp.json();

    // ok must be false (duplicate check fires)
    expect(body.ok).toBe(false);
    // The 'error' field must be populated (the fix — not just 'content')
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
    // The error message must NOT be the generic fallback
    expect(body.error).not.toBe("Échec de l'exécution.");
    // It must contain a meaningful rejection reason
    expect(body.error).toMatch(/24\s*heure|déjà\s*(été\s*)?réalis|audit.*déjà/i);

    // Cleanup
    await pool.query(`DELETE FROM audits WHERE org_id = $1`, [orgId]).catch(() => {});
    await pool.query(`DELETE FROM ai_action_proposals WHERE org_id = $1`, [orgId]).catch(() => {});
    await pool.query(`DELETE FROM user_sessions WHERE org_id = $1`, [orgId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
  });
});
