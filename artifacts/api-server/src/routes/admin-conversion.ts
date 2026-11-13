/**
 * Tableaux de bord de conversion (administration, lecture seule).
 * Protege par `x-admin-key` (ADMIN_KEY, 32 caracteres minimum), comme les autres
 * routes d'administration. Aucune ecriture, aucune donnee personnelle.
 */
import { Router, type Request, type Response } from "express";
import { keysEqual } from "../lib/auth-token.js";
import { logger } from "../lib/logger.js";
import { globalConversion, outboundConversion, parseWindow, poolQuery } from "../services/conversion-dashboards.js";

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

function handler(view: typeof globalConversion) {
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

router.get("/admin/conversion/global", handler(globalConversion));
router.get("/admin/conversion/outbound", handler(outboundConversion));

export default router;
