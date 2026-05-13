import { describe, it, expect } from "vitest";
import { BASE_URL } from "../setup.js";

describe("Notifications API", () => {
  let createdId: string;

  it("GET /api/notifications returns an array", async () => {
    const res = await fetch(`${BASE_URL}/api/notifications`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /api/notifications creates a notification", async () => {
    const res = await fetch(`${BASE_URL}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test Notification",
        message: "This is a test notification",
        type: "info",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    createdId = body.id;
  });

  it("PATCH /api/notifications/:id/read marks as read", async () => {
    if (!createdId) return;
    const res = await fetch(`${BASE_URL}/api/notifications/${createdId}/read`, {
      method: "PATCH",
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /api/notifications/:id removes it", async () => {
    if (!createdId) return;
    const res = await fetch(`${BASE_URL}/api/notifications/${createdId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });
});
