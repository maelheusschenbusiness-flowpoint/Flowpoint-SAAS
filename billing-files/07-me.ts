import { Router, type Request, type Response } from "express";
import { requireOrgId } from "../lib/require-org-id.js";
import { store } from "../services/store.js";
import { PLAN_LIMITS } from "../lib/plans.js";
import { loadOrgSettings, upsertOrgSettings } from "../services/org-settings.js";
import { normalizeSubscriptionStatus } from "../lib/subscription-state.js";
import { logger } from "../lib/logger.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const orgDb = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// Helper: normalize plan to Title Case
function normPlan(p: string | null | undefined): string {
  if (!p) return "Standard";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

// ── GET /api/me ───────────────────────────────────────────────────────────────
router.get("/me", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, no-cache");

  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  // Canonical timezone from user_prefs.settings (written by PATCH /api/me/settings).
  // Queried unconditionally so it appears even when org_settings row is missing.
  let settingsTimezone: string | null = null;
  try {
    const pRow = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    const prefs = pRow.rows[0]?.settings as Record<string, unknown> | null;
    if (prefs && typeof prefs.timezone === "string" && prefs.timezone) {
      settingsTimezone = prefs.timezone;
    }
  } catch { /* non-fatal */ }

  try {
    const dbData = await loadOrgSettings(orgId);

    if (dbData) {
      const plan   = dbData.plan.toLowerCase();
      const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS["standard"];

      const firstName = dbData.firstName ||
        (req.orgContext?.email?.split("@")[0] ?? "User");

      const _pkHash = Buffer.from(orgId).toString("base64").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 22);
      // Normalise subscription status — include trialConsumedAt for pending_billing detection
      const normStatus = normalizeSubscriptionStatus({
        rawStatus:            dbData.subscriptionStatus,
        stripeSubscriptionId: dbData.stripeSubscriptionId,
        stripeCustomerId:     dbData.stripeCustomerId,
        trialEndsAt:          dbData.trialEndsAt,
        trialConsumedAt:      dbData.trialConsumedAt,
      });

      // Read addons from org_addons table (single source of truth — Correction 8)
      const _addonsRows = await orgDb(req)(
        `SELECT addon_key, active FROM org_addons WHERE org_id=$1`,
        [orgId]
      ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
      const _mergedAddons: Record<string, boolean | number> = {};
      for (const row of _addonsRows.rows) {
        _mergedAddons[String(row["addon_key"])] = Boolean(row["active"]);
      }
      // Merge org_settings.addons as legacy supplemental (org_addons takes precedence)
      if (dbData.addons && typeof dbData.addons === "object") {
        for (const [key, val] of Object.entries(dbData.addons)) {
          if (!(key in _mergedAddons)) _mergedAddons[key] = val as boolean | number;
        }
      }
      const _canStartTrial = !dbData.trialConsumedAt && !dbData.stripeSubscriptionId;

      res.json({
        firstName,
        lastName:            dbData.lastName ?? "",
        email:               req.orgContext?.email ?? "",
        plan:                normPlan(dbData.plan),
        role:                req.orgContext?.role ?? "owner",
        org:                 { name: dbData.orgName, website: dbData.website ?? "" },
        subscriptionStatus:  normStatus,
        stripeSubscriptionId: dbData.stripeSubscriptionId,
        trialEndsAt:         dbData.trialEndsAt,
        stripeCustomerId:    dbData.stripeCustomerId,
        canStartTrial:       _canStartTrial,
        hasPremiumAccess:    normStatus === "active" || normStatus === "trialing",
        mustCompleteBilling: normStatus !== "active" && normStatus !== "trialing",
        usage:              dbData.usage,
        addons:             _mergedAddons,
        limits,
        publicApiKey:       `fp_pub_${_pkHash}`,
        createdAt:          dbData.createdAt ?? new Date().toISOString(),
        timezone:  settingsTimezone ?? dbData.timezone  ?? null,
        language:  dbData.language  ?? null,
        currency:  dbData.currency  ?? null,
        dateFormat: dbData.dateFormat ?? null,
        timeFormat: dbData.timeFormat ?? null,
        location: {
          address:            dbData.address            ?? null,
          city:               dbData.city               ?? null,
          postalCode:         dbData.postalCode         ?? null,
          country:            dbData.country            ?? null,
          region:             dbData.region             ?? null,
          phone:              dbData.phone              ?? null,
          latitude:           dbData.latitude           ?? null,
          longitude:          dbData.longitude          ?? null,
          serviceArea:        dbData.serviceArea        ?? [],
          locationConfigured: dbData.locationConfigured ?? false,
          locationSource:     dbData.locationSource     ?? null,
        },
      });
      return;
    }
  } catch {
    // Non-fatal — fall through to in-memory store
  }

  // SECURITY: never fall back to store.me (global singleton — would leak other users' data).
  // Return minimal safe defaults derived from the authenticated org context only.
  const _safeEmail = req.orgContext?.email ?? "";
  const _safeFirstName = _safeEmail.split("@")[0] || "User";
  res.json({
    firstName:           _safeFirstName,
    lastName:            "",
    email:               _safeEmail,
    plan:                "Standard",
    role:                req.orgContext?.role ?? "owner",
    org:                 { name: "", website: "" },
    subscriptionStatus:  "unknown",
    stripeSubscriptionId: null,
    trialEndsAt:         null,
    stripeCustomerId:    null,
    usage:               {},
    addons:              {},
    limits:              PLAN_LIMITS["standard"],
    publicApiKey:        null,
    createdAt:           new Date().toISOString(),
    timezone:            settingsTimezone ?? null,
    language:            null,
    currency:            null,
    dateFormat:          null,
    timeFormat:          null,
    location: {
      address: null, city: null, postalCode: null, country: null, region: null,
      phone: null, latitude: null, longitude: null, serviceArea: [], locationConfigured: false, locationSource: null,
    },
  });
});

// ── PATCH /api/me ─────────────────────────────────────────────────────────────
// Fully org-isolated: reads from DB, applies only provided fields, returns DB-confirmed data.
// Never reads from store.me (global singleton) to prevent multi-tenant leaks.
router.patch("/me", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const body = req.body as Record<string, unknown>;

  // Localisation fields must go to PATCH /api/location — reject explicitly, never silently ignore
  const LOC_FIELDS = [
    "city", "country", "address", "postalCode",
    "latitude", "longitude", "serviceArea", "location",
    "language", "currency", "dateFormat", "timeFormat",
    "phone", "region",
  ] as const;
  const rejectedLoc = LOC_FIELDS.filter(f => f in body);
  if (rejectedLoc.length > 0) {
    res.status(400).json({
      error: "Use PATCH /api/location for localisation fields.",
      code:  "LOCATION_ENDPOINT_REQUIRED",
      fields: rejectedLoc,
    });
    return;
  }

  const {
    firstName, lastName, orgName,
    website, timezone,
  } = body as {
    firstName?: string; lastName?: string; orgName?: string;
    website?: string; timezone?: string;
  };

  // Load current org data from DB (isolated per org)
  let current = await loadOrgSettings(orgId);

  // If no row yet, seed with defaults so upsert has a base
  const toSave: Parameters<typeof upsertOrgSettings>[1] = {};

  if (typeof firstName === "string" && firstName.trim()) toSave.firstName = firstName.trim();
  if (typeof lastName  === "string")                      toSave.lastName  = lastName.trim();
  if (typeof orgName   === "string" && orgName.trim())   toSave.orgName   = orgName.trim();
  if (typeof website   === "string")                      toSave.website   = website.trim();

  // Preserve immutable fields from DB (never overwrite plan/billing from this endpoint)
  if (current) {
    if (!toSave.firstName && current.firstName)  toSave.firstName = current.firstName;
    if (!toSave.orgName   && current.orgName)    toSave.orgName   = current.orgName;
  }

  try {
    current = await upsertOrgSettings(orgId, toSave);
  } catch (err) {
    logger.error({ err, orgId }, "[PATCH /api/me] upsertOrgSettings failed");
    res.status(500).json({ error: "Failed to save profile" });
    return;
  }

  // Mirror timezone to user_prefs.settings — single source of truth read by GET /api/me.
  // This ensures timezone persists on hard reload regardless of which endpoint the
  // frontend uses to write it (PATCH /api/me or PATCH /api/me/settings both write here).
  let resolvedTimezone: string | null = current?.timezone ?? null;
  if (typeof timezone === "string" && timezone.trim()) {
    const tz = timezone.trim();
    resolvedTimezone = tz;
    try {
      await orgDb(req)(
        `INSERT INTO user_prefs (org_id, settings, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (org_id) DO UPDATE SET
           settings   = COALESCE(user_prefs.settings, '{}'::jsonb) || $2::jsonb,
           updated_at = now()`,
        [orgId, JSON.stringify({ timezone: tz })]
      );
    } catch (err) {
      logger.warn({ err, orgId }, "[PATCH /api/me] Failed to mirror timezone to user_prefs.settings — non-fatal");
    }
  }

  const plan   = current?.plan ?? "standard";
  const limits = PLAN_LIMITS[plan.toLowerCase()] ?? PLAN_LIMITS["standard"];
  const _pkHash = Buffer.from(orgId).toString("base64").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 22);

  res.json({
    firstName:          current?.firstName ?? "",
    lastName:           current?.lastName  ?? "",
    email:              req.orgContext?.email ?? "",
    plan:               normPlan(current?.plan),
    role:               req.orgContext?.role ?? "owner",
    org:                { name: current?.orgName ?? "", website: current?.website ?? "" },
    subscriptionStatus: current?.subscriptionStatus,
    trialEndsAt:        current?.trialEndsAt,
    stripeCustomerId:   current?.stripeCustomerId,
    usage:              current?.usage ?? {},
    addons:             current?.addons ?? {},
    limits,
    publicApiKey:       `fp_pub_${_pkHash}`,
    createdAt:          current?.createdAt ?? new Date().toISOString(),
    timezone:           resolvedTimezone,
    language:           current?.language  ?? null,
    currency:           current?.currency  ?? null,
    dateFormat:         current?.dateFormat ?? null,
    timeFormat:         current?.timeFormat ?? null,
    location: {
      address:            current?.address            ?? null,
      city:               current?.city               ?? null,
      postalCode:         current?.postalCode         ?? null,
      country:            current?.country            ?? null,
      region:             current?.region             ?? null,
      phone:              current?.phone              ?? null,
      latitude:           current?.latitude           ?? null,
      longitude:          current?.longitude          ?? null,
      serviceArea:        current?.serviceArea        ?? [],
      locationConfigured: current?.locationConfigured ?? false,
      locationSource:     current?.locationSource     ?? null,
    },
  });
});

// ── PUT /api/me/addons ────────────────────────────────────────────────────────
router.put("/me/addons", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const body   = req.body as Partial<typeof store.me.addons>;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ ok: false, error: "Invalid addons payload — expected an object" }); return;
  }

  if (typeof body.whiteLabel      === "boolean") store.me.addons.whiteLabel      = body.whiteLabel;
  if (typeof body.prioritySupport === "boolean") store.me.addons.prioritySupport = body.prioritySupport;
  if (typeof body.customDomain    === "boolean") store.me.addons.customDomain    = body.customDomain;
  if (typeof body.extraSeats      === "number" && body.extraSeats     >= 0) store.me.addons.extraSeats     = Math.floor(body.extraSeats);
  if (typeof body.monitorsPack50  === "number" && body.monitorsPack50 >= 0) store.me.addons.monitorsPack50 = Math.floor(body.monitorsPack50);

  try {
    await upsertOrgSettings(orgId, {
      addons: store.me.addons,
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to persist addons — try again" }); return;
  }

  const current = await loadOrgSettings(orgId);
  const limits = PLAN_LIMITS[(current?.plan ?? "standard").toLowerCase()] ?? PLAN_LIMITS["standard"];
  res.json({ ok: true, addons: store.me.addons, limits });
});

// ── GET /api/me/prefs ─────────────────────────────────────────────────────────
router.get("/me/prefs", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const r = await orgDb(req)(`SELECT streak, pinned, checklist, settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    if (r.rows[0]) {
      res.json(r.rows[0]);
    } else {
      res.json({ streak: 0, pinned: {}, checklist: null, settings: null });
    }
  } catch {
    res.json({ streak: 0, pinned: {}, checklist: null, settings: null });
  }
});

// ── PATCH /api/me/prefs ───────────────────────────────────────────────────────
router.patch("/me/prefs", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const { streak, pinned, checklist, settings: rawSettings } = req.body as {
    streak?: number; pinned?: Record<string, boolean>; checklist?: unknown; settings?: Record<string, unknown>;
  };
  // Strip any DataForSEO credentials from settings before storing in user_prefs
  let settings = rawSettings;
  if (settings && typeof settings === "object") {
    const { dataForSEO: _, ...rest } = settings;
    settings = rest;
  }
  try {
    await orgDb(req)(
      `INSERT INTO user_prefs (org_id, streak, pinned, checklist, settings, updated_at)
       VALUES ($1, COALESCE($2,0), COALESCE($3::jsonb,'{}'), $4, $5, now())
       ON CONFLICT (org_id) DO UPDATE SET
         streak    = COALESCE($2, user_prefs.streak),
         pinned    = COALESCE($3::jsonb, user_prefs.pinned),
         checklist = COALESCE($4, user_prefs.checklist),
         settings  = COALESCE(user_prefs.settings, '{}'::jsonb) || COALESCE($5::jsonb, '{}'::jsonb),
         updated_at = now()`,
      [orgId,
       streak    ?? null,
       pinned    ? JSON.stringify(pinned)    : null,
       checklist ? JSON.stringify(checklist) : null,
       settings  ? JSON.stringify(settings)  : null]
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

// ── /api/me/settings — read canonical user preferences (timezone, etc.) ────────
router.get("/me/settings", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const r = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    res.json(r.rows[0]?.settings ?? {});
  } catch {
    res.json({});
  }
});

// ── PATCH /api/me/settings — write canonical user preferences (timezone, etc.) ──
// Canonical storage for timezone. Merges into user_prefs.settings JSONB so that
// GET /api/me/settings always returns the authoritative value.
router.patch("/me/settings", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const body = req.body as Record<string, unknown>;

  // Accept only safe preference fields — never billing or auth data
  const ALLOWED_KEYS = ["timezone", "language", "dateFormat", "timeFormat", "currency"] as const;
  const patch: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (typeof body[key] === "string" && (body[key] as string).trim()) {
      patch[key] = (body[key] as string).trim();
    }
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ ok: false, error: "No valid preference fields provided" });
    return;
  }

  try {
    await orgDb(req)(
      `INSERT INTO user_prefs (org_id, settings, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (org_id) DO UPDATE SET
         settings   = COALESCE(user_prefs.settings, '{}'::jsonb) || $2::jsonb,
         updated_at = now()`,
      [orgId, JSON.stringify(patch)]
    );
    const r = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    res.json(r.rows[0]?.settings ?? patch);
  } catch (err) {
    logger.error({ err, orgId }, "[PATCH /me/settings] upsert failed");
    res.status(500).json({ ok: false, error: "Failed to save settings" });
  }
});

// ── DataForSEO credentials — server-only org-scoped storage ───────────────────────────────────

import { pool } from "@workspace/db";
import { isDataForSEOConfigured } from "../services/dataforseo-service.js";

/** GET /api/me/dataforseo/status — return configured status (never exposes password) */
router.get("/me/dataforseo/status", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const configured = await isDataForSEOConfigured(orgId);
    let login = "";
    if (configured) {
      const r = await pool.query(
        `SELECT value FROM org_secrets WHERE org_id = $1 AND key = 'dataforseo_login'`, [orgId]
      );
      login = r.rows[0]?.value ?? "";
    }
    res.json({ configured, login });
  } catch {
    res.json({ configured: false, login: "" });
  }
});

/** POST /api/me/dataforseo/credentials — save org-scoped credentials */
router.post("/me/dataforseo/credentials", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    res.status(400).json({ ok: false, error: "login and password required" });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO org_secrets (org_id, key, value, created_at)
       VALUES ($1, 'dataforseo_login',    $2, NOW()),
              ($1, 'dataforseo_password', $3, NOW())
       ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value, created_at = NOW()`,
      [orgId, login.trim(), password.trim()]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to save credentials" });
  }
});

/** DELETE /api/me/dataforseo/credentials — clear org-scoped credentials */
router.delete("/me/dataforseo/credentials", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    await pool.query(
      `DELETE FROM org_secrets WHERE org_id = $1 AND key IN ('dataforseo_login','dataforseo_password')`,
      [orgId]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to clear credentials" });
  }
});

// ── GET /api/me/storage — real DB volume counts ─────────────────────────────
router.get("/me/storage", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const client = await (await import("@workspace/db")).pool.connect();
    try {
      // Count rows per table + estimate total size
      const counts = await Promise.all([
        client.query(`SELECT COUNT(*)::int AS n FROM audits WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
        client.query(`SELECT COUNT(*)::int AS n FROM reports WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
        client.query(`SELECT COUNT(*)::int AS n FROM monitors WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
        client.query(`SELECT COUNT(*)::int AS n FROM tracked_keywords WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
        client.query(`SELECT COUNT(*)::int AS n FROM team_files WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
        client.query(`SELECT COUNT(*)::int AS n FROM automation_integrations WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
        client.query(`SELECT COUNT(*)::int AS n FROM automation_logs WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
        client.query(`SELECT COUNT(*)::int AS n FROM psi_cache WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
      ]);

      const [
        audits, reports, monitors, keywords, uploads, integrations, logs, psiCache
      ] = counts.map(r => (r.rows[0] as { n: number }).n);

      const totalItems = audits + reports + monitors + keywords + uploads + integrations + logs + psiCache;

      // Estimate per-org storage from row counts (accurate enough for billing UI)
      const estimatedBytes = totalItems * 2500; // ~2.5 KB/item rough avg per org
      const isEstimated = true;

      res.json({
        orgId,
        counts: { audits, reports, monitors, keywords, uploads, integrations, logs, psiCache, total: totalItems },
        size: {
          bytes: estimatedBytes,
          readable: estimatedBytes > 0
            ? estimatedBytes < 1024
              ? `${estimatedBytes} B`
              : estimatedBytes < 1024 * 1024
                ? `${(estimatedBytes / 1024).toFixed(1)} KB`
                : `${(estimatedBytes / (1024 * 1024)).toFixed(2)} MB`
            : "0 B",
          estimated: isEstimated,
          note: "Estimation par org basée sur le nombre de lignes",
        },
      });
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, "[me/storage] failed");
    res.status(500).json({ error: "Impossible de lire le stockage" });
  }
});

export default router;
