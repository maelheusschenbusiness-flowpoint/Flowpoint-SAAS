import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  aiChat: vi.fn(),
  checkAIQuota: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("./ai-provider.js", () => ({ aiChat: mocks.aiChat }));
vi.mock("./ai-engine.js", () => ({
  checkAIQuota: mocks.checkAIQuota,
  recordCompletedUsageDeferred: mocks.recordUsage,
}));

import { generateReplyForReview } from "./review-intel-service.js";

describe("Review Intelligence AI reply drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAIQuota.mockResolvedValue({ allowed: true });
    mocks.query.mockResolvedValue({
      rows: [{ author: "Camille", rating: 2, review_text: "Le délai était long et personne ne m'a tenue informée." }],
    });
    mocks.aiChat.mockResolvedValue({
      text: "Bonjour Camille, nous sommes désolés pour le délai et le manque d'information. Nous allons examiner votre retour.",
      usage: { promptTokens: 40, completionTokens: 25 },
      _ai: { model: "gpt-5-mini", provider: "openai" },
    });
  });

  it("loads a tenant-owned review and returns a measured AI draft", async () => {
    const reply = await generateReplyForReview("org-1", "review-1", "empathetic", "fr", "user-1");

    expect(reply).toContain("désolés");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("google_reviews WHERE id=$1 AND org_id=$2"), ["review-1", "org-1"]);
    expect(mocks.aiChat).toHaveBeenCalledWith(expect.objectContaining({
      task: "market_intel",
      userPrompt: expect.stringContaining("délai était long"),
    }));
    expect(mocks.checkAIQuota).toHaveBeenCalledWith({ feature: "market_intel", orgId: "org-1" });
    expect(mocks.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1", userId: "user-1", success: true,
    }));
  });

  it("does not generate a reply when the review is absent from that organization", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await expect(generateReplyForReview("org-2", "review-1")).rejects.toThrow("REVIEW_NOT_FOUND");
    expect(mocks.aiChat).not.toHaveBeenCalled();
  });

  it("does not call the provider when the AI quota is exhausted", async () => {
    mocks.checkAIQuota.mockResolvedValueOnce({ allowed: false });

    await expect(generateReplyForReview("org-1", "review-1")).rejects.toThrow("AI_QUOTA_EXCEEDED");
    expect(mocks.aiChat).not.toHaveBeenCalled();
  });
});
