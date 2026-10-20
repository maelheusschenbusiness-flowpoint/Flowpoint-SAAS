import { afterEach, describe, expect, it, vi } from "vitest";

const mockedPool = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
}));

vi.mock("@workspace/db", () => ({ pool: mockedPool }));

import { getGoogleMapsResultsAtCoordinate } from "./dataforseo-service.js";

describe("DataForSEO local coordinate response mapping", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps Maps results and preserves provider ranks from a representative response", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "fixture-login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "fixture-password");
    const fixture = {
      tasks: [{
        status_code: 20000,
        status_message: "Ok.",
        result: [{
          items: [
            { type: "maps_search", title: "Cafe Rene Centre", rank_absolute: 4 },
            { type: "local_pack", title: "Boulangerie Nord", rank_absolute: 2 },
            { type: "organic", title: "Cafe Rene Centre", rank_absolute: 1 },
            { type: "maps_search", title: "Cafe Rene Centre", rank_absolute: 0 },
          ],
        }],
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const mapped = await getGoogleMapsResultsAtCoordinate("plombier", 50.85, 4.35, "org-fixture");

    expect(mapped).toEqual({
      results: [
        { name: "Cafe Rene Centre", rank: 4 },
        { name: "Boulangerie Nord", rank: 2 },
      ],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual([{
      keyword: "plombier",
      location_coordinate: "50.8500000,4.3500000,17z",
      language_code: "fr",
      depth: 20,
    }]);
  });

  it("returns an explicit provider error for HTTP 200 with a failed DataForSEO task", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "fixture-login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "fixture-password");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tasks: [{ status_code: 40501, status_message: "Invalid request.", result: null }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(getGoogleMapsResultsAtCoordinate("plombier", 50.85, 4.35, "org-fixture"))
      .resolves.toEqual({ results: [], error: "provider_error" });
  });
});
