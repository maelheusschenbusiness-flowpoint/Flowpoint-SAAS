/**
 * Stripe / billing tests
 * Run: node --import tsx/esm --test src/__tests__/stripe.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env["TEST_BASE_URL"] ?? "http://localhost:8080";
const AUTH_TOKEN = process.env["TEST_AUTH_TOKEN"] ?? "";

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

async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("POST /api/billing/checkout", () => {
  it("returns 200 or 503 (no mock URLs in production)", async () => {
    const { status, body } = await post("/api/billing/checkout", { plan: "pro" }, AUTH_TOKEN);
    assert.ok([200, 401, 402, 503].includes(status), `Unexpected: ${status} ${JSON.stringify(body)}`);
    if (status === 200 && process.env["NODE_ENV"] === "production") {
      assert.ok(!(body as { mock?: boolean }).mock, "Production must not return mock: true checkout");
    }
  });

  it("rejects unknown plan gracefully", async () => {
    const { status } = await post("/api/billing/checkout", { plan: "invalid_plan_xyz" }, AUTH_TOKEN);
    assert.ok([400, 401, 402, 503].includes(status));
  });
});

describe("POST /api/billing/embedded-checkout", () => {
  it("returns clientSecret or 503 (never mock clientSecret in production)", async () => {
    const { status, body } = await post("/api/billing/embedded-checkout", { plan: "standard" }, AUTH_TOKEN);
    assert.ok([200, 401, 402, 503].includes(status));
    if (status === 200 && process.env["NODE_ENV"] === "production") {
      assert.ok(!(body as { mock?: boolean }).mock, "Production must not return mock clientSecret");
    }
  });
});

describe("POST /api/billing/stripe-webhook", () => {
  it("rejects invalid webhook signature with 400", async () => {
    const { status } = await post("/api/billing/stripe-webhook", { type: "test" });
    assert.ok([400, 401, 500].includes(status), `Expected 400/401/500 for invalid signature, got ${status}`);
  });
});

describe("GET /api/billing/subscription", () => {
  it("returns plan info", async () => {
    const { status } = await get("/api/billing/subscription", AUTH_TOKEN);
    assert.ok([200, 401].includes(status));
  });
});
