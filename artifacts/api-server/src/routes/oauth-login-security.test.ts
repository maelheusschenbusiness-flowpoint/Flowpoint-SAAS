/**
 * C-07 — connexions OAuth : `state` lie a un cookie, usage unique, expiration ;
 * e-mail verifie obligatoire (Google, GitHub) ; Apple : nonce, iss/exp, e-mail
 * pris uniquement dans le jeton signe. Tout est mocke : aucun appel reseau.
 */
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { generateKeyPairSync, createSign } from "crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  loadOrgSettings: vi.fn(),
  upsertOrgSettings: vi.fn(),
  fetchBorne: vi.fn(),
  createSession: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@workspace/db", () => ({ pool: { query: mocks.poolQuery, connect: mocks.poolConnect } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: vi.fn() }; } }));
vi.mock("nodemailer", () => ({ createTransport: vi.fn(() => ({ sendMail: vi.fn() })) }));
vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: mocks.loadOrgSettings,
  upsertOrgSettings: mocks.upsertOrgSettings,
}));
vi.mock("../lib/logger.js", () => ({ logger: mocks.logger }));
vi.mock("../lib/fetch-borne.js", () => ({
  fetchBorne: mocks.fetchBorne,
  DELAIS: { identite: 1000 },
}));
vi.mock("../services/mailer.js", () => ({ captureTestMail: vi.fn() }));
vi.mock("../services/store.js", () => ({ store: {} }));
vi.mock("../services/funnel-events.js", () => ({ enregistrerEtape: vi.fn(), normaliserAttributionFunnel: vi.fn() }));
vi.mock("../services/sessions.js", () => ({
  createSession: mocks.createSession,
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  invalidateAllSessions: vi.fn(),
  SESSION_TTL_MS: 60_000,
}));
vi.mock("../middlewares/rateLimiter.js", () => ({ authRateLimit: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../middlewares/requireAuth.js", () => ({ requireAuth: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../services/stripe-factory.js", () => ({ createStripeClient: vi.fn(), getStripeKey: vi.fn() }));
vi.mock("../lib/conversion-events.js", () => ({ stableEventId: vi.fn() }));
vi.mock("../lib/conversion-outbox.js", () => ({ queueConversionEvent: vi.fn() }));

const { default: authRouter } = await import("./auth.js");
const { _resetConsumedOAuthStates, OAUTH_STATE_TTL_MS } = await import("../services/oauth-state.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use("/api", authRouter);
  return app;
}

function jsonRes(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

/** Extrait "nom=valeur" des Set-Cookie pour le rejouer. */
function cookieHeader(res: request.Response, name: string): string {
  const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const c = raw.find((x) => x.startsWith(`${name}=`));
  if (!c) throw new Error(`cookie ${name} absent`);
  return c.split(";")[0]!;
}

function stateOf(res: request.Response): string {
  return new URL(res.headers["location"] as string).searchParams.get("state") ?? "";
}

beforeEach(() => {
  _resetConsumedOAuthStates();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "gid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "gsecret");
  vi.stubEnv("GITHUB_CLIENT_ID", "ghid");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "ghsecret");
  vi.stubEnv("APPLE_CLIENT_ID", "com.example.app");
  vi.stubEnv("PUBLIC_BASE_URL", "https://app.example.test");
  vi.stubEnv("ALLOWED_EMAILS", "");
  vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "");
  mocks.poolQuery.mockResolvedValue({ rows: [] });
  mocks.loadOrgSettings.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

// ──────────────────────────── Google ────────────────────────────
function googleFetch(user: Record<string, unknown>) {
  mocks.fetchBorne.mockImplementation(async (url: string) => {
    if (String(url).includes("oauth2.googleapis.com/token")) return jsonRes({ access_token: "tok" });
    if (String(url).includes("userinfo")) return jsonRes(user);
    throw new Error("appel reseau inattendu: " + url);
  });
}

describe("Google OAuth — state", () => {
  it("le login pose un cookie httpOnly et envoie un state opaque, sans JSON/plan dans l'URL", async () => {
    const res = await request(makeApp()).get("/api/auth/google/login?plan=pro&seller_code=SELLER-ABC&fp_lid=abcdefghijklmnopqrstuv");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers["location"] as string);
    const state = loc.searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(() => JSON.parse(Buffer.from(state, "base64").toString("utf8"))).toThrow();
    expect(loc.toString()).not.toContain("SELLER-ABC");
    const setCookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []).join(";");
    expect(setCookie).toMatch(/fp_oauth_google=/);
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it("deux departs donnent deux states differents", async () => {
    const a = await request(makeApp()).get("/api/auth/google/login");
    const b = await request(makeApp()).get("/api/auth/google/login");
    expect(stateOf(a)).not.toBe(stateOf(b));
  });

  it("callback sans cookie : refuse avant tout echange de code", async () => {
    const login = await request(makeApp()).get("/api/auth/google/login?plan=pro");
    const res = await request(makeApp()).get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(stateOf(login))}`);
    expect(res.headers["location"]).toContain("error=invalid_state");
    expect(mocks.fetchBorne).not.toHaveBeenCalled();
  });

  it("callback avec ancien format de state (JSON base64 forge) : refuse", async () => {
    const forged = Buffer.from(JSON.stringify({ ts: Date.now(), plan: "ultra", seller_code: "SELLER-X" })).toString("base64");
    const login = await request(makeApp()).get("/api/auth/google/login");
    const res = await request(makeApp())
      .get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(forged)}`)
      .set("Cookie", cookieHeader(login, "fp_oauth_google"));
    expect(res.headers["location"]).toContain("error=invalid_state");
    expect(mocks.fetchBorne).not.toHaveBeenCalled();
  });

  it("state ne correspondant pas au cookie : refuse", async () => {
    const a = await request(makeApp()).get("/api/auth/google/login");
    const b = await request(makeApp()).get("/api/auth/google/login");
    const res = await request(makeApp())
      .get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(stateOf(b))}`)
      .set("Cookie", cookieHeader(a, "fp_oauth_google"));
    expect(res.headers["location"]).toContain("error=invalid_state");
  });

  it("state expire : refuse", async () => {
    const login = await request(makeApp()).get("/api/auth/google/login");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + OAUTH_STATE_TTL_MS + 1000);
      const res = await request(makeApp())
        .get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(stateOf(login))}`)
        .set("Cookie", cookieHeader(login, "fp_oauth_google"));
      expect(res.headers["location"]).toContain("error=invalid_state");
    } finally {
      vi.useRealTimers();
    }
  });

  it("usage unique : le rejeu du meme couple cookie/state est refuse", async () => {
    googleFetch({ sub: "1", email: "new@example.test", email_verified: true, given_name: "A" });
    mocks.loadOrgSettings
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ subscriptionStatus: "pending_billing", plan: "pro" });
    mocks.poolConnect.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() });
    const login = await request(makeApp()).get("/api/auth/google/login?plan=pro");
    const cookie = cookieHeader(login, "fp_oauth_google");
    const url = `/api/auth/google/callback?code=c&state=${encodeURIComponent(stateOf(login))}`;
    const first = await request(makeApp()).get(url).set("Cookie", cookie);
    expect(first.headers["location"]).not.toContain("invalid_state");
    const second = await request(makeApp()).get(url).set("Cookie", cookie);
    expect(second.headers["location"]).toContain("error=invalid_state");
  });

  it("le plan voyage dans le state verifie et reste dans la redirection vers signin.html", async () => {
    googleFetch({ sub: "1", email: "new@example.test", email_verified: true, given_name: "A", family_name: "B" });
    mocks.loadOrgSettings
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ subscriptionStatus: "pending_billing", plan: "pro" });
    mocks.poolConnect.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() });
    const login = await request(makeApp()).get("/api/auth/google/login?plan=pro");
    const res = await request(makeApp())
      .get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(stateOf(login))}`)
      .set("Cookie", cookieHeader(login, "fp_oauth_google"));
    const loc = new URL(res.headers["location"] as string);
    expect(loc.pathname).toBe("/signin.html");
    expect(loc.searchParams.get("plan")).toBe("pro");
    expect(loc.searchParams.get("google_signup")).toBe("1");
    expect(loc.searchParams.get("pre_reg_token")).toBeTruthy();
  });
});

describe("Google OAuth — e-mail verifie", () => {
  async function runCallback(user: Record<string, unknown>) {
    googleFetch(user);
    const login = await request(makeApp()).get("/api/auth/google/login");
    return request(makeApp())
      .get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(stateOf(login))}`)
      .set("Cookie", cookieHeader(login, "fp_oauth_google"));
  }

  it("email_verified=false : aucune session, aucune lecture d'organisation par e-mail", async () => {
    const res = await runCallback({ sub: "1", email: "victim@example.test", email_verified: false });
    expect(res.headers["location"]).toContain("error=email_not_verified");
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.loadOrgSettings).not.toHaveBeenCalled();
  });

  it("email_verified absent : refuse", async () => {
    const res = await runCallback({ sub: "1", email: "victim@example.test" });
    expect(res.headers["location"]).toContain("error=email_not_verified");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("pas d'e-mail (repli sur sub supprime) : refuse", async () => {
    const res = await runCallback({ sub: "123456", email_verified: true });
    expect(res.headers["location"]).toContain("error=email_not_verified");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

// ──────────────────────────── GitHub ────────────────────────────
describe("GitHub OAuth", () => {
  it("le login envoie un state et pose le cookie", async () => {
    const res = await request(makeApp()).get("/api/auth/github/login");
    expect(res.status).toBe(302);
    expect(stateOf(res).length).toBeGreaterThanOrEqual(40);
    expect(([] as string[]).concat(res.headers["set-cookie"] ?? []).join(";")).toContain("fp_oauth_github=");
  });

  it("callback sans state ni cookie : refuse, aucun echange", async () => {
    const res = await request(makeApp()).get("/api/auth/github/callback?code=c");
    expect(res.headers["location"]).toContain("error=invalid_state");
    expect(mocks.fetchBorne).not.toHaveBeenCalled();
  });

  async function ghCallback(emails: unknown, profile: Record<string, unknown> = { login: "octo", name: "Octo", email: "public@example.test" }) {
    mocks.fetchBorne.mockImplementation(async (url: string) => {
      if (String(url).includes("access_token")) return jsonRes({ access_token: "tok" });
      if (String(url).endsWith("/user/emails")) return jsonRes(emails);
      if (String(url).endsWith("/user")) return jsonRes(profile);
      throw new Error("appel reseau inattendu: " + url);
    });
    const login = await request(makeApp()).get("/api/auth/github/login");
    return request(makeApp())
      .get(`/api/auth/github/callback?code=c&state=${encodeURIComponent(stateOf(login))}`)
      .set("Cookie", cookieHeader(login, "fp_oauth_github"));
  }

  it("aucune adresse primaire verifiee : refuse (pas de repli sur login ni sur l'e-mail public)", async () => {
    const res = await ghCallback([{ email: "public@example.test", primary: true, verified: false }]);
    expect(res.headers["location"]).toContain("error=email_not_verified");
    expect(mocks.loadOrgSettings).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("l'identite est l'adresse primaire verifiee, pas le champ public de /user", async () => {
    await ghCallback([
      { email: "other@example.test", primary: false, verified: true },
      { email: "Real.Owner@Example.test", primary: true, verified: true },
    ]);
    const asked = mocks.loadOrgSettings.mock.calls.map((c) => c[0]);
    expect(asked).toContain("real.owner@example.test");
    expect(asked).not.toContain("public@example.test");
    expect(asked).not.toContain("octo");
  });
});

// ──────────────────────────── Apple ────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: "k1", alg: "RS256", use: "sig" };

function appleToken(claims: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createSign("SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url");
  return `${h}.${p}.${sig}`;
}

function nonceFromLogin(res: request.Response): string {
  return new URL(res.headers["location"] as string).searchParams.get("nonce")!;
}

describe("Apple OAuth", () => {
  const goodClaims = (nonce: string, extra: Record<string, unknown> = {}) => ({
    iss: "https://appleid.apple.com", aud: "com.example.app", sub: "apple-sub-1",
    exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000),
    nonce, email: "Apple.User@Example.test", email_verified: "true", ...extra,
  });

  function appleFetch() {
    mocks.fetchBorne.mockImplementation(async (url: string) => {
      if (String(url).includes("/auth/keys")) return jsonRes({ keys: [jwk] });
      throw new Error("appel reseau inattendu: " + url);
    });
  }

  it("le login envoie state ET nonce, et pose le cookie", async () => {
    const res = await request(makeApp()).get("/api/auth/apple/login");
    expect(stateOf(res).length).toBeGreaterThanOrEqual(40);
    expect(nonceFromLogin(res).length).toBeGreaterThanOrEqual(40);
    expect(([] as string[]).concat(res.headers["set-cookie"] ?? []).join(";")).toContain("fp_oauth_apple=");
  });

  it("callback sans cookie / state : refuse", async () => {
    const res = await request(makeApp()).post("/api/auth/apple/callback").type("form").send({ code: "c", state: "x", id_token: "a.b.c" });
    expect(res.headers["location"]).toContain("error=invalid_state");
    expect(mocks.fetchBorne).not.toHaveBeenCalled();
  });

  async function post(claims: (nonce: string) => Record<string, unknown>, userJson?: string) {
    appleFetch();
    const login = await request(makeApp()).get("/api/auth/apple/login");
    const nonce = nonceFromLogin(login);
    return request(makeApp())
      .post("/api/auth/apple/callback")
      .set("Cookie", cookieHeader(login, "fp_oauth_apple"))
      .type("form")
      .send({ code: "c", state: stateOf(login), id_token: appleToken(claims(nonce)), ...(userJson ? { user: userJson } : {}) });
  }

  it("jeton valide : identite prise dans le jeton signe (e-mail en minuscules)", async () => {
    await post((n) => goodClaims(n));
    expect(mocks.loadOrgSettings.mock.calls.map((c) => c[0])).toContain("apple.user@example.test");
  });

  it("l'e-mail du champ `user` (non signe) n'est jamais utilise", async () => {
    await post((n) => goodClaims(n, { email: undefined, email_verified: undefined }),
      JSON.stringify({ name: { firstName: "Eve" }, email: "victim@example.test" }));
    expect(mocks.loadOrgSettings).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ["nonce errone", (n: string) => goodClaims(n + "x")],
    ["nonce absent", (n: string) => goodClaims(n, { nonce: undefined })],
    ["iss errone", (n: string) => goodClaims(n, { iss: "https://evil.example" })],
    ["jeton expire", (n: string) => goodClaims(n, { exp: Math.floor(Date.now() / 1000) - 3600 })],
    ["aud errone", (n: string) => goodClaims(n, { aud: "other.app" })],
    ["email non verifie", (n: string) => goodClaims(n, { email_verified: "false" })],
  ])("%s : aucune session", async (_label, claims) => {
    const res = await post(claims);
    expect(res.headers["location"]).toContain("error=apple_auth_failed");
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.loadOrgSettings).not.toHaveBeenCalled();
  });
});
