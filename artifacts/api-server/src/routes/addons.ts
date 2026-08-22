import { Router, type Request, type Response } from "express";
import { activateAddon, deactivateAddon, getOrgAddons, addExtraAICredits, getQuotaLimits, ADDON_DEFINITIONS } from "../services/addons-service.js";
import { store } from "../services/store.js";
import { loadOrgData } from "../services/org-data.js";
import { ownerOnly } from "../middlewares/requireRole.js";
import { PLAN_INCLUDED_ADDONS, ADDON_DEFINITIONS as CANONICAL_ADDON_DEFINITIONS } from "../lib/plans.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/addons", async (req: Request, res: Response) => {
  try {
    const orgId = (req as Request & { orgId?: string }).orgId ?? "default";
    const dbData = await loadOrgData(orgId).catch(() => null);
    const plan = (dbData?.plan || "standard").toLowerCase();
    const orgAddons = await getOrgAddons(orgId);
    // Use DB-sourced addons — never the store.me singleton (cross-tenant contamination risk).
    // org_addons is the source of truth; legacy org_settings JSON only fills gaps.
    const liveAddons: Record<string, boolean | number> = { ...((dbData?.addons ?? {}) as Record<string, boolean | number>), ...(orgAddons ?? {}) };
    // Overlay plan-bundled addons so subscribers see entitlements without manual activation.
    const planIncluded = PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>();
    for (const key of planIncluded) {
      if (!(key in liveAddons)) liveAddons[key] = true;
    }
    const quotas = getQuotaLimits(plan, liveAddons);
    const catalog = Object.fromEntries(Object.entries(CANONICAL_ADDON_DEFINITIONS).map(([key, definition]) => [key, {
      ...definition,
      active: liveAddons[key] ?? false,
      includedInPlan: planIncluded.has(key),
    }]));
    res.json({
      addons: liveAddons,
      orgAddons,
      definitions: catalog,
      quotas,
      plan,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch addons" });
  }
});

router.post("/addons/:key/activate", ownerOnly, async (req: Request, res: Response) => {
  const key = String(req.params["key"] ?? "");
  const orgId = (req as Request & { orgId?: string }).orgId ?? "default";
  if (!ADDON_DEFINITIONS[key]) {
    res.status(400).json({ error: "Unknown addon key" }); return;
  }
  // Optional quantity (quantity add-ons only) — clamped 1..20 to match the UI.
  const rawQty = (req.body as { quantity?: unknown } | undefined)?.quantity;
  const quantity = Math.min(20, Math.max(1, Math.floor(Number(rawQty ?? 1)) || 1));
  const dbData = await loadOrgData(orgId).catch(() => null);
  const plan = String(dbData?.plan ?? "standard").toLowerCase();
  if ((PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>()).has(key)) {
    // Included capabilities are entitlements, never a separately billable
    // add-on. Do not call Stripe or create an org_addons duplicate.
    res.json({ ok: true, addonKey: key, includedInPlan: true, addons: await getOrgAddons(orgId) });
    return;
  }
  // Bill the paid add-on on the existing Stripe subscription BEFORE granting access.
  // A Stripe failure — OR any unsynced result — must not create a free paid feature.
  // Grant is allowed ONLY when Stripe actually carries the item (synced:true) or the
  // add-on is bundled in the plan (included_in_plan → nothing to bill).
  const { syncAddonWithStripe } = await import("../services/addon-stripe-sync.js");
  const stripeSync = await syncAddonWithStripe(orgId, key, "activate", quantity);
  const billingSecured = stripeSync.synced === true || stripeSync.reason === "included_in_plan";
  if (!billingSecured) {
    const statusByReason: Record<string, { code: number; msg: string }> = {
      stripe_error:         { code: 502, msg: "La facturation Stripe de l'add-on a échoué — activation annulée" },
      no_live_subscription: { code: 402, msg: "Un abonnement actif est requis pour activer cet add-on — passez par la page Tarifs" },
      no_subscription_id:   { code: 402, msg: "Aucun abonnement Stripe trouvé — passez par la page Tarifs pour activer cet add-on" },
      no_stripe_key:        { code: 503, msg: "Service de facturation indisponible — activation annulée" },
      no_price_id:          { code: 422, msg: "Aucun prix Stripe configuré pour cet add-on — contactez le support" },
      one_time_addon:       { code: 422, msg: "Cet add-on s'achète en paiement unique — utilisez le checkout dédié" },
    };
    const mapped = statusByReason[stripeSync.reason] ?? { code: 402, msg: "Facturation non confirmée — activation annulée" };
    logger.warn({ orgId, addonKey: key, reason: stripeSync.reason }, "[Addons] activation blocked — Stripe billing not secured");
    res.status(mapped.code).json({ error: mapped.msg, stripe: stripeSync });
    return;
  }
  const ok = await activateAddon(key, orgId, quantity);
  if (ok) {
    const _actCtx = (req as Request & { orgContext?: { userId?: string; email?: string; name?: string } }).orgContext;
    store.logActivity({ type: "billing", label: `Add-on activé : ${key}`, targetId: key, targetType: "addon", orgId,
      actionKey: "activity.addon.activated", actionParams: { key },
      userId: _actCtx?.userId ?? _actCtx?.email, userName: _actCtx?.name ?? _actCtx?.email }).catch(err => console.warn("[logActivity]", err?.message));
    store.broadcast({ type: "fp:addon:activated", addonKey: key }, orgId);
    const freshAddons = await getOrgAddons(orgId);
    res.json({ ok: true, addonKey: key, addons: freshAddons, stripe: stripeSync });
  } else {
    // DB grant failed after a successful Stripe add — roll the Stripe item back.
    if (stripeSync.synced && stripeSync.reason === "item_added") {
      await syncAddonWithStripe(orgId, key, "deactivate").catch(() => {});
    }
    res.status(500).json({ error: "Failed to activate addon" });
  }
});

router.post("/addons/:key/deactivate", ownerOnly, async (req: Request, res: Response) => {
  const key = String(req.params["key"] ?? "");
  const orgId = (req as Request & { orgId?: string }).orgId ?? "default";

  // Validate key against known definitions before touching Stripe or DB.
  if (!ADDON_DEFINITIONS[key]) {
    res.status(400).json({ error: "Unknown addon key" }); return;
  }

  // Capture current quantity BEFORE revoking so a failed-Stripe compensation
  // restores the exact same entitlement (not a default of 1 pack).
  let priorQuantity = 1;
  try {
    const { pool } = await import("@workspace/db");
    const q = await pool.query<{ quantity: number | null }>(
      `SELECT quantity FROM org_addons WHERE org_id = $1 AND addon_key = $2`,
      [orgId, key]
    );
    priorQuantity = Math.max(1, Number(q.rows[0]?.quantity ?? 1));
  } catch { /* default 1 */ }

  // Order: revoke in DB first, then remove from Stripe.
  // If DB succeeds but Stripe fails → compensation: re-activate in DB (customer not yet billed).
  // If DB fails → Stripe is never touched → nothing to compensate.
  const ok = await deactivateAddon(key, orgId);
  if (!ok) {
    res.status(500).json({ ok: false, error: "La désactivation en base a échoué", addonKey: key });
    return;
  }

  const _deactCtx = (req as Request & { orgContext?: { userId?: string; email?: string; name?: string } }).orgContext;
  store.logActivity({ type: "billing", label: `Add-on désactivé : ${key}`, targetId: key, targetType: "addon", orgId,
    actionKey: "activity.addon.deactivated", actionParams: { key },
    userId: _deactCtx?.userId ?? _deactCtx?.email, userName: _deactCtx?.name ?? _deactCtx?.email }).catch(err => console.warn("[logActivity]", err?.message));
  store.broadcast({ type: "fp:addon:deactivated", addonKey: key }, orgId);

  // Now stop Stripe billing. If this fails, compensate by re-activating in DB so the two
  // sides stay in sync — the customer must not keep paying for a disabled feature.
  const { syncAddonWithStripe } = await import("../services/addon-stripe-sync.js");
  const stripeSync = await syncAddonWithStripe(orgId, key, "deactivate");
  if (stripeSync.reason === "stripe_error") {
    // Stripe removal failed — re-activate in DB so the addon stays accessible while
    // still billed; a sync error is raised so ops can retry the Stripe removal.
    const { activateAddon } = await import("../services/addons-service.js");
    await activateAddon(key, orgId, priorQuantity).catch(() => {});
    res.status(502).json({
      ok: false,
      error: "L'arrêt de la facturation Stripe a échoué — la désactivation a été annulée",
      addonKey: key,
      stripe: stripeSync,
    });
    return;
  }

  const freshAddons = await getOrgAddons(orgId);
  res.json({ ok: true, addonKey: key, addons: freshAddons, stripe: stripeSync });
});

router.post("/addons/ai-credits/buy", async (req: Request, res: Response) => {
  const { pack } = req.body as { pack?: string };
  if (!pack || !["50k", "200k", "500k"].includes(pack)) {
    res.status(400).json({ error: "Pack must be 50k, 200k or 500k" }); return;
  }
  const credits = await addExtraAICredits(pack as "50k" | "200k" | "500k");
  res.json({ ok: true, creditsAdded: credits, pack });
});

export default router;
