import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./google-service.js", () => ({ publishGBPPost: vi.fn() }));

import { pool } from "@workspace/db";
import { publishGBPPost } from "./google-service.js";
import { publishPost, type GBPPost } from "./gbp-posting-service.js";

const query = vi.mocked(pool.query);
const post = {
  id: "post-1", org_id: "org-1", location_id: "loc-1", location_name: "Clinic",
  content: "Open this week", cta_type: null, cta_url: null, status: "draft", post_type: "standard",
} as GBPPost;
const result = (rows: unknown[]) => ({ rows, rowCount: rows.length }) as never;

describe("GBP post publishing", () => {
  beforeEach(() => {
    query.mockReset();
    vi.mocked(publishGBPPost).mockReset();
  });

  it("publishes only to a verified GBP location belonging to the organization", async () => {
    query
      .mockResolvedValueOnce(result([post]))
      .mockResolvedValueOnce(result([{ resource_name: "accounts/acct-1/locations/place-1" }]))
      .mockResolvedValueOnce(result([]));
    vi.mocked(publishGBPPost).mockResolvedValue({ ok: true, postName: "accounts/acct-1/locations/place-1/localPosts/post-9" });

    const published = await publishPost("org-1", "post-1");

    expect(published.ok).toBe(true);
    expect(published.googlePostId).toContain("localPosts/post-9");
    expect(publishGBPPost).toHaveBeenCalledWith("org-1", "accounts/acct-1/locations/place-1", { summary: "Open this week" });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining("id=$1 AND org_id=$2"), ["post-1", "org-1"]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining("org_id=$1"), ["org-1", "loc-1"]);
  });

  it("refuses an unverified location and never calls Google", async () => {
    query
      .mockResolvedValueOnce(result([post]))
      .mockResolvedValueOnce(result([{ resource_name: "not-a-google-location-resource" }]))
      .mockResolvedValueOnce(result([]));

    await expect(publishPost("org-1", "post-1")).rejects.toThrow("GBP_LOCATION_NOT_VERIFIED_FOR_ORG");
    expect(publishGBPPost).not.toHaveBeenCalled();
  });
});
