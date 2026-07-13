import { Router, type Request, type Response } from "express";
import { requireOrgId } from "../lib/require-org-id.js";
import { store } from "../services/store.js";
import { PLAN_LIMITS } from "../lib/plans.js";
import { loadOrgSettings, upsertOrgSettings } from "../services/org-settings.js";
import { logger } from "../lib/logger.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const orgDb = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// ── GET /api/me ───────────────────────────────────────────────────────────────
router.get("/me", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, no-cache");

  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  try {
    const dbData = await loadOrgSettings(orgId);

    if (dbData) {
      const plan   = dbData.plan.toLowerCase();
      const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS["standard"];

      const firstName = dbData.firstName ||
        (req.orgContext?.email?.split("@")[0] ?? store.me.firstName);

      const _pkHash = Buffer.from(orgId).toString("base64").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 22);
      res.json({
        firstName,
        lastName:           dbData.lastName ?? "",
        email:              req.orgContext?.email ?? "",
        plan:               dbData.plan,
        role:               req.orgContext?.role ?? "owner",
        org:                { name: dbData.orgName, website: dbData.website ?? "" },
        subscriptionStatus: dbData.subscriptionStatus,
        trialEndsAt:        dbData.trialEndsAt,
        stripeCustomerId:   dbData.stripeCustomerId,
        usage:              dbData.usage,
        addons:             dbData.addons,
        limits,
        publicApiKey:       `fp_pub_${_pkHash}`,
        createdAt:          dbData.createdAt ?? new Date().toISOString(),
        location: {
          address:            dbData.address            ?? null,
          city:               dbData.city               ?? null,
          postalCode:         dbData.postalCode         ?? null,
          country:            dbData.country            ?? null,
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

  const limits = PLAN_LIMITS[store.me.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];
  res.json({ ...store.me, email: req.orgContext?.email ?? "", lastName: "", limits });
});

// ── PATCH /api/me ─────────────────────────────────────────────────────────────
router.patch("/me", async (req: Request, res: Response): Promise<void> => {
  const {
    firstName, lastName, orgName, plan,
    website, timezone, address, city, postalCode, country,
  } = req.body as {
    firstName?:  string; lastName?:   string; orgName?:    string; plan?:       string;
    website?:    string; timezone?:   string; address?:    string;
    city?:       string; postalCode?: string; country?:    string;
  };
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  if (typeof firstName === "string" && firstName.trim()) store.me.firstName = firstName.trim();
  if (typeof lastName  === "string") store.me.lastName = lastName.trim();
  if (typeof orgName   === "string" && orgName.trim()) store.me.org = { ...store.me.org, name: orgName.trim() };
  if (typeof website   === "string") store.me.org = { ...store.me.org, website: website.trim() };
  if (typeof timezone  === "string" && timezone.trim()) {
    store.me.org = { ...store.me.org, timezone: timezone.trim() };
    if (store.settings) store.settings.timezone = timezone.trim();
    // Persist timezone to user_prefs so it survives server restarts
    try {
      await orgDb(req)(
        `INSERT INTO user_prefs (org_id, settings, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (org_id) DO UPDATE
           SET settings = COALESCE(user_prefs.settings, '{}'::jsonb) || $2::jsonb,
               updated_at = now()`,
        [orgId, JSON.stringify({ timezone: timezone.trim() })]
      );
    } catch { /* non-fatal */ }
  }
  if (typeof plan === "string" && ["standard", "pro", "ultra"].includes(plan.toLowerCase())) {
    store.broadcastPlanUpdate(plan.toLowerCase(), orgId);
  }

  try {
    await upsertOrgSettings(orgId, {
      firstName:   store.me.firstName,
      lastName:    typeof lastName === "string" ? lastName.trim() : undefined,
      orgName:     store.me.org?.name ?? (typeof orgName === "string" ? orgName.trim() : undefined),
      plan:        store.me.plan,
      website:     typeof website === "string" ? website.trim() : (store.me.org?.website ?? undefined),
      address:     typeof address    === "string" ? address.trim()    : undefined,
      city:        typeof city       === "string" ? city.trim()       : undefined,
      postalCode:  typeof postalCode === "string" ? postalCode.trim() : undefined,
      country:     typeof country    === "string" ? country.trim()    : undefined,
      locationConfigured: (typeof address === "string" && address.trim()) || (typeof city === "string" && city.trim()) ? true : undefined,
      subscriptionStatus: store.me.subscriptionStatus,
      trialEndsAt: store.me.trialEndsAt ?? null,
      stripeCustomerId: store.me.stripeCustomerId ?? "",
      addons:      store.me.addons,
      usage:       store.me.usage,
    });
  } catch {
    // Non-fatal
  }

  const limits = PLAN_LIMITS[store.me.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];
  res.json({ ...store.me, limits });
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
      firstName:   store.me.firstName,
      orgName:     store.me.org.name,
      plan:        store.me.plan,
      subscriptionStatus: store.me.subscriptionStatus,
      trialEndsAt: store.me.trialEndsAt ?? null,
      stripeCustomerId: store.me.stripeCustomerId ?? "",
      addons:      store.me.addons,
      usage:       store.me.usage,
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to persist addons — try again" }); return;
  }

  const limits = PLAN_LIMITS[store.me.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];
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
