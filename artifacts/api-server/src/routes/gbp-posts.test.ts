import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../middlewares/planGate.js", () => ({
  requireFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/gbp-posting-service.js", () => ({
  createPost: vi.fn(),
  generateAiPost: vi.fn(),
  publishPost: vi.fn(),
  getPostsDashboard: vi.fn(),
  deletePost: vi.fn(),
  getScheduledPosts: vi.fn(),
}));

import router from "./gbp-posts.js";
import { createPost, generateAiPost, publishPost } from "../services/gbp-posting-service.js";

const app = express();
app.use(express.json());
app.use(router);

describe("GBP post studio API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires manual approval before scheduling", async () => {
    const response = await request(app).post("/gbp-posts").send({
      postType: "event",
      content: "Open house",
      locationId: "loc-1",
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      eventTitle: "Open house",
      eventStart: new Date(Date.now() + 172_800_000).toISOString(),
      eventEnd: new Date(Date.now() + 259_200_000).toISOString(),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("validation manuelle");
    expect(createPost).not.toHaveBeenCalled();
  });

  it("keeps product-format posts as drafts only", async () => {
    const response = await request(app).post("/gbp-posts").send({
      postType: "product",
      content: "New product",
      locationId: "loc-1",
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      manualApproval: true,
    });

    expect(response.status).toBe(422);
    expect(createPost).not.toHaveBeenCalled();
  });

  it("allows a manually approved event post to be scheduled", async () => {
    vi.mocked(createPost).mockResolvedValue({ id: "event-1" } as never);
    const response = await request(app).post("/gbp-posts").send({
      postType: "event",
      content: "Open house",
      locationId: "loc-1",
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      manualApproval: true,
      eventTitle: "Open house",
      eventStart: new Date(Date.now() + 172_800_000).toISOString(),
      eventEnd: new Date(Date.now() + 259_200_000).toISOString(),
      ctaType: "LEARN_MORE",
      ctaUrl: "https://example.com/event",
      mediaUrls: ["https://example.com/photo.jpg"],
    });

    expect(response.status).toBe(201);
    expect(createPost).toHaveBeenCalledWith("default", expect.objectContaining({
      postType: "event",
      approvedAt: expect.any(String),
      ctaUrl: "https://example.com/event",
      mediaUrls: ["https://example.com/photo.jpg"],
    }));
  });

  it("returns a validation response when generated copy exceeds its requested limit", async () => {
    vi.mocked(generateAiPost).mockRejectedValue(new Error("AI_GENERATION_OVER_LIMIT"));

    const response = await request(app).post("/gbp-posts/ai-generate").send({
      locationId: "loc-1",
      language: "fr",
      maxCharacters: 100,
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("AI_GENERATION_OVER_LIMIT");
  });

  it("maps a rejected publish request to 422 without leaking internal details", async () => {
    vi.mocked(publishPost).mockRejectedValue(new Error("GBP_POST_TYPE_NOT_SUPPORTED_FOR_PUBLISH"));

    const response = await request(app).post("/gbp-posts/post-1/publish").send({});

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("GBP_POST_TYPE_NOT_SUPPORTED_FOR_PUBLISH");
  });

  it("sanitizes unexpected publish failures", async () => {
    vi.mocked(publishPost).mockRejectedValue(new Error("private provider response"));

    const response = await request(app).post("/gbp-posts/post-1/publish").send({});

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
    expect(JSON.stringify(response.body)).not.toContain("private provider response");
  });
});
