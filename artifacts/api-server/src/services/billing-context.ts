/**
 * billing-context.ts — Per-request billing state loaded from DB.
 *
 * All billing decisions (subscription guards, trial checks, plan gates) must
 * read from this context rather than from the in-memory store singleton.
 *
 * The store singleton (store.me) is only authoritative for SSE pub/sub;
 * it MUST NOT be used as the source of truth for any per-tenant billing decision.
 */

import { pool } from "@workspace/db";
import { loadOrgSettings } from "./org-settings.js";
import { logger } from "../lib/logger.js";

export interface BillingContext {
  /** Current subscription status from org_settings.subscription_status */
  subscriptionStatus: string | null;
  /** Current plan from org_settings.plan */
  plan: string;
  /** Stripe customer ID from org_settings.stripe_customer_id */
  stripeCustomerId: string | null;
  /** Trial end ISO string from org_settings.trial_ends_at */
  trialEndsAt: string | null;
  /** Contact email from org_settings.email */
  email: string | null;
  /** First name from org_settings.first_name */
  firstName: string | null;
  /** Organisation name from org_settings.org_name */
  orgName: string | null;
  /** Active add-ons from org_addons table (keyed by addon_key) */
  addons: Record<string, boolean | number>;
}

/**
 * Load all billing-relevant fields for the given org from the database.
 * Always reads from DB — never from the in-memory store singleton.
 * Safe for concurrent requests from different organisations.
 */
export async function loadBillingContext(orgId: string): Promise<BillingContext> {
  const [settings, addonsResult] = await Promise.all([
    loadOrgSettings(orgId).catch(err => {
      logger.warn({ err, orgId }, "[BillingContext] loadOrgSettings failed");
      return null;
    }),
    (async () => {
      const client = await pool.connect();
      try {
        return await client.query<{ addon_key: string; active: boolean }>(
          `SELECT addon_key, active
           FROM org_addons
           WHERE org_id = $1`,
          [orgId]
        );
      } finally {
        client.release();
      }
    })().catch(err => {
      logger.warn({ err, orgId }, "[BillingContext] org_addons query failed");
      return { rows: [] as { addon_key: string; active: boolean }[] };
    }),
  ]);

  // Build addons map from org_addons table (the canonical source)
  const addons: Record<string, boolean | number> = {};
  for (const row of addonsResult.rows) {
    addons[row.addon_key] = row.active;
  }

  // Merge addons from org_settings.addons JSONB as supplemental data
  // (org_addons table takes precedence when both exist for the same key)
  if (settings?.addons && typeof settings.addons === "object") {
    for (const [key, val] of Object.entries(settings.addons)) {
      if (!(key in addons)) {
        addons[key] = val as boolean | number;
      }
    }
  }

  return {
    subscriptionStatus: settings?.subscriptionStatus ?? null,
    plan: settings?.plan ?? "standard",
    stripeCustomerId: settings?.stripeCustomerId ?? null,
    trialEndsAt: settings?.trialEndsAt ?? null,
    email: settings?.email ?? null,
    firstName: settings?.firstName ?? null,
    orgName: settings?.orgName ?? null,
    addons,
  };
}
