import { Router, type Request, type Response } from "express";
import { activateAddon, deactivateAddon, getOrgAddons, addExtraAICredits, getQuotaLimits, ADDON_DEFINITIONS } from "../services/addons-service.js";
import { store } from "../services/store.js";

const router = Router();

router.get("/addons", async (_req: Request, res: Response) => {
  try {
    const orgAddons = await getOrgAddons();
    const plan = store.me.plan?.toLowerCase() ?? "pro";
    const quotas = getQuotaLimits(plan, store.me.addons as Record<string, boolean | number>);
    res.json({
      addons: store.me.addons,
      orgAddons,
      definitions: ADDON_DEFINITIONS,
      quotas,
      plan,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch addons" });
  }
});

router.post("/addons/:key/activate", async (req: Request, res: Response) => {
  const { key } = req.params;
  if (!ADDON_DEFINITIONS[key]) {
    res.status(400).json({ error: "Unknown addon key" }); return;
  }
  const ok = await activateAddon(key);
  if (ok) {
    store.logActivity({ type: "billing", label: `Add-on activé : ${key}`, targetId: key, targetType: "addon" }).catch(err => console.warn("[logActivity]", err?.message));
    store.broadcast({ type: "fp:addon:activated", addonKey: key });
    res.json({ ok: true, addonKey: key, addons: store.me.addons });
  } else {
    res.status(500).json({ error: "Failed to activate addon" });
  }
});

router.post("/addons/:key/deactivate", async (req: Request, res: Response) => {
  const { key } = req.params;
  const ok = await deactivateAddon(key);
  if (ok) {
    store.logActivity({ type: "billing", label: `Add-on désactivé : ${key}`, targetId: key, targetType: "addon" }).catch(err => console.warn("[logActivity]", err?.message));
    store.broadcast({ type: "fp:addon:deactivated", addonKey: key });
  }
  res.json({ ok, addonKey: key });
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
