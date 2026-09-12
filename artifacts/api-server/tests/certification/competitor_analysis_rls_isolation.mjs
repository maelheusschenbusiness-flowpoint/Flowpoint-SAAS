/**
 * competitor_analysis_rls_isolation.mjs
 *
 * Security certification — Task #630
 *
 * Verifies that competitor_analysis has RLS + FORCE enabled and that
 * organisation A cannot read, insert, update or delete rows belonging
 * to organisation B, even when using the same Postgres user.
 *
 * Uses real Postgres connections via DATABASE_URL so the test runs against
 * the same database that the API server uses.
 *
 * Exit code: 0 = all assertions passed, 1 = at least one failure.
 */

import pg from 'pg';

const { Pool } = pg;

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label, value) {
  if (value) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

/**
 * Run a query with a specific org_id set in the GUC so RLS policies apply.
 * Mirrors what withOrgDb() does in the API server.
 */
async function withOrg(pool, orgId, sql, values = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL ROLE app_user drops superuser so RLS applies.
    // On Supabase/Render the GRANT may not work — fall back to GUC-only.
    try { await client.query('SET LOCAL ROLE app_user'); } catch { /* GUC-only mode */ }
    await client.query(`SET LOCAL "app.current_org_id" = '${orgId.replace(/'/g, "''")}'`);
    const result = await client.query(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const superPool = pool; // same connection string — pool.query() = superuser = BYPASSRLS

  const orgA = 'rls-cert-org-a-' + Date.now();
  const orgB = 'rls-cert-org-b-' + Date.now();
  const idA  = 'ca-cert-a-' + Date.now();
  const idB  = 'ca-cert-b-' + Date.now();
  const compA = 'comp-cert-a-' + Date.now();
  const compB = 'comp-cert-b-' + Date.now();

  console.log('\n=== competitor_analysis RLS isolation — Task #630 ===\n');

  // ── 1. Schema invariants ──────────────────────────────────────────────────
  console.log('── 1. Schema invariants ──');
  const schemaRes = await superPool.query(`
    SELECT c.relrowsecurity AS rls_on, c.relforcerowsecurity AS force_on,
           COUNT(p.policyname) AS policy_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
    WHERE n.nspname = 'public' AND c.relname = 'competitor_analysis'
    GROUP BY c.relrowsecurity, c.relforcerowsecurity
  `);
  const schema = schemaRes.rows[0];
  ok('RLS enabled (relrowsecurity = true)',  schema?.rls_on   === true);
  ok('FORCE RLS (relforcerowsecurity = true)', schema?.force_on === true);
  ok('4 tenant policies exist',              Number(schema?.policy_count) === 4);

  const noUnprotected = await superPool.query(
    `SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname='public' AND rowsecurity=false`
  );
  ok('No unprotected public table remains', Number(noUnprotected.rows[0]?.n) === 0);

  // ── 2. Seed — superuser inserts rows for both orgs ───────────────────────
  console.log('\n── 2. Seed rows ──');
  await superPool.query(
    `INSERT INTO competitor_analysis (id, org_id, competitor_id, url_fetched)
     VALUES ($1,$2,$3,'https://a.example.com'),
            ($4,$5,$6,'https://b.example.com')
     ON CONFLICT (competitor_id, org_id) DO UPDATE SET url_fetched=EXCLUDED.url_fetched`,
    [idA, orgA, compA, idB, orgB, compB]
  );
  ok('Seed rows inserted via superuser (BYPASSRLS)', true);

  // ── 3. Positive: org A can read its own row ───────────────────────────────
  console.log('\n── 3. Positive — org A reads own row ──');
  const ownRead = await withOrg(pool, orgA,
    `SELECT id FROM competitor_analysis WHERE org_id=$1`, [orgA]);
  ok('Org A sees exactly 1 row of its own', ownRead.rows.length === 1 && ownRead.rows[0].id === idA);

  // ── 4. Negative: org A cannot read org B's rows ──────────────────────────
  console.log('\n── 4. Negative — org A cannot read org B row ──');
  const crossRead = await withOrg(pool, orgA,
    `SELECT id FROM competitor_analysis WHERE id=$1`, [idB]);
  ok('Org A sees 0 rows when querying B\'s row by id', crossRead.rows.length === 0);

  const crossReadByOrg = await withOrg(pool, orgA,
    `SELECT id FROM competitor_analysis WHERE org_id=$1`, [orgB]);
  ok('Org A sees 0 rows when querying by B\'s org_id', crossReadByOrg.rows.length === 0);

  // ── 5. Negative: org A cannot INSERT a row for org B ─────────────────────
  console.log('\n── 5. Negative — org A cannot INSERT for org B ──');
  let insertCrossBlocked = false;
  try {
    await withOrg(pool, orgA,
      `INSERT INTO competitor_analysis (id, org_id, competitor_id, url_fetched)
       VALUES ('ca-cross-insert','${orgB}','comp-cross','https://x.com')`);
  } catch (err) {
    // RLS check violation or permission denied = expected
    insertCrossBlocked = true;
  }
  ok('Cross-org INSERT is blocked by RLS', insertCrossBlocked);

  // ── 6. Negative: org A cannot UPDATE org B's row ─────────────────────────
  console.log('\n── 6. Negative — org A cannot UPDATE org B row ──');
  const updateCross = await withOrg(pool, orgA,
    `UPDATE competitor_analysis SET url_fetched='https://hacked.com' WHERE id=$1 RETURNING id`,
    [idB]);
  ok('Cross-org UPDATE returns 0 affected rows', updateCross.rowCount === 0);

  // Verify the row was NOT actually changed
  const afterUpdate = await superPool.query(
    `SELECT url_fetched FROM competitor_analysis WHERE id=$1`, [idB]);
  ok('Org B row url_fetched unchanged after cross-org UPDATE attempt',
     afterUpdate.rows[0]?.url_fetched === 'https://b.example.com');

  // ── 7. Negative: org A cannot DELETE org B's row ─────────────────────────
  console.log('\n── 7. Negative — org A cannot DELETE org B row ──');
  const deleteCross = await withOrg(pool, orgA,
    `DELETE FROM competitor_analysis WHERE id=$1 RETURNING id`, [idB]);
  ok('Cross-org DELETE returns 0 affected rows', deleteCross.rowCount === 0);

  const afterDelete = await superPool.query(
    `SELECT id FROM competitor_analysis WHERE id=$1`, [idB]);
  ok('Org B row still exists after cross-org DELETE attempt', afterDelete.rows.length === 1);

  // ── 8. Positive: org A can UPDATE and DELETE its own row ─────────────────
  console.log('\n── 8. Positive — org A can UPDATE/DELETE own row ──');
  const ownUpdate = await withOrg(pool, orgA,
    `UPDATE competitor_analysis SET url_fetched='https://updated.example.com' WHERE id=$1 RETURNING id`,
    [idA]);
  ok('Org A can UPDATE its own row', Number(ownUpdate.rowCount) === 1);

  const ownDelete = await withOrg(pool, orgA,
    `DELETE FROM competitor_analysis WHERE id=$1 RETURNING id`, [idA]);
  ok('Org A can DELETE its own row', Number(ownDelete.rowCount) === 1);

  // ── 9. Unset GUC (unauthenticated) sees nothing ──────────────────────────
  // Re-seed org B row so we have something to try to read.
  console.log('\n── 9. Negative — unset GUC sees no rows ──');
  await superPool.query(
    `INSERT INTO competitor_analysis (id, org_id, competitor_id, url_fetched)
     VALUES ($1,$2,$3,'https://b2.example.com')
     ON CONFLICT (competitor_id, org_id) DO UPDATE SET url_fetched=EXCLUDED.url_fetched`,
    [idB, orgB, compB]
  );
  // Simulate an unauthenticated connection: SET ROLE app_user + NO GUC set.
  // current_setting('app.current_org_id', true) returns '' (empty) when missing,
  // which never matches any real org_id → 0 rows visible.
  const unsetGucCount = await withOrg(pool, '', // empty string → unset GUC effectively
    `SELECT COUNT(*)::int AS n FROM competitor_analysis`);
  ok('Unset GUC (empty org_id) yields 0 visible rows',
     Number(unsetGucCount.rows[0]?.n) === 0);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await superPool.query(
    `DELETE FROM competitor_analysis WHERE org_id IN ($1,$2)`, [orgA, orgB]);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\ncompetitor_analysis RLS isolation — ${passed} passed, ${failed} failed\n`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
