import { describe, it, expect } from "vitest";
import { BASE_URL } from "../setup.js";

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(body.status).toBe("ok");
  });

  it("returns JSON content-type", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });
});
