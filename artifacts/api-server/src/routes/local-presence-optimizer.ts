import { Router, type Request } from "express";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { safeErrMsg } from "../lib/safe-error.js";
import { LOCAL_PRESENCE_FIELDS, analyzeLocalPresence, type LocalPresenceFieldKey } from "../services/local-presence-optimizer.js";

type DbResult = { rows: Record<string, unknown>[] };
type OrgRequest = Request & {
  orgId?: string;
  orgDb?: (sql: string, values?: unknown[]) => Promise<DbResult>;
};

const router = Router();
const orgId = (req: Request) => (req as OrgRequest).orgId;
const query = (req: Request) => (req as OrgRequest).orgDb;
router.use("/local-presence", requireAddon("localPresenceOptimizer", "Local Presence Optimizer"));

router.get("/local-presence", async (req, res) => {
  const id = orgId(req);
  const db = query(req);
  if (!id || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  try {
    const [locations, saved] = await Promise.all([
      db("SELECT id, name, raw_data, last_sync_at FROM google_locations WHERE org_id=$1 ORDER BY name", [id]),
      db("SELECT settings FROM local_presence_settings WHERE org_id=$1", [id]),
    ]);
    const settings = (saved.rows[0]?.["settings"] as Record<string, unknown> | undefined) ?? {
      locationId: null,
      trackedFields: LOCAL_PRESENCE_FIELDS.map(field => field.key),
    };
    const chosen = locations.rows.find(row => row["id"] === settings["locationId"]) ?? locations.rows[0];
    const analysis = chosen
      ? analyzeLocalPresence(chosen["raw_data"], settings["trackedFields"])
      : null;
    res.json({
      ok: true,
      connected: locations.rows.length > 0,
      settings,
      locations: locations.rows.map(row => ({ id: row["id"], name: row["name"], lastSyncAt: row["last_sync_at"] })),
      profile: chosen ? { id: chosen["id"], name: chosen["name"], lastSyncAt: chosen["last_sync_at"] } : null,
      analysis,
    });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

router.put("/local-presence/settings", canWrite, async (req, res) => {
  const id = orgId(req);
  const db = query(req);
  if (!id || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  const body = req.body as { locationId?: unknown; trackedFields?: unknown };
  const locationId = typeof body.locationId === "string" ? body.locationId : null;
  const allowed = new Set(LOCAL_PRESENCE_FIELDS.map(field => field.key));
  const trackedFields = Array.isArray(body.trackedFields)
    ? [...new Set(body.trackedFields.filter((key): key is LocalPresenceFieldKey => typeof key === "string" && allowed.has(key as LocalPresenceFieldKey)))]
    : LOCAL_PRESENCE_FIELDS.map(field => field.key);
  if (!trackedFields.length || trackedFields.length > LOCAL_PRESENCE_FIELDS.length) {
    res.status(400).json({ error: "Sélectionnez au moins un critère de présence." }); return;
  }
  try {
    if (locationId) {
      const owned = await db("SELECT id FROM google_locations WHERE id=$1 AND org_id=$2 LIMIT 1", [locationId, id]);
      if (!owned.rows.length) { res.status(404).json({ error: "Cette fiche GBP n’appartient pas à votre organisation." }); return; }
    }
    const settings = { locationId, trackedFields };
    await db(
      `INSERT INTO local_presence_settings (org_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (org_id) DO UPDATE SET settings=$2::jsonb, updated_at=NOW()`,
      [id, JSON.stringify(settings)],
    );
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

export default router;
