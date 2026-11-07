import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureGbpPerformanceSettingsSchema } from "../services/init-gbp-performance-settings.js";

const google = vi.hoisted(() => ({
  getPerformance: vi.fn(),
  getValidToken: vi.fn(),
}));
const entitlement = vi.hoisted(() => ({ allowed: true }));

vi.mock("../services/google-service.js", () => google);
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: (addonKey: string) => (_req: unknown, res: any, next: () => void) => {
    if (!entitlement.allowed) {
      res.status(402).json({ error: "addon_gate_blocked", addonKey });
      return;
    }
    next();
  },
}));

const databaseUrl = process.env["DATABASE_URL"] ?? "";
const certUrl = process.env["FLOWPOINT_ADDON_CERT_DATABASE_URL"] ?? "";
const certDatabase = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_DB"] ?? "";
const certHost = process.env["FLOWPOINT_ADDON_CERT_EXPECTED_HOST"] ?? "";

function getSafeTarget() {
  try {
    const target = new URL(databaseUrl);
    const databaseName = decodeURIComponent(target.pathname);
    if (
      process.env["NODE_ENV"] === "test" &&
      target.hostname === "127.0.0.1" &&
      databaseName === "/flowpoint_ci"
    ) {
      return "ci";
    }
    if (
      databaseUrl === certUrl &&
      target.hostname.toLowerCase() === certHost.trim().toLowerCase() &&
      databaseName === `/${certDatabase}` &&
      certDatabase === "flowpoint_addon_cert_e2e"
    ) {
      return "cert";
    }
  } catch {
    // Invalid or absent URLs are never certification targets.
  }
  return null;
}

const target = getSafeTarget();
if (target) process.env["PGSSLMODE"] = "disable";

// The global test setup mocks @workspace/db for unit suites. This one
// deliberately opts into the real pool only after validating a local target.
vi.unmock("@workspace/db");
const { pool } = await import("@workspace/db");
const { default: gbpPerformanceRouter } = await import("./gbp-performance.js");

const suite = target ? describe : describe.skip;
const orgA = randomUUID();
const orgB = randomUUID();
const locationA = `qa-gbp-${randomUUID()}`;
const locationB = `qa-gbp-${randomUUID()}`;
const resourceA = `accounts/qa/locations/${locationA}`;
const resourceB = `accounts/qa/locations/${locationB}`;
let databaseReady = false;
let tablesReady = false;
const defaultSettings = {
  locationId: locationA,
  periodDays: 30,
  goals: { CALL_CLICKS: 40 },
  alertDropPercent: 25,
};

function makeApp(orgId: string | null = orgA, role = "owner") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (orgId) {
      Object.assign(req, {
        orgContext: { orgId, role, userId: `qa-user-${orgId}` },
        orgId,
      });
    }
    next();
  });
  app.use("/api", gbpPerformanceRouter);
  return app;
}

suite("GBP Performance & Leads PostgreSQL-backed API certification", () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error("Refusing GBP certification: database target guard failed.");
    }
    if (typeof pool.end !== "function" || typeof pool.connect !== "function") {
      throw new Error("Refusing GBP certification: the real PostgreSQL pool was not loaded.");
    }
    if (target === "cert") {
      try {
        const identity = await pool.query("SELECT current_database() AS database_name");
        const marker = await pool.query(
          "SELECT database_name, classification FROM public.flowpoint_test_database_guard WHERE purpose=$1",
          ["addon-cert"],
        );
        if (
          identity.rows[0]?.database_name !== certDatabase ||
          marker.rows.length !== 1 ||
          marker.rows[0].database_name !== certDatabase ||
          marker.rows[0].classification !== "disposable"
        ) {
          throw new Error("identity mismatch");
        }
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "identity_mismatch";
        throw new Error(`Refusing GBP certification: disposable database guard failed (${code}).`);
      }
    } else {
      await pool.query("SELECT 1");
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS google_locations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'default',
        location_id TEXT,
        name TEXT NOT NULL DEFAULT '',
        primary_category TEXT,
        rating REAL,
        reviews_count INTEGER NOT NULL DEFAULT 0,
        phone TEXT,
        website TEXT,
        lat REAL,
        lng REAL,
        raw_data JSONB NOT NULL DEFAULT '{}',
        last_sync_at TIMESTAMPTZ
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gbp_performance_settings (
        org_id TEXT PRIMARY KEY,
        settings JSONB NOT NULL DEFAULT '{"locationId":null,"periodDays":30,"goals":{},"alertDropPercent":20}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    databaseReady = true;
    tablesReady = true;
    await pool.query(
      `INSERT INTO google_locations (id, org_id, name, raw_data)
       VALUES ($1, $2, $3, $4::jsonb), ($5, $6, $7, $8::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET org_id=EXCLUDED.org_id, name=EXCLUDED.name, raw_data=EXCLUDED.raw_data`,
      [
        locationA, orgA, "Synthetic GBP A", JSON.stringify({ name: resourceA }),
        locationB, orgB, "Synthetic GBP B", JSON.stringify({ name: resourceB }),
      ],
    );
    await pool.query(
      `INSERT INTO gbp_performance_settings (org_id, settings)
       VALUES ($1, $2::jsonb), ($3, $4::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET settings=EXCLUDED.settings`,
      [
        orgA, JSON.stringify(defaultSettings),
        orgB, JSON.stringify({ ...defaultSettings, locationId: locationB }),
      ],
    );
  });

  beforeEach(() => {
    entitlement.allowed = true;
    google.getValidToken.mockReset().mockResolvedValue("synthetic-google-token");
    google.getPerformance.mockReset().mockImplementation(
        async (_tenantId: string, resourceName: string, range: { startTime: string }) => {
        if (resourceName !== resourceA) {
          return [{ dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: "999" }] } }];
        }
        const currentPeriod = Date.parse(range.startTime) > Date.now() - 45 * 86_400_000;
        return [{
          dailyMetric: "CALL_CLICKS",
          timeSeries: { datedValues: [{ value: currentPeriod ? "5" : "20" }] },
        }];
      },
    );
  });

  afterAll(async () => {
    if (tablesReady) {
      await pool.query("DELETE FROM gbp_performance_settings WHERE org_id = ANY($1::text[])", [[orgA, orgB]]);
      await pool.query("DELETE FROM google_locations WHERE id = ANY($1::text[])", [[locationA, locationB]]);
    }
    if (databaseReady) {
      await pool.end();
    }
  });

  it("reads only the tenant's synced location and calculates real-period declines", async () => {
    const response = await request(makeApp()).get("/api/gbp-performance");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      configured: true,
      location: { id: locationA, name: "Synthetic GBP A" },
      current: { CALL_CLICKS: 5 },
      previous: { CALL_CLICKS: 20 },
      drops: { CALL_CLICKS: 75 },
      goals: { CALL_CLICKS: 40 },
    });
    expect(response.body.locations).toEqual([{ id: locationA, name: "Synthetic GBP A" }]);
    expect(google.getValidToken).toHaveBeenCalledWith(orgA);
    expect(google.getPerformance).toHaveBeenCalledTimes(2);
    expect(google.getPerformance).toHaveBeenCalledWith(
      orgA,
      resourceA,
      expect.objectContaining({ startTime: expect.any(String), endTime: expect.any(String) }),
    );
  });

  it("repairs an existing settings table idempotently without changing saved tenant data", async () => {
    const before = await pool.query(
      `SELECT org_id, settings FROM gbp_performance_settings
       WHERE org_id = ANY($1::text[]) ORDER BY org_id`,
      [[orgA, orgB]],
    );
    expect(before.rows).toHaveLength(2);

    await ensureGbpPerformanceSettingsSchema(pool);
    await ensureGbpPerformanceSettingsSchema(pool);

    const after = await pool.query(
      `SELECT org_id, settings FROM gbp_performance_settings
       WHERE org_id = ANY($1::text[]) ORDER BY org_id`,
      [[orgA, orgB]],
    );
    expect(after.rows).toEqual(before.rows);

    const schema = await pool.query(
      `SELECT c.relrowsecurity AS rls,
              COUNT(p.policyname)::int AS policy_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_policies p
         ON p.schemaname = n.nspname AND p.tablename = c.relname
        AND p.policyname LIKE 'gbp_performance_settings_tenant_%'
       WHERE n.nspname = 'public' AND c.relname = 'gbp_performance_settings'
       GROUP BY c.relrowsecurity`,
    );
    expect(schema.rows[0]).toMatchObject({ rls: true, policy_count: 4 });
  });

  it("persists owner settings and returns them on the next real database read", async () => {
    const settings = {
      locationId: locationA,
      periodDays: 7,
      goals: { CALL_CLICKS: 75, WEBSITE_CLICKS: 12 },
      alertDropPercent: 15,
    };
    const saved = await request(makeApp()).put("/api/gbp-performance/settings").send(settings);

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ok: true, settings });
    const row = await pool.query(
      "SELECT settings FROM gbp_performance_settings WHERE org_id=$1",
      [orgA],
    );
    expect(row.rows[0]?.settings).toMatchObject(settings);

    const loaded = await request(makeApp()).get("/api/gbp-performance");
    expect(loaded.status).toBe(200);
    expect(loaded.body.settings).toMatchObject(settings);
    expect(loaded.body.period.days).toBe(7);
  });

  it("rejects viewer writes and cross-organization locations without changing stored settings", async () => {
    const before = await pool.query(
      "SELECT settings FROM gbp_performance_settings WHERE org_id=$1",
      [orgA],
    );
    const viewerWrite = await request(makeApp(orgA, "viewer"))
      .put("/api/gbp-performance/settings")
      .send({ ...defaultSettings, alertDropPercent: 30 });
    const foreignLocationWrite = await request(makeApp())
      .put("/api/gbp-performance/settings")
      .send({ ...defaultSettings, locationId: locationB });
    const after = await pool.query(
      "SELECT settings FROM gbp_performance_settings WHERE org_id=$1",
      [orgA],
    );

    expect(viewerWrite.status).toBe(403);
    expect(foreignLocationWrite.status).toBe(404);
    expect(after.rows[0]?.settings).toEqual(before.rows[0]?.settings);
  });

  it("surfaces missing auth, entitlement, invalid settings, missing Google connection, and provider failures", async () => {
    const unauthenticated = await request(makeApp(null)).get("/api/gbp-performance");
    entitlement.allowed = false;
    const noEntitlement = await request(makeApp()).get("/api/gbp-performance");
    entitlement.allowed = true;
    const invalidSettings = await request(makeApp())
      .put("/api/gbp-performance/settings")
      .send({ ...defaultSettings, periodDays: 13 });
    google.getValidToken.mockResolvedValueOnce(null);
    const noGoogleConnection = await request(makeApp()).get("/api/gbp-performance");
    google.getPerformance.mockRejectedValue(new Error("synthetic Google outage"));
    const providerFailure = await request(makeApp()).get("/api/gbp-performance");

    expect(unauthenticated.status).toBe(401);
    expect(noEntitlement.status).toBe(402);
    expect(invalidSettings.status).toBe(400);
    expect(noGoogleConnection.status).toBe(200);
    expect(noGoogleConnection.body).toMatchObject({ configured: false, connectionRequired: true });
    expect(providerFailure.status).toBe(502);
    expect(providerFailure.body).toMatchObject({ ok: false });
  });
});
