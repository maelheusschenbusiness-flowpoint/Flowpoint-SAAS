import { describe, it, expect } from "vitest";
import { BASE_URL } from "../setup.js";

describe("Billing API", () => {
  it("GET /api/billing returns plans array", async () => {
    const res = await fetch(`${BASE_URL}/api/billing`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("plans");
    expect(Array.isArray(body.plans)).toBe(true);
  });

  it("POST /api/billing/checkout returns a URL for pro plan", async () => {
    const res = await fetch(`${BASE_URL}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "pro" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("url");
    expect(typeof body.url).toBe("string");
  });

  it("POST /api/billing/checkout returns a URL for ultra plan", async () => {
    const res = await fetch(`${BASE_URL}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "ultra" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("url");
  });

  it("POST /api/billing/checkout rejects unknown plan", async () => {
    const res = await fetch(`${BASE_URL}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "diamond" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
