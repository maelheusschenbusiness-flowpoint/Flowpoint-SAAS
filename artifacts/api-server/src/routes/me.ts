import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";
import { PLAN_LIMITS } from "../lib/plans.js";
import { loadOrgSettings, upsertOrgSettings } from "../services/org-settings.js";
import { pool } from "@workspace/db";

const router = Router();

// ── GET /api/me ───────────────────────────────────────────────────────────────
// Returns org-level settings from DB, merged with session-level identity.
// Falls back to in-memory store.me when the DB row doesn't exist yet.
router.get("/me", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, no-cache");

  const orgId = req.orgContext?.orgId ?? "default";

  try {
    const dbData = await loadOrgSettings(orgId);

    if (dbData) {
      const plan   = dbData.plan.toLowerCase();
      const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS["standard"];

      // Use session email prefix as firstName fallback if DB field is empty
      const firstName = dbData.firstName ||
        (req.orgContext?.email?.split("@")[0] ?? store.me.firstName);

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

  // Fall back to in-memory singleton (first run before DB row exists)
  const limits = PLAN_LIMITS[store.me.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];
  res.json({ ...store.me, email: req.orgContext?.email ?? "", lastName: "", limits });
});

// ── PATCH /api/me ─────────────────────────────────────────────────────────────
// Updates profile, org info or plan — persists to DB and syncs in-memory store.
router.patch("/me", async (req: Request, res: Response): Promise<void> => {
  const {
    firstName, lastName, orgName, plan,
    website, timezone, address, city, postalCode, country,
  } = req.body as {
    firstName?:  string;
    lastName?:   string;
    orgName?:    string;
    plan?:       string;
    website?:    string;
    timezone?:   string;
    address?:    string;
    city?:       string;
    postalCode?: string;
    country?:    string;
  };
  const orgId = req.orgContext?.orgId ?? "default";

  if (typeof firstName === "string" && firstName.trim()) {
    store.me.firstName = firstName.trim();
  }
  if (typeof lastName === "string") {
    store.me.lastName = lastName.trim();
  }
  if (typeof orgName === "string" && orgName.trim()) {
    store.me.org = { ...store.me.org, name: orgName.trim() };
  }
  if (typeof website === "string") {
    store.me.org = { ...store.me.org, website: website.trim() };
  }
  if (typeof timezone === "string" && timezone.trim()) {
    store.me.org = { ...store.me.org, timezone: timezone.trim() };
    if (store.settings) store.settings.timezone = timezone.trim();
  }
  if (typeof plan === "string" && ["standard", "pro", "ultra"].includes(plan.toLowerCase())) {
    store.broadcastPlanUpdate(plan.toLowerCase());
  }

  // Persist to DB (non-blocking on failure)
  upsertOrgSettings(orgId, {
    firstName:   store.me.firstName,
    lastName:    typeof lastName === "string" ? lastName.trim() : undefined,
    orgName:     store.me.org.name,
    plan:        store.me.plan,
    website:     typeof website === "string" ? website.trim() : undefined,
    timezone:    typeof timezone === "string" ? timezone.trim() : undefined,
    address:     typeof address === "string" ? address.trim() : undefined,
    city:        typeof city === "string" ? city.trim() : undefined,
    postalCode:  typeof postalCode === "string" ? postalCode.trim() : undefined,
    country:     typeof country === "string" ? country.trim() : undefined,
    subscriptionStatus: store.me.subscriptionStatus,
    trialEndsAt: store.me.trialEndsAt ?? null,
    stripeCustomerId: store.me.stripeCustomerId ?? "",
    addons:      store.me.addons,
    usage:       store.me.usage,
  }).catch(() => {});

  const limits = PLAN_LIMITS[store.me.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];
  res.json({ ...store.me, limits });
});

// ── PUT /api/me/addons ────────────────────────────────────────────────────────
// Saves addon selections server-side (persists to DB, survives page refresh).
router.put("/me/addons", async (req: Request, res: Response): Promise<void> => {
  const orgId  = req.orgContext?.orgId ?? "default";
  const body   = req.body as Partial<typeof store.me.addons>;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ ok: false, error: "Invalid addons payload — expected an object" });
    return;
  }

  // Merge only recognised keys with strict type checks
  if (typeof body.whiteLabel     === "boolean") store.me.addons.whiteLabel     = body.whiteLabel;
  if (typeof body.prioritySupport === "boolean") store.me.addons.prioritySupport = body.prioritySupport;
  if (typeof body.customDomain   === "boolean") store.me.addons.customDomain   = body.customDomain;
  if (typeof body.extraSeats     === "number"  && body.extraSeats     >= 0) store.me.addons.extraSeats     = Math.floor(body.extraSeats);
  if (typeof body.monitorsPack50 === "number"  && body.monitorsPack50 >= 0) store.me.addons.monitorsPack50 = Math.floor(body.monitorsPack50);

  // Persist to DB
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
    res.status(500).json({ ok: false, error: "Failed to persist addons — try again" });
    return;
  }

  const limits = PLAN_LIMITS[store.me.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];
  res.json({ ok: true, addons: store.me.addons, limits });
});

// ── GET /api/me/prefs ─────────────────────────────────────────────────────────
// Returns cross-device user preferences (streak, pinned, checklist, settings).
router.get("/me/prefs", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? "default";
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT streak, pinned, checklist, settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    if (r.rows[0]) {
      res.json(r.rows[0]);
    } else {
      res.json({ streak: 0, pinned: {}, checklist: null, settings: null });
    }
  } catch {
    res.json({ streak: 0, pinned: {}, checklist: null, settings: null });
  } finally {
    client.release();
  }
});

// ── PATCH /api/me/prefs ───────────────────────────────────────────────────────
// Upserts cross-device user preferences (streak, pinned, checklist, settings).
router.patch("/me/prefs", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? "default";
  const { streak, pinned, checklist, settings } = req.body as {
    streak?: number;
    pinned?: Record<string, boolean>;
    checklist?: unknown;
    settings?: Record<string, unknown>;
  };
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO user_prefs (org_id, streak, pinned, checklist, settings, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (org_id) DO UPDATE SET
         streak     = COALESCE($2, user_prefs.streak),
         pinned     = COALESCE($3, user_prefs.pinned),
         checklist  = COALESCE($4, user_prefs.checklist),
         settings   = COALESCE($5, user_prefs.settings),
         updated_at = now()`,
      [orgId, streak ?? null, pinned ? JSON.stringify(pinned) : null, checklist ? JSON.stringify(checklist) : null, settings ? JSON.stringify(settings) : null]
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  } finally {
    client.release();
  }
});

export default router;
