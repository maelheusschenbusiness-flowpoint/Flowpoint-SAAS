/**
 * Jetons de session et nonces : multi-instances. Deux instances du module (vi.resetModules)
 * partagent le meme magasin (faux pool PostgreSQL avec contrainte unique), comme deux
 * instances Render partageant la base.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ nonces: new Map<string, Date>(), failing: false }));
vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (store.failing) throw new Error("db down");
      if (/^\s*INSERT INTO behavior_nonces/i.test(sql)) {
        const key = `${values[0]}|${values[1]}`;
        if (store.nonces.has(key)) return { rowCount: 0, rows: [] };
        store.nonces.set(key, values[2] as Date);
        return { rowCount: 1, rows: [] };
      }
      if (/^\s*DELETE FROM behavior_nonces/i.test(sql)) {
        for (const [k, exp] of store.nonces) if (exp.getTime() < Date.now()) store.nonces.delete(k);
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }),
  },
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type Mod = typeof import("./behavioral-session-auth.js");
async function freshInstance(): Promise<Mod> {
  vi.resetModules();
  return import("./behavioral-session-auth.js");
}

const SITE = "https://shop.example.test";
const ORIGIN = "https://shop.example.test";

beforeEach(() => { store.nonces.clear(); store.failing = false; });

describe("jeton de session sans etat", () => {
  it("emis par l'instance A, accepte par l'instance B (cle derivee du secret partage)", async () => {
    const a = await freshInstance();
    const b = await freshInstance();
    expect(a).not.toBe(b);
    const { token } = a.issueSessionToken(SITE, ORIGIN, "org-1");
    expect(b.verifySessionToken(token, SITE, ORIGIN)).toMatchObject({ orgId: "org-1", siteUrl: SITE });
  });

  it("refuse : falsifie, autre site, autre origine, expire, autre secret, entree invalide", async () => {
    const a = await freshInstance();
    const { token } = a.issueSessionToken(SITE, ORIGIN, "org-1");
    const [payload, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ s: SITE, o: ORIGIN, g: "org-2", e: Date.now() + 1e6 })).toString("base64url");
    expect(a.verifySessionToken(`${forged}.${sig}`, SITE, ORIGIN)).toBeNull();
    expect(a.verifySessionToken(`${payload}.${sig.slice(0, -2)}AA`, SITE, ORIGIN)).toBeNull();
    expect(a.verifySessionToken(token, "https://autre.example.test", ORIGIN)).toBeNull();
    expect(a.verifySessionToken(token, SITE, "https://evil.example.test")).toBeNull();
    expect(a.verifySessionToken(token, SITE, ORIGIN, Date.now() + a.SESSION_TOKEN_TTL_MS + 1)).toBeNull();
    for (const bad of [undefined, null, 42, "", "abc", ".", "a.b", "x".repeat(5000)]) {
      expect(a.verifySessionToken(bad, SITE, ORIGIN)).toBeNull();
    }
    const prev = process.env["JWT_SECRET"];
    process.env["JWT_SECRET"] = "another-secret-another-secret-another-secret";
    try {
      const other = await freshInstance();
      expect(other.verifySessionToken(token, SITE, ORIGIN)).toBeNull();
    } finally {
      if (prev === undefined) delete process.env["JWT_SECRET"]; else process.env["JWT_SECRET"] = prev;
    }
  });
});

describe("anti-rejeu des nonces partage entre instances", () => {
  it("un nonce consomme sur l'instance A est un rejeu sur l'instance B", async () => {
    const a = await freshInstance();
    const b = await freshInstance();
    const ts = Date.now();
    expect(await a.consumeNonce(SITE, "n-1", ts)).toBe(true);
    expect(await b.consumeNonce(SITE, "n-1", ts)).toBe(false);
    expect(await a.consumeNonce(SITE, "n-1", ts)).toBe(false);
    // Meme nonce sur un autre site : independant.
    expect(await b.consumeNonce("https://other.example.test", "n-1", ts)).toBe(true);
  });

  it("concurrence : le meme nonce envoye en parallele aux deux instances n'est accepte qu'une fois", async () => {
    const a = await freshInstance();
    const b = await freshInstance();
    const ts = Date.now();
    const results = await Promise.all([a, b, a, b, a, b].map(m => m.consumeNonce(SITE, "race", ts)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("nonce vide, absent ou trop long : refuse sans toucher la base", async () => {
    const a = await freshInstance();
    for (const bad of [undefined, null, "", 12, "x".repeat(200)]) expect(await a.consumeNonce(SITE, bad, Date.now())).toBe(false);
    expect(store.nonces.size).toBe(0);
  });

  it("echeance = timestamp + fenetre de tolerance ; purge des lignes expirees", async () => {
    const a = await freshInstance();
    const old = Date.now() - 2 * a.MAX_TS_SKEW_MS;
    store.nonces.set(`${SITE}|expired`, new Date(old));
    await a.consumeNonce(SITE, "fresh", Date.now());
    await Promise.resolve();
    expect(store.nonces.has(`${SITE}|expired`)).toBe(false);
    const exp = store.nonces.get(`${SITE}|fresh`)!.getTime();
    expect(exp).toBeGreaterThan(Date.now() + a.MAX_TS_SKEW_MS - 5_000);
  });

  it("base indisponible : l'erreur remonte (l'appelant repond 503, jamais d'acceptation par defaut)", async () => {
    const a = await freshInstance();
    store.failing = true;
    await expect(a.consumeNonce(SITE, "n-db", Date.now())).rejects.toThrow("db down");
  });
});
