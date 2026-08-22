import { db, orgAddonsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { store } from "./store.js";
import { ADDON_DEFINITIONS as CANONICAL_ADDON_DEFINITIONS, FLAG_ADDONS, QTY_ADDONS, PLAN_DEFINITIONS, computeQtyAddonExtras } from "../lib/plans.js";

export const ADDON_DEFINITIONS: Record<string, {
  name: string; category: string; description: string; price: string; isFlagAddon: boolean;
}> = Object.fromEntries(Object.entries(CANONICAL_ADDON_DEFINITIONS).map(([key, definition]) => [key, {
  name: definition.name,
  category: definition.category,
  description: definition.description,
  price: `${definition.priceEur}€${definition.oneTime ? "" : "/mois"}`,
  isFlagAddon: FLAG_ADDONS.has(key),
}]));

export async function activateAddon(addonKey: string, orgId = "default", quantity = 1): Promise<boolean> {
  if (!ADDON_DEFINITIONS[addonKey]) {
    logger.warn({ addonKey }, "[Addons] Unknown addon key");
    return false;
  }
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  try {
    const id = `oa_${orgId}_${addonKey}`;
    await db.insert(orgAddonsTable).values({
      id,
      orgId,
      addonKey,
      active: true,
      quantity: qty,
      activatedAt: new Date(),
      metadata: { source: "manual" },
    }).onConflictDoNothing();

    const client = await (await import("@workspace/db")).pool.connect();
    try {
      await client.query(
        `UPDATE org_addons SET active = true, quantity = $3, activated_at = NOW(), updated_at = NOW() WHERE org_id = $1 AND addon_key = $2`,
        [orgId, addonKey, qty]
      );
    } finally {
      client.release();
    }

    applyAddonToStore(addonKey, true);
    store.broadcast({ type: "addon:activated", addonKey }, orgId);
    store.logActivity({ type: "team", label: `Add-on activé : ${ADDON_DEFINITIONS[addonKey]?.name ?? addonKey}`, metadata: { addonKey }, orgId,
      userId: "system", userName: "Stripe Webhook" }).catch(err => logger.warn({ err: err?.message }, "logActivity failed"));

    logger.info({ addonKey, orgId }, "[Addons] Addon activated");
    return true;
  } catch (err) {
    logger.error({ err, addonKey }, "[Addons] Failed to activate addon");
    return false;
  }
}

export async function deactivateAddon(addonKey: string, orgId = "default"): Promise<boolean> {
  if (!ADDON_DEFINITIONS[addonKey]) {
    logger.warn({ addonKey }, "[Addons] Unknown addon key — deactivate ignored");
    return false;
  }
  try {
    const client = await (await import("@workspace/db")).pool.connect();
    let rowCount = 0;
    try {
      const result = await client.query(
        `UPDATE org_addons SET active = false, updated_at = NOW() WHERE org_id = $1 AND addon_key = $2`,
        [orgId, addonKey]
      );
      rowCount = result.rowCount ?? 0;
    } finally {
      client.release();
    }
    if (rowCount === 0) {
      // No row existed — addon was never activated; treat as a no-op success so
      // the caller doesn't attempt Stripe compensation for something that was never billed.
      logger.info({ addonKey, orgId }, "[Addons] deactivateAddon: no row found — already inactive");
      return false;
    }
    applyAddonToStore(addonKey, false);
    store.broadcast({ type: "addon:deactivated", addonKey }, orgId);
    store.logActivity({ type: "team", label: `Add-on désactivé : ${ADDON_DEFINITIONS[addonKey]?.name ?? addonKey}`, metadata: { addonKey }, orgId,
      userId: "system", userName: "Stripe Webhook" }).catch(err => logger.warn({ err: err?.message }, "logActivity failed"));
    logger.info({ addonKey, orgId }, "[Addons] Addon deactivated");
    return true;
  } catch (err) {
    logger.error({ err, addonKey }, "[Addons] Failed to deactivate addon");
    return false;
  }
}

export async function getOrgAddons(orgId = "default"): Promise<Record<string, boolean | number>> {
  try {
    const rows = await db.select().from(orgAddonsTable).where(eq(orgAddonsTable.orgId, orgId));
    const result: Record<string, boolean | number> = {};
    for (const row of rows) {
      const active = row.active ?? false;
      // Quantity add-ons carry their pack count so quota expansion multiplies
      // per pack; flag add-ons stay boolean.
      if (active && QTY_ADDONS.has(row.addonKey)) {
        result[row.addonKey] = Math.max(1, Number((row as { quantity?: number }).quantity ?? 1));
      } else {
        result[row.addonKey] = active;
      }
    }
    return result;
  } catch {
    // Never fall back to store.me (cross-tenant contamination risk).
    // Return empty — caller can decide the safe default.
    return {};
  }
}

export function applyAddonToStore(addonKey: string, active: boolean | number): void {
  const addons = store.me.addons as Record<string, boolean | number>;
  addons[addonKey] = active;
}

/**
 * Provisions every add-on that is bundled in the given plan by writing it into
 * org_addons.  Uses onConflictDoNothing so repeated calls are idempotent.
 * Fire-and-forget: callers do not need to await the result in webhook handlers.
 *
 * @param activator - injectable activator fn (defaults to activateAddon); pass a
 *   stub in unit tests to avoid live DB calls while still verifying provisioning logic.
 */
export async function provisionPlanAddons(
  plan: string,
  orgId: string,
  activator: (key: string, orgId: string) => Promise<boolean> = activateAddon,
): Promise<void> {
  const { PLAN_INCLUDED_ADDONS } = await import("../lib/plans.js");
  const included = PLAN_INCLUDED_ADDONS[plan.toLowerCase()] ?? new Set<string>();
  if (!included.size) return;
  const keys = Array.from(included);
  const results = await Promise.allSettled(keys.map(key => activator(key, orgId)));
  const failed = results
    .map((r, i) => (r.status === "rejected" || (r.status === "fulfilled" && !r.value)) ? keys[i] : null)
    .filter((k): k is string => k !== null);
  if (failed.length) {
    logger.warn({ plan, orgId, failed }, "[Addons] Some plan-bundled addons failed to provision");
  } else {
    logger.info({ plan, orgId, count: included.size }, "[Addons] Plan-bundled addons provisioned");
  }
}

export async function addExtraAICredits(pack: "50k" | "200k" | "500k", orgId = "default"): Promise<number> {
  const packMap = { "50k": 50000, "200k": 200000, "500k": 500000 };
  const credits = packMap[pack];
  // NOTE: extra credits are recorded in ai_credit_purchases (Stripe webhook handles that).
  // ai_monthly_usage no longer stores credits_extra — limit comes exclusively from plans.ts.
  store.broadcast({ type: "ai:credits_added", credits, pack }, orgId);
  return credits;
}

export function getQuotaLimits(plan: string, addons: Record<string, boolean | number>): {
  audits: number; monitors: number; reports: number; exports: number; seats: number; retention: number;
} {
  const definition = PLAN_DEFINITIONS[plan.toLowerCase()] ?? PLAN_DEFINITIONS["standard"];
  // Canonical per-pack expansion — QTY_ADDON_GRANTS is the single source of truth.
  const extras = computeQtyAddonExtras(addons);
  const limits = {
    audits:  definition.limits.audits      + (extras["audits"]      ?? 0),
    monitors: definition.limits.monitors   + (extras["monitors"]    ?? 0),
    reports: definition.limits.reports     + (extras["reports"]     ?? 0),
    exports: definition.limits.exports     + (extras["exports"]     ?? 0),
    seats:   definition.limits.teamMembers + (extras["teamMembers"] ?? 0),
    retention: definition.limits.retention,
  };

  if (addons.retention365d)  limits.retention = 365;
  else if (addons.retention90d) limits.retention = 90;

  return limits;
}
