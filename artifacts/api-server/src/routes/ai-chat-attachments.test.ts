/**
 * ai-chat-attachments.test.ts
 *
 * Route-level contract tests for POST /ai/chat attachment handling (Step 3A).
 *
 * Audit points verified:
 *   C — Attachment path blocks at 501 ATTACHMENT_PROCESSING_NOT_IMPLEMENTED
 *   7 — aiChat and aiStream are NOT called when 501 is returned (spy proof)
 *   8 — recordCompletedUsage is NOT called when 501 is returned (usage proof)
 *   E — Without attachments the SSE path is entered normally (no 501 regression)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ── Hoisted spies — must be created before vi.mock() factories run ─────────────
const spies = vi.hoisted(() => ({
  aiChat:                   vi.fn(),
  aiStream:                 vi.fn(),
  recordCompletedUsage:     vi.fn().mockResolvedValue(undefined),
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

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool:          { query: vi.fn().mockResolvedValue({ rows: [] }) },
  db:            {},
  auditsTable:   {},
  monitorsTable: {},
  withOrgDb:     vi.fn(),
}));

vi.mock("../services/store.js", () => ({
  store: {
    me:                  { plan: null },
    broadcast:           vi.fn(),
    addSseClient:        vi.fn(),
    removeSseClient:     vi.fn(),
    broadcastPlanUpdate: vi.fn(),
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

// ── Import handler after mocks ─────────────────────────────────────────────────
import { chatHandler } from "../routes/ai.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

// Valid base64 string (~1 024 decoded bytes, length multiple of 4)
const VALID_B64 = "A".repeat(1368);

function makeValidOrgDb() {
  return vi.fn().mockResolvedValue({
    rows: [{
      id:      "file1",
      org_id:  "org-test",
      name:    "document.pdf",
      type:    "application/pdf",
      size:    1024,
      content: VALID_B64,
    }],
  });
}

function makeReq(
  overrides: { body?: Record<string, unknown>; orgDb?: unknown } = {},
): Request {
  return {
    body:    { message: "bonjour", stream: false, ...overrides.body },
    orgId:   "org-test",
    userId:  "user-test",
    orgDb:   overrides.orgDb ?? vi.fn().mockResolvedValue({ rows: [] }),
    headers: {},
    ip:      "127.0.0.1",
  } as unknown as Request;
}

function makeRes(): Response {
  const r = {
    status:       vi.fn(),
    json:         vi.fn(),
    write:        vi.fn(),
    end:          vi.fn(),
    setHeader:    vi.fn(),
    writableEnded: false,
    on:           vi.fn(),
  };
  r.status.mockReturnValue(r);
  r.json.mockReturnValue(r);
  r.write.mockReturnValue(r);
  return r as unknown as Response;
}

function setupDefaultMocks(): void {
  spies.loadOrgAIPrefs.mockResolvedValue({
    aiIntensity:       "standard",
    preferredProvider: "openai",
    activeModules:     { dailyAI: true },
  });
  spies.checkModuleEnabled.mockReturnValue(true);
  spies.resolveIntensityConfig.mockReturnValue({ model: "gpt-5-mini", maxTokens: 2048 });
  spies.getOrCreateMonthlyUsage.mockResolvedValue({
    creditsUsed: 0, creditsLimit: 100_000, creditsExtra: 0,
    tokensUsed: 0, tokenLimit: 1_000_000,
  });
  spies.loadOrgEconomyThresholds.mockResolvedValue({ eco: 70, thrift: 90, exhausted: 100 });
  spies.computeEconomyTier.mockReturnValue("NORMAL");
  spies.resolveEconomyPolicy.mockReturnValue({
    effectiveModel:  "gpt-5-mini",
    maxTokens:       2048,
    contextFactor:   1.0,
    effectiveMode:   "standard",
    economyTier:     "NORMAL",
    downgradeApplied: false,
  });
  spies.computeContextLimits.mockReturnValue({ historyLimit: 10 });
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("POST /ai/chat — attachment contract (Step 3A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ── C — Valid attachment → 501 ────────────────────────────────────────────────

  describe("C — valid attachment → 501 ATTACHMENT_PROCESSING_NOT_IMPLEMENTED", () => {
    it("returns HTTP 501 with correct code (stream=false)", async () => {
      const req = makeReq({
        body:  { message: "analyse ce fichier", stream: false, attachments: [{ fileId: "file1" }] },
        orgDb: makeValidOrgDb(),
      });
      const res = makeRes();

      await chatHandler(req, res);

      expect(vi.mocked(res.status)).toHaveBeenCalledWith(501);
      expect(vi.mocked(res.json)).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ATTACHMENT_PROCESSING_NOT_IMPLEMENTED" }),
      );
    });

    it("returns HTTP 501 with correct code (stream=true — not SSE)", async () => {
      const req = makeReq({
        body:  { message: "analyse ce fichier", stream: true, attachments: [{ fileId: "file1" }] },
        orgDb: makeValidOrgDb(),
      });
      const res = makeRes();

      await chatHandler(req, res);

      expect(vi.mocked(res.status)).toHaveBeenCalledWith(501);
      expect(vi.mocked(res.json)).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ATTACHMENT_PROCESSING_NOT_IMPLEMENTED" }),
      );
    });

    it("returns correct French message in body", async () => {
      const req = makeReq({
        body:  { message: "analyse", attachments: [{ fileId: "file1" }] },
        orgDb: makeValidOrgDb(),
      });
      const res = makeRes();

      await chatHandler(req, res);

      expect(vi.mocked(res.json)).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Le traitement des pièces jointes est en cours d'activation.",
        }),
      );
    });
  });

  // ── C — Invalid attachment structure → 400 ────────────────────────────────────

  it("C — attachment not an array → HTTP 400", async () => {
    const req = makeReq({ body: { message: "analyse", attachments: "not-an-array" } });
    const res = makeRes();

    await chatHandler(req, res);

    expect(vi.mocked(res.status)).toHaveBeenCalledWith(400);
    expect(vi.mocked(res.status)).not.toHaveBeenCalledWith(501);
  });

  it("C — attachment item missing fileId → HTTP 400", async () => {
    const req = makeReq({ body: { message: "analyse", attachments: [{}] } });
    const res = makeRes();

    await chatHandler(req, res);

    expect(vi.mocked(res.status)).toHaveBeenCalledWith(400);
  });

  // ── C — No attachment → attachment block skipped ──────────────────────────────

  it("C — no attachments field → handler does not return 501", async () => {
    // Exit early via economy exhaustion (402) — happens after the attachment
    // block is skipped, before buildFlowpointContext or any provider call.
    // This proves: with no attachments the 501 path is never entered.
    spies.computeEconomyTier.mockReturnValueOnce("EXHAUSTED");
    spies.getOrCreateMonthlyUsage.mockResolvedValueOnce({
      creditsUsed: 100_000, creditsLimit: 100_000, creditsExtra: 0,
      tokensUsed: 0, tokenLimit: 1_000_000,
    });

    const req = makeReq({ body: { message: "bonjour" } }); // no attachments
    const res = makeRes();

    await chatHandler(req, res);

    expect(vi.mocked(res.status)).toHaveBeenCalledWith(402);
    expect(vi.mocked(res.status)).not.toHaveBeenCalledWith(501);
  });

  // ── 7 — Provider spies: NOT called when 501 returned ─────────────────────────

  it("7 — aiChat is NOT called when valid attachment → 501", async () => {
    const req = makeReq({
      body:  { message: "analyse", stream: false, attachments: [{ fileId: "file1" }] },
      orgDb: makeValidOrgDb(),
    });

    await chatHandler(req, makeRes());

    expect(spies.aiChat).not.toHaveBeenCalled();
  });

  it("7 — aiStream is NOT called when valid attachment → 501", async () => {
    const req = makeReq({
      body:  { message: "analyse", stream: true, attachments: [{ fileId: "file1" }] },
      orgDb: makeValidOrgDb(),
    });

    await chatHandler(req, makeRes());

    expect(spies.aiStream).not.toHaveBeenCalled();
  });

  // ── 8 — Usage NOT debited when 501 returned ───────────────────────────────────

  it("8 — recordCompletedUsage is NOT called when 501 returned", async () => {
    const req = makeReq({
      body:  { message: "analyse", stream: false, attachments: [{ fileId: "file1" }] },
      orgDb: makeValidOrgDb(),
    });

    await chatHandler(req, makeRes());

    expect(spies.recordCompletedUsage).not.toHaveBeenCalled();
  });

  // ── 6 — No attachment + quota available → provider called, HTTP 200 ──────────

  it("6 — no attachment + quota available → aiChat called, reply returned (non-stream)", async () => {
    // Proves the normal chat path is completely unaffected by the attachment block.
    spies.aiChat.mockResolvedValue({
      text:  "Bonjour ! Je suis votre consultant SEO.",
      usage: { promptTokens: 50, completionTokens: 30 },
    });

    const req = makeReq({ body: { message: "bonjour", stream: false } }); // no attachments
    const res = makeRes();

    await chatHandler(req, res);

    // Provider WAS called
    expect(spies.aiChat).toHaveBeenCalledOnce();

    // Normal JSON reply — not 501 / 402 / 400
    expect(vi.mocked(res.status)).not.toHaveBeenCalledWith(501);
    expect(vi.mocked(res.status)).not.toHaveBeenCalledWith(402);
    expect(vi.mocked(res.status)).not.toHaveBeenCalledWith(400);
    expect(vi.mocked(res.json)).toHaveBeenCalledWith(
      expect.objectContaining({
        reply:     "Bonjour ! Je suis votre consultant SEO.",
        streaming: false,
      }),
    );
  });

  // ── E / 10 — SSE regression: multiple deltas, single _ai, [DONE], one usage ──

  it("10 — SSE without attachment: multiple deltas, _ai before [DONE], single usage debit", async () => {
    // Full async-generator mock — verifies the complete SSE contract.
    spies.aiStream.mockReturnValue(
      (async function* () {
        yield { content: "Bonjour" };
        yield { content: " le monde" };
      })(),
    );

    const req = makeReq({ body: { message: "bonjour", stream: true } }); // no attachments
    const res = makeRes();

    await chatHandler(req, res);

    const writes: string[] = vi.mocked(res.write).mock.calls.map(c => String(c[0]));

    // Multiple distinct deltas written
    expect(writes.some(s => s.includes('"delta":"Bonjour"'))).toBe(true);
    expect(writes.some(s => s.includes('"delta":" le monde"'))).toBe(true);

    // Exactly one _ai metadata frame
    const aiFrames = writes.filter(s => s.includes('"_ai"'));
    expect(aiFrames).toHaveLength(1);

    // [DONE] present and after _ai — use reduce to find last index (ES2020-safe)
    const doneIdx = writes.reduce((acc, s, i) => (s.includes("[DONE]")  ? i : acc), -1);
    const aiIdx   = writes.reduce((acc, s, i) => (s.includes('"_ai"')   ? i : acc), -1);
    expect(doneIdx).toBeGreaterThan(-1);

    // _ai comes before [DONE]
    expect(aiIdx).toBeLessThan(doneIdx);

    // res.end() called exactly once
    expect(vi.mocked(res.end)).toHaveBeenCalledOnce();

    // Exactly one usage debit
    expect(spies.recordCompletedUsage).toHaveBeenCalledOnce();

    // Not 501
    expect(vi.mocked(res.status)).not.toHaveBeenCalledWith(501);
  });
});
