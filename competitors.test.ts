import { describe, it, expect } from "vitest";
import { BASE_URL } from "../setup.js";

describe("Competitors API", () => {
  let createdId: string;

  it("GET /api/competitors returns an array", async () => {
    const res = await fetch(`${BASE_URL}/api/competitors`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /api/competitors creates a competitor", async () => {
    const res = await fetch(`${BASE_URL}/api/competitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "test-competitor.com",
        name: "Test Competitor",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.domain).toBe("test-competitor.com");
    createdId = body.id;
  });

  it("DELETE /api/competitors/:id removes it", async () => {
    if (!createdId) return;
    const res = await fetch(`${BASE_URL}/api/competitors/${createdId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });
});
