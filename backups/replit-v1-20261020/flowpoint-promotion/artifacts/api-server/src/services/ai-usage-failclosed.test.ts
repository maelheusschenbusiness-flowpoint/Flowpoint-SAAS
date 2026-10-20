/**
 * Fail-closed semantics when the usage store is unavailable.
 *
 * Mocks @workspace/db so every read/write rejects, then asserts that:
 *  - checkAIQuota BLOCKS (no degraded unlimited allow)
 *  - consumeAICredits BLOCKS with a zero debit (no success-shaped result)
 *  - recordCompletedUsage PROPAGATES the failure (callers can never mistake
 *    a rolled-back debit for a success)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  pool: {
    connect: vi.fn().mockRejectedValue(new Error("db down")),
    query: vi.fn().mockRejectedValue(new Error("db down")),
  },
  withOrgDb: vi.fn().mockRejectedValue(new Error("db down")),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./org-data.js", () => ({
  loadOrgData: vi.fn().mockRejectedValue(new Error("db down")),
}));

import { checkAIQuota, consumeAICredits, recordCompletedUsage, resolveCanonicalOrgUuid } from "./ai-engine.js";

// Valid UUID — canonicalization short-circuits without touching the DB.
const ORG = "0d9e2f6a-1b3c-4d5e-8f70-123456789abc";

describe("AI usage fail-closed on DB failure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checkAIQuota blocks when usage state is unreadable", async () => {
    const gate = await checkAIQuota({ feature: "chat", orgId: ORG });
    expect(gate.allowed).toBe(false);
    expect(gate.remaining).toBe(0);
  });

  it("consumeAICredits blocks with zero debit when the store is down", async () => {
    const res = await consumeAICredits({ feature: "behavior_analysis", orgId: ORG, model: "gpt-5-mini", provider: "openai" });
    expect(res.allowed).toBe(false);
    expect(res.creditsUsed).toBe(0);
    expect(res.remaining).toBe(0);
  });

  it("legacy-org lookup during a DB outage throws ORG_LOOKUP_UNAVAILABLE (never a verified-absence verdict)", async () => {
    await expect(resolveCanonicalOrgUuid("legacy@example.com"))
      .rejects.toMatchObject({ code: "ORG_LOOKUP_UNAVAILABLE" });
  });

  it("recordCompletedUsage propagates a failed atomic write", async () => {
    await expect(recordCompletedUsage({
      feature: "chat", orgId: ORG, userId: "u1", model: "gpt-5-mini",
      provider: "openai", tokensIn: 10, tokensOut: 5, latencyMs: 1, success: true,
      requestId: "req_failclosed_test",
    })).rejects.toThrow();
  });
});
