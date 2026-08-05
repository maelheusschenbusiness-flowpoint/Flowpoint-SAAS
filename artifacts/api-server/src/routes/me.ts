import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { requireOrgId } from "../lib/require-org-id.js";

import { PLAN_LIMITS } from "../lib/plans.js";
import { loadOrgSettings, upsertOrgSettings } from "../services/org-settings.js";
import { loadOrgData }                         from "../services/org-data.js";
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

  // Record today's activity for streak reliability — every dashboard load counts,
  // regardless of whether /api/me/streak or /api/me/prefs is reached later.
  recordActivityDay(orgDb(req), orgId).catch(() => {});

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
    // Jalon 4: parallel fetch — billing from organizations (source of truth) + profile from org_settings
    const [billingData, dbData] = await Promise.all([
      loadOrgData(orgId).catch(() => null),       // organizations first, org_settings fallback
      loadOrgSettings(orgId).catch(() => null),   // profile fields: firstName, lastName, timezone, location…
    ]);

    if (billingData ?? dbData) {
      // Billing fields: prefer organizations (billingData) → org_settings fallback (dbData)
      const rawPlan             = billingData?.plan ?? dbData?.plan ?? "standard";
      const plan                = rawPlan.toLowerCase();
      const limits              = PLAN_LIMITS[plan] ?? PLAN_LIMITS["standard"];
      const rawSubStatus        = billingData?.subscriptionStatus ?? dbData?.subscriptionStatus ?? null;
      const rawStripeSubId      = billingData?.stripeSubscriptionId ?? dbData?.stripeSubscriptionId ?? null;
      const rawStripeCustomerId = billingData?.stripeCustomerId     ?? dbData?.stripeCustomerId     ?? null;
      const rawTrialEndsAt      = billingData?.trialEndsAt          ?? dbData?.trialEndsAt          ?? null;
      const rawTrialConsumedAt  = billingData?.trialConsumedAt      ?? dbData?.trialConsumedAt      ?? null;

      // Profile fields: org_settings (dbData) is the source for these; billingData firstName/orgName as fallback
      const firstName = dbData?.firstName || billingData?.firstName ||
        (req.orgContext?.email?.split("@")[0] ?? "User");

      const _pkHash = Buffer.from(orgId).toString("base64").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 22);
      // Allow regenerated key stored in user_prefs.settings to override the deterministic hash
      const prefsRow = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [] }));
      const _storedPubKey = (prefsRow.rows[0] as Record<string,unknown>)?.settings as Record<string,unknown> | null;
      const _publicApiKey = (typeof _storedPubKey?.publicApiKey === "string" && _storedPubKey.publicApiKey)
        ? _storedPubKey.publicApiKey
        : `fp_pub_${_pkHash}`;

      // Normalise subscription status — include trialConsumedAt for pending_billing detection
      const normStatus = normalizeSubscriptionStatus({
        rawStatus:            rawSubStatus,
        stripeSubscriptionId: rawStripeSubId,
        stripeCustomerId:     rawStripeCustomerId,
        trialEndsAt:          rawTrialEndsAt,
        trialConsumedAt:      rawTrialConsumedAt,
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
      const legacyAddons = dbData?.addons ?? billingData?.addons;
      if (legacyAddons && typeof legacyAddons === "object") {
        for (const [key, val] of Object.entries(legacyAddons)) {
          if (!(key in _mergedAddons)) _mergedAddons[key] = val as boolean | number;
        }
      }
      const _canStartTrial = !rawTrialConsumedAt && !rawStripeSubId;

      res.json({
        firstName,
        lastName:            dbData?.lastName ?? "",
        email:               req.orgContext?.email ?? "",
        plan:                normPlan(rawPlan),
        role:                req.orgContext?.role ?? "owner",
        org:                 { name: billingData?.orgName ?? dbData?.orgName ?? "", website: dbData?.website ?? "" },
        subscriptionStatus:  normStatus,
        stripeSubscriptionId: rawStripeSubId,
        trialEndsAt:         rawTrialEndsAt,
        stripeCustomerId:    rawStripeCustomerId,
        canStartTrial:       _canStartTrial,
        hasPremiumAccess:    normStatus === "active" || normStatus === "trialing",
        mustCompleteBilling: normStatus !== "active" && normStatus !== "trialing",
        usage:              await (async () => {
          try {
            const [auditR, monR, repR, expR] = await Promise.all([
              orgDb(req)(`SELECT COUNT(*)::int AS n FROM audits WHERE org_id=$1`, [orgId]).catch(() => ({rows:[]})),
              orgDb(req)(`SELECT COUNT(*)::int AS n FROM monitors WHERE org_id=$1`, [orgId]).catch(() => ({rows:[]})),
              orgDb(req)(`SELECT COUNT(*)::int AS n FROM reports WHERE org_id=$1`, [orgId]).catch(() => ({rows:[]})),
              orgDb(req)(`SELECT COUNT(*)::int AS n FROM report_exports WHERE org_id=$1`, [orgId]).catch(() => ({rows:[]})),
            ]);
            const stored = (dbData?.usage ?? {}) as Record<string, unknown>;
            return {
              ...stored,
              audit:   { used: (auditR.rows[0] as Record<string,number>|undefined)?.n ?? 0, limit: limits.audits },
              monitor: { used: (monR.rows[0]   as Record<string,number>|undefined)?.n ?? 0, limit: limits.monitors },
              reports: { used: (repR.rows[0]   as Record<string,number>|undefined)?.n ?? 0, limit: limits.reports },
              exports: { used: (expR.rows[0]   as Record<string,number>|undefined)?.n ?? 0, limit: limits.exports ?? limits.reports },
              pdf:     { used: (expR.rows[0]   as Record<string,number>|undefined)?.n ?? 0, limit: limits.reports },
            };
          } catch { return dbData?.usage ?? {}; }
        })(),
        addons:             _mergedAddons,
        limits,
        publicApiKey:       _publicApiKey,
        createdAt:          dbData?.createdAt ?? new Date().toISOString(),
        timezone:  settingsTimezone ?? dbData?.timezone  ?? null,
        language:  dbData?.language  ?? null,
        currency:  dbData?.currency  ?? null,
        dateFormat: dbData?.dateFormat ?? null,
        timeFormat: dbData?.timeFormat ?? null,
        location: {
          address:            dbData?.address            ?? null,
          city:               dbData?.city               ?? null,
          postalCode:         dbData?.postalCode         ?? null,
          country:            dbData?.country            ?? null,
          region:             dbData?.region             ?? null,
          phone:              dbData?.phone              ?? null,
          latitude:           dbData?.latitude           ?? null,
          longitude:          dbData?.longitude          ?? null,
          serviceArea:        dbData?.serviceArea        ?? [],
          locationConfigured: dbData?.locationConfigured ?? false,
          locationSource:     dbData?.locationSource     ?? null,
        },
      });
      return;
    }
  } catch {
    // Non-fatal — fall through to safe defaults
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
// ── PATCH /api/org — update organisation name / website ─────────────────────
router.patch("/org", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const { name, website } = req.body as { name?: string; website?: string };
  if (!name && !website) { res.json({ ok: true }); return; }
  try {
    const { persistOrgData } = await import("../services/org-data.js");
    const fields: Parameters<typeof persistOrgData>[1] = {};
    if (name)    fields.orgName  = name.trim();
    if (website) fields.website  = website.trim();
    await persistOrgData(orgId, fields);
    res.json({ ok: true, name: name?.trim(), website: website?.trim() });
  } catch (err) {
    logger.error({ err }, "[me] PATCH /org failed");
    res.status(500).json({ error: "Failed to update organisation" });
  }
});

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
  // Resolve publicApiKey — check user_prefs for a stored custom key, fall back to deterministic hash.
  // This mirrors the GET /api/me logic so PATCH returns a consistent, valid publicApiKey.
  const _patchPrefsRow = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [] }));
  const _patchStoredKey = (_patchPrefsRow.rows[0] as Record<string,unknown>)?.settings as Record<string,unknown> | null;
  const _publicApiKey = (typeof _patchStoredKey?.publicApiKey === "string" && _patchStoredKey.publicApiKey)
    ? _patchStoredKey.publicApiKey
    : `fp_pub_${_pkHash}`;

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
    publicApiKey:       _publicApiKey,
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
  const body = req.body as Partial<Record<string, boolean | number>>;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ ok: false, error: "Invalid addons payload — expected an object" }); return;
  }

  // Load current addons from DB — never from store.me singleton
  const orgData = await loadOrgData(orgId).catch(() => null);
  const currentAddons: Record<string, boolean | number> = { ...(orgData?.addons ?? {}) as Record<string, boolean | number> };

  if (typeof body.whiteLabel      === "boolean") currentAddons.whiteLabel      = body.whiteLabel;
  if (typeof body.prioritySupport === "boolean") currentAddons.prioritySupport = body.prioritySupport;
  if (typeof body.customDomain    === "boolean") currentAddons.customDomain    = body.customDomain;
  if (typeof body.extraSeats      === "number" && body.extraSeats     >= 0) currentAddons.extraSeats     = Math.floor(body.extraSeats);
  if (typeof body.monitorsPack50  === "number" && body.monitorsPack50 >= 0) currentAddons.monitorsPack50 = Math.floor(body.monitorsPack50);

  try {
    await upsertOrgSettings(orgId, { addons: currentAddons });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to persist addons — try again" }); return;
  }

  const current = await loadOrgSettings(orgId);
  const limits = PLAN_LIMITS[(current?.plan ?? "standard").toLowerCase()] ?? PLAN_LIMITS["standard"];
  res.json({ ok: true, addons: currentAddons, limits });
});

// ── Streak helpers ─────────────────────────────────────────────────────────────

type DbFn = (sql: string, vals?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Record one row per org per day in user_activity_days (cheap upsert, idempotent).
 * Timezone: from user_prefs.settings.timezone, fallback Europe/Brussels.
 */
async function recordActivityDay(db: DbFn, orgId: string): Promise<void> {
  try {
    let tz = "Europe/Brussels";
    try {
      const tzRow = await db(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
      const s = tzRow.rows[0]?.["settings"] as Record<string, unknown> | null;
      if (s && typeof s["timezone"] === "string" && s["timezone"]) tz = s["timezone"];
    } catch { /* non-fatal */ }
    await db(
      `INSERT INTO user_activity_days (org_id, user_id, day)
       VALUES ($1, $1, (NOW() AT TIME ZONE $2)::date)
       ON CONFLICT (org_id, user_id, day) DO NOTHING`,
      [orgId, tz]
    );
  } catch { /* non-fatal — table may not exist yet on first boot */ }
}

/**
 * Compute {current, best} streak from user_activity_days.
 * Today counts if present; if today absent, start from yesterday
 * so the streak never decreases during the same calendar day.
 */
async function computeStreakFromTable(db: DbFn, orgId: string, tz: string): Promise<{ current: number; best: number }> {
  const actRes = await db(
    `SELECT day::text AS d FROM user_activity_days
     WHERE org_id=$1 AND day >= (NOW() AT TIME ZONE $2)::date - INTERVAL '365 days'
     ORDER BY d DESC`,
    [orgId, tz]
  );
  if (actRes.rows.length === 0) return { current: 0, best: 0 };

  const activeDays = new Set(actRes.rows.map((row: Record<string, unknown>) => String(row["d"]).slice(0, 10)));
  // today in the org's timezone
  const todayStr = new Date().toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).slice(0, 10);
  const startOffset = activeDays.has(todayStr) ? 0 : 1;

  let current = 0;
  for (let d = startOffset; d < 365; d++) {
    const dt = new Date(Date.now() - d * 86_400_000);
    const dayStr = dt.toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).slice(0, 10);
    if (activeDays.has(dayStr)) { current++; } else { break; }
  }

  const sortedDays = Array.from(activeDays).sort();
  let best = 0;
  let run = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    if (i === 0) { run = 1; }
    else {
      const prev = new Date(sortedDays[i - 1]!);
      const curr = new Date(sortedDays[i]!);
      const diff = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);
      run = diff === 1 ? run + 1 : 1;
    }
    if (run > best) best = run;
  }
  if (current > best) best = current;
  return { current, best };
}

// ── GET /api/me/streak ─────────────────────────────────────────────────────────
// Returns { current, best } from real user_activity_days rows.
router.get("/me/streak", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    await recordActivityDay(orgDb(req), orgId);
    let tz = "Europe/Brussels";
    try {
      const tzRow = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
      const s = tzRow.rows[0]?.["settings"] as Record<string, unknown> | null;
      if (s && typeof s["timezone"] === "string" && s["timezone"]) tz = s["timezone"];
    } catch { /* non-fatal */ }
    const streak = await computeStreakFromTable(orgDb(req), orgId, tz);
    res.json(streak);
  } catch {
    res.json({ current: 0, best: 0 });
  }
});

// ── GET /api/me/prefs ─────────────────────────────────────────────────────────
router.get("/me/prefs", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    // Record today's activity (cheap upsert, non-fatal)
    recordActivityDay(orgDb(req), orgId).catch(() => {});

    const r = await orgDb(req)(`SELECT streak, pinned, checklist, settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    const row = r.rows[0] ?? { streak: 0, pinned: {}, checklist: null, settings: null };

    // Determine timezone
    let tz = "Europe/Brussels";
    const settingsObj = row["settings"] as Record<string, unknown> | null;
    if (settingsObj && typeof settingsObj["timezone"] === "string" && settingsObj["timezone"]) {
      tz = settingsObj["timezone"];
    }

    // Compute streak from user_activity_days (authoritative).
    // Fall back to legacy activity_logs, then to stored value.
    let finalStreak: number;
    let querySucceeded = false;
    let computedStreak = 0;
    try {
      const { current } = await computeStreakFromTable(orgDb(req), orgId, tz);
      querySucceeded = true;
      computedStreak = current;
      finalStreak = current;
    } catch {
      // user_activity_days not yet available — fall back to activity_logs
      try {
        const actRes = await orgDb(req)(
          `SELECT DISTINCT DATE(created_at AT TIME ZONE $2) AS d
           FROM activity_logs
           WHERE org_id = $1
             AND created_at >= NOW() - INTERVAL '365 days'
           ORDER BY d DESC`,
          [orgId, tz]
        );
        querySucceeded = true;
        if (actRes.rows.length > 0) {
          const activeDays = new Set(actRes.rows.map((r2: Record<string, unknown>) => String(r2["d"]).slice(0, 10)));
          const todayStr = new Date().toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).slice(0, 10);
          const startOffset = activeDays.has(todayStr) ? 0 : 1;
          let s = 0;
          for (let d = startOffset; d < 365; d++) {
            const dt = new Date(Date.now() - d * 86_400_000);
            const dayStr = dt.toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).slice(0, 10);
            if (activeDays.has(dayStr)) { s++; } else { break; }
          }
          computedStreak = s;
        }
        finalStreak = computedStreak;
      } catch {
        finalStreak = typeof row["streak"] === "number" ? (row["streak"] as number) : 0;
      }
    }

    const storedStreak = typeof row["streak"] === "number" ? (row["streak"] as number) : 0;
    if (querySucceeded && computedStreak !== storedStreak) {
      orgDb(req)(
        `INSERT INTO user_prefs (org_id, streak, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (org_id) DO UPDATE SET streak = $2, updated_at = now()`,
        [orgId, finalStreak]
      ).catch(() => {});
    }

    res.json({ ...row, streak: finalStreak });
  } catch {
    res.json({ streak: 0, pinned: {}, checklist: null, settings: null });
  }
});

// ── PATCH /api/me/prefs ───────────────────────────────────────────────────────
router.patch("/me/prefs", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const { streak, pinned, checklist, settings: rawSettings, statusPageUrl } = req.body as {
    streak?: number; pinned?: Record<string, boolean>; checklist?: unknown; settings?: Record<string, unknown>;
    statusPageUrl?: string; // convenience top-level alias — merged into settings.statusPageUrl
  };
  // ── statusPageUrl validation helper ──────────────────────────────────────────
  // Returns the trimmed URL if it is a valid absolute http/https URL, "" if the
  // intent is to clear the field, or null if the value is invalid and must be
  // rejected.  Never allows javascript:, data:, or other schemes.
  function validateStatusPageUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed === "") return "";          // explicit clear — allowed
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return trimmed;
    } catch {
      // falls through to null
    }
    return null;                           // invalid — must be rejected
  }

  // Strip any DataForSEO credentials from settings before storing in user_prefs.
  // IMPORTANT: also strip statusPageUrl from rawSettings so it cannot bypass the
  // validated top-level field.  statusPageUrl is always written through the
  // top-level path only, which is protocol-validated before the JSONB merge.
  let settings = rawSettings;
  if (settings && typeof settings === "object") {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dataForSEO: _dfs, statusPageUrl: _spUrl, ...rest } = settings;
    settings = rest;
  }

  // Convenience: top-level statusPageUrl is merged into settings so the value
  // survives across devices (user_prefs row, not localStorage).
  // Invalid non-empty values → 400 (no silent accept).
  if (typeof statusPageUrl === "string") {
    const validated = validateStatusPageUrl(statusPageUrl);
    if (validated === null) {
      res.status(400).json({ error: "statusPageUrl must be an absolute https:// or http:// URL or empty string" });
      return;
    }
    settings = Object.assign({}, settings ?? {}, { statusPageUrl: validated });
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
    // Journalise la modification de paramètres dans le fil d'activité (Command Center)
    if (settings && Object.keys(settings).length > 0) {
      const keys = Object.keys(settings).slice(0, 5).join(", ");
      import("../services/store.js")
        .then(m => m.store.logActivity({ type: "settings", label: `Paramètres mis à jour : ${keys}`, orgId }))
        .catch(() => {});
    }
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

// ── GET /api/settings/api-keys ───────────────────────────────────────────────
router.get("/settings/api-keys", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  // API-key principals (fp_pub_ / fp_sec_) must never see the raw secret key value.
  // Only interactive sessions (browser login) may retrieve it.
  const isApiKeyPrincipal = (req.orgContext?.userId ?? "").startsWith("apikey:");

  try {
    const r = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [] }));
    const prefs = (r.rows[0] as Record<string, unknown>)?.settings as Record<string, string> | null;
    const _pkHash = Buffer.from(orgId).toString("base64").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 22);
    const publicKey  = prefs?.publicApiKey  ?? `fp_pub_${_pkHash}`;
    const secretKey  = prefs?.secretApiKey  ?? null;

    // Auto-persist the deterministic public key if it hasn't been stored yet.
    // This ensures it is findable by orgContext on future API requests.
    if (!prefs?.publicApiKey) {
      orgDb(req)(
        `INSERT INTO user_prefs (org_id, settings, updated_at)
         VALUES ($1, jsonb_build_object('publicApiKey', $2::text), now())
         ON CONFLICT (org_id) DO UPDATE SET
           settings   = COALESCE(user_prefs.settings, '{}'::jsonb) || jsonb_build_object('publicApiKey', $2::text),
           updated_at = now()`,
        [orgId, publicKey]
      ).catch((err: unknown) => logger.warn({ err }, "[api-keys] auto-persist publicApiKey failed"));
    }

    res.json({
      publicKey,
      // Never expose the actual secret to API-key callers — they already have their own credential.
      secretKey:  isApiKeyPrincipal ? null : secretKey,
      hasSecret:  !!secretKey,
      publicKeyCreatedAt: prefs?.publicApiKeyCreatedAt ?? null,
      secretKeyCreatedAt: prefs?.secretApiKeyCreatedAt ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[api-keys/get] failed");
    res.status(500).json({ error: "Erreur" });
  }
});

// ── DELETE /api/settings/data ─────────────────────────────────────────────────
// Purge all product data for this org but keep the account intact.
router.delete("/settings/data", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const tables = [
    "audits", "audit_schedules", "reports", "report_exports",
    "monitors", "monitor_checks", "monitor_incidents",
    "alert_rules", "alert_events",
    "tracked_keywords", "calendar_events",
    "team_messages", "team_files",
    "automation_integrations", "automation_workflows", "automation_runs",
    "automation_logs", "workflow_runs", "incoming_webhooks",
    "missions", "mission_history", "mission_ai_logs",
    "psi_cache", "seo_forecasts", "funnels", "funnel_steps",
    "gsc_keyword_data", "gsc_page_data", "gsc_sync_logs",
    "behavior_events", "behavior_sessions",
    "traffic_sources", "traffic_losses",
    "cro_scores", "cro_experiments", "revenue_leaks",
    "local_pack_history", "org_checklist",
    "overview_insights_cache", "overview_insights_rl",
    "activity_log", "share_tokens", "growth_objectives",
  ];
  try {
    const { pool: pgPool } = await import("@workspace/db");
    const client = await pgPool.connect();
    let deleted = 0;
    try {
      const existCheck = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1)`,
        [tables]
      );
      const existing = new Set(existCheck.rows.map(r => r.tablename));
      await client.query("BEGIN");
      for (const t of tables.filter(t => existing.has(t))) {
        const r = await client.query(`DELETE FROM ${t} WHERE org_id = $1`, [orgId]);
        deleted += r.rowCount ?? 0;
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    logger.info({ orgId, deleted }, "[settings/data] User data purged");
    res.json({ ok: true, deleted });
  } catch (err) {
    logger.error({ err }, "[settings/data] purge failed");
    res.status(500).json({ error: "Erreur lors de la suppression" });
  }
});

// ── POST /api/settings/api-keys/regenerate ────────────────────────────────────
router.post("/settings/api-keys/regenerate", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  // API-key principals must not be able to regenerate keys — only interactive sessions may rotate them.
  if ((req.orgContext?.userId ?? "").startsWith("apikey:")) {
    res.status(403).json({ error: "Forbidden: API keys cannot be rotated via an API key credential" });
    return;
  }

  const { type } = req.body as { type?: "public" | "secret" };
  try {
    const suffix = randomBytes(20).toString("hex"); // 40-char hex
    const createdAt = new Date().toISOString();
    if (type === "secret") {
      const secretKey = `fp_sec_${suffix}`;
      await orgDb(req)(
        `INSERT INTO user_prefs (org_id, settings, updated_at)
         VALUES ($1, jsonb_build_object('secretApiKey', $2::text, 'secretApiKeyCreatedAt', $3::text), now())
         ON CONFLICT (org_id) DO UPDATE SET
           settings = COALESCE(user_prefs.settings, '{}'::jsonb) || jsonb_build_object('secretApiKey', $2::text, 'secretApiKeyCreatedAt', $3::text),
           updated_at = now()`,
        [orgId, secretKey, createdAt]
      );
      res.json({ ok: true, key: secretKey, type: "secret", createdAt });
    } else {
      // Public key: store custom suffix in prefs so it overrides the deterministic hash
      const publicKey = `fp_pub_${suffix}`;
      await orgDb(req)(
        `INSERT INTO user_prefs (org_id, settings, updated_at)
         VALUES ($1, jsonb_build_object('publicApiKey', $2::text, 'publicApiKeyCreatedAt', $3::text), now())
         ON CONFLICT (org_id) DO UPDATE SET
           settings = COALESCE(user_prefs.settings, '{}'::jsonb) || jsonb_build_object('publicApiKey', $2::text, 'publicApiKeyCreatedAt', $3::text),
           updated_at = now()`,
        [orgId, publicKey, createdAt]
      );
      res.json({ ok: true, key: publicKey, type: "public", createdAt });
    }
    // Journalise la rotation de clé dans le fil d'activité
    import("../services/store.js")
      .then(m => m.store.logActivity({ type: "security", label: `Clé API ${type === "secret" ? "secrète" : "publique"} régénérée`, orgId }))
      .catch(() => {});
  } catch (err) {
    logger.error({ err }, "[api-keys/regenerate] failed");
    res.status(500).json({ error: "Erreur lors de la régénération" });
  }
});

export default router;
