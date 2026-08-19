import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchUrlContent = vi.fn();

vi.mock("./url-fetcher.js", () => ({ fetchUrlContent }));

import { crawlSite } from "./site-crawler.js";

describe("crawlSite — robots.txt gate", () => {
  beforeEach(() => {
    fetchUrlContent.mockReset();
  });

  it("loads robots.txt before the supplied URL and never downloads a disallowed start page", async () => {
    fetchUrlContent.mockImplementation(async (url: string) => {
      if (url === "https://example.com/robots.txt") {
        return { ok: true, url, bodyText: "User-agent: FlowpointBot\nDisallow: /" };
      }
      throw new Error(`The crawler must not fetch ${url}`);
    });

    const result = await crawlSite("https://example.com/private");

    expect(result).toMatchObject({
      ok: false,
      pagesAttempted: 0,
      pagesFetched: 0,
      blockedByRobots: 1,
      error: "La page demandée est exclue par robots.txt",
    });
    expect(fetchUrlContent).toHaveBeenCalledTimes(1);
    expect(fetchUrlContent).toHaveBeenCalledWith(
      "https://example.com/robots.txt",
      { timeoutMs: 4_000 },
    );
  });
});