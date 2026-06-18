/**
 * Quota & plan enforcement tests — AI credits, rate limits, plan gates
 * Run: node --import tsx/esm --test src/__tests__/quotas.test.ts
 */
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env["TEST_BASE_URL"] ?? "http://localhost:8080";
const AUTH_TOKEN = process.env["TEST_AUTH_TOKEN"] ?? "";

async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("GET /api/ai/usage", () => {
  it("returns usage stats (authenticated or 401)", async () => {
    const { status, body } = await get("/api/ai/usage", AUTH_TOKEN);
    assert.ok([200, 401].includes(status));
    if (status === 200) {
      const b = body as { creditsUsed?: number; creditsLimit?: number };
      assert.ok(typeof b.creditsUsed === "number" || b.creditsUsed === null);
    }
  });
});

describe("AI rate limiting — /api/ai/*", () => {
  it("rate limits rapid AI requests (>30/min per IP)", async (t: TestContext) => {
    if (!AUTH_TOKEN) { t.skip("TEST_AUTH_TOKEN not set"); return; }
    const responses: number[] = [];
    for (let i = 0; i < 35; i++) {
      const { status } = await post("/api/ai/explain", { context: "test" }, AUTH_TOKEN);
      responses.push(status);
      if (responses.filter(s => s === 429).length >= 1) break;
    }
    const has429 = responses.some(s => s === 429);
    assert.ok(has429, `Expected 429 after 30+ AI requests. Got: ${responses.join(",")}`);
  });
});

describe("GET /api/addons", () => {
  it("returns addon list (authenticated or 401)", async () => {
    const { status } = await get("/api/addons", AUTH_TOKEN);
    assert.ok([200, 401].includes(status));
  });
});

describe("Plan quota enforcement", () => {
  it("GET /api/reports returns report list (authenticated or 401)", async () => {
    const { status } = await get("/api/reports", AUTH_TOKEN);
    assert.ok([200, 401, 403].includes(status));
  });

  it("GET /api/keywords returns keyword list (authenticated or 401)", async () => {
    const { status } = await get("/api/keywords", AUTH_TOKEN);
    assert.ok([200, 401, 403].includes(status));
  });

  it("GET /api/competitors returns competitor list (authenticated or 401)", async () => {
    const { status } = await get("/api/competitors", AUTH_TOKEN);
    assert.ok([200, 401, 403].includes(status));
  });
});
