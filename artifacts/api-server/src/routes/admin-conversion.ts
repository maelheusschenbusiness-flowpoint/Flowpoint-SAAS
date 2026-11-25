/**
 * Tableaux de bord de conversion (administration, lecture seule).
 * Protege par `x-admin-key` (ADMIN_KEY, 32 caracteres minimum), comme les autres
 * routes d'administration. Aucune ecriture, aucune donnee personnelle.
 */
import { Router, type Request, type Response } from "express";
import { keysEqual } from "../lib/auth-token.js";
import { logger } from "../lib/logger.js";
import { globalConversion, outboundConversion, parseWindow, poolQuery, type Query } from "../services/conversion-dashboards.js";
import { compteursTunnel } from "../services/funnel-counters.js";
import { avantApres, parseJour, JOURS_MAX } from "../services/funnel-before-after.js";

const router = Router();
const MIN_LEN = 32;

function requireAdminKey(req: Request, res: Response): boolean {
  const key = process.env["ADMIN_KEY"];
  if (!key || key.length < MIN_LEN) {
    res.status(503).json({ ok: false, error: "ADMIN_KEY is not configured on this server" });
    return false;
  }
  const provided = req.headers["x-admin-key"];
  if (typeof provided !== "string" || !keysEqual(provided, key)) {
    res.status(403).json({ ok: false, error: "Invalid or missing x-admin-key header" });
    return false;
  }
  return true;
}

function handler(view: (query: Query, from: Date, to: Date) => Promise<object>) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireAdminKey(req, res)) return;
    const window = parseWindow(req.query["from"], req.query["to"]);
    if (!window) {
      res.status(400).json({ ok: false, error: "from and to must be valid AAAA-MM-JJ dates (from <= to, 366 days max)" });
      return;
    }
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, from: req.query["from"], to: req.query["to"], ...(await view(poolQuery, window.from, window.to)) });
    } catch (err) {
      logger.error({ err: (err as Error)?.name }, "[conversion-dashboard] read failed");
      res.status(503).json({ ok: false, error: "Conversion data is temporarily unavailable" });
    }
  };
}

/**
 * Compteurs agreges anonymes : par jour, etape, source, plan ; deux familles
 * (consentement / transactionnel) jamais additionnees ; rejets par motif.
 */
router.get("/admin/conversion/counters", handler(compteursTunnel));

/**
 * Comparaison avant/apres : `?change=AAAA-MM-JJ&days=7` (1 a 60). Lecture seule.
 * Methode et limites : docs/CONVERSION-COMPARAISON-AVANT-APRES.md.
 */
router.get("/admin/conversion/before-after", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const change = parseJour(req.query["change"]);
  const rawDays = req.query["days"] === undefined ? "7" : req.query["days"];
  const days = typeof rawDays === "string" && /^\d{1,3}$/.test(rawDays) ? Number(rawDays) : 0;
  if (!change || days < 1 || days > JOURS_MAX) {
    res.status(400).json({ ok: false, error: `change must be a valid AAAA-MM-JJ date and days an integer from 1 to ${JOURS_MAX}` });
    return;
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, ...(await avantApres(poolQuery, change, days)) });
  } catch (err) {
    logger.error({ err: (err as Error)?.name }, "[conversion-dashboard] before-after read failed");
    res.status(503).json({ ok: false, error: "Conversion data is temporarily unavailable" });
  }
});

router.get("/admin/conversion/global", handler(globalConversion));
router.get("/admin/conversion/outbound", handler(outboundConversion));

export default router;
