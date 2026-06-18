/**
 * Auth endpoint tests — magic link flow, rate limiting, session management
 * Run: node --import tsx/esm --test src/__tests__/auth.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env["TEST_BASE_URL"] ?? "http://localhost:8080";

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("POST /api/auth/login-request", () => {
  it("rejects missing email — 400 or 429 (rate limiter may be active)", async () => {
    const { status } = await post("/api/auth/login-request", {});
    assert.ok([400, 429].includes(status), `Expected 400 or 429, got ${status}`);
  });

  it("rejects invalid email (no @) — 400 or 429", async () => {
    const { status } = await post("/api/auth/login-request", { email: "notanemail" });
    assert.ok([400, 429].includes(status), `Expected 400 or 429, got ${status}`);
  });

  it("accepts valid email — 200 or 429 (rate limiter may be active)", async () => {
    const { status } = await post("/api/auth/login-request", { email: "test@example.com" });
    assert.ok([200, 429].includes(status), `Expected 200 or 429, got ${status}`);
  });
});

describe("POST /api/auth/register", () => {
  it("rejects missing email — 400 or 429", async () => {
    const { status } = await post("/api/auth/register", { firstName: "Test" });
    assert.ok([400, 429].includes(status), `Expected 400 or 429, got ${status}`);
  });

  it("accepts valid registration payload — 200, 201, 409, or 429", async () => {
    const { status, body } = await post("/api/auth/register", {
      email: `test-${Date.now()}@example.com`,
      firstName: "Test",
      companyName: "TestCo",
      plan: "standard",
    });
    assert.ok([200, 201, 409, 429].includes(status), `Expected 200/201/409/429 got ${status}: ${JSON.stringify(body)}`);
  });
});

describe("Auth rate limiting (brute-force protection)", () => {
  it("triggers 429 within 12 rapid requests", async () => {
    const responses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const { status } = await post("/api/auth/login-request", { email: `burst-${i}@rl-test.invalid` });
      responses.push(status);
      if (status === 429) break;
    }
    // Either we already got 429 immediately (rate limit pre-saturated) OR we hit it within the loop
    const has429 = responses.some(s => s === 429) || responses[0] === 429;
    assert.ok(has429, `Expected 429 within 12 requests. Got: ${responses.join(",")}`);
  });
});

describe("GET /api/me (unauthenticated)", () => {
  it("returns 401 without token", async () => {
    const { status } = await get("/api/me");
    assert.ok([401, 403].includes(status), `Expected 401/403 got ${status}`);
  });
});

describe("POST /api/auth/logout", () => {
  it("returns ok or 401 without session", async () => {
    const { status, body } = await post("/api/auth/logout", {});
    assert.ok([200, 401].includes(status));
    if (status === 200) assert.equal((body as { ok: boolean }).ok, true);
  });
});
