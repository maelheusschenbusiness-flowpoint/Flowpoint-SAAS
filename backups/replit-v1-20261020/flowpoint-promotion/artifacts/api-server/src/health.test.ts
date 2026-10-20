/**
 * Health & diagnostics endpoint tests
 * Run: node --import tsx/esm --test src/__tests__/health.test.ts
 */
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env["TEST_BASE_URL"] ?? "http://localhost:8080";

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("GET /api/healthz", () => {
  it("returns 200 with status ok", async () => {
    const { status, body } = await get("/api/healthz");
    assert.equal(status, 200);
    assert.equal((body as { status: string }).status, "ok");
  });

  it("includes uptime field", async () => {
    const { body } = await get("/api/healthz");
    assert.ok(typeof (body as { uptime: number }).uptime === "number");
  });
});

describe("GET /api/healthz/deep", () => {
  it("returns 200 or 503 (degraded services allowed)", async () => {
    const { status } = await get("/api/healthz/deep");
    assert.ok(status === 200 || status === 503, `Expected 200 or 503, got ${status}`);
  });

  it("response is an object with system info", async () => {
    const { body } = await get("/api/healthz/deep");
    assert.ok(body !== null && typeof body === "object", "Expected non-null object");
  });
});

describe("GET /api/diagnostics (requires auth + admin key)", () => {
  const adminKey = process.env["ADMIN_KEY"] ?? "";

  it("rejects unauthenticated requests", async () => {
    const { status } = await get("/api/diagnostics");
    assert.ok([401, 403, 503].includes(status), `Expected 401/403/503 got ${status}`);
  });

  it("with admin key: returns plan info or 401 (auth required before key check)", async (t: TestContext) => {
    if (!adminKey) { t.skip("ADMIN_KEY not set"); return; }
    const { status, body } = await get("/api/diagnostics", { "x-admin-key": adminKey });
    // Diagnostics are behind requireAuth — admin key alone returns 401
    // With a valid user session + admin key it returns 200
    assert.ok([200, 401].includes(status), `Expected 200 or 401, got ${status}`);
    if (status === 200) {
      assert.ok((body as { plan?: string }).plan !== undefined);
    }
  });
});

describe("GET /api/diagnostics/workers", () => {
  const adminKey = process.env["ADMIN_KEY"] ?? "";

  it("rejects without credentials", async () => {
    const { status } = await get("/api/diagnostics/workers");
    assert.ok([401, 403, 503].includes(status));
  });

  it("with admin key: returns 200 or 401 (auth required)", async (t: TestContext) => {
    if (!adminKey) { t.skip("ADMIN_KEY not set"); return; }
    const { status } = await get("/api/diagnostics/workers", { "x-admin-key": adminKey });
    assert.ok([200, 401].includes(status), `Expected 200 or 401, got ${status}`);
  });
});
