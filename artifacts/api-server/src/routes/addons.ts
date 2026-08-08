import { Router, type Request, type Response } from "express";
import { activateAddon, deactivateAddon, getOrgAddons, addExtraAICredits, getQuotaLimits, ADDON_DEFINITIONS } from "../services/addons-service.js";
import { store } from "../services/store.js";
import { loadOrgData } from "../services/org-data.js";
import { ownerOnly } from "../middlewares/requireRole.js";
import { PLAN_INCLUDED_ADDONS } from "../lib/plans.js";

const router = Router();

router.get("/addons", async (req: Request, res: Response) => {
  try {
    const orgId = (req as Request & { orgId?: string }).orgId ?? "default";
    const dbData = await loadOrgData(orgId).catch(() => null);
    const plan = (dbData?.plan || "standard").toLowerCase();
    const orgAddons = await getOrgAddons(orgId);
    // Use DB-sourced addons — never the store.me singleton (cross-tenant contamination risk).
    // org_addons is the source of truth; legacy org_settings JSON only fills gaps.
    const liveAddons: Record<string, boolean | number> = { ...(dbData?.addons ?? {}), ...(orgAddons ?? {}) };
    // Overlay plan-bundled addons so subscribers see entitlements without manual activation.
    const planIncluded = PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>();
    for (const key of planIncluded) {
      if (!(key in liveAddons)) liveAddons[key] = true;
    }
    const quotas = getQuotaLimits(plan, liveAddons);
    res.json({
      addons: liveAddons,
      orgAddons,
      definitions: ADDON_DEFINITIONS,
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
  const dbData = await loadOrgData(orgId).catch(() => null);
  const plan = String(dbData?.plan ?? "standard").toLowerCase();
  if ((PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>()).has(key)) {
    // Included capabilities are entitlements, never a separately billable
    // add-on. Do not call Stripe or create an org_addons duplicate.
    res.json({ ok: true, addonKey: key, includedInPlan: true, addons: await getOrgAddons(orgId) });
    return;
  }
  // Bill the paid add-on on the existing Stripe subscription BEFORE granting access.
  // A Stripe failure must not result in a free paid feature.
  const { syncAddonWithStripe } = await import("../services/addon-stripe-sync.js");
  const stripeSync = await syncAddonWithStripe(orgId, key, "activate");
  if (stripeSync.reason === "stripe_error") {
    res.status(502).json({ error: "La facturation Stripe de l'add-on a échoué — activation annulée", stripe: stripeSync });
    return;
  }
  const ok = await activateAddon(key, orgId);
  if (ok) {
    store.logActivity({ type: "billing", label: `Add-on activé : ${key}`, targetId: key, targetType: "addon", orgId }).catch(err => console.warn("[logActivity]", err?.message));
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

  // Order: revoke in DB first, then remove from Stripe.
  // If DB succeeds but Stripe fails → compensation: re-activate in DB (customer not yet billed).
  // If DB fails → Stripe is never touched → nothing to compensate.
  const ok = await deactivateAddon(key, orgId);
  if (!ok) {
    res.status(500).json({ ok: false, error: "La désactivation en base a échoué", addonKey: key });
    return;
  }

  store.logActivity({ type: "billing", label: `Add-on désactivé : ${key}`, targetId: key, targetType: "addon", orgId }).catch(err => console.warn("[logActivity]", err?.message));
  store.broadcast({ type: "fp:addon:deactivated", addonKey: key }, orgId);

  // Now stop Stripe billing. If this fails, compensate by re-activating in DB so the two
  // sides stay in sync — the customer must not keep paying for a disabled feature.
  const { syncAddonWithStripe } = await import("../services/addon-stripe-sync.js");
  const stripeSync = await syncAddonWithStripe(orgId, key, "deactivate");
  if (stripeSync.reason === "stripe_error") {
    // Stripe removal failed — re-activate in DB so the addon stays accessible while
    // still billed; a sync error is raised so ops can retry the Stripe removal.
    const { activateAddon } = await import("../services/addons-service.js");
    await activateAddon(key, orgId).catch(() => {});
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
