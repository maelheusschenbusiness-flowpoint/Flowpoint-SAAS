/**
 * billing-migration-dryrun.ts
 *
 * Dry-run migration script for the billing state-machine corrections.
 *
 * What it checks/fixes:
 *  1. Old fake trials (subscription_status='trialing' WITH NO stripe_subscription_id)
 *     → reclassified to 'pending_billing'
 *
 *  2. Impossible 'active' rows (subscription_status='active' WITH NO stripe_subscription_id)
 *     → reclassified to 'pending_billing'
 *
 *  3. Orphaned 'trialing' rows WHERE trial_ends_at is in the past AND no stripe_subscription_id
 *     → reclassified to 'pending_billing'
 *
 *  4. Missing trial_consumed_at on rows that have a real stripe_subscription_id with status 'trialing'
 *     → sets trial_consumed_at = NOW() (idempotent: skipped if already set)
 *
 * Usage:
 *   # Dry-run (no writes):
 *   pnpm --filter api-server exec tsx scripts/billing-migration-dryrun.ts
 *
 *   # Apply fixes:
 *   pnpm --filter api-server exec tsx scripts/billing-migration-dryrun.ts --apply
 *
 * Safety:
 *   - The script connects directly to the DATABASE_URL in the current environment.
 *   - All changes are wrapped in a single transaction and ROLLBACKed in dry-run mode.
 *   - A summary table is printed before any commit.
 */

import { Pool } from "pg";

const DRY_RUN = !process.argv.includes("--apply");

const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] || process.env["SUPABASE_URL"],
  max: 1,
});

interface MigrationRow {
  org_id: string;
  current_status: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  trial_ends_at: string | null;
  trial_consumed_at: string | null;
  action: string;
  new_status: string | null;
}

async function main(): Promise<void> {
  const client = await pool.connect();
  console.log(`\n${"─".repeat(70)}`);
  console.log(`FlowPoint Billing Migration — ${DRY_RUN ? "DRY-RUN (no writes)" : "APPLY MODE"}`);
  console.log(`${"─".repeat(70)}\n`);

  try {
    await client.query("BEGIN");

    // ── 1. Fetch all org_settings rows for audit ──────────────────────────────
    const { rows } = await client.query<{
      org_id: string;
      subscription_status: string | null;
      stripe_subscription_id: string | null;
      stripe_customer_id: string | null;
      trial_ends_at: string | null;
      trial_consumed_at: string | null;
    }>(`
      SELECT
        org_id,
        subscription_status,
        stripe_subscription_id,
        stripe_customer_id,
        trial_ends_at,
        trial_consumed_at
      FROM org_settings
      ORDER BY org_id
    `);

    const changes: MigrationRow[] = [];

    for (const row of rows) {
      const {
        org_id,
        subscription_status: status,
        stripe_subscription_id: subId,
        stripe_customer_id: custId,
        trial_ends_at: trialEnd,
        trial_consumed_at: trialConsumed,
      } = row;

      // Rule 1: trialing with no Stripe subscription → pending_billing
      if (status === "trialing" && !subId) {
        changes.push({
          org_id,
          current_status: status,
          stripe_subscription_id: subId,
          stripe_customer_id: custId,
          trial_ends_at: trialEnd,
          trial_consumed_at: trialConsumed,
          action: "fake_trial→pending_billing",
          new_status: "pending_billing",
        });
        if (!DRY_RUN) {
          await client.query(
            `UPDATE org_settings
             SET subscription_status = 'pending_billing',
                 trial_ends_at       = NULL,
                 updated_at          = NOW()
             WHERE org_id = $1`,
            [org_id]
          );
        }
        continue;
      }

      // Rule 2: 'active' with no Stripe subscription → pending_billing
      if (status === "active" && !subId) {
        changes.push({
          org_id,
          current_status: status,
          stripe_subscription_id: subId,
          stripe_customer_id: custId,
          trial_ends_at: trialEnd,
          trial_consumed_at: trialConsumed,
          action: "impossible_active→pending_billing",
          new_status: "pending_billing",
        });
        if (!DRY_RUN) {
          await client.query(
            `UPDATE org_settings
             SET subscription_status = 'pending_billing',
                 updated_at          = NOW()
             WHERE org_id = $1`,
            [org_id]
          );
        }
        continue;
      }

      // Rule 3: trialing with real Stripe sub but missing trial_consumed_at → backfill
      if (status === "trialing" && subId && !trialConsumed) {
        changes.push({
          org_id,
          current_status: status,
          stripe_subscription_id: subId,
          stripe_customer_id: custId,
          trial_ends_at: trialEnd,
          trial_consumed_at: trialConsumed,
          action: "backfill_trial_consumed_at",
          new_status: null,
        });
        if (!DRY_RUN) {
          await client.query(
            `UPDATE org_settings
             SET trial_consumed_at = COALESCE(created_at, NOW()),
                 trial_started_at  = COALESCE(created_at, NOW()),
                 updated_at        = NOW()
             WHERE org_id = $1`,
            [org_id]
          );
        }
        continue;
      }
    }

    // ── Print summary ─────────────────────────────────────────────────────────
    console.log(`Total orgs scanned: ${rows.length}`);
    console.log(`Changes required:   ${changes.length}\n`);

    if (changes.length > 0) {
      console.log("Changes:");
      console.log(
        ["org_id".padEnd(35), "current_status".padEnd(18), "action".padEnd(35), "new_status"].join(" | ")
      );
      console.log("-".repeat(100));
      for (const c of changes) {
        console.log(
          [
            (c.org_id || "").substring(0, 34).padEnd(35),
            (c.current_status || "null").padEnd(18),
            c.action.padEnd(35),
            c.new_status || "(no status change)",
          ].join(" | ")
        );
      }
    } else {
      console.log("✅ No changes required — billing states are consistent.");
    }

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("\n🔵 DRY-RUN: all changes rolled back.");
      console.log("   Run with --apply to apply them.\n");
    } else {
      await client.query("COMMIT");
      console.log(`\n✅ APPLIED: ${changes.length} change(s) committed.\n`);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n❌ Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
