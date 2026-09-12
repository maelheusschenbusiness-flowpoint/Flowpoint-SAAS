/**
 * Route-level contract for paid recommendation localization:
 * concurrent cache misses for the same org/language/source are single-flight,
 * and the successful provider call is accounted exactly once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

type Metadata = Record<string, unknown>;

const spies = vi.hoisted(() => ({
  aiChat: vi.fn(),
  checkAIQuota: vi.fn(),
  recordCompletedUsage: vi.fn(),
  loadOrgAIPrefs: vi.fn(),
  checkModuleEnabled: vi.fn(),
  selectOptimalModel: vi.fn(),
  isAiMigrationComplete: vi.fn(),
  checkDistributedAiProviderRateLimit: vi.fn(),
  withOrgDb: vi.fn(),
  withOrgDbClient: vi.fn(),
}));

let persistedMetadata: Metadata = {
  language: "fr",
  sourceLanguage: "fr",
  originalTitle: "Corriger le LCP",
  originalDescription: "Réduire le temps de chargement principal.",
};

let lockTail: Promise<void> = Promise.resolve();
let settledUsageMetadata: Metadata | null = null;
let failNextCacheUpdate = false;

function makeClient() {
  let releaseAdvisoryLock: (() => void) | null = null;
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT DISTINCT ON (title)")) {
        return {
          rows: [{
            id: "rec-1",
            type: "recommendation",
            title: "Corriger le LCP",
            description: "Réduire le temps de chargement principal.",
            priority: 90,
            status: "active",
            source: "audit",
            metadata: structuredClone(persistedMetadata),
            created_at: new Date("2026-08-24T08:00:00Z"),
            expires_at: null,
          }],
        };
      }
      if (sql.includes("pg_advisory_lock")) {
        const previous = lockTail;
        lockTail = new Promise<void>((resolve) => {
          releaseAdvisoryLock = resolve;
        });
        await previous;
        return { rows: [{ pg_advisory_lock: null }] };
      }
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql.includes("SELECT id, metadata")) {
        return {
          rows: [{
            id: "rec-1",
            metadata: structuredClone(persistedMetadata),
          }],
        };
      }
      if (sql.includes("FROM ai_usage_logs")) {
        return {
          rows: settledUsageMetadata
            ? [{ metadata: structuredClone(settledUsageMetadata) }]
            : [],
        };
      }
      if (sql.includes("UPDATE ai_recommendations")) {
        if (failNextCacheUpdate) {
          failNextCacheUpdate = false;
          throw new Error("cache write failed");
        }
        const language = String(params[2]);
        const cached = JSON.parse(String(params[3])) as Metadata;
        const translations = persistedMetadata["translations"] && typeof persistedMetadata["translations"] === "object"
          ? persistedMetadata["translations"] as Metadata
          : {};
        persistedMetadata = {
          ...persistedMetadata,
          translations: { ...translations, [language]: cached },
        };
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("pg_advisory_unlock")) {
        releaseAdvisoryLock?.();
        releaseAdvisoryLock = null;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      throw new Error(`Unexpected SQL in recommendation localization test: ${sql}`);
    }),
    release: vi.fn(),
  };
}

const poolConnect = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  pool: {
    connect: poolConnect,
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
  db: {},
  auditsTable: {},
  monitorsTable: {},
  withOrgDb: spies.withOrgDb,
  withOrgDbClient: spies.withOrgDbClient,
}));

vi.mock("../services/store.js", () => ({
  store: {
    me: { plan: null },
    broadcast: vi.fn(),
    addSseClient: vi.fn(),
    removeSseClient: vi.fn(),
    broadcastPlanUpdate: vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../middlewares/rateLimiter.js", () => ({
  aiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  aiChatRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  checkDistributedAiProviderRateLimit: spies.checkDistributedAiProviderRateLimit,
}));

vi.mock("../services/init-ai-migration.js", () => ({
  isAiMigrationComplete: spies.isAiMigrationComplete,
}));

vi.mock("../services/ai-engine.js", () => ({
  checkAIQuota: spies.checkAIQuota,
  recordCompletedUsage: spies.recordCompletedUsage,
  recordCompletedUsageDeferred: vi.fn(),
  consumeAICredits: vi.fn(),
  getAIUsageStats: vi.fn(),
  getOrCreateMonthlyUsage: vi.fn(),
}));

vi.mock("../services/ai-prefs.js", () => ({
  loadOrgAIPrefs: spies.loadOrgAIPrefs,
  checkModuleEnabled: spies.checkModuleEnabled,
  moduleDisabledResponse: vi.fn(),
  selectOptimalModel: spies.selectOptimalModel,
  resolveAIModel: vi.fn(),
}));

vi.mock("../services/ai-provider.js", () => ({
  aiChat: spies.aiChat,
  aiStream: vi.fn(),
  checkAllProviders: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/ai-quota.js", () => ({
  buildQuotaGuidance: vi.fn().mockReturnValue(""),
}));

vi.mock("../services/ai-provider-matrix.js", () => ({
  resolveIntensityConfig: vi.fn(),
  isValidProvider: vi.fn().mockReturnValue(true),
  isModelValidForProvider: vi.fn().mockReturnValue(true),
}));

vi.mock("../services/ai-economy.js", () => ({
  computeEconomyTier: vi.fn(),
  resolveEconomyPolicy: vi.fn(),
  loadOrgEconomyThresholds: vi.fn(),
  computeContextLimits: vi.fn(),
}));

import { recommendationsHandler } from "./ai.js";

function makeReq(): Request {
  return {
    orgId: "org-1",
    userId: "user-1",
    query: { language: "de" },
    headers: {},
  } as unknown as Request;
}

function makeRes(): Response {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
}

describe("GET /ai/recommendations — paid localization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistedMetadata = {
      language: "fr",
      sourceLanguage: "fr",
      originalTitle: "Corriger le LCP",
      originalDescription: "Réduire le temps de chargement principal.",
    };
    lockTail = Promise.resolve();
    settledUsageMetadata = null;
    failNextCacheUpdate = false;
    poolConnect.mockImplementation(async () => makeClient());
    spies.withOrgDb.mockImplementation(async (_orgId: string, callback: (client: ReturnType<typeof makeClient>) => Promise<unknown>) => {
      return callback(makeClient());
    });
    spies.withOrgDbClient.mockImplementation(async (client: ReturnType<typeof makeClient>, _orgId: string, callback: (client: ReturnType<typeof makeClient>) => Promise<unknown>) => {
      return callback(client);
    });
    spies.isAiMigrationComplete.mockReturnValue(true);
    spies.loadOrgAIPrefs.mockResolvedValue({ activeModules: { aiStrategist: true } });
    spies.checkModuleEnabled.mockReturnValue(true);
    spies.checkAIQuota.mockResolvedValue({ allowed: true });
    spies.checkDistributedAiProviderRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetInMs: 60_000,
      limit: 20,
      plan: "pro",
    });
    spies.selectOptimalModel.mockResolvedValue({
      provider: "openai",
      model: "gpt-5-mini",
      maxTokens: 2000,
      temperature: 0,
    });
    spies.aiChat.mockResolvedValue({
      text: JSON.stringify({
        translations: [{
          id: "rec-1",
          title: "LCP beheben",
          description: "Die Ladezeit des Hauptinhalts reduzieren.",
        }],
      }),
      provider: "openai",
      model: "gpt-5-mini",
      _ai: {
        provider: "openai",
        model: "gpt-5-mini",
      },
      usage: {
        promptTokens: 120,
        completionTokens: 60,
        totalTokens: 180,
      },
      latencyMs: 50,
    });
    spies.recordCompletedUsage.mockImplementation(async (args: { metadata?: Metadata }) => {
      settledUsageMetadata = structuredClone(args.metadata ?? {});
      return { creditsDebited: 1, remaining: 999 };
    });
  });

  it("deduplicates two concurrent cache misses and accounts one provider call", async () => {
    const firstResponse = makeRes();
    const secondResponse = makeRes();

    await Promise.all([
      recommendationsHandler(makeReq(), firstResponse),
      recommendationsHandler(makeReq(), secondResponse),
    ]);

    expect(spies.aiChat).toHaveBeenCalledTimes(1);
    expect(spies.checkAIQuota).toHaveBeenCalledTimes(2);
    expect(spies.checkDistributedAiProviderRateLimit).toHaveBeenCalledTimes(1);
    expect(poolConnect).toHaveBeenCalledTimes(2);
    expect(spies.withOrgDb).toHaveBeenCalledTimes(2);
    expect(spies.withOrgDbClient).toHaveBeenCalled();
    expect(spies.recordCompletedUsage).toHaveBeenCalledTimes(1);
    expect(spies.recordCompletedUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "strategist",
        orgId: "org-1",
        userId: "user-1",
        requestId: expect.stringMatching(/^recommendation_translation:org-1:de:/),
      }),
      expect.objectContaining({
        canonicalOrgId: "org-1",
      }),
    );

    for (const response of [firstResponse, secondResponse]) {
      const body = (response.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        recommendations: Array<{ title: string; language: string }>;
      };
      expect(body.recommendations[0]).toMatchObject({
        title: "LCP beheben",
        language: "de",
      });
    }
  });

  it("does not account usage or update cache when every provider attempt fails", async () => {
    spies.aiChat.mockRejectedValue(new Error("provider unavailable"));
    const response = makeRes();

    await recommendationsHandler(makeReq(), response);

    expect(spies.aiChat).toHaveBeenCalled();
    expect(spies.recordCompletedUsage).not.toHaveBeenCalled();
    expect(persistedMetadata["translations"]).toBeUndefined();
    const body = (response.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      recommendations: Array<{ title: string; language: string }>;
    };
    expect(body.recommendations[0]).toMatchObject({
      title: "Corriger le LCP",
      language: "fr",
    });
  });

  it("recovers a settled result after cache failure without a second provider call", async () => {
    failNextCacheUpdate = true;
    const firstResponse = makeRes();
    await recommendationsHandler(makeReq(), firstResponse);

    expect(spies.aiChat).toHaveBeenCalledTimes(1);
    expect(spies.recordCompletedUsage).toHaveBeenCalledTimes(1);
    expect(persistedMetadata["translations"]).toBeUndefined();

    const retryResponse = makeRes();
    await recommendationsHandler(makeReq(), retryResponse);

    expect(spies.aiChat).toHaveBeenCalledTimes(1);
    expect(spies.recordCompletedUsage).toHaveBeenCalledTimes(1);
    const retryBody = (retryResponse.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      recommendations: Array<{ title: string; language: string }>;
    };
    expect(retryBody.recommendations[0]).toMatchObject({
      title: "LCP beheben",
      language: "de",
    });
  });

  it("never calls the provider when quota denies localization", async () => {
    spies.checkAIQuota.mockResolvedValue({ allowed: false, reason: "quota" });
    const response = makeRes();

    await recommendationsHandler(makeReq(), response);

    expect(spies.aiChat).not.toHaveBeenCalled();
    expect(spies.recordCompletedUsage).not.toHaveBeenCalled();
  });

  it("never calls the provider when the shared database rate limit denies localization", async () => {
    spies.checkDistributedAiProviderRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetInMs: 30_000,
      limit: 20,
      plan: "pro",
    });
    const response = makeRes();

    await recommendationsHandler(makeReq(), response);

    expect(spies.aiChat).not.toHaveBeenCalled();
    expect(spies.recordCompletedUsage).not.toHaveBeenCalled();
  });
});