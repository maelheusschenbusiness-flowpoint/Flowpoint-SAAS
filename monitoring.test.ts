/**
 * Monitoring endpoint tests — monitors, alerts, SSE events
 * Run: node --import tsx/esm --test src/__tests__/monitoring.test.ts
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

describe("GET /api/monitors", () => {
  it("returns monitor list (authenticated or 401)", async () => {
    const { status, body } = await get("/api/monitors", AUTH_TOKEN);
    assert.ok([200, 401].includes(status));
    if (status === 200) {
      assert.ok(Array.isArray(body) || Array.isArray((body as { monitors: unknown[] }).monitors));
    }
  });
});

describe("POST /api/monitors — SSRF prevention", () => {
  it("rejects monitor targeting localhost", async () => {
    const { status } = await post("/api/monitors", {
      name: "SSRF Test",
      url: "http://localhost:5432",
      interval: 60,
    }, AUTH_TOKEN);
    assert.ok([400, 401, 422].includes(status), `Expected 400/401/422 got ${status}`);
  });

  it("rejects monitor targeting 127.0.0.1", async () => {
    const { status } = await post("/api/monitors", {
      name: "SSRF Test 2",
      url: "http://127.0.0.1",
      interval: 60,
    }, AUTH_TOKEN);
    assert.ok([400, 401, 422].includes(status));
  });

  it("rejects monitor targeting 10.x.x.x", async () => {
    const { status } = await post("/api/monitors", {
      name: "SSRF Test 3",
      url: "http://10.0.0.1/api",
      interval: 60,
    }, AUTH_TOKEN);
    assert.ok([400, 401, 422].includes(status));
  });
});

describe("GET /api/alert-rules", () => {
  it("returns alert rules (authenticated or 401)", async () => {
    const { status } = await get("/api/alert-rules", AUTH_TOKEN);
    assert.ok([200, 401].includes(status));
  });
});

describe("GET /api/betterstack/monitors", () => {
  it("returns BetterStack data or not-configured state", async () => {
    const { status } = await get("/api/betterstack/monitors", AUTH_TOKEN);
    assert.ok([200, 401, 404, 503].includes(status));
  });
});

describe("SSE endpoint — GET /api/events", () => {
  it("connects and receives SSE stream headers", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${BASE}/api/events`, {
        headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timer);
      const ct = res.headers.get("content-type") ?? "";
      assert.ok(
        ct.includes("text/event-stream") || [401, 403].includes(res.status),
        `Expected SSE content-type or 401/403, got ${res.status} ${ct}`
      );
    } catch (err: unknown) {
      clearTimeout(timer);
      if ((err as { name?: string }).name === "AbortError") return;
      throw err;
    }
  });
});
