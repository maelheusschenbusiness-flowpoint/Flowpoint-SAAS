import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({
  query: vi.fn(async (_sql: string, _values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> => ({ rows: [] })),
}));
vi.mock("@workspace/db", () => ({ pool: { query } }));
vi.mock("../lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const service = await import("./gsc-oauth-service.js");
const KEY = "a".repeat(64);

beforeEach(() => {
  vi.stubEnv("GOOGLE_GSC_TOKEN_ENCRYPTION_KEY", KEY);
  vi.stubEnv("GOOGLE_GSC_CLIENT_ID", "gsc-client-id");
  vi.stubEnv("GOOGLE_GSC_CLIENT_SECRET", "test-only-secret");
  query.mockClear();
});

describe("isolated GSC OAuth", () => {
  it("uses only the read-only Search Console scope and dedicated OAuth client", () => {
    const url = new URL(service.buildGscAuthUrl("f".repeat(64)));
    expect(url.searchParams.get("client_id")).toBe("gsc-client-id");
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toContain(service.GSC_SCOPE);
    expect(scopes).toContain("openid");
    expect(scopes).toContain("email");
    expect(scopes).toHaveLength(3);
    expect(scopes).not.toContain("https://www.googleapis.com/auth/business.manage");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/analytics.readonly");
    expect(url.searchParams.get("redirect_uri")).toContain("/api/google/gsc/callback");
  });

  it("encrypts tokens with authenticated encryption and rejects tampering", () => {
    const encrypted = service.encryptGscToken("refresh-secret");
    expect(encrypted).not.toContain("refresh-secret");
    expect(service.decryptGscToken(encrypted)).toBe("refresh-secret");
    const [iv, tag, body] = encrypted.split(":");
    expect(() => service.decryptGscToken(`${iv}:${tag}:${body.slice(0, -2)}00`)).toThrow();
  });

  it("stores only a hash of single-use state with expiry and deletes it atomically on consume", async () => {
    const state = "d".repeat(64);
    await service.createGscState("org-1", state);
    expect(query.mock.calls[0][0]).toContain("gsc_oauth_states");
    expect(query.mock.calls[0][1]?.[0]).not.toBe(state);
    expect(query.mock.calls[0][0]).toContain("expires_at");
    query.mockResolvedValueOnce({ rows: [{ org_id: "org-1" }] });
    expect(await service.consumeGscState(state)).toBe("org-1");
    expect(query.mock.calls.at(-1)?.[0]).toContain("DELETE FROM gsc_oauth_states");
  });

  it("persists GSC tokens only in the dedicated table", async () => {
    await service.saveGscTokens("org-1", {
      access_token: "access", refresh_token: "refresh", expires_in: 3600,
      scope: service.GSC_SCOPE,
    }, "owner@example.test", "sc-domain:flowpoint.pro");
    expect(query.mock.calls[0][0]).toContain("gsc_oauth_tokens");
    expect(query.mock.calls[0][0]).not.toContain("google_tokens");
    expect(query.mock.calls[0][0]).not.toContain("google_accounts");
  });
});
