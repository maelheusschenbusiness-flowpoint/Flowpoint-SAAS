/**
 * stripe-customer-migration.ts
 *
 * Diagnose and optionally repair Stripe customer duplication in FlowPoint.
 *
 * What it does:
 *  Phase 1 (always) — DIAGNOSTIC
 *   - Reads every org from org_settings + organizations
 *   - Lists all Stripe customers with flowpoint metadata (orgId / flowpointOrgId)
 *   - Groups customers per orgId
 *   - Identifies the canonical customer per org (active sub > trialing sub > payment
 *     method > most recent)
 *   - Prints a full report: duplicates, orphaned DB references, unlinked customers
 *
 *  Phase 2 (--apply only) — DB UPDATE
 *   - Updates org_settings.stripe_customer_id + organizations.stripe_customer_id to
 *     the canonical customer ID for every org that has the wrong (or missing) ID in DB
 *   - Never deletes any Stripe customer
 *   - Never cancels any subscription
 *
 * Usage:
 *   # Dry-run (read-only, safe to run any time):
 *   pnpm --filter api-server exec tsx scripts/stripe-customer-migration.ts
 *
 *   # Apply fixes:
 *   pnpm --filter api-server exec tsx scripts/stripe-customer-migration.ts --apply
 *
 * Requires: STRIPE_LIVE_API_KEY (or STRIPE_SECRET_KEY) + DATABASE_URL in env.
 */

import Stripe from "stripe";
import { pool } from "@workspace/db";

const DRY_RUN = !process.argv.includes("--apply");
const SEP = "─".repeat(80);

// ── Helpers ──────────────────────────────────────────────────────────────────

function pad(s: string, n: number) { return String(s ?? "").substring(0, n - 1).padEnd(n); }
function ts(d: number | null) { return d ? new Date(d * 1000).toISOString().substring(0, 10) : "—"; }

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgRow {
  org_id: string;
  db_customer_id: string | null;
  subscription_status: string | null;
  stripe_subscription_id: string | null;
  email: string | null;
}

interface CustomerSummary {
  id: string;
  email: string | null;
  name: string | null;
  created: number;
  orgId: string | null;         // from metadata
  hasActiveSub: boolean;
  hasTrialingSub: boolean;
  hasPaymentMethod: boolean;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  score: number;                // higher = more canonical
}

interface OrgGroup {
  orgId: string;
  dbCustomerId: string | null;
  dbSubId: string | null;
  dbStatus: string | null;
  email: string | null;
  customers: CustomerSummary[];
  canonical: CustomerSummary | null;
  issue: string;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  if (!stripeKey) {
    console.error("❌  STRIPE_LIVE_API_KEY / STRIPE_SECRET_KEY not set");
    process.exit(1);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-06-30.basil" as Parameters<typeof Stripe>[1]["apiVersion"] });
  const keyMode = stripeKey.startsWith("sk_live_") ? "LIVE 🔴" : "TEST 🟡";

  console.log(`\n${SEP}`);
  console.log(`FlowPoint — Stripe Customer Migration Diagnostic`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no writes)" : "APPLY"}  |  Stripe key: ${keyMode}`);
  console.log(`${SEP}\n`);

  // ── Phase 1a: Read DB ────────────────────────────────────────────────────
  const dbClient = await pool.connect();
  let orgRows: OrgRow[] = [];
  try {
    const r = await dbClient.query<OrgRow>(`
      SELECT
        os.org_id,
        COALESCE(NULLIF(org.stripe_customer_id,''), NULLIF(os.stripe_customer_id,'')) AS db_customer_id,
        os.subscription_status,
        os.stripe_subscription_id,
        os.email
      FROM org_settings os
      LEFT JOIN organizations org ON org.id = os.org_id
      ORDER BY os.org_id
    `);
    orgRows = r.rows;
  } finally {
    dbClient.release();
  }
  console.log(`DB: ${orgRows.length} org(s) found\n`);

  // ── Phase 1b: Read Stripe (all customers, paginated) ──────────────────────
  console.log("Fetching Stripe customers (paginated)…");
  const allStripeCustomers: Stripe.Customer[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;
  let page = 0;
  while (hasMore) {
    page++;
    const params: Stripe.CustomerListParams = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const page_data = await stripe.customers.list(params);
    for (const c of page_data.data) {
      if (c.object === "customer" && !c.deleted) allStripeCustomers.push(c);
    }
    hasMore = page_data.has_more;
    if (page_data.data.length > 0) startingAfter = page_data.data[page_data.data.length - 1].id;
    process.stdout.write(`\r  Page ${page} — ${allStripeCustomers.length} customers so far…`);
  }
  console.log(`\nStripe: ${allStripeCustomers.length} live customer(s) fetched\n`);

  // ── Phase 1c: Enrich each customer with subscription info ─────────────────
  console.log("Fetching subscriptions for each customer…");
  const customerSummaries: CustomerSummary[] = [];
  for (let i = 0; i < allStripeCustomers.length; i++) {
    const c = allStripeCustomers[i];
    process.stdout.write(`\r  ${i + 1}/${allStripeCustomers.length}`);

    const meta = (c.metadata ?? {}) as Record<string, string>;
    const orgId = meta["orgId"] || meta["flowpointOrgId"] || meta["org_id"] || null;

    // Fetch subscriptions for this customer
    let hasActiveSub = false;
    let hasTrialingSub = false;
    let subscriptionId: string | null = null;
    let subscriptionStatus: string | null = null;
    try {
      const subs = await stripe.subscriptions.list({ customer: c.id, limit: 5, status: "all" });
      for (const sub of subs.data) {
        if (sub.status === "active")   { hasActiveSub = true;    subscriptionId = sub.id; subscriptionStatus = "active";   }
        if (sub.status === "trialing") { hasTrialingSub = true; subscriptionId = subscriptionId ?? sub.id; subscriptionStatus = subscriptionStatus ?? "trialing"; }
      }
    } catch { /* non-fatal */ }

    // Fetch payment methods
    let hasPaymentMethod = false;
    try {
      const pms = await stripe.paymentMethods.list({ customer: c.id, type: "card", limit: 1 });
      hasPaymentMethod = pms.data.length > 0;
    } catch { /* non-fatal */ }

    // Score: higher = more canonical
    const score =
      (hasActiveSub   ? 1000 : 0) +
      (hasTrialingSub ? 500  : 0) +
      (hasPaymentMethod ? 100 : 0) +
      (orgId ? 10 : 0) +
      (c.email ? 5 : 0);

    customerSummaries.push({
      id: c.id,
      email: c.email ?? null,
      name: typeof c.name === "string" ? c.name : null,
      created: c.created,
      orgId,
      hasActiveSub,
      hasTrialingSub,
      hasPaymentMethod,
      subscriptionId,
      subscriptionStatus,
      score,
    });
  }
  console.log("\n");

  // ── Phase 1d: Group by orgId ──────────────────────────────────────────────
  // Build map: orgId → customers
  const byOrgId = new Map<string, CustomerSummary[]>();
  const unlinked: CustomerSummary[] = [];

  for (const cs of customerSummaries) {
    if (cs.orgId) {
      const arr = byOrgId.get(cs.orgId) ?? [];
      arr.push(cs);
      byOrgId.set(cs.orgId, arr);
    } else if (cs.email) {
      // Try to match by email against DB orgs
      const match = orgRows.find(r => r.email === cs.email || r.org_id === cs.email);
      if (match) {
        const arr = byOrgId.get(match.org_id) ?? [];
        arr.push(cs);
        byOrgId.set(match.org_id, arr);
      } else {
        unlinked.push(cs);
      }
    } else {
      unlinked.push(cs);
    }
  }

  // ── Phase 1e: Build per-org diagnosis ────────────────────────────────────
  const groups: OrgGroup[] = [];
  const dbUpdates: { orgId: string; newCustomerId: string; oldCustomerId: string | null }[] = [];

  for (const row of orgRows) {
    const customers = byOrgId.get(row.org_id) ?? [];

    // Sort by score desc, then created desc
    customers.sort((a, b) => b.score - a.score || b.created - a.created);
    const canonical = customers[0] ?? null;

    // Determine issue
    let issue = "ok";
    if (!canonical && row.db_customer_id) issue = "orphaned_db_ref";
    else if (!canonical && !row.db_customer_id) issue = "no_customer";
    else if (customers.length > 1) issue = "duplicates";
    else if (canonical && row.db_customer_id && canonical.id !== row.db_customer_id) issue = "db_mismatch";
    else if (canonical && !row.db_customer_id) issue = "db_missing";

    if ((issue === "db_mismatch" || issue === "db_missing") && canonical) {
      dbUpdates.push({ orgId: row.org_id, newCustomerId: canonical.id, oldCustomerId: row.db_customer_id });
    }

    groups.push({
      orgId: row.org_id,
      dbCustomerId: row.db_customer_id,
      dbSubId: row.stripe_subscription_id,
      dbStatus: row.subscription_status,
      email: row.email,
      customers,
      canonical,
      issue,
    });
  }

  // ── Phase 2: Print report ─────────────────────────────────────────────────
  const issues = groups.filter(g => g.issue !== "ok" && g.issue !== "no_customer");
  const duplicateGroups = groups.filter(g => g.issue === "duplicates");
  const orphaned = groups.filter(g => g.issue === "orphaned_db_ref");
  const mismatched = groups.filter(g => g.issue === "db_mismatch" || g.issue === "db_missing");
  const ok = groups.filter(g => g.issue === "ok");

  console.log(`${SEP}`);
  console.log(`SUMMARY`);
  console.log(`${SEP}`);
  console.log(`  Total orgs in DB:              ${orgRows.length}`);
  console.log(`  Total Stripe customers:         ${allStripeCustomers.length}`);
  console.log(`  Orgs with correct customer:     ${ok.length}`);
  console.log(`  Orgs with duplicate customers:  ${duplicateGroups.length}`);
  console.log(`  Orgs with orphaned DB ref:      ${orphaned.length}`);
  console.log(`  Orgs with DB mismatch/missing:  ${mismatched.length}`);
  console.log(`  Unlinked Stripe customers:      ${unlinked.length}`);
  console.log(`  DB updates required:            ${dbUpdates.length}\n`);

  // ─── Duplicates ────────────────────────────────────────────────────────────
  if (duplicateGroups.length > 0) {
    console.log(`\n${SEP}`);
    console.log(`DUPLICATE CUSTOMERS (${duplicateGroups.length} org(s))`);
    console.log(`${SEP}`);
    for (const g of duplicateGroups) {
      console.log(`\nOrg: ${g.orgId}`);
      console.log(`  DB customer:  ${g.dbCustomerId ?? "(none)"}`);
      console.log(`  Canonical:    ${g.canonical?.id ?? "none"} (score ${g.canonical?.score ?? 0})`);
      console.log(`  All customers (${g.customers.length}):`);
      for (const c of g.customers) {
        const marker = c.id === g.canonical?.id ? "★ CANONICAL" : "  orphan   ";
        console.log(`    ${marker}  ${c.id}  email=${c.email ?? "—"}  sub=${c.subscriptionStatus ?? "—"}  pm=${c.hasPaymentMethod}  created=${ts(c.created)}`);
      }
    }
  }

  // ─── DB mismatches ─────────────────────────────────────────────────────────
  if (mismatched.length > 0) {
    console.log(`\n${SEP}`);
    console.log(`DB MISMATCH / MISSING CUSTOMER ID (${mismatched.length} org(s))`);
    console.log(`${SEP}`);
    console.log(["ORG".padEnd(38), "DB_CUSTOMER".padEnd(22), "→", "CANONICAL_CUSTOMER"].join("  "));
    console.log("─".repeat(90));
    for (const g of mismatched) {
      console.log([
        pad(g.orgId, 38),
        pad(g.dbCustomerId ?? "(none)", 22),
        "→",
        g.canonical?.id ?? "(none)",
      ].join("  "));
    }
  }

  // ─── Orphaned DB refs ──────────────────────────────────────────────────────
  if (orphaned.length > 0) {
    console.log(`\n${SEP}`);
    console.log(`ORPHANED DB REFERENCES — customer in DB but not found in Stripe (${orphaned.length})`);
    console.log(`${SEP}`);
    for (const g of orphaned) {
      console.log(`  ${g.orgId.padEnd(38)}  DB ref: ${g.dbCustomerId}  (not found in Stripe — possibly deleted or wrong env)`);
    }
  }

  // ─── Unlinked customers ───────────────────────────────────────────────────
  if (unlinked.length > 0) {
    console.log(`\n${SEP}`);
    console.log(`UNLINKED STRIPE CUSTOMERS — no orgId metadata, no email match (${unlinked.length})`);
    console.log(`${SEP}`);
    console.log(["CUSTOMER_ID".padEnd(22), "EMAIL".padEnd(30), "NAME".padEnd(25), "SUB_STATUS".padEnd(12), "PM", "CREATED"].join("  "));
    console.log("─".repeat(110));
    for (const c of unlinked) {
      console.log([
        pad(c.id, 22),
        pad(c.email ?? "—", 30),
        pad(c.name ?? "—", 25),
        pad(c.subscriptionStatus ?? "—", 12),
        c.hasPaymentMethod ? "yes" : "no ",
        ts(c.created),
      ].join("  "));
    }
  }

  // ── Phase 3: Apply DB updates (--apply only) ──────────────────────────────
  if (!DRY_RUN && dbUpdates.length > 0) {
    console.log(`\n${SEP}`);
    console.log(`APPLYING ${dbUpdates.length} DB UPDATE(S)…`);
    console.log(`${SEP}`);

    const applyClient = await pool.connect();
    try {
      await applyClient.query("BEGIN");
      let applied = 0;
      for (const u of dbUpdates) {
        // Update org_settings
        await applyClient.query(
          `UPDATE org_settings SET stripe_customer_id = $1, updated_at = NOW() WHERE org_id = $2`,
          [u.newCustomerId, u.orgId]
        );
        // Update organizations (may not exist for all orgs)
        await applyClient.query(
          `UPDATE organizations SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2`,
          [u.newCustomerId, u.orgId]
        );
        console.log(`  ✅ ${u.orgId.substring(0, 36).padEnd(38)}  ${u.oldCustomerId ?? "(none)"} → ${u.newCustomerId}`);
        applied++;
      }
      await applyClient.query("COMMIT");
      console.log(`\n✅ APPLIED: ${applied} org(s) updated.\n`);
    } catch (err) {
      await applyClient.query("ROLLBACK").catch(() => {});
      console.error(`\n❌ ERROR: ${err}\n   All changes rolled back.`);
    } finally {
      applyClient.release();
    }
  } else if (DRY_RUN) {
    if (dbUpdates.length > 0) {
      console.log(`\n🔵 DRY-RUN: ${dbUpdates.length} DB update(s) pending.`);
      console.log("   Run with --apply to apply them.\n");
    } else {
      console.log("\n✅ No DB updates required — all org→customer links are consistent.\n");
    }
  }

  // ── JSON report output ────────────────────────────────────────────────────
  const reportPath = "/tmp/stripe-migration-report.json";
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    stripeMode: stripeKey.startsWith("sk_live_") ? "live" : "test",
    summary: {
      totalOrgs: orgRows.length,
      totalStripeCustomers: allStripeCustomers.length,
      orgsOk: ok.length,
      duplicateGroups: duplicateGroups.length,
      orphanedDbRefs: orphaned.length,
      dbMismatches: mismatched.length,
      unlinkedCustomers: unlinked.length,
      dbUpdatesRequired: dbUpdates.length,
    },
    duplicates: duplicateGroups.map(g => ({
      orgId: g.orgId,
      dbCustomerId: g.dbCustomerId,
      canonicalCustomerId: g.canonical?.id ?? null,
      allCustomerIds: g.customers.map(c => ({
        id: c.id,
        email: c.email,
        subscriptionStatus: c.subscriptionStatus,
        hasPaymentMethod: c.hasPaymentMethod,
        created: ts(c.created),
        score: c.score,
      })),
    })),
    dbUpdates,
    orphanedDbRefs: orphaned.map(g => ({ orgId: g.orgId, dbCustomerId: g.dbCustomerId })),
    unlinkedCustomers: unlinked.map(c => ({ id: c.id, email: c.email, subscriptionStatus: c.subscriptionStatus, hasPaymentMethod: c.hasPaymentMethod })),
  };

  const fs = await import("fs");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 JSON report written to ${reportPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
