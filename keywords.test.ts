import { describe, it, expect } from "vitest";
import { BASE_URL } from "../setup.js";

describe("Keywords API", () => {
  let createdId: string;

  it("GET /api/keywords returns an array", async () => {
    const res = await fetch(`${BASE_URL}/api/keywords`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /api/keywords creates a keyword", async () => {
    const res = await fetch(`${BASE_URL}/api/keywords`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: "flowpoint seo test",
        position: 12,
        volume: 800,
        difficulty: 35,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.keyword).toBe("flowpoint seo test");
    createdId = body.id;
  });

  it("DELETE /api/keywords/:id removes the keyword", async () => {
    if (!createdId) return;
    const res = await fetch(`${BASE_URL}/api/keywords/${createdId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });
});
