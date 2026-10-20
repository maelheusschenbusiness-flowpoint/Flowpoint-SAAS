/**
 * Global vitest setup — stubs infrastructure dependencies so pure function
 * tests can run without a live database, logger, or AI SDK.
 *
 * Only the pure exports of ai-economy.ts are tested here; the DB-backed
 * functions (loadOrgEconomyThresholds, getOrgUsageStatus) are not exercised
 * in this suite because they require a real Supabase connection.
 */
import { vi } from "vitest";

// ── @workspace/db (pool / drizzle) ────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  pool:    { connect: vi.fn(), query: vi.fn() },
  db:      {},
  eq:      vi.fn(),
  desc:    vi.fn(),
  and:     vi.fn(),
}));

// ── Logger ────────────────────────────────────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── ai-engine (getOrCreateMonthlyUsage) ──────────────────────────────────────
vi.mock("./ai-engine.js", () => ({
  getOrCreateMonthlyUsage: vi.fn().mockResolvedValue({
    creditsUsed: 0, creditsLimit: 100000, creditsExtra: 0,
    costEur: 0, requestCount: 0, tokensUsed: 0, tokenLimit: 50000,
  }),
}));

// ── AI provider types (only type imports — no runtime dep needed) ─────────────
vi.mock("./ai-providers/capabilities.js", () => ({}));
vi.mock("./ai-provider-matrix.js", () => ({}));
