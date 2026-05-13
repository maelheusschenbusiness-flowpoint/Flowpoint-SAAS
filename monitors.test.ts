import { describe, it, expect } from "vitest";
import { BASE_URL } from "../setup.js";

describe("Monitors API", () => {
  it("GET /api/monitors returns an array", async () => {
    const res = await fetch(`${BASE_URL}/api/monitors`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /api/monitors creates a new monitor", async () => {
    const res = await fetch(`${BASE_URL}/api/monitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Monitor",
        url: "https://example.com",
        interval: 5,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.name).toBe("Test Monitor");
  });

  it("POST /api/monitors/:id/ping returns ping result", async () => {
    // Get first monitor ID
    const listRes = await fetch(`${BASE_URL}/api/monitors`);
    const monitors = await listRes.json();
    if (!monitors.length) return; // skip if no monitors seeded

    const id = monitors[0].id;
    const res = await fetch(`${BASE_URL}/api/monitors/${id}/ping`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(["up", "down"]).toContain(body.status);
  });

  it("POST /api/monitors rejects missing URL", async () => {
    const res = await fetch(`${BASE_URL}/api/monitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No URL" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
