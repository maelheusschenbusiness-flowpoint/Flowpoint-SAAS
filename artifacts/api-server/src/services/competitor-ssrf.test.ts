/**
 * C-03 — SSRF analyse de concurrents.
 *  - normalizeCompetitorUrl refuse les cibles internes des la saisie ;
 *  - l'analyse passe par le fetch garde (fetchUrlContent), jamais par fetch() brut.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchUrlContent = vi.hoisted(() => vi.fn());
vi.mock("./url-fetcher.js", async () => {
  const actual = await vi.importActual<typeof import("./url-fetcher.js")>("./url-fetcher.js");
  return { ...actual, fetchUrlContent };
});
vi.mock("./ai-provider.js", () => ({ aiChat: vi.fn() }));
vi.mock("./ai-engine.js", () => ({
  checkAIQuota: vi.fn().mockResolvedValue({ allowed: true }),
  recordCompletedUsageDeferred: vi.fn(),
  getOrCreateMonthlyUsage: vi.fn(),
}));

import { normalizeCompetitorUrl } from "./competitor-url.js";
import { runFullCompetitorAnalysis } from "./competitor-analysis-service.js";

describe("normalizeCompetitorUrl (C-03)", () => {
  it("accepte un domaine public et le normalise", () => {
    expect(normalizeCompetitorUrl("Example.com/pricing")).toEqual({ url: "https://example.com", domain: "example.com" });
  });
  it.each([
    "127.0.0.1", "http://169.254.169.254/latest/meta-data", "10.0.0.5", "192.168.1.1",
    "100.64.0.1", "http://[::1]/", "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/",
    "localhost", "http://localhost.localdomain", "db.internal", "printer.local",
    "https://user:pw@example.com", "ftp://example.com", "intranet",
  ])("refuse %s", v => {
    expect(normalizeCompetitorUrl(v)).toBeNull();
  });
});

describe("analyse de concurrent : fetch garde (C-03)", () => {
  afterEach(() => { fetchUrlContent.mockReset(); vi.restoreAllMocks(); });

  it("n'utilise jamais fetch() brut et delegue au garde SSRF pour chaque page", async () => {
    const rawFetch = vi.spyOn(globalThis, "fetch");
    fetchUrlContent.mockResolvedValue({ ok: false, url: "x", error: "SSRF bloqué : résout vers une adresse interne/privée" });
    const r = await runFullCompetitorAnalysis({
      competitorId: "c1", competitorName: "Evil", competitorUrl: "https://metadata.attacker.example",
      orgId: "org-1", orgDb: vi.fn() as never,
    });
    expect(r.ok).toBe(false);
    expect(rawFetch).not.toHaveBeenCalled();
    expect(fetchUrlContent).toHaveBeenCalledTimes(4);
    for (const call of fetchUrlContent.mock.calls) {
      expect(String(call[0])).toContain("metadata.attacker.example");
    }
  });
});
