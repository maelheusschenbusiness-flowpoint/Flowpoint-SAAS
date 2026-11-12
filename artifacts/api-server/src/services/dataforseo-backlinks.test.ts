import { describe, expect, it } from "vitest";
    import { normalizeBacklinksSummary } from "./dataforseo-service.js";

    describe("backlinks provider normalization", () => {
      it("preserves real zero metrics while mapping the frontend contract", () => {
        expect(normalizeBacklinksSummary({ backlinks: 0, referring_domains: 0, rank: 0, dofollow_links: 0 })).toMatchObject({ available: true, totalBacklinks: 0, totalDomains: 0, domainRating: 0 });
      });
      it("does not turn a missing provider result into zero metrics", () => {
        expect(normalizeBacklinksSummary({})).toBeNull();
      });
      it("keeps omitted metrics unavailable instead of coercing them to zero", () => {
        expect(normalizeBacklinksSummary({ backlinks: "12" })).toMatchObject({ available: true, totalBacklinks: 12, totalDomains: null, domainRating: null });
      });
    });
    