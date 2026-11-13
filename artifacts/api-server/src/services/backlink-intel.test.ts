import { describe, expect, it } from "vitest";
import { normalizeBacklinkDetails, normalizeBacklinkHistoryItems } from "./dataforseo-service.js";

describe("backlink history normalization", () => {
  it("sorts actual monthly observations and preserves missing metrics as unknown", () => {
    const result = normalizeBacklinkHistoryItems([
      { date: "2026-10-01 00:00:00 +00:00", backlinks: 28, new_backlinks: 4, lost_backlinks: 1 },
      { date: "2026-09-01 00:00:00 +00:00", backlinks: 25, new_backlinks: null, lost_backlinks: 2, referring_domains: 8 },
      { date: "not-a-date", backlinks: 999 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ date: "2026-09-01", backlinks: 25, new_backlinks: null, referring_domains: 8 });
    expect(result[1]).toMatchObject({ date: "2026-10-01", backlinks: 28, new_backlinks: 4, lost_backlinks: 1 });
  });

  it("keeps only provider-returned link details and does not synthesize records", () => {
    const result = normalizeBacklinkDetails([
      { url_from: "https://source.example/page", domain_from: "source.example", url_to: "https://target.example/", anchor: "target", dofollow: true, rank: 42 },
      { rank: 90 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url_from: "https://source.example/page",
      domain_from: "source.example",
      url_to: "https://target.example/",
      anchor: "target",
      dofollow: true,
      rank: 42,
    });
  });
});
