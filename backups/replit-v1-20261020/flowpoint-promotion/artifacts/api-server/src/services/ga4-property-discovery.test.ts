/**
 * ga4-property-discovery.test.ts — certifie que discoverAndStoreProperties
 * persiste automatiquement la première propriété GA4 trouvée pour l'org.
 *
 * Correction documentée : la version précédente découvrait les propriétés
 * sans jamais les écrire en base, laissant /ga4/status en état
 * "discovering:true" permanent même après un OAuth réussi.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const ORG = "33333333-3333-3333-3333-333333333333";
const ACCOUNT_NAME = "accounts/12345";
const PROPERTY_NAME = "properties/67890";
const PROPERTY_DISPLAY = "My GA4 Property";

// State trackers
let storedRows: Array<{ id: string; org_id: string; property_id: string; property_name: string; is_active: boolean }> = [];
let existingProperty: { property_id: string; property_name: string } | null = null;

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  pool: {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("INSERT INTO ga4_properties") || sql.includes("ON CONFLICT (org_id)")) {
          storedRows.push({
            id:            String(params?.[0]),
            org_id:        String(params?.[1]),
            property_id:   String(params?.[2]),
            property_name: String(params?.[3]),
            is_active:     true,
          });
          return { rows: [] };
        }
        if (sql.includes("SELECT property_id") && sql.includes("ga4_properties")) {
          return { rows: existingProperty ? [existingProperty] : [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    })),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT property_id") && sql.includes("ga4_properties")) {
        return { rows: existingProperty ? [existingProperty] : [] };
      }
      return { rows: [] };
    }),
  },
}));

// ─── Mock google-service (valid token always present) ─────────────────────────
vi.mock("./google-service.js", () => ({
  getValidToken: vi.fn(async () => "fake-access-token"),
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Mock Google Admin API responses ──────────────────────────────────────────
const fetchCalls: string[] = [];
vi.stubGlobal("fetch", vi.fn(async (url: string | URL, opts?: RequestInit) => {
  const u = String(url);
  fetchCalls.push(u);

  if (u.endsWith("/accounts")) {
    return {
      ok: true,
      json: async () => ({ accounts: [{ name: ACCOUNT_NAME }] }),
    } as unknown as Response;
  }
  if (u.includes("properties?filter=parent:")) {
    return {
      ok: true,
      json: async () => ({
        properties: [{ name: PROPERTY_NAME, displayName: PROPERTY_DISPLAY }],
      }),
    } as unknown as Response;
  }
  return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
}));

// ─── Import the function under test ───────────────────────────────────────────
const { discoverAndStoreProperties } = await import("./ga4-service.js");

beforeEach(() => {
  fetchCalls.length = 0;
  storedRows.length = 0;
  existingProperty = null;
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("discoverAndStoreProperties — auto-activate first property", () => {
  it("persists the first discovered property when none is already stored", async () => {
    const count = await discoverAndStoreProperties(ORG);

    expect(count).toBe(1);
    // Must have written to ga4_properties
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]!.property_id).toBe("67890");
    expect(storedRows[0]!.property_name).toBe(PROPERTY_DISPLAY);
    expect(storedRows[0]!.is_active).toBe(true);
    expect(storedRows[0]!.org_id).toBe(ORG);
  });

  it("does NOT overwrite an existing active property (idempotent)", async () => {
    // Org already has a property stored (user's previous choice)
    existingProperty = { property_id: "11111", property_name: "Existing Prop" };

    const count = await discoverAndStoreProperties(ORG);

    // Should short-circuit at 1 (already set) and skip the Google API calls
    expect(count).toBe(1);
    expect(storedRows).toHaveLength(0); // no new write
    expect(fetchCalls.filter(u => u.includes("accounts")).length).toBe(0); // no Google Admin call
  });

  it("returns 0 and writes nothing when Google Admin API returns no accounts", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ accounts: [] }),
    }));

    const count = await discoverAndStoreProperties(ORG);
    expect(count).toBe(0);
    expect(storedRows).toHaveLength(0);
  });

  it("returns 0 and writes nothing when the accounts endpoint fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      ok: false, status: 403, json: async () => ({}),
    }));

    const count = await discoverAndStoreProperties(ORG);
    expect(count).toBe(0);
    expect(storedRows).toHaveLength(0);
  });

  it("returns 0 and writes nothing when token is unavailable", async () => {
    const { getValidToken } = await import("./google-service.js");
    (getValidToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("not connected"));

    const count = await discoverAndStoreProperties(ORG);
    expect(count).toBe(0);
    expect(storedRows).toHaveLength(0);
  });
});
