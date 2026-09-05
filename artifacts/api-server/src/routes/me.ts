import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { requireOrgId } from "../lib/require-org-id.js";
import { canAdmin, ownerOnly, canWrite } from "../middlewares/requireRole.js";

import { PLAN_LIMITS, PLAN_INCLUDED_ADDONS, QTY_ADDON_GRANTS } from "../lib/plans.js";
import { loadOrgSettings, upsertOrgSettings } from "../services/org-settings.js";
import { loadOrgData }                         from "../services/org-data.js";
import { normalizeSubscriptionStatus } from "../lib/subscription-state.js";
import { logger } from "../lib/logger.js";
import {
  loadMeEntitlement,
  BillingDataUnavailableError,
  BILLING_DATA_UNAVAILABLE_CODE,
} from "./me-entitlement.js";

const router = Router();

/**
 * Validate and sanitize an IANA timezone string.
 * Maps common French UI labels to their IANA equivalents (e.g. "Bruxelles" â†’ "Europe/Brussels").
 * Falls back to "Europe/Brussels" for completely unrecognised values rather than
 * storing an invalid string that would cause PostgreSQL AT TIME ZONE errors (22023).
 */
function sanitizeTimezone(raw: string): string {
  // Common UI-label â†’ IANA mappings (French labels, city-only labels, etc.)
  const LABEL_MAP: Record<string, string> = {
    "Bruxelles":      "Europe/Brussels",
    "bruxelles":      "Europe/Brussels",
    "Paris":          "Europe/Paris",
    "paris":          "Europe/Paris",
    "Amsterdam":      "Europe/Amsterdam",
    "amsterdam":      "Europe/Amsterdam",
    "Berlin":         "Europe/Berlin",
    "berlin":         "Europe/Berlin",
    "London":         "Europe/London",
    "london":         "Europe/London",
    "Madrid":         "Europe/Madrid",
    "madrid":         "Europe/Madrid",
    "Rome":           "Europe/Rome",
    "rome":           "Europe/Rome",
    "Zurich":         "Europe/Zurich",
    "zurich":         "Europe/Zurich",
    "Lisbon":         "Europe/Lisbon",
    "lisbon":         "Europe/Lisbon",
    "Varsovie":       "Europe/Warsaw",
    "varsovie":       "Europe/Warsaw",
    "New York":       "America/New_York",
    "new york":       "America/New_York",
    "Los Angeles":    "America/Los_Angeles",
    "los angeles":    "America/Los_Angeles",
    "Chicago":        "America/Chicago",
    "chicago":        "America/Chicago",
    "Toronto":        "America/Toronto",
    "toronto":        "America/Toronto",
    "Tokyo":          "Asia/Tokyo",
    "tokyo":          "Asia/Tokyo",
    "Dubai":          "Asia/Dubai",
    "dubai":          "Asia/Dubai",
    "Singapour":      "Asia/Singapore",
    "singapour":      "Asia/Singapore",
    "Sydney":         "Australia/Sydney",
    "sydney":         "Australia/Sydney",
  };

  const mapped = LABEL_MAP[raw] ?? raw;

  // Validate as a proper IANA timezone â€” Intl.DateTimeFormat throws on invalid zones
  try {
    Intl.DateTimeFormat(undefined, { timeZone: mapped });
    return mapped;
  } catch {
    logger.warn({ raw, mapped }, "[sanitizeTimezone] Invalid IANA timezone â€” falling back to Europe/Brussels");
    return "Europe/Brussels";
  }
}

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

// â”€â”€ GET /api/me â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get("/me", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, no-cache");

  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  // Record today's activity for streak reliability â€” every dashboard load counts,
  // regardless of whether /api/me/streak or /api/me/prefs is reached later.
  recordActivityDay(orgDb(req), orgId, req.orgContext?.userId ?? undefined).catch(() => {});

  // Canonical timezone + language from user_prefs.settings (written by PATCH /api/me/settings).
  // Queried unconditionally so they appear even when org_settings row is missing
  // (new-auth orgs only have an organizations row, not org_settings).
  let settingsTimezone: string | null = null;
  let settingsLanguage: string | null = null;
  try {
    const pRow = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    const prefs = pRow.rows[0]?.settings as Record<string, unknown> | null;
    if (prefs) {
      if (typeof prefs.timezone === "string" && prefs.timezone) {
        settingsTimezone = prefs.timezone;
      }
      if (typeof prefs.language === "string" && prefs.language) {
        settingsLanguage = prefs.language;
      }
    }
  } catch { /* non-fatal */ }

  try {
    // Jalon 4: parallel fetch â€” billing from organizations (source of truth) + profile from org_settings.
    // FAIL-CLOSED: loadMeEntitlement distinguishes "row genuinely absent" (null) from
    // "store threw" (BillingDataUnavailableError). A transient DB failure must NEVER be
    // downgraded to a fabricated Standard/unknown entitlement â€” it becomes a retryable 503.
    // org_addons is loaded fail-closed too, so quantity-addon limits are never undercounted.
    const { billingData, dbData, addonRows: _entitlementAddonRows } = await loadMeEntitlement(orgId, {
      loadOrgData,
      loadOrgSettings,
      loadAddons: async (id) => {
        // org_addons.org_id is UUID-typed in production.
        // A legacy (email-shaped) orgId would throw "invalid input syntax for type uuid"
        // and pollute Supabase logs.  Skip the query when id is not a valid UUID;
        // the caller falls back to plan-included addons only.
        const { isUUIDFormat } = await import("../lib/validate-org-id.js");
        if (!isUUIDFormat(id)) {
          return [];
        }
        const r = await orgDb(req)(
          `SELECT addon_key, active, quantity FROM org_addons WHERE org_id=$1`,
          [id],
        );
        return r.rows;
      },
    });

    if (billingData ?? dbData) {
      // Billing fields: prefer organizations (billingData) â†’ org_settings fallback (dbData)
      const rawPlan             = billingData?.plan ?? dbData?.plan ?? "standard";
      const plan                = rawPlan.toLowerCase();
      // Mutable copy â€” org_addons qty grants are applied below after _addonsRows is read
      const limits: Record<string, number> = { ...(PLAN_LIMITS[plan] ?? PLAN_LIMITS["standard"]) };
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

      // Normalise subscription status â€” include trialConsumedAt for pending_billing detection
      const _normStatusBase = normalizeSubscriptionStatus({
        rawStatus:            rawSubStatus,
        stripeSubscriptionId: rawStripeSubId,
        stripeCustomerId:     rawStripeCustomerId,
        trialEndsAt:          rawTrialEndsAt,
        trialConsumedAt:      rawTrialConsumedAt,
      });

      // Internal QA bypass â€” mirrors billing-context.ts guard exactly.
      // Double-locked: orgId must match the fixed QA UUID AND is_internal_qa=true.
      // Prevents any other org from ever receiving 'trialing' via this path.
      const _QA_ORG_UUID = "10000000-0000-4000-8000-000000000002";
      const _isQaOrg = orgId === _QA_ORG_UUID && billingData?.isInternalQa === true;
      const normStatus = _isQaOrg ? "trialing" as const : _normStatusBase;

      // Read addons from org_addons table (single source of truth â€” Correction 8).
      // FAIL-CLOSED: these rows were loaded by loadMeEntitlement, which turns an
      // org_addons load failure into a 503 rather than a suppressed empty array â€”
      // otherwise quantity-addon limits below would be silently undercounted.
      const _addonsRows = { rows: _entitlementAddonRows };
      const _mergedAddons: Record<string, boolean | number> = {};
      for (const row of _addonsRows.rows) {
        const key = String(row["addon_key"]);
        if (!row["active"]) continue;
        // Qty addons (extraSeats, monitorsPack10, etc.) â†’ store pack count as number
        const qtyGrant = QTY_ADDON_GRANTS[key as keyof typeof QTY_ADDON_GRANTS];
        if (qtyGrant) {
          const packs = Number(row["quantity"] ?? 1);
          _mergedAddons[key] = packs;
          // Expand the mutable limits object with this pack's grant
          limits[qtyGrant.resource] = (limits[qtyGrant.resource] ?? 0) + packs * qtyGrant.perPack;
        } else {
          _mergedAddons[key] = true;
        }
      }
      // Merge plan-included addons (whiteLabel for Standard, etc.) â€” PLAN_INCLUDED_ADDONS is the source of truth
      for (const addonKey of PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>()) {
        if (!_mergedAddons[addonKey]) _mergedAddons[addonKey] = true;
      }
      // Merge org_settings.addons as legacy supplemental (org_addons takes precedence)
      const legacyAddons = dbData?.addons ?? billingData?.addons;
      if (legacyAddons && typeof legacyAddons === "object") {
        for (const [key, val] of Object.entries(legacyAddons)) {
          if (!(key in _mergedAddons)) _mergedAddons[key] = val as boolean | number;
        }
      }
      // QA org: never show "start trial" CTA â€” it's an internal account, not a real signup.
      const _canStartTrial = !_isQaOrg && !rawTrialConsumedAt && !rawStripeSubId;

      // â”€â”€ P0 ISOLATION LOGGING â€” temporary, identifies cross-user leaks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Logs every /api/me response with full identity context so USER A / USER B
      // test scenarios can trace exactly which session/user/plan is being served.
      // Remove once ACTUAL_ROOT_CAUSE is confirmed from browser tests.
      const _sessionBearer = String((req as Request & { headers: Record<string, unknown> }).headers["authorization"] ?? "").slice(7, 23) || "cookie-auth";
      logger.info({
        // â”€ Identity
        session_id:             _sessionBearer,
        user_id:                req.orgContext?.userId ?? null,
        user_uuid:              req.orgContext?.userUuid ?? null,
        email:                  req.orgContext?.email ?? null,
        org_id:                 orgId,
        // â”€ Stripe
        stripe_customer_id:     rawStripeCustomerId ? rawStripeCustomerId.slice(-8) : null,
        stripe_subscription_id: rawStripeSubId      ? rawStripeSubId.slice(-8)      : null,
        // â”€ Plan resolution chain
        plan_from_db:           (billingData?.plan ?? dbData?.plan ?? "MISSING").toLowerCase(),
        plan_source:            billingData?.plan ? "organizations" : dbData?.plan ? "org_settings" : "NONE",
        plan_final:             normPlan(rawPlan),
        // â”€ Addons & quotas
        addon_source:           "org_addons+plan_included",
        addon_count:            Object.keys(_mergedAddons).length,
        retention90d_active:    !!_mergedAddons["retention90d"],
        retention365d_active:   !!_mergedAddons["retention365d"],
        // â”€ Subscription
        sub_status:             normStatus,
        role:                   req.orgContext?.role ?? "member",
        org_name:               (dbData?.orgName ?? "").slice(0, 30),
      }, "[P0-ISOLATION][ME]");
      // â”€â”€ P1 RETENTION90D SUPPRESSION â€” fix Ultra double-count â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // On Ultra, retention90d is superseded by retention365d.  If both are active
      // (legacy Pro provisioning survived upgrade), remove retention90d from the
      // merged addons so /api/me does not report 11 active addons for an Ultra org.
      if (plan === "ultra" && _mergedAddons["retention365d"] && _mergedAddons["retention90d"]) {
        delete _mergedAddons["retention90d"];
        logger.info({ orgId, plan }, "[P1][ME] retention90d suppressed (superseded by retention365d on Ultra)");
      }
      res.json({
        orgId:               orgId,
        firstName,
        lastName:            dbData?.lastName ?? "",
        email:               req.orgContext?.email ?? "",
        userId:              req.orgContext?.userId ?? null,
        userUuid:            req.orgContext?.userUuid ?? null,
        plan:                normPlan(rawPlan),
        role:                req.orgContext?.role ?? "member",
        org:                 { name: billingData?.orgName ?? dbData?.orgName ?? "", website: dbData?.website ?? "" },
        subscriptionStatus:  normStatus,
        stripeSubscriptionId: rawStripeSubId,
        trialEndsAt:         rawTrialEndsAt,
        stripeCustomerId:    rawStripeCustomerId,
        canStartTrial:       _canStartTrial,
        hasPremiumAccess:    normStatus === "active" || normStatus === "trialing" || normStatus === "past_due",
        mustCompleteBilling: normStatus !== "active" && normStatus !== "trialing" && normStatus !== "past_due",
        onboardingCompletedAt: await (async () => {
          try {
            const _obr = await orgDb(req)(`SELECT settings->>'onboardingCompletedAt' AS cat FROM user_prefs WHERE org_id=$1`, [orgId]);
            return (_obr.rows[0]?.cat as string | null) ?? null;
          } catch { return null; }
        })(),
        usage:              await (async () => {
          try {
            const now = new Date();
            const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
            const [auditR, monR, repR, kwR, pdfR, exportR] = await Promise.all([
              orgDb(req)(`SELECT COUNT(*)::int AS n FROM audits WHERE org_id=$1`, [orgId]).catch(() => ({rows:[]})),
              orgDb(req)(`SELECT COUNT(*)::int AS n FROM monitors WHERE org_id=$1`, [orgId]).catch(() => ({rows:[]})),
              orgDb(req)(`SELECT COUNT(*)::int AS n FROM reports WHERE org_id=$1`, [orgId]).catch(() => ({rows:[]})),
              // keyword tracking count â€” persists in DB, survives F5
              orgDb(req)(`SELECT COUNT(*)::int AS n FROM tracked_keywords WHERE org_id=$1 AND active=true`, [orgId]).catch(() => ({rows:[]})),
              // PDF exports â€” counted via usage_events (kind='pdf_export'), current month only
              orgDb(req)(
                `SELECT COUNT(*)::int AS n FROM usage_events WHERE org_id=$1 AND kind='pdf_export' AND created_at >= $2`,
                [orgId, monthStart],
              ).catch(() => ({rows:[]})),
              // Data exports â€” counted via usage_events (kind='export' or 'health_export'), current month only
              orgDb(req)(
                `SELECT COUNT(*)::int AS n FROM usage_events WHERE org_id=$1 AND kind IN ('export','health_export') AND created_at >= $2`,
                [orgId, monthStart],
              ).catch(() => ({rows:[]})),
            ]);
            const stored = (dbData?.usage ?? {}) as Record<string, unknown>;
            return {
              ...stored,
              audit:    { used: (auditR.rows[0] as Record<string,number>|undefined)?.n ?? 0, limit: limits.audits },
              monitor:  { used: (monR.rows[0]   as Record<string,number>|undefined)?.n ?? 0, limit: limits.monitors },
              reports:  { used: (repR.rows[0]   as Record<string,number>|undefined)?.n ?? 0, limit: limits.reports },
              exports:  { used: (exportR.rows[0] as Record<string,number>|undefined)?.n ?? 0, limit: limits.exports ?? limits.reports },
              pdf:      { used: (pdfR.rows[0]   as Record<string,number>|undefined)?.n ?? 0, limit: limits.reports },
              keywords: { used: (kwR.rows[0]    as Record<string,number>|undefined)?.n ?? 0, limit: limits.keywords ?? 500 },
            };
          } catch { return dbData?.usage ?? {}; }
        })(),
        addons:             _mergedAddons,
        limits,
        // dfsQuota: DataForSEO API quota for today â€” seeded here so the dashboard
        // can show a correct X/N value immediately on F5, before /api/seo/status loads.
        dfsQuota: await (async () => {
          try {
            const { isDataForSEOConfigured, getQuotaUsageFromDB } = await import("../services/dataforseo-service.js");
            const configured = await isDataForSEOConfigured(orgId);
            // DB-backed: reads dataforseo_quota for today, warms in-memory cache.
            // This ensures /api/me returns the correct used count on F5/reconnect.
            const { used, limit } = await getQuotaUsageFromDB(orgId, rawPlan);
            return { configured, used, limit, remaining: Math.max(0, limit - used) };
          } catch { return null; }
        })(),
        publicApiKey:       _publicApiKey,
        createdAt:          dbData?.createdAt ?? new Date().toISOString(),
        timezone:  settingsTimezone ?? dbData?.timezone  ?? null,
        language:  dbData?.language  ?? settingsLanguage ?? null,
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
  } catch (err) {
    // Authoritative billing/entitlement data could not be loaded (transient DB
    // failure / outage). NEVER fabricate a Standard/unknown entitlement here â€”
    // return an explicit, retryable, non-cacheable 503 so the client retries
    // instead of treating the org as having no plan.
    if (err instanceof BillingDataUnavailableError) {
      logger.warn({ orgId }, "[me] GET /api/me â€” billing/entitlement data unavailable, returning 503");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Retry-After", "5");
      res.status(503).json({
        error: "Billing and entitlement data is temporarily unavailable. Please retry.",
        code:  BILLING_DATA_UNAVAILABLE_CODE,
        retryable: true,
      });
      return;
    }
    // Unexpected non-billing error â€” also fail closed rather than fabricating a plan.
    logger.error({ err, orgId }, "[me] GET /api/me â€” unexpected error, returning 503");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Retry-After", "5");
    res.status(503).json({
      error: "Unable to load account data. Please retry.",
      code:  BILLING_DATA_UNAVAILABLE_CODE,
      retryable: true,
    });
    return;
  }

  // Reached only when both authoritative sources resolved successfully but the org
  // genuinely has no billing/settings row yet (brand-new account). This is a
  // legitimate absence, NOT a failure â€” but we still must not fabricate a paid or
  // fake entitlement. Treat it as retryable-unavailable so provisioning can catch up.
  logger.warn({ orgId }, "[me] GET /api/me â€” no billing/entitlement row for org, returning 503");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Retry-After", "5");
  res.status(503).json({
    error: "Account entitlement is not available yet. Please retry.",
    code:  BILLING_DATA_UNAVAILABLE_CODE,
    retryable: true,
  });
});

// â”€â”€ PATCH /api/me â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Fully org-isolated: reads from DB, applies only provided fields, returns DB-confirmed data.
// Never reads from store.me (global singleton) to prevent multi-tenant leaks.
// â”€â”€ PATCH /api/org â€” update organisation name / website â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.patch("/org", canAdmin, async (req: Request, res: Response): Promise<void> => {
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

  // Localisation fields must go to PATCH /api/location â€” reject explicitly, never silently ignore
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
    w6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã°¢G'’°¢òò´d•…Ò72&VÂW6W$–B6òÖVÖ&W%ö7F—f—G•öF—2—2÷VÆFVBf÷"FVÒ×7G&V²F—7Æ’à¢v—B&V6÷&D7F—f—G”F’†÷&tF"‡&W’Â÷&t–BÂ&Wæ÷&t6öçFW‡CòçW6W$–B“°¢ÆWBG¢Ò$WW&÷Rô''W76VÇ2#°¢ÆWB7F÷&VE7G&V²Ò°¢G'’°¢6öç7BG¥&÷rÒv—B÷&tF"‡&W’†4TÄT5B6WGF–æw2Â7G&V²e$ôÒW6W%÷&Vg2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ“°¢6öç7B2ÒG¥&÷rç&÷w5³Óòå²'6WGF–æw2%Ò2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâÂçVÆÃ°¢–b‡2bbG—Vöb5²'F–ÖW¦öæR%ÒÓÓÒ'7G&–ær"bb5²'F–ÖW¦öæR%Ò’G¢Ò5²'F–ÖW¦öæR%Ó°¢7F÷&VE7G&V²ÒG—VöbG¥&÷rç&÷w5³Óòå²'7G&V²%ÒÓÓÒ&çVÖ&W""ò‡G¥&÷rç&÷w5³Õ²'7G&V²%Ò2çVÖ&W"’¢°¢Ò6F6‚²ò¢æöâÖfFÂ¢òĞ¢6öç7BW6W$–BÒ&Wæ÷&t6öçFW‡CòçW6W$–Bóò&WçW6W$–BóòVæFVf–æVC°¢6öç7B7G&V²Òv—B6ö×WFU7G&V´g&öÕF&ÆR†÷&tF"‡&W’Â÷&t–BÂG¢ÂW6W$–B“°¢òòæWfW"&WGW&â–bF†R7F—f—G’F&ÆR—2V×G’f÷"F†—2÷&r(	@¢òòF†BÖVç2F†R&÷r–ç6W'F–öâ†6âwB†VæVB–WB…$Å2&6R’Âæ÷BvVçV–æRvà¢6öç7B6fU7G&V²Ò‡7G&V²ç&÷t6÷VçBÓÓÒbb7F÷&VE7G&V²â’ò7F÷&VE7G&V²¢7G&V²æ7W'&VçC°¢&W2æ§6öâ‡²7W'&VçC¢6fU7G&V²Â&W7C¢ÖF‚æÖ‚‡7G&V²æ&W7BÂ6fU7G&V²’Ò“°¢Ò6F6‚°¢&W2æ§6öâ‡²7W'&VçC¢Â&W7C¢Ò“°¢Ğ§Ò“° ¢òò)H)HtUBö’öÖR÷&Vg2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H §&÷WFW"ævWB‚"öÖR÷&Vg2"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã°¢G'’°¢òò&V6÷&BFöF’w27F—f—G’†6†VW6W'BÂæöâÖfFÂ¢&V6÷&D7F—f—G”F’†÷&tF"‡&W’Â÷&t–BÂ&Wæ÷&t6öçFW‡CòçW6W$–BóòVæFVf–æVB’æ6F6‚‚‚’Óâ·Ò“° ¢6öç7B"Òv—B÷&tF"‡&W’†4TÄT5B7G&V²Â–ææVBÂ6†V6¶Æ—7BÂ6WGF–æw2e$ôÒW6W%÷&Vg2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ“°¢6öç7B&÷rÒ"ç&÷w5³Òóò²7G&V³¢Â–ææVC¢·ÒÂ6†V6¶Æ—7C¢çVÆÂÂ6WGF–æw3¢çVÆÂÓ° ¢òòFWFW&Ö–æRF–ÖW¦öæP¢ÆWBG¢Ò$WW&÷Rô''W76VÇ2#°¢6öç7B6WGF–æw4ö&¢Ò&÷u²'6WGF–æw2%Ò2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâÂçVÆÃ°¢–b‡6WGF–æw4ö&¢bbG—Vöb6WGF–æw4ö&¥²'F–ÖW¦öæR%ÒÓÓÒ'7G&–ær"bb6WGF–æw4ö&¥²'F–ÖW¦öæR%Ò’°¢G¢Ò6WGF–æw4ö&¥²'F–ÖW¦öæR%Ó°¢Ğ ¢òò6ö×WFR7G&V²g&öÒW6W%ö7F—f—G•öF—2†WF†÷&—FF—fR’à¢òòfÆÂ&6²FòÆVv7’7F—f—G•öÆöw2ÂF†VâFò7F÷&VBfÇVRà¢òò´d•…Ò726æöæ–6ÂW6W$–B(	B7G&V²—2W'6öæÂÂæ÷B÷&r×v–FRà¢òòv—F†÷WBW6W$–BÂ6ö×WFU7G&V´g&öÕF&ÆR&WGW&ç2F†R÷&rvw&VvFR†ÆÂÖVÖ&W'26öÖ&–æVB’à¢6öç7BW6W$–BÒ‡&W2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ•²&÷&t6öçFW‡B%ÒbbG—Vöb‚‡&W2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ•²&÷&t6öçFW‡B%Ò2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ•²'W6W$–B%ÒÓÓÒ'7G&–ær ¢ò‚‡&W2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ•²&÷&t6öçFW‡B%Ò2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ•²'W6W$–B%Ò27G&–æp¢¢VæFVf–æVC°¢ÆWBf–æÅ7G&V³¢çVÖ&W#°¢ÆWBVW'•7V66VVFVBÒfÇ6S°¢ÆWB6ö×WFVE7G&V²Ò°¢G'’°¢6öç7B²7W'&VçBÒÒv—B6ö×WFU7G&V´g&öÕF&ÆR†÷&tF"‡&W’Â÷&t–BÂG¢ÂW6W$–B“°¢VW'•7V66VVFVBÒG'VS°¢6ö×WFVE7G&V²Ò7W'&VçC°¢f–æÅ7G&V²Ò7W'&VçC°¢Ò6F6‚°¢òòW6W%ö7F—f—G•öF—2æ÷B–WBf–Æ&ÆR(	BfÆÂ&6²Fò7F—f—G•öÆöw0¢G'’°¢6öç7B7E&W2Òv—B÷&tF"‡&W’€¢4TÄT5BD•5D”ä5BDDR†7&VFVEöBBD”ÔR¤ôäRC"’2@¢e$ôÒ7F—f—G•öÆöw0¢t„U$R÷&uö–BÒC¢äB7&VFVEöBãÒäõr‚’Ò”åDU%dÂs3cRF—2p¢õ$DU"%’BDU46À¢¶÷&t–BÂG¥Ğ¢“°¢VW'•7V66VVFVBÒG'VS°¢–b†7E&W2ç&÷w2æÆVæwF‚â’°¢6öç7B7F—fTF—2ÒæWr6WB†7E&W2ç&÷w2æÖ‚‡##¢&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ’Óâ7G&–ær‡#%²&B%Ò’ç6Æ–6RƒÂ’’“°¢6öç7BFöF•7G"ÒæWrFFR‚’çFôÆö6ÆU7G&–ær‚&VâÔ4"Â²F–ÖU¦öæS¢G¢Â–V#¢&çVÖW&–2"ÂÖöçFƒ¢#"ÖF–v—B"ÂF“¢#"ÖF–v—B"Ò’ç6Æ–6RƒÂ“°¢6öç7B7F'Döfg6WBÒ7F—fTF—2æ†2‡FöF•7G"’ò¢°¢ÆWB2Ò°¢f÷"†ÆWBBÒ7F'Döfg6WC²BÂ3cS²B²²’°¢6öç7BGBÒæWrFFR„FFRææ÷r‚’ÒB¢ƒeóCó“°¢6öç7BF•7G"ÒGBçFôÆö6ÆU7G&–ær‚&VâÔ4"Â²F–ÖU¦öæS¢G¢Â–V#¢&çVÖW&–2"ÂÖöçFƒ¢#"ÖF–v—B"ÂF“¢#"ÖF–v—B"Ò’ç6Æ–6RƒÂ“°¢–b†7F—fTF—2æ†2†F•7G"’’²2²³²ÒVÇ6R²'&V³²Ğ¢Ğ¢6ö×WFVE7G&V²Ò3°¢Ğ¢f–æÅ7G&V²Ò6ö×WFVE7G&V³°¢Ò6F6‚°¢f–æÅ7G&V²ÒG—Vöb&÷u²'7G&V²%ÒÓÓÒ&çVÖ&W""ò‡&÷u²'7G&V²%Ò2çVÖ&W"’¢°¢Ğ¢Ğ ¢6öç7B7F÷&VE7G&V²ÒG—Vöb&÷u²'7G&V²%ÒÓÓÒ&çVÖ&W""ò‡&÷u²'7G&V²%Ò2çVÖ&W"’¢°¢òòæWfW"w&—FRFòW6W%÷&Vg2v†VâF†R7F—f—G’F&ÆR&WGW&æVBæò&÷w2f÷"F†—2÷&r(	@¢òòF†BÖVç2F†R”å4U%B†6âwBÆæFVB–WB…$Å2&6Ròf—'7B&ö÷B’Âæ÷BvVçV–æRvà¢6öç7BF&ÆUv4V×G’ÒVW'•7V66VVFVBbb6ö×WFVE7G&V²ÓÓÒbb7F÷&VE7G&V²â°¢–b‡F&ÆUv4V×G’’°¢òò¶VW7F÷&VB7G&V³²Ç6òW6W'B—BFò&Vg&W6‚WFFVEöB6ò—B7F—2WF†÷&—FF—fRà¢f–æÅ7G&V²Ò7F÷&VE7G&V³°¢ÒVÇ6R–b‡VW'•7V66VVFVBbb6ö×WFVE7G&V²ÓÒ7F÷&VE7G&V²’°¢÷&tF"‡&W’€¢”å4U%B”åDòW6W%÷&Vg2†÷&uö–BÂ7G&V²ÂWFFVEöB¢dÅTU2‚CÂC"Âæ÷r‚’¢ôâ4ôädÄ”5B†÷&uö–B’DòUDDR4UB7G&V²ÒC"ÂWFFVEöBÒæ÷r‚–À¢¶÷&t–BÂf–æÅ7G&VµĞ¢’æ6F6‚‚‚’Óâ·Ò“°¢Ğ ¢&W2æ§6öâ‡²ââç&÷rÂ7G&V³¢f–æÅ7G&V²Ò“°¢Ò6F6‚°¢&W2æ§6öâ‡²7G&V³¢Â–ææVC¢·ÒÂ6†V6¶Æ—7C¢çVÆÂÂ6WGF–æw3¢çVÆÂÒ“°¢Ğ§Ò“° ¢òò)H)HD4‚ö’öÖR÷&Vg2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H §&÷WFW"çF6‚‚"öÖR÷&Vg2"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã°¢6öç7B²7G&V²Â–ææVBÂ6†V6¶Æ—7BÂ6WGF–æw3¢&u6WGF–æw2Â7FGW5vUW&ÂÒÒ&Wæ&öG’2°¢7G&V³ó¢çVÖ&W#²–ææVCó¢&V6÷&CÇ7G&–ærÂ&ööÆVãã²6†V6¶Æ—7Có¢Væ¶æ÷vã²6WGF–æw3ó¢&V6÷&CÇ7G&–ærÂVæ¶æ÷vãã°¢7FGW5vUW&Ãó¢7G&–æs²òò6öçfVæ–Væ6RF÷ÖÆWfVÂÆ–2(	BÖW&vVB–çFò6WGF–æw2ç7FGW5vUW&À¢Ó°¢òò)H)H7FGW5vUW&ÂfÆ–FF–öâ†VÇW")H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òò&WGW&ç2F†RG&–ÖÖVBU$Â–b—B—2fÆ–B'6öÇWFR‡GGö‡GG2U$ÂÂ""–bF†P¢òò–çFVçB—2Fò6ÆV"F†Rf–VÆBÂ÷"çVÆÂ–bF†RfÇVR—2–çfÆ–BæB×W7B&P¢òò&V¦V7FVBâæWfW"ÆÆ÷w2¦f67&—C¢ÂFF¢Â÷"÷F†W"66†VÖW2à¢gVæ7F–öâfÆ–FFU7FGW5vUW&Â‡&s¢7G&–ær“¢7G&–ærÂçVÆÂ°¢6öç7BG&–ÖÖVBÒ&rçG&–Ò‚“°¢–b‡G&–ÖÖVBÓÓÒ""’&WGW&â"#²òòW‡Æ–6—B6ÆV"(	BÆÆ÷vV@¢G'’°¢6öç7B'6VBÒæWrU$Â‡G&–ÖÖVB“°¢–b‡'6VBç&÷Fö6öÂÓÓÒ&‡GG3¢"ÇÂ'6VBç&÷Fö6öÂÓÓÒ&‡GG¢"’&WGW&âG&–ÖÖVC°¢Ò6F6‚°¢òòfÆÇ2F‡&÷Vv‚FòçVÆÀ¢Ğ¢&WGW&âçVÆÃ²òò–çfÆ–B(	B×W7B&R&V¦V7FV@¢Ğ ¢òò7G&—ç’FFf÷%4Tò7&VFVçF–Ç2g&öÒ6WGF–æw2&Vf÷&R7F÷&–ær–âW6W%÷&Vg2à¢òò”Õõ%DåC¢Ç6ò7G&—7FGW5vUW&Âg&öÒ&u6WGF–æw26ò—B6ææ÷B'—72F†P¢òòfÆ–FFVBF÷ÖÆWfVÂf–VÆBâ7FGW5vUW&Â—2Çv—2w&—GFVâF‡&÷Vv‚F†P¢òòF÷ÖÆWfVÂF‚öæÇ’Âv†–6‚—2&÷Fö6öÂ×fÆ–FFVB&Vf÷&RF†R¥4ôä"ÖW&vRà¢ÆWB6WGF–æw2Ò&u6WGF–æw3°¢–b‡6WGF–æw2bbG—Vöb6WGF–æw2ÓÓÒ&ö&¦V7B"’°¢òòW6Æ–çBÖF—6&ÆRÖæW‡BÖÆ–æRG—W67&—BÖW6Æ–çBöæò×VçW6VB×f'0¢6öç7B²FFf÷%4Tó¢öFg2Â7FGW5vUW&Ã¢÷7W&ÂÂââç&W7BÒÒ6WGF–æw3°¢6WGF–æw2Ò&W7C°¢Ğ ¢òò6öçfVæ–Væ6S¢F÷ÖÆWfVÂ7FGW5vUW&Â—2ÖW&vVB–çFò6WGF–æw26òF†RfÇVP¢òò7W'f—fW27&÷72FWf–6W2‡W6W%÷&Vg2&÷rÂæ÷BÆö6Å7F÷&vR’à¢òò–çfÆ–BæöâÖV×G’fÇVW2(i"C†æò6–ÆVçB66WB’à¢–b‡G—Vöb7FGW5vUW&ÂÓÓÒ'7G&–ær"’°¢6öç7BfÆ–FFVBÒfÆ–FFU7FGW5vUW&Â‡7FGW5vUW&Â“°¢–b‡fÆ–FFVBÓÓÒçVÆÂ’°¢&W2ç7FGW2ƒC’æ§6öâ‡²W'&÷#¢'7FGW5vUW&Â×W7B&Râ'6öÇWFR‡GG3¢òò÷"‡GG¢òòU$Â÷"V×G’7G&–ær"Ò“°¢&WGW&ã°¢Ğ¢6WGF–æw2Òö&¦V7Bæ76–vâ‡·ÒÂ6WGF–æw2óò·ÒÂ²7FGW5vUW&Ã¢fÆ–FFVBÒ“°¢Ğ¢G'’°¢v—B÷&tF"‡&W’€¢”å4U%B”åDòW6W%÷&Vg2†÷&uö–BÂ7G&V²Â–ææVBÂ6†V6¶Æ—7BÂ6WGF–æw2ÂWFFVEöB¢dÅTU2‚CÂ4ôÄU44R‚C"Ã’Â4ôÄU44R‚C3£¦§6öæ"Âw·Òr’ÂCBÂCRÂæ÷r‚’¢ôâ4ôädÄ”5B†÷&uö–B’DòUDDR4U@¢7G&V²Ò4ôÄU44R‚C"ÂW6W%÷&Vg2ç7G&V²’À¢–ææVBÒ4ôÄU44R‚C3£¦§6öæ"ÂW6W%÷&Vg2ç–ææVB’À¢6†V6¶Æ—7BÒ4ôÄU44R‚CBÂW6W%÷&Vg2æ6†V6¶Æ—7B’À¢6WGF–æw2Ò4ôÄU44R‡W6W%÷&Vg2ç6WGF–æw2Âw·Òs£¦§6öæ"’ÇÂ4ôÄU44R‚CS£¦§6öæ"Âw·Òs£¦§6öæ"’À¢WFFVEöBÒæ÷r‚–À¢¶÷&t–BÀ¢7G&V²óòçVÆÂÀ¢–ææVBò¥4ôâç7G&–æv–g’‡–ææVB’¢çVÆÂÀ¢6†V6¶Æ—7Bò¥4ôâç7G&–æv–g’†6†V6¶Æ—7B’¢çVÆÂÀ¢6WGF–æw2ò¥4ôâç7G&–æv–g’‡6WGF–æw2’¢çVÆÅĞ¢“°¢òò¦÷W&æÆ—6RÆÖöF–f–6F–öâFR&Ü:‡G&W2Fç2ÆRf–ÂBv7F—f—L:’„6öÖÖæB6VçFW"¢–b‡6WGF–æw2bbö&¦V7Bæ¶W—2‡6WGF–æw2’æÆVæwF‚â’°¢6öç7B¶W—2Òö&¦V7Bæ¶W—2‡6WGF–æw2’ç6Æ–6RƒÂR’æ¦ö–â‚"Â"“°¢6öç7B÷6WGF–æw47G‚Ò‡&W2ç’’æ÷&t6öçFW‡BÇÂ·Ó°¢–×÷'B‚"ââ÷6W'f–6W2÷7F÷&Ræ§2"¢çF†Vâ†ÒÓâÒç7F÷&RæÆöt7F—f—G’‡²G—S¢'6WGF–æw2"ÂÆ&VÃ¢&Ü:‡G&W2Ö—2:¦÷W"¢G¶¶W—7ÖÂ÷&t–BÀ¢7F–öä¶W“¢&7F—f—G’ç6WGF–æw2çWFFVB"Â7F–öå&×3¢²¶W—2ÒÀ¢W6W$–C¢÷6WGF–æw47G‚çW6W$–BÇÂ÷6WGF–æw47G‚æVÖ–ÂÇÂçVÆÂÀ¢W6W$æÖS¢÷6WGF–æw47G‚ææÖRÇÂ÷6WGF–æw47G‚æVÖ–ÂÇÂçVÆÂÒ’¢æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&W2æ§6öâ‡²ö³¢G'VRÒ“°¢Ò6F6‚°¢&W2æ§6öâ‡²ö³¢fÇ6RÒ“°¢Ğ§Ò“° ¢òò)H)Hö’öÖR÷6WGF–æw2(	B&VB6æöæ–6ÂW6W"&VfW&Væ6W2‡F–ÖW¦öæRÂWF2â’)H)H)H)H)H)H)H)H §&÷WFW"ævWB‚"öÖR÷6WGF–æw2"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã°¢G'’°¢6öç7B"Òv—B÷&tF"‡&W’†4TÄT5B6WGF–æw2e$ôÒW6W%÷&Vg2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ“°¢&W2æ§6öâ‡"ç&÷w5³Óòç6WGF–æw2óò·Ò“°¢Ò6F6‚°¢&W2æ§6öâ‡·Ò“°¢Ğ§Ò“° ¢òò)H)HD4‚ö’öÖR÷6WGF–æw2(	Bw&—FR6æöæ–6ÂW6W"&VfW&Væ6W2‡F–ÖW¦öæRÂWF2â’)H)H ¢òò6æöæ–6Â7F÷&vRf÷"F–ÖW¦öæRâÖW&vW2–çFòW6W%÷&Vg2ç6WGF–æw2¥4ôä"6òF†@¢òòtUBö’öÖR÷6WGF–æw2Çv—2&WGW&ç2F†RWF†÷&—FF—fRfÇVRà§&÷WFW"çF6‚‚"öÖR÷6WGF–æw2"Â6äFÖ–âÂ7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã° ¢6öç7B&öG’Ò&Wæ&öG’2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãã° ¢òò66WBöæÇ’6fR&VfW&Væ6Rf–VÆG2(	BæWfW"&–ÆÆ–ær÷"WF‚FF¢6öç7BÄÄõtTEô´U•2Ò²'F–ÖW¦öæR"Â&ÆæwVvR"Â&FFTf÷&ÖB"Â'F–ÖTf÷&ÖB"Â&7W'&Væ7’%Ò26öç7C°¢6öç7BF6ƒ¢&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâÒ·Ó°¢f÷"†6öç7B¶W’öbÄÄõtTEô´U•2’°¢–b‡G—Vöb&öG•¶¶W•ÒÓÓÒ'7G&–ær"bb†&öG•¶¶W•Ò27G&–ær’çG&–Ò‚’’°¢F6…¶¶W•ÒÒ†&öG•¶¶W•Ò27G&–ær’çG&–Ò‚“°¢Ğ¢Ğ ¢–b„ö&¦V7Bæ¶W—2‡F6‚’æÆVæwF‚ÓÓÒ’°¢&W2ç7FGW2ƒC’æ§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$æòfÆ–B&VfW&Væ6Rf–VÆG2&÷f–FVB"Ò“°¢&WGW&ã°¢Ğ ¢G'’°¢v—B÷&tF"‡&W’€¢”å4U%B”åDòW6W%÷&Vg2†÷&uö–BÂ6WGF–æw2ÂWFFVEöB¢dÅTU2‚CÂC#£¦§6öæ"Âæ÷r‚’¢ôâ4ôädÄ”5B†÷&uö–B’DòUDDR4U@¢6WGF–æw2Ò4ôÄU44R‡W6W%÷&Vg2ç6WGF–æw2Âw·Òs£¦§6öæ"’ÇÂC#£¦§6öæ"À¢WFFVEöBÒæ÷r‚–À¢¶÷&t–BÂ¥4ôâç7G&–æv–g’‡F6‚•Ğ¢“°¢6öç7B"Òv—B÷&tF"‡&W’†4TÄT5B6WGF–æw2e$ôÒW6W%÷&Vg2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ“°¢&W2æ§6öâ‡"ç&÷w5³Óòç6WGF–æw2óòF6‚“°¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"Â÷&t–BÒÂ%µD4‚öÖR÷6WGF–æw5ÒW6W'Bf–ÆVB"“°¢&W2ç7FGW2ƒS’æ§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$f–ÆVBFò6fR6WGF–æw2"Ò“°¢Ğ§Ò“° ¢òò)H)HFFf÷%4Tò7&VFVçF–Ç2(	B6W'fW"ÖöæÇ’÷&r×66÷VB7F÷&vR)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H  ¦–×÷'B²ööÂÒg&öÒ$v÷&·76RöF"#°¦–×÷'B²—4FFf÷%4Tô6öæf–wW&VBÒg&öÒ"ââ÷6W'f–6W2öFFf÷'6Vò×6W'f–6Ræ§2#° ¢ò¢¢tUBö’öÖRöFFf÷'6Vò÷7FGW2(	B&WGW&â6öæf–wW&VB7FGW2†æWfW"W‡÷6W277v÷&B’¢ğ§&÷WFW"ævWB‚"öÖRöFFf÷'6Vò÷7FGW2"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã°¢G'’°¢6öç7B6öæf–wW&VBÒv—B—4FFf÷%4Tô6öæf–wW&VB†÷&t–B“°¢ÆWBÆöv–âÒ"#°¢–b†6öæf–wW&VB’°¢6öç7B"Òv—BööÂçVW'’€¢4TÄT5BfÇVRe$ôÒ÷&u÷6V7&WG2t„U$R÷&uö–BÒCäB¶W’ÒvFFf÷'6VõöÆöv–âvÂ¶÷&t–EĞ¢“°¢Æöv–âÒ"ç&÷w5³ÓòçfÇVRóò"#°¢Ğ¢&W2æ§6öâ‡²6öæf–wW&VBÂÆöv–âÒ“°¢Ò6F6‚°¢&W2æ§6öâ‡²6öæf–wW&VC¢fÇ6RÂÆöv–ã¢""Ò“°¢Ğ§Ò“° ¢ò¢¢õ5Bö’öÖRöFFf÷'6Vòö7&VFVçF–Ç2(	B6fR÷&r×66÷VB7&VFVçF–Ç2¢ğ§&÷WFW"ç÷7B‚"öÖRöFFf÷'6Vòö7&VFVçF–Ç2"Â6äFÖ–âÂ7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã°¢6öç7B²Æöv–âÂ77v÷&BÒÒ&Wæ&öG’2²Æöv–ãó¢7G&–æs²77v÷&Có¢7G&–ærÓ°¢–b‚Æöv–âÇÂ77v÷&B’°¢&W2ç7FGW2ƒC’æ§6öâ‡²ö³¢fÇ6RÂW'&÷#¢&Æöv–âæB77v÷&B&WV—&VB"Ò“°¢&WGW&ã°¢Ğ¢G'’°¢v—BööÂçVW'’€¢”å4U%B”åDò÷&u÷6V7&WG2†÷&uö–BÂ¶W’ÂfÇVRÂ7&VFVEöB¢dÅTU2‚CÂvFFf÷'6VõöÆöv–ârÂC"Âäõr‚’’À¢‚CÂvFFf÷'6Võ÷77v÷&BrÂC2Âäõr‚’¢ôâ4ôädÄ”5B†÷&uö–BÂ¶W’’DòUDDR4UBfÇVRÒU„4ÅTDTBçfÇVRÂ7&VFVEöBÒäõr‚–À¢¶÷&t–BÂÆöv–âçG&–Ò‚’Â77v÷&BçG&–Ò‚•Ğ¢“°¢&W2æ§6öâ‡²ö³¢G'VRÒ“°¢Ò6F6‚°¢&W2ç7FGW2ƒS’æ§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$f–ÆVBFò6fR7&VFVçF–Ç2"Ò“°¢Ğ§Ò“° ¢ò¢¢DTÄUDRö’öÖRöFFf÷'6Vòö7&VFVçF–Ç2(	B6ÆV"÷&r×66÷VB7&VFVçF–Ç2¢ğ§&÷WFW"æFVÆWFR‚"öÖRöFFf÷'6Vòö7&VFVçF–Ç2"Â6äFÖ–âÂ7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã°¢G'’°¢v—BööÂçVW'’€¢DTÄUDRe$ôÒ÷&u÷6V7&WG2t„U$R÷&uö–BÒCäB¶W’”â‚vFFf÷'6VõöÆöv–ârÂvFFf÷'6Võ÷77v÷&Br–À¢¶÷&t–EĞ¢“°¢&W2æ§6öâ‡²ö³¢G'VRÒ“°¢Ò6F6‚°¢&W2ç7FGW2ƒS’æ§6öâ‡²ö³¢fÇ6RÂW'&÷#¢$f–ÆVBFò6ÆV"7&VFVçF–Ç2"Ò“°¢Ğ§Ò“° ¢òò)H)HtUBö’öÖR÷7F÷&vR(	B&VÂD"föÇVÖR6÷VçG2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H §&÷WFW"ævWB‚"öÖR÷7F÷&vR"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã°¢G'’°¢6öç7B6Æ–VçBÒv—B†v—B–×÷'B‚$v÷&·76RöF""’’çööÂæ6öææV7B‚“°¢G'’°¢òò6÷VçB&÷w2W"F&ÆR²W7F–ÖFRF÷FÂ6—¦P¢6öç7B6÷VçG2Òv—B&öÖ—6RæÆÂ…°¢6Æ–VçBçVW'’†4TÄT5B4õTåB‚¢“£¦–çB2âe$ôÒVF—G2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ’æ6F6‚‚‚’Óâ‡²&÷w3¢·²ã¢ÕÒÒ’’À¢6Æ–VçBçVW'’†4TÄT5B4õTåB‚¢“£¦–çB2âe$ôÒ&W÷'G2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ’æ6F6‚‚‚’Óâ‡²&÷w3¢·²ã¢ÕÒÒ’’À¢6Æ–VçBçVW'’†4TÄT5B4õTåB‚¢“£¦–çB2âe$ôÒÖöæ—F÷'2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ’æ6F6‚‚‚’Óâ‡²&÷w3¢·²ã¢ÕÒÒ’’À¢6Æ–VçBçVW'’†4TÄT5B4õTåB‚¢“£¦–çB2âe$ôÒG&6¶VEö¶W—v÷&G2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ’æ6F6‚‚‚’Óâ‡²&÷w3¢·²ã¢ÕÒÒ’’À¢6Æ–VçBçVW'’†4TÄT5B4õTåB‚¢“£¦–çB2âe$ôÒFVÕöf–ÆW2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ’æ6F6‚‚‚’Óâ‡²&÷w3¢·²ã¢ÕÒÒ’’À¢6Æ–VçBçVW'’†4TÄT5B4õTåB‚¢“£¦–çB2âe$ôÒWFöÖF–öåö–çFVw&F–öç2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ’æ6F6‚‚‚’Óâ‡²&÷w3¢·²ã¢ÕÒÒ’’À¢6Æ–VçBçVW'’†4TÄT5B4õTåB‚¢“£¦–çB2âe$ôÒWFöÖF–öåöÆöw2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ’æ6F6‚‚‚’Óâ‡²&÷w3¢·²ã¢ÕÒÒ’’À¢6Æ–VçBçVW'’†4TÄT5B4õTåB‚¢“£¦–çB2âe$ôÒ6•ö66†Rt„U$R÷&uö–CÒCÂ¶÷&t–EÒ’æ6F6‚‚‚’Óâ‡²&÷w3¢·²ã¢ÕÒÒ’’À¢Ò“° ¢6öç7B°¢VF—G2Â&W÷'G2ÂÖöæ—F÷'2Â¶W—v÷&G2ÂWÆöG2Â–çFVw&F–öç2ÂÆöw2Â6”66†P¢ÒÒ6÷VçG2æÖ‡"Óâ‡"ç&÷w5³Ò2²ã¢çVÖ&W"Ò’æâ“° ¢6öç7BF÷FÄ—FV×2ÒVF—G2²&W÷'G2²Ööæ—F÷'2²¶W—v÷&G2²WÆöG2²–çFVw&F–öç2²Æöw2²6”66†S° ¢òòW7F–ÖFRW"Ö÷&r7F÷&vRg&öÒ&÷r6÷VçG2†67W&FRVæ÷Vv‚f÷"&–ÆÆ–ærT’¢6öç7BW7F–ÖFVD'—FW2ÒF÷FÄ—FV×2¢#S²òòã"ãR´"ö—FVÒ&÷Vv‚frW"÷&p¢6öç7B—4W7F–ÖFVBÒG'VS° ¢&W2æ§6öâ‡°¢÷&t–BÀ¢6÷VçG3¢²VF—G2Â&W÷'G2ÂÖöæ—F÷'2Â¶W—v÷&G2ÂWÆöG2Â–çFVw&F–öç2ÂÆöw2Â6”66†RÂF÷FÃ¢F÷FÄ—FV×2ÒÀ¢6—¦S¢°¢'—FW3¢W7F–ÖFVD'—FW2À¢&VF&ÆS¢W7F–ÖFVD'—FW2â ¢òW7F–ÖFVD'—FW2Â#@¢òG¶W7F–ÖFVD'—FW7Ò& ¢¢W7F–ÖFVD'—FW2Â#B¢#@¢òG²†W7F–ÖFVD'—FW2ò#B’çFôf—†VBƒ—Ò´& ¢¢G²†W7F–ÖFVD'—FW2òƒ#B¢#B’’çFôf—†VBƒ"—ÒÔ& ¢¢#""À¢W7F–ÖFVC¢—4W7F–ÖFVBÀ¢æ÷FS¢$W7F–ÖF–öâ"÷&r&<:–R7W"ÆRæöÖ'&RFRÆ–væW2"À¢ÒÀ¢Ò“°¢Òf–æÆÇ’°¢6Æ–VçBç&VÆV6R‚“°¢Ğ¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"ÒÂ%¶ÖR÷7F÷&vUÒf–ÆVB"“°¢&W2ç7FGW2ƒS’æ§6öâ‡²W'&÷#¢$–×÷76–&ÆRFRÆ—&RÆR7Fö6¶vR"Ò“°¢Ğ§Ò“° ¢òò)H)HtUBö’÷6WGF–æw2ö’Ö¶W—2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H §&÷WFW"ævWB‚"÷6WGF–æw2ö’Ö¶W—2"Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã° ¢òò’Ö¶W’&–æ6—Ç2†g÷V%òòg÷6V5ò’×W7BæWfW"6VRF†R&r6V7&WB¶W’fÇVRà¢òòöæÇ’–çFW&7F—fR6W76–öç2†'&÷w6W"Æöv–â’Ö’&WG&–WfR—Bà¢6öç7B—4”¶W•&–æ6—ÂÒ‡&Wæ÷&t6öçFW‡CòçW6W$–Bóò""’ç7F'G5v—F‚‚&–¶W“¢"“° ¢G'’°¢6öç7B"Òv—B÷&tF"‡&W’†4TÄT5B6WGF–æw2e$ôÒW6W%÷&Vg2t„U$R÷&uö–CÒCÂ¶÷&t–EÒ’æ6F6‚‚‚’Óâ‡²&÷w3¢µÒÒ’“°¢6öç7B&Vg2Ò‡"ç&÷w5³Ò2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ“òç6WGF–æw22&V6÷&CÇ7G&–ærÂ7G&–æsâÂçVÆÃ°¢6öç7B÷´†6‚Ò'VffW"æg&öÒ†÷&t–B’çFõ7G&–ær‚&&6ScB"’ç&WÆ6R‚õµæ×¤Õ£Ó•ÒörÂ""’çFôÆ÷vW$66R‚’ç6Æ–6RƒÂ#"“°¢6öç7BV&Æ–4¶W’Ò&Vg3òçV&Æ–4”¶W’óòg÷V%òGµ÷´†6‡Ö°¢6öç7B6V7&WD¶W’Ò&Vg3òç6V7&WD”¶W’óòçVÆÃ° ¢òòWFò×W'6—7BF†RFWFW&Ö–æ—7F–2V&Æ–2¶W’–b—B†6âwB&VVâ7F÷&VB–WBà¢òòF†—2Vç7W&W2—B—2f–æF&ÆR'’÷&t6öçFW‡BöâgWGW&R’&WVW7G2à¢–b‚&Vg3òçV&Æ–4”¶W’’°¢÷&tF"‡&W’€¢”å4U%B”åDòW6W%÷&Vg2†÷&uö–BÂ6WGF–æw2ÂWFFVEöB¢dÅTU2‚CÂ§6öæ%ö'V–ÆEöö&¦V7B‚wV&Æ–4”¶W’rÂC#£§FW‡B’Âæ÷r‚’¢ôâ4ôädÄ”5B†÷&uö–B’DòUDDR4U@¢6WGF–æw2Ò4ôÄU44R‡W6W%÷&Vg2ç6WGF–æw2Âw·Òs£¦§6öæ"’ÇÂ§6öæ%ö'V–ÆEöö&¦V7B‚wV&Æ–4”¶W’rÂC#£§FW‡B’À¢WFFVEöBÒæ÷r‚–À¢¶÷&t–BÂV&Æ–4¶W•Ğ¢’æ6F6‚‚†W'#¢Væ¶æ÷vâ’ÓâÆövvW"çv&â‡²W'"ÒÂ%¶’Ö¶W—5ÒWFò×W'6—7BV&Æ–4”¶W’f–ÆVB"’“°¢Ğ ¢&W2æ§6öâ‡°¢V&Æ–4¶W’À¢òòæWfW"W‡÷6RF†R7GVÂ6V7&WBFò’Ö¶W’6ÆÆW'2(	BF†W’Ç&VG’†fRF†V—"÷vâ7&VFVçF–Âà¢6V7&WD¶W“¢—4”¶W•&–æ6—ÂòçVÆÂ¢6V7&WD¶W’À¢†56V7&WC¢6V7&WD¶W’À¢V&Æ–4¶W”7&VFVDC¢&Vg3òçV&Æ–4”¶W”7&VFVDBóòçVÆÂÀ¢6V7&WD¶W”7&VFVDC¢&Vg3òç6V7&WD”¶W”7&VFVDBóòçVÆÂÀ¢Ò“°¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"ÒÂ%¶’Ö¶W—2övWEÒf–ÆVB"“°¢&W2ç7FGW2ƒS’æ§6öâ‡²W'&÷#¢$W'&WW""Ò“°¢Ğ§Ò“° ¢òò)H)HDTÄUDRö’÷6WGF–æw2öFF)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòW&vRÆÂ&öGV7BFFf÷"F†—2÷&r'WB¶VWF†R66÷VçB–çF7Bà§&÷WFW"æFVÆWFR‚"÷6WGF–æw2öFF"Â÷væW$öæÇ’Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã°¢6öç7BF&ÆW2Ò°¢òò6÷&R4TòbVF—BFF¢&VF—G2"Â&VF—E÷66†VGVÆW2"Â'&W÷'G2"Â'&W÷'EöW‡÷'G2"À¢òòÖöæ—F÷&–æp¢&Ööæ—F÷'2"Â&Ööæ—F÷%ö6†V6·2"Â&Ööæ—F÷%ö–æ6–FVçG2"À¢&ÆW'E÷'VÆW2"Â&ÆW'EöWfVçG2"À¢òò¶W—v÷&G2Â6ÆVæF"ÂFVĞ¢'G&6¶VEö¶W—v÷&G2"Â&6ÆVæF%öWfVçG2"À¢'FVÕöÖW76vW2"Â'FVÕöf–ÆW2"À¢òòWFöÖF–öç2bv÷&¶fÆ÷w0¢&WFöÖF–öåö–çFVw&F–öç2"Â&WFöÖF–öå÷v÷&¶fÆ÷w2"Â&WFöÖF–öå÷'Vç2"À¢&WFöÖF–öåöÆöw2"Â'v÷&¶fÆ÷u÷'Vç2"Â&–æ6öÖ–æu÷vV&†öö·2"À¢òò’bÖ—76–öç0¢&Ö—76–öç2"Â&Ö—76–öåö†—7F÷'’"Â&Ö—76–öåö•öÆöw2"À¢&•÷W6vUöÆöw2"Â&•öÖöçF†Ç•÷W6vR"À¢òòæÇ—F–72b4TòFööÇ0¢'6•ö66†R"Â'6Võöf÷&V67G2"Â&gVææVÇ2"Â&gVææVÅ÷7FW2"À¢&w65ö¶W—v÷&EöFF"Â&w65÷vUöFF"Â&w65÷7–æ5öÆöw2"À¢&&V†f–÷%öWfVçG2"Â&&V†f–÷%÷6W76–öç2"À¢'G&ff–5÷6÷W&6W2"Â'G&ff–5öÆ÷76W2"À¢&7&õ÷66÷&W2"Â&7&õöW‡W&–ÖVçG2"Â'&WfVçVUöÆV·2"À¢òò6ö×WF—F÷'2bÆö6Â4Tğ¢&6ö×WF—F÷'2"Â&6ö×WF—F÷%öæÇ—6—2"Â&6ö×WF—F÷%öÖ÷&W7VÇG2"À¢&v'÷&öf–ÆW2"Â&Æö6Å÷6µö†—7F÷'’"À¢òòæ÷F–f–6F–öç2Â7F—f—G’ÂÖ—60¢&æ÷F–f–6F–öç2"À¢&÷&uö6†V6¶Æ—7B"À¢&÷fW'f–Wuö–ç6–v‡G5ö66†R"Â&÷fW'f–Wuö–ç6–v‡G5÷&Â"À¢&7F—f—G•öÆör"Â'6†&U÷Fö¶Vç2"Â&w&÷wF…öö&¦V7F—fW2"À¢Ó°¢6öç7B²ööÃ¢uööÂÒÒv—B–×÷'B‚$v÷&·76RöF""“°¢6öç7B6Æ–VçBÒv—BuööÂæ6öææV7B‚“°¢ÆWBFVÆWFVBÒ°¢G'’°¢6öç7BW†—7D6†V6²Òv—B6Æ–VçBçVW'“Ç²F&ÆVæÖS¢7G&–ærÓâ€¢4TÄT5BF&ÆVæÖRe$ôÒu÷F&ÆW2t„U$R66†VÖæÖSÒwV&Æ–2räBF&ÆVæÖRÒå’‚C–À¢·F&ÆW5Ğ¢“°¢6öç7BW†—7F–ærÒæWr6WB†W†—7D6†V6²ç&÷w2æÖ‡"Óâ"çF&ÆVæÖR’“°¢v—B6Æ–VçBçVW'’‚$$Tt”â"“°¢G'’°¢f÷"†6öç7BBöbF&ÆW2æf–ÇFW"‡BÓâW†—7F–æræ†2‡B’’’°¢6öç7B"Òv—B6Æ–VçBçVW'’€¢òò•÷W6vUöÆöw2æ÷&uö–B—2UT”C²W‡Æ–6—B67B†æFÆW2ÆÂ6öÇVÖâG—W26fVÇ¢DTÄUDRe$ôÒG·GÒt„U$R÷&uö–C£§FW‡BÒCÀ¢¶÷&t–EĞ¢“°¢FVÆWFVB³Ò"ç&÷t6÷VçBóò°¢Ğ¢v—B6Æ–VçBçVW'’‚$4ôÔÔ•B"“°¢Ò6F6‚‡G„W'"’°¢v—B6Æ–VçBçVW'’‚%$ôÄÄ$4²"“°¢F‡&÷rG„W'#°¢Ğ¢ÆövvW"æ–æfò‡²÷&t–BÂFVÆWFVBÒÂ%·6WGF–æw2öFFÒW6W"FFW&vVB"“°¢&W2æ§6öâ‡²ö³¢G'VRÂFVÆWFVBÒ“°¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"ÒÂ%·6WGF–æw2öFFÒW&vRf–ÆVB"“°¢&W2ç7FGW2ƒS’æ§6öâ‡²W'&÷#¢$W'&WW"Æ÷'2FRÆ7W&W76–öâ"Ò“°¢Òf–æÆÇ’°¢6Æ–VçBç&VÆV6R‚“°¢Ğ§Ò“° ¢òò)H)Hõ5Bö’÷6WGF–æw2ö’Ö¶W—2÷&VvVæW&FR)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H §&÷WFW"ç÷7B‚"÷6WGF–æw2ö’Ö¶W—2÷&VvVæW&FR"Â÷væW$öæÇ’Â7–æ2‡&W¢&WVW7BÂ&W3¢&W7öç6R“¢&öÖ—6SÇfö–CâÓâ°¢6öç7B÷&t–BÒ&WV—&T÷&t–B‡&WÂ&W2“°¢–b‚÷&t–B’&WGW&ã° ¢òò’Ö¶W’&–æ6—Ç2×W7Bæ÷B&R&ÆRFò&VvVæW&FR¶W—2(	BöæÇ’–çFW&7F—fR6W76–öç2Ö’&÷FFRF†VÒà¢–b‚‡&Wæ÷&t6öçFW‡CòçW6W$–Bóò""’ç7F'G5v—F‚‚&–¶W“¢"’’°¢&W2ç7FGW2ƒC2’æ§6öâ‡²W'&÷#¢$f÷&&–FFVã¢’¶W—26ææ÷B&R&÷FFVBf–â’¶W’7&VFVçF–Â"Ò“°¢&WGW&ã°¢Ğ ¢6öç7B²G—RÒÒ&Wæ&öG’2²G—Só¢'V&Æ–2"Â'6V7&WB"Ó°¢G'’°¢6öç7B7Vff—‚Ò&æFöÔ'—FW2ƒ#’çFõ7G&–ær‚&†W‚"“²òòCÖ6†"†W€¢6öç7B7&VFVDBÒæWrFFR‚’çFô•4õ7G&–ær‚“°¢–b‡G—RÓÓÒ'6V7&WB"’°¢6öç7B6V7&WD¶W’Òg÷6V5òG·7Vff—‡Ö°¢v—B÷&tF"‡&W’€¢”å4U%B”åDòW6W%÷&Vg2†÷&uö–BÂ6WGF–æw2ÂWFFVEöB¢dÅTU2‚CÂ§6öæ%ö'V–ÆEöö&¦V7B‚w6V7&WD”¶W’rÂC#£§FW‡BÂw6V7&WD”¶W”7&VFVDBrÂC3£§FW‡B’Âæ÷r‚’¢ôâ4ôädÄ”5B†÷&uö–B’DòUDDR4U@¢6WGF–æw2Ò4ôÄU44R‡W6W%÷&Vg2ç6WGF–æw2Âw·Òs£¦§6öæ"’ÇÂ§6öæ%ö'V–ÆEöö&¦V7B‚w6V7&WD”¶W’rÂC#£§FW‡BÂw6V7&WD”¶W”7&VFVDBrÂC3£§FW‡B’À¢WFFVEöBÒæ÷r‚–À¢¶÷&t–BÂ6V7&WD¶W’Â7&VFVDEĞ¢“°¢&W2æ§6öâ‡²ö³¢G'VRÂ¶W“¢6V7&WD¶W’ÂG—S¢'6V7&WB"Â7&VFVDBÒ“°¢ÒVÇ6R°¢òòV&Æ–2¶W“¢7F÷&R7W7FöÒ7Vff—‚–â&Vg26ò—B÷fW'&–FW2F†RFWFW&Ö–æ—7F–2†6€¢6öç7BV&Æ–4¶W’Òg÷V%òG·7Vff—‡Ö°¢v—B÷&tF"‡&W’€¢”å4U%B”åDòW6W%÷&Vg2†÷&uö–BÂ6WGF–æw2ÂWFFVEöB¢dÅTU2‚CÂ§6öæ%ö'V–ÆEöö&¦V7B‚wV&Æ–4”¶W’rÂC#£§FW‡BÂwV&Æ–4”¶W”7&VFVDBrÂC3£§FW‡B’Âæ÷r‚’¢ôâ4ôädÄ”5B†÷&uö–B’DòUDDR4U@¢6WGF–æw2Ò4ôÄU44R‡W6W%÷&Vg2ç6WGF–æw2Âw·Òs£¦§6öæ"’ÇÂ§6öæ%ö'V–ÆEöö&¦V7B‚wV&Æ–4”¶W’rÂC#£§FW‡BÂwV&Æ–4”¶W”7&VFVDBrÂC3£§FW‡B’À¢WFFVEöBÒæ÷r‚–À¢¶÷&t–BÂV&Æ–4¶W’Â7&VFVDEĞ¢“°¢&W2æ§6öâ‡²ö³¢G'VRÂ¶W“¢V&Æ–4¶W’ÂG—S¢'V&Æ–2"Â7&VFVDBÒ“°¢Ğ¢òò¦÷W&æÆ—6RÆ&÷FF–öâFR6Ì:’Fç2ÆRf–ÂBv7F—f—L:¢6öç7Bö”¶W”7G‚Ò‡&W2ç’’æ÷&t6öçFW‡BÇÂ·Ó°¢–×÷'B‚"ââ÷6W'f–6W2÷7F÷&Ræ§2"¢çF†Vâ†ÒÓâÒç7F÷&RæÆöt7F—f—G’‡²G—S¢'6V7W&—G’"ÂÆ&VÃ¢6Ì:’’G·G—RÓÓÒ'6V7&WB"ò'6V7,:‡FR"¢'V&Æ—VR'Ò,:–|:–ì:—,:–VÂ÷&t–BÀ¢7F–öä¶W“¢&7F—f—G’ç6WGF–æw2æ–¶W’"Â7F–öå&×3¢²G—RÒÀ¢W6W$–C¢ö”¶W”7G‚çW6W$–BÇÂö”¶W”7G‚æVÖ–ÂÇÂçVÆÂÀ¢W6W$æÖS¢ö”¶W”7G‚ææÖRÇÂö”¶W”7G‚æVÖ–ÂÇÂçVÆÂÒ’¢æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'"’°¢ÆövvW"æW'&÷"‡²W'"ÒÂ%¶’Ö¶W—2÷&VvVæW&FUÒf–ÆVB"“°¢&W2ç7FGW2ƒS’æ§6öâ‡²W'&÷#¢$W'&WW"Æ÷'2FRÆ,:–|:–ì:—&F–öâ"Ò“°¢Ğ§Ò“° ¦W‡÷'BFVfVÇB&÷WFW#°