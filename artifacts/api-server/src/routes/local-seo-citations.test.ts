import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Local SEO citations availability", () => {
  const source = readFileSync(path.join(import.meta.dirname ?? __dirname, "seo.ts"), "utf8");
  const route = source.split('router.get("/local-seo/citations",')[1]?.split("\n});")[0] ?? "";
  const dashboard = readFileSync(new URL("../../../flowpoint-export/dashboard.js", import.meta.url), "utf8");

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
