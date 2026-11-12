import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeCompetitors, resolveMapsSearchKeyword } from "./maps-service.js";

const originalMapKey = process.env["FLOWPOINT_MAP_BACKEND"];
let requests: URL[] = [];

beforeEach(() => {
  requests = [];
  process.env["FLOWPOINT_MAP_BACKEND"] = "maps-test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const requestUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      requests.push(new URL(requestUrl));
      return new Response(JSON.stringify({
        results: [{
          place_id: "paris-place-1",
          name: "Test restaurant",
          geometry: { location: { lat: 48.8567, lng: 2.3522 } },
          rating: 4.2,
          user_ratings_total: 10,
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMapKey === undefined) delete process.env["FLOWPOINT_MAP_BACKEND"];
  else process.env["FLOWPOINT_MAP_BACKEND"] = originalMapKey;
});

describe("analyzeCompetitors search coverage", () => {
  it("uses an explicit keyword first and the organization activity only as fallback", () => {
    expect(resolveMapsSearchKeyword("  dentist  ", "restaurant")).toBe("dentist");
    expect(resolveMapsSearchKeyword("", "  restaurant  ")).toBe("restaurant");
    expect(resolveMapsSearchKeyword("", "")).toBeNull();
  });

  it.each([5_000, 20_000, 50_000])(
    "uses one Google search centre for a %i m radius",
    async radius => {
      const places = await analyzeCompetitors(48.8566, 2.3522, "restaurant", radius);

      expect(requests).toHaveLength(1);
      expect(Number(requests[0].searchParams.get("radius"))).toBe(radius);
      expect(places).toHaveLength(1);
    },
  );

  it("uses seven centres for 100 km, caps each Google request at 50 km, and deduplicates places", async () => {
    const places = await analyzeCompetitors(48.8566, 2.3522, "restaurant", 100_000);

    expect(requests).toHaveLength(7);
    expect(requests.every(url => Number(url.searchParams.get("radius")) === 50_000)).toBe(true);
    expect(places).toHaveLength(1);
    expect(new Set(places.map(place => (place as { placeId: string }).placeId)).size).toBe(1);
  });

  it("surfaces provider errors instead of silently returning an empty competitor list", async () => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => new Response(
      JSON.stringify({ status: "REQUEST_DENIED", error_message: "test denial" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    await expect(analyzeCompetitors(48.8566, 2.3522, "restaurant", 5_000))
      .rejects.toThrow("Google Places search failed (REQUEST_DENIED)");
  });
});
