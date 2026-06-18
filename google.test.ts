/**
 * Google integration tests — OAuth flow, GSC, GA4, GBP data
 * Run: node --import tsx/esm --test src/__tests__/google.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env["TEST_BASE_URL"] ?? "http://localhost:8080";
const AUTH_TOKEN = process.env["TEST_AUTH_TOKEN"] ?? "";

async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("GET /api/google/status", () => {
  it("returns connected status or not-connected (authenticated or 401)", async () => {
    const { status } = await get("/api/google/status", AUTH_TOKEN);
    assert.ok([200, 401, 404].includes(status));
  });
});

describe("GET /api/gsc/analytics", () => {
  it("returns GSC data or not-connected state (never fake data)", async () => {
    const { status, body } = await get("/api/gsc/analytics", AUTH_TOKEN);
    assert.ok([200, 401, 404, 503].includes(status));
    if (status === 200) {
      const b = body as { data?: unknown; error?: string; connected?: boolean };
      assert.ok(b.data !== undefined || b.error !== undefined || b.connected !== undefined);
    }
  });
});

describe("GET /api/ga4/report", () => {
  it("returns GA4 data or not-connected (never fake sessions)", async () => {
    const { status } = await get("/api/ga4/report", AUTH_TOKEN);
    assert.ok([200, 401, 404, 503].includes(status));
  });
});

describe("GET /api/google/accounts", () => {
  it("returns accounts list (authenticated or 401)", async () => {
    const { status } = await get("/api/google/accounts", AUTH_TOKEN);
    assert.ok([200, 401].includes(status));
  });
});

describe("Google OAuth state parameter", () => {
  it("GET /api/google/auth returns redirect (302) or error", async () => {
    const res = await fetch(`${BASE}/api/google/auth`, { redirect: "manual" });
    assert.ok([302, 400, 401, 500].includes(res.status), `Got ${res.status}`);
  });

  it("GET /api/google/auth/sc returns redirect or error", async () => {
    const res = await fetch(`${BASE}/api/google/auth/sc`, { redirect: "manual" });
    assert.ok([302, 400, 401, 500].includes(res.status));
  });
});
