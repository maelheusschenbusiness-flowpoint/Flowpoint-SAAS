import { Router, type Request, type Response } from "express";
import { loadOrgSettings, upsertOrgSettings } from "../services/org-settings.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── GET /api/org/location ─────────────────────────────────────────────────────
router.get("/org/location", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? "default";
  const s = await loadOrgSettings(orgId);
  res.json({
    address:             s?.address             ?? null,
    city:                s?.city                ?? null,
    postalCode:          s?.postalCode          ?? null,
    country:             s?.country             ?? null,
    latitude:            s?.latitude            ?? null,
    longitude:           s?.longitude           ?? null,
    serviceArea:         s?.serviceArea         ?? [],
    locationConfigured:  s?.locationConfigured  ?? false,
    locationSource:      s?.locationSource      ?? null,
  });
});

// ── PUT /api/org/location ─────────────────────────────────────────────────────
router.put("/org/location", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? "default";
  const {
    address, city, postalCode, country,
    latitude, longitude, serviceArea, locationSource,
  } = req.body as {
    address?:        string;
    city?:           string;
    postalCode?:     string;
    country?:        string;
    latitude?:       number;
    longitude?:      number;
    serviceArea?:    string[];
    locationSource?: string;
  };

  // ── Validation ────────────────────────────────────────────────────────────
  if (latitude !== undefined) {
    const lat = Number(latitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      res.status(400).json({ ok: false, error: "Latitude invalide (doit être entre -90 et 90)" });
      return;
    }
  }
  if (longitude !== undefined) {
    const lng = Number(longitude);
    if (isNaN(lng) || lng < -180 || lng > 180) {
      res.status(400).json({ ok: false, error: "Longitude invalide (doit être entre -180 et 180)" });
      return;
    }
  }
  if (typeof country === "string" && country.trim().length < 2) {
    res.status(400).json({ ok: false, error: "Pays invalide" });
    return;
  }

  const locationConfigured = !!(city?.trim() || address?.trim());

  try {
    await upsertOrgSettings(orgId, {
      address:            address?.trim()    ?? null,
      city:               city?.trim()       ?? null,
      postalCode:         postalCode?.trim() ?? null,
      country:            country?.trim()    ?? null,
      latitude:           latitude != null   ? Number(latitude)  : null,
      longitude:          longitude != null  ? Number(longitude) : null,
      serviceArea:        Array.isArray(serviceArea) ? serviceArea : [],
      locationConfigured,
      locationSource:     locationSource ?? "manual",
    });
    const updated = await loadOrgSettings(orgId);
    res.json({
      ok: true,
      locationConfigured,
      location: {
        address:            updated?.address           ?? null,
        city:               updated?.city             ?? null,
        postalCode:         updated?.postalCode        ?? null,
        country:            updated?.country           ?? null,
        latitude:           updated?.latitude          ?? null,
        longitude:          updated?.longitude         ?? null,
        serviceArea:        updated?.serviceArea       ?? [],
        locationConfigured: updated?.locationConfigured ?? false,
        locationSource:     updated?.locationSource    ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "[location] PUT /org/location failed");
    res.status(500).json({ ok: false, error: "Impossible de sauvegarder la localisation" });
  }
});

// ── POST /api/org/geocode ─────────────────────────────────────────────────────
// address → lat/lng  OR  lat+lng → address  (uses Nominatim/OSM, no API key)
router.post("/org/geocode", async (req: Request, res: Response): Promise<void> => {
  const { address, lat, lng } = req.body as {
    address?: string;
    lat?:     number;
    lng?:     number;
  };

  try {
    if (lat !== undefined && lng !== undefined) {
      // ── Reverse geocoding ─────────────────────────────────────────────────
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${Number(lat)}&lon=${Number(lng)}&accept-language=fr`;
      const r = await fetch(url, {
        headers: { "User-Agent": "FlowPoint/1.0 (contact@flowpoint.pro)" },
      });
      if (!r.ok) throw new Error(`Nominatim reverse ${r.status}`);
      const data = await r.json() as Record<string, unknown>;
      const addr = (data.address ?? {}) as Record<string, string>;
      res.json({
        ok:          true,
        address:     (data.display_name as string) ?? null,
        city:        addr.city || addr.town || addr.village || addr.municipality || null,
        postalCode:  addr.postcode ?? null,
        country:     addr.country  ?? null,
        countryCode: (addr.country_code ?? "").toUpperCase() || null,
        latitude:    parseFloat((data.lat as string) ?? String(lat)),
        longitude:   parseFloat((data.lon as string) ?? String(lng)),
      });

    } else if (address?.trim()) {
      // ── Forward geocoding ─────────────────────────────────────────────────
      const encoded = encodeURIComponent(address.trim());
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1&accept-language=fr&addressdetails=1`;
      const r = await fetch(url, {
        headers: { "User-Agent": "FlowPoint/1.0 (contact@flowpoint.pro)" },
      });
      if (!r.ok) throw new Error(`Nominatim search ${r.status}`);
      const data = await r.json() as Record<string, unknown>[];
      if (!data[0]) {
        res.status(404).json({ ok: false, error: "Adresse introuvable — vérifiez l'adresse saisie" });
        return;
      }
      const result = data[0];
      const addrParts = (result.address ?? {}) as Record<string, string>;
      res.json({
        ok:          true,
        address:     (result.display_name as string) ?? address,
        city:        addrParts.city || addrParts.town || addrParts.village || addrParts.municipality || null,
        postalCode:  addrParts.postcode ?? null,
        country:     addrParts.country  ?? null,
        countryCode: (addrParts.country_code ?? "").toUpperCase() || null,
        latitude:    parseFloat(result.lat as string),
        longitude:   parseFloat(result.lon as string),
      });

    } else {
      res.status(400).json({ ok: false, error: "Fournir 'address' ou 'lat' + 'lng'" });
    }
  } catch (err) {
    logger.error({ err }, "[location] geocode failed");
    res.status(500).json({ ok: false, error: "Erreur de géocodage — réessayez dans quelques instants" });
  }
});

// ── POST /api/org/location/sync-gbp ──────────────────────────────────────────
// Pull address + coordinates from the first GBP location linked to this org
router.post("/org/location/sync-gbp", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? "default";
  try {
    const { pool } = await import("@workspace/db");
    const client = await pool.connect();
    let tokenRow: Record<string, unknown> | null = null;
    try {
      const r = await client.query(
        `SELECT account_id FROM google_tokens WHERE org_id = $1 LIMIT 1`,
        [orgId]
      );
      tokenRow = r.rows[0] ?? null;
    } finally {
      client.release();
    }
    if (!tokenRow) {
      res.status(404).json({ ok: false, error: "Google Business Profile non connecté" });
      return;
    }

    const { getLocations } = await import("../services/google-service.js");
    const locations = await getLocations(orgId, tokenRow.account_id as string) as Record<string, unknown>[];
    if (!locations?.length) {
      res.status(404).json({ ok: false, error: "Aucun établissement GBP trouvé" });
      return;
    }

    const loc = locations[0] as Record<string, unknown>;
    const addrObj = (loc.storefrontAddress ?? loc.address ?? {}) as Record<string, unknown>;
    const addressLines = Array.isArray(addrObj.addressLines) ? (addrObj.addressLines as string[]).join(", ") : null;
    const city = (addrObj.locality as string) || null;
    const postalCode = (addrObj.postalCode as string) || null;
    const country = (addrObj.regionCode as string) || null;

    // Geocode the address to get lat/lng
    let latitude: number | null = null;
    let longitude: number | null = null;
    const latlng = loc.latlng as Record<string, number> | undefined;
    if (latlng?.latitude != null) latitude  = latlng.latitude;
    if (latlng?.longitude != null) longitude = latlng.longitude;

    await upsertOrgSettings(orgId, {
      address:            addressLines,
      city,
      postalCode,
      country,
      latitude,
      longitude,
      locationConfigured: !!(city || addressLines),
      locationSource:     "gbp",
    });

    res.json({
      ok: true,
      address: addressLines,
      city,
      postalCode,
      country,
      latitude,
      longitude,
      locationSource: "gbp",
    });
  } catch (err) {
    logger.error({ err }, "[location] sync-gbp failed");
    res.status(500).json({ ok: false, error: "Impossible de synchroniser depuis GBP" });
  }
});

export default router;

// ── GET /api/location — alias for /api/org/location ─────────────────────────
type _LocOrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

router.get("/location", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? "default";
  const s = await loadOrgSettings(orgId).catch(() => null);

  // Canonical timezone from user_prefs.settings (set by PATCH /api/me/settings).
  // org_settings.timezone is a legacy fallback only.
  let settingsTimezone: string | null = null;
  try {
    const orgDbFn = (req as _LocOrgReq).orgDb;
    if (typeof orgDbFn === "function") {
      const pRow = await orgDbFn.call(req, `SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
      const prefs = pRow.rows[0]?.settings as Record<string, unknown> | null;
      if (prefs && typeof prefs.timezone === "string" && prefs.timezone) {
        settingsTimezone = prefs.timezone;
      }
    }
  } catch { /* non-fatal */ }

  res.json({
    address:            s?.address            ?? null,
    city:               s?.city               ?? null,
    postalCode:         s?.postalCode         ?? null,
    country:            s?.country            ?? null,
    region:             s?.region             ?? null,
    phone:              s?.phone              ?? null,
    latitude:           s?.latitude           ?? null,
    longitude:          s?.longitude          ?? null,
    serviceArea:        s?.serviceArea        ?? [],
    locationConfigured: s?.locationConfigured ?? false,
    locationSource:     s?.locationSource     ?? null,
    timezone:           settingsTimezone ?? s?.timezone ?? null,
    language:           s?.language           ?? null,
    currency:           s?.currency           ?? null,
    dateFormat:         s?.dateFormat         ?? null,
    timeFormat:         s?.timeFormat         ?? null,
  });
});

// ── PATCH /api/location — save location/locale prefs ─────────────────────────
router.patch("/location", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? "default";
  if (!orgId || orgId === "default") {
    res.status(401).json({ ok: false, error: "Unauthorized" }); return;
  }
  const {
    address, city, postalCode, country, region, phone,
    latitude, longitude, serviceArea, locationSource,
    timezone, language, currency, dateFormat, timeFormat,
  } = req.body as {
    address?: string; city?: string; postalCode?: string; country?: string;
    region?: string; phone?: string;
    latitude?: number; longitude?: number; serviceArea?: string[]; locationSource?: string;
    timezone?: string; language?: string; currency?: string;
    dateFormat?: string; timeFormat?: string;
  };
  try {
    const toSave: Parameters<typeof upsertOrgSettings>[1] = {};
    if (address    !== undefined) toSave.address    = address;
    if (city       !== undefined) { toSave.city = city; if (city) toSave.locationConfigured = true; }
    if (postalCode !== undefined) toSave.postalCode = postalCode;
    if (country    !== undefined) toSave.country    = country;
    if (region     !== undefined) toSave.region     = region;
    if (phone      !== undefined) toSave.phone      = phone;
    if (latitude   !== undefined) toSave.latitude   = Number(latitude);
    if (longitude  !== undefined) toSave.longitude  = Number(longitude);
    if (serviceArea !== undefined) toSave.serviceArea = serviceArea;
    if (locationSource !== undefined) toSave.locationSource = locationSource;
    if (timezone   !== undefined) toSave.timezone   = timezone;
    if (language   !== undefined) toSave.language   = language;
    if (currency   !== undefined) toSave.currency   = currency;
    if (dateFormat !== undefined) toSave.dateFormat = dateFormat;
    if (timeFormat !== undefined) toSave.timeFormat = timeFormat;
    await upsertOrgSettings(orgId, toSave);
    const updated = await loadOrgSettings(orgId);
    res.json({
      ok: true,
      location: {
        address:            updated?.address            ?? null,
        city:               updated?.city               ?? null,
        postalCode:         updated?.postalCode         ?? null,
        country:            updated?.country            ?? null,
        region:             updated?.region             ?? null,
        phone:              updated?.phone              ?? null,
        latitude:           updated?.latitude           ?? null,
        longitude:          updated?.longitude          ?? null,
        serviceArea:        updated?.serviceArea        ?? [],
        locationConfigured: updated?.locationConfigured ?? false,
        locationSource:     updated?.locationSource     ?? null,
        timezone:           updated?.timezone           ?? null,
        language:           updated?.language           ?? null,
        currency:           updated?.currency           ?? null,
        dateFormat:         updated?.dateFormat         ?? null,
        timeFormat:         updated?.timeFormat         ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "[location] PATCH /location failed");
    res.status(500).json({ ok: false, error: "Failed to save location" });
  }
});
