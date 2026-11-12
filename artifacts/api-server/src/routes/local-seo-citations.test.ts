import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  getBacklinks: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  getDBMode: vi.fn(() => "postgres"),
  getOrgDb: vi.fn(() => vi.fn()),
  queryWithRetry: vi.fn(),
}));

vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/dataforseo-service.js", () => ({
  isDataForSEOConfigured: vi.fn(),
  verifierEtConsommerQuota: vi.fn(),
  rembourserQuota: vi.fn(),
  suivreAppelsPayants: vi.fn(),
  getQuotaUsage: vi.fn(),
  getQuotaUsageFromDB: vi.fn(),
  getKeywordSuggestions: vi.fn(),
  getSERP: vi.fn(),
  getCompetitors: vi.fn(),
  getBacklinks: mocks.getBacklinks,
  getBacklinkHistory: vi.fn(),
  getBacklinkDetails: vi.fn(),
  getDomainMetrics: vi.fn(),
  getKeywordDifficulty: vi.fn(),
  getLocalPackRank: vi.fn(),
  getGoogleMapsResults: vi.fn(),
  getAIVisibility: vi.fn(),
  getContentOptimization: vi.fn(),
  generateSEOMissions: vi.fn(),
  refreshSEOCache: vi.fn(),
}));

vi.mock("../services/llm-visibility.js", () => ({
  checkLLMVisibility: vi.fn(),
}));

vi.mock("../services/store.js", () => ({
  store: { logActivity: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import seoRouter from "./seo.js";

describe("Local SEO citations availability", () => {
  const source = readFileSync(path.join(import.meta.dirname ?? __dirname, "seo.ts"), "utf8");
  const route = source.split('router.get("/local-seo/citations",')[1]?.split("\n});")[0] ?? "";
  const dashboard = readFileSync(new URL("../../../flowpoint-export/dashboard.js", import.meta.url), "utf8");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unknown citation metrics without calling DataForSEO", async () => {
    const app = express();
    app.use("/api", seoRouter);

    const response = await request(app).get("/api/local-seo/citations?domain=example.test");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      domain: "example.test",
      available: false,
      reason: "citation_provider_required",
      totalCitations: null,
      activeCitations: null,
      napConsistency: null,
      citations: [],
    });
    expect(mocks.getBacklinks).not.toHaveBeenCalled();
  });

  it("does not present backlink data as verified local citations or NAP health", () => {
    expect(route).toContain('reason: "citation_provider_required"');
    expect(route).toContain("available: false");
    expect(route).toMatch(/totalCitations:\s*null/);
    expect(route).toMatch(/activeCitations:\s*null/);
    expect(route).toMatch(/napConsistency:\s*null/);
    expect(route).not.toMatch(/getBacklinks|hasPhone:\s*true|hasAddress:\s*true|hasWebsite:\s*true|napConsistency:\s*85/);
  });

  it("shows an unavailable state and gates NAP score display on verified citations", () => {
    expect(dashboard).toContain("Données de citations non disponibles");
    expect(dashboard).toContain("apiFetch('/api/local-seo/citations')");
    expect(dashboard).toContain("citationData.citations.every(c => c?.verified === true)");
    expect(dashboard).toContain("typeof citationData.napConsistency === 'number'");
    expect(dashboard).not.toContain("Liens NAP cohérents sur 15 annuaires");
  });
});
