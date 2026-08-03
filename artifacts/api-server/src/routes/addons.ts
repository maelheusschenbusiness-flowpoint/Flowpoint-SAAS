import { Router, type Request, type Response } from "express";
import { activateAddon, deactivateAddon, getOrgAddons, addExtraAICredits, getQuotaLimits, ADDON_DEFINITIONS } from "../services/addons-service.js";
import { store } from "../services/store.js";
import { loadOrgData } from "../services/org-data.js";
import { ownerOnly } from "../middlewares/requireRole.js";

const router = Router();

router.get("/addons", async (req: Request, res: Response) => {
  try {
    const orgId = (req as Request & { orgId?: string }).orgId ?? "default";
    const dbData = await loadOrgData(orgId).catch(() => null);
    const plan = (dbData?.plan || "standard").toLowerCase();
    const orgAddons = await getOrgAddons(orgId);
    // Use DB-sourced addons — never the store.me singleton (cross-tenant contamination risk)
    const liveAddons = dbData?.addons ?? orgAddons ?? {};
    const quotas = getQuotaLimits(plan, liveAddons as Record<string, boolean | number>);
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
  // Stop Stripe billing BEFORE revoking access — never leave a customer paying
  // for a feature that was just disabled.
  const { syncAddonWithStripe } = await import("../services/addon-stripe-sync.js");
  const stripeSync = await syncAddonWithStripe(orgId, key, "deactivate");
  if (stripeSync.reason === "stripe_error") {
    res.status(502).json({ error: "L'arrêt de la facturation Stripe a échoué — désactivation annulée", stripe: stripeSync });
    return;
  }
  const ok = await deactivateAddon(key, orgId);
  if (ok) {
    store.logActivity({ type: "billing", label: `Add-on désactivé : ${key}`, targetId: key, targetType: "addon", orgId }).catch(err => console.warn("[logActivity]", err?.message));
    store.broadcast({ type: "fp:addon:deactivated", addonKey: key }, orgId);
  }
  res.json({ ok, addonKey: key, stripe: stripeSync });
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
