/**
 * ai-chat-failclosed.test.ts
 *
 * Route-level fail-closed contract for POST /ai/chat:
 *  - DB failure while reading quota state → 503, NO provider call (stream + non-stream)
 *  - Unresolvable legacy org (ORG_NOT_CANONICAL) → 402, NO provider call
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Request, Response } from "express";

const spies = vi.hoisted(() => ({
  aiChat:                   vi.fn(),
  aiStream:                 vi.fn(),
  recordCompletedUsage:     vi.fn(),
  getOrCreateMonthlyUsage:  vi.fn(),
  loadOrgAIPrefs:           vi.fn(),
  checkModuleEnabled:       vi.fn(),
  moduleDisabledResponse:   vi.fn().mockReturnValue({ error: "module disabled" }),
  resolveIntensityConfig:   vi.fn(),
  isValidProvider:          vi.fn().mockReturnValue(true),
  isModelValidForProvider:  vi.fn().mockReturnValue(true),
  computeEconomyTier:       vi.fn(),
  resolveEconomyPolicy:     vi.fn(),
  loadOrgEconomyThresholds: vi.fn(),
  computeContextLimits:     vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool:          { query: vi.fn().mockResolvedValue({ rows: [] }) },
  db:            {},
  auditsTable:   {},
  monitorsTable: {},
  withOrgDb:     vi.fn(),
}));
vi.mock("../services/store.js", () => ({
  store: {
    me: { plan: null },
    broadcast: vi.fn(), addSseClient: vi.fn(), removeSseClient: vi.fn(), broadcastPlanUpdate: vi.fn(),
  },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middlewares/rateLimiter.js", () => ({
  aiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/ai-engine.js", () => ({
  getOrCreateMonthlyUsage: spies.getOrCreateMonthlyUsage,
  recordCompletedUsage:    spies.recordCompletedUsage,
  recordCompletedUsageDeferred: vi.fn(),
  consumeAICredits:        vi.fn(),
  checkAIQuota:            vi.fn(),
  getAIUsageStats:         vi.fn(),
}));
vi.mock("../services/ai-prefs.js", () => ({
  loadOrgAIPrefs:         spies.loadOrgAIPrefs,
  checkModuleEnabled:     spies.checkModuleEnabled,
  moduleDisabledResponse: spies.moduleDisabledResponse,
  selectOptimalModel:     vi.fn(),
  resolveAIModel:         vi.fn(),
}));
vi.mock("../services/ai-provider.js", () => ({
  aiChat:            spies.aiChat,
  aiStream:          spies.aiStream,
  checkAllProviders: vi.fn().mockResolvedValue([]),
}));
vi.mock("../services/ai-quota.js", () => ({
  buildQuotaGuidance: vi.fn().mockReturnValue(""),
}));
vi.mock("../services/ai-provider-matrix.js", () => ({
  resolveIntensityConfig:  spies.resolveIntensityConfig,
  isValidProvider:         spies.isValidProvider,
  isModelValidForProvider: spies.isModelValidForProvider,
}));
vi.mock("../services/ai-economy.js", () => ({
  computeEconomyTier:       spies.computeEconomyTier,
  resolveEconomyPolicy:     spies.resolveEconomyPolicy,
  loadOrgEconomyThresholds: spies.loadOrgEconomyThresholds,
  computeContextLimits:     spies.computeContextLimits,
}));

import { chatHandler } from "../routes/ai.js";

let _reqCounter = 0;
function makeReq(body: Record<string, unknown> = {}): Request {
  _reqCounter++;
  return {
    body:    { message: "bonjour", stream: false, ...body },
    orgId:   "org-test",
    userId:  "user-test",
    orgDb:   vi.fn().mockResolvedValue({ rows: [] }),
    headers: {},
    ip:      `10.1.${Math.floor(_reqCounter / 256)}.${_reqCounter % 256}`,
  } as unknown as Request;
}

function makeRes(): Response {
  const r = {
    status: vi.fn(), json: vi.fn(), write: vi.fn(), end: vi.fn(),
    setHeader: vi.fn(), writableEnded: false, on: vi.fn(),
  };
  r.status.mockReturnValue(r);
  r.json.mockReturnValue(r);
  r.write.mockReturnValue(r);
  return r as unknown as Response;
}

function setupDefaults(): void {
  spies.isValidProvider.mockReturnValue(true);
  spies.isModelValidForProvider.mockReturnValue(true);
  spies.loadOrgAIPrefs.mockResolvedValue({
    aiIntensity: "standard", preferredProvider: "openai", activeModules: { dailyAI: true },
  });
  spies.checkModuleEnabled.mockReturnValue(true);
  spies.resolveIntensityConfig.mockReturnValue({ model: "gpt-5-mini", maxTokens: 2048 });
  spies.loadOrgEconomyThresholds.mockResolvedValue({ eco: 70, thrift: 90, exhausted: 100 });
  spies.computeEconomyTier.mockReturnValue("NORMAL");
  spies.computeContextLimits.mockReturnValue({ historyLimit: 10 });
}

describe("POST /ai/chat — fail-closed on quota-state failure", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaults();
  });

  it("DB failure → 503 QUOTA_STATE_UNAVAILABLE, provider never called (non-stream)", async () => {
    spies.getOrCreateMonthlyUsage.mockRejectedValue(new Error("db down"));
    const res = makeRes();
    await chatHandler(makeReq({ stream: false }), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].code).toBe("QUOTA_STATE_UNAVAILABLE");
    expect(spies.aiChat).not.toHaveBeenCalled();
    expect(spies.aiStream).not.toHaveBeenCalled();
    expect(spies.recordCompletedUsage).not.toHaveBeenCalled();
  });

  it("DB failure → 503, provider never called (stream)", async () => {
    spies.getOrCreateMonthlyUsage.mockRejectedValue(new Error("db down"));
    const res = makeRes();
    await chatHandler(makeReq({ stream: true }), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(spies.aiStream).not.toHaveBeenCalled();
    expect(spies.aiChat).not.toHaveBeenCalled();
  });

  it("unresolvable legacy org → 402 QUOTA_UNRESOLVABLE_ORG, provider never called", async () => {
    const err = Object.assign(new Error("not canonical"), { code: "ORG_NOT_CANONICAL" });
    spies.getOrCreateMonthlyUsage.mockRejectedValue(err);
    const res = makeRes();
    await chatHandler(makeReq({ stream: false }), res);
    expect(res.status).toHaveBeenCalledWith(402);
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].code).toBe("QUOTA_UNRESOLVABLE_ORG");
    expect(spies.aiChat).not.toHaveBeenCalled();
    expect(spies.aiStream).not.toHaveBeenCalled();
  });
});
