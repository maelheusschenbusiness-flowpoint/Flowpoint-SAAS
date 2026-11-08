/**
 * Inscription Google — A-07 (membre invite), A-08 (e-mail normalise),
 * A-10 (adresse factice), A-11 (e-mail hors URL) et transaction de
 * pending_signups. Tout est mocke : aucune base, aucun reseau.
 */
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
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
vi.mock("../lib/fetch-borne.js", () => ({ fetchBorne: mocks.fetchBorne, DELAIS: { identite: 1000 } }));
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
const { _resetConsumedOAuthStates } = await import("../services/oauth-state.js");

const MEMBER_ORG = "22222222-2222-4222-8222-222222222222";
const USER_UUID = "33333333-3333-4333-8333-333333333333";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", authRouter);
  return app;
}
const jsonRes = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

async function runGoogleCallback(user: Record<string, unknown>, plan = "pro") {
  mocks.fetchBorne.mockImplementation(async (url: string) => {
    if (String(url).includes("oauth2.googleapis.com/token")) return jsonRes({ access_token: "tok" });
    if (String(url).includes("userinfo")) return jsonRes(user);
    throw new Error("appel reseau inattendu: " + url);
  });
  const login = await request(makeApp()).get(`/api/auth/google/login?plan=${plan}`);
  const state = new URL(login.headers["location"] as string).searchParams.get("state")!;
  const cookie = ([] as string[]).concat(login.headers["set-cookie"] ?? []).find((c) => c.startsWith("fp_oauth_google="))!.split(";")[0]!;
  return request(makeApp()).get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(state)}`).set("Cookie", cookie);
}

/** Pool dont les reponses dependent du SQL ; `users` / `members` configurables. */
function configurePool(opts: { user?: { id: string; status: string } | null; member?: { organization_id: string; role: string } | null }) {
  mocks.poolQuery.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM users")) return { rows: opts.user ? [opts.user] : [] };
    if (q.includes("FROM organization_members")) return { rows: opts.member ? [opts.member] : [] };
    return { rows: [] }; // organizations : aucune org detenue
  });
}

function makeClient(failInsertWith?: { code: string }) {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      log.push({ sql: String(sql), params });
      if (failInsertWith && String(sql).includes("INSERT INTO pending_signups")) throw Object.assign(new Error("dup"), failInsertWith);
      if (String(sql).includes("UPDATE pending_signups")) return { rows: [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  mocks.poolConnect.mockResolvedValue(client);
  return { client, log };
}

beforeEach(() => {
  _resetConsumedOAuthStates();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "gid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "gsecret");
  vi.stubEnv("PUBLIC_BASE_URL", "https://app.example.test");
  vi.stubEnv("ALLOWED_EMAILS", "");
  vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "");
  mocks.loadOrgSettings
    .mockResolvedValueOnce(null)
    .mockResolvedValue({ subscriptionStatus: "pending_billing", plan: "pro" });
});
afterEach(() => vi.unstubAllEnvs());

const googleUser = { sub: "1", email: "New.User@Example.test", email_verified: true, given_name: "Ada", family_name: "Lovelace" };

describe("A-07 — compte existant non traite comme nouvelle inscription", () => {
  it("membre invite actif : connexion avec SON role, aucun signup cree", async () => {
    configurePool({ user: { id: USER_UUID, status: "active" }, member: { organization_id: MEMBER_ORG, role: "member" } });
    const { log } = makeClient();
    const res = await runGoogleCallback(googleUser);
    expect(res.headers["location"]).toContain("/dashboard.html");
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({
      orgId: MEMBER_ORG, userUuid: USER_UUID, role: "member", email: "new.user@example.test",
    }));
    expect(log.some((l) => l.sql.includes("pending_signups"))).toBe(false);
    expect(mocks.upsertOrgSettings).not.toHaveBeenCalled();
  });

  it("utilisateur actif sans organisation : refuse, aucun signup, aucune session", async () => {
    configurePool({ user: { id: USER_UUID, status: "active" }, member: null });
    const { log } = makeClient();
    const res = await runGoogleCallback(googleUser);
    expect(res.headers["location"]).toContain("/login.html?error=no_active_org");
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(log.some((l) => l.sql.includes("pending_signups"))).toBe(false);
    expect(mocks.upsertOrgSettings).not.toHaveBeenCalled();
  });

  it("utilisateur suspendu : refuse", async () => {
    configurePool({ user: { id: USER_UUID, status: "suspended" }, member: null });
    makeClient();
    const res = await runGoogleCallback(googleUser);
    expect(res.headers["location"]).toContain("error=access_denied");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("users.status='pending' (inscription reprise) : le signup continue", async () => {
    configurePool({ user: { id: USER_UUID, status: "pending" }, member: null });
    const { log } = makeClient();
    const res = await runGoogleCallback(googleUser);
    expect(res.headers["location"]).toContain("/signin.html?google_signup=1");
    expect(log.some((l) => l.sql.includes("INSERT INTO pending_signups"))).toBe(true);
  });
});

describe("A-08 / A-10 / A-11 / transaction — creation du pre-enregistrement", () => {
  it("e-mail normalise partout ; pending_signups sans adresse factice ; e-mail absent de l'URL", async () => {
    configurePool({ user: null });
    const { log } = makeClient();
    const res = await runGoogleCallback(googleUser, "ultra");

    // A-08
    const insert = log.find((l) => l.sql.includes("INSERT INTO pending_signups"))!;
    expect(insert.params[1]).toBe("new.user@example.test");
    expect(mocks.loadOrgSettings.mock.calls.every((c) => c[0] === "new.user@example.test")).toBe(true);
    const ownerQuery = mocks.poolQuery.mock.calls.find((c) => String(c[0]).includes("FROM organizations"))!;
    expect(String(ownerQuery[0])).toContain("lower(owner_email)");
    expect(ownerQuery[1]).toEqual(["new.user@example.test"]);

    // A-10
    expect(insert.sql).not.toMatch(/'FR'|'—'|'00000'/);
    expect(insert.sql).toMatch(/NULL,NULL,NULL,NULL/);

    // A-11 : contrat de redirection conserve (jeton + plan), sans donnees personnelles
    const loc = new URL(res.headers["location"] as string);
    expect(loc.pathname).toBe("/signin.html");
    expect(loc.searchParams.get("google_signup")).toBe("1");
    expect(loc.searchParams.get("plan")).toBe("ultra");
    expect(loc.searchParams.get("pre_reg_token")).toBe(insert.params[0]);
    expect(loc.search).not.toMatch(/example\.test|Ada|Lovelace|email|first_name|last_name/i);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("UPDATE puis INSERT dans une seule transaction verrouillee par e-mail", async () => {
    configurePool({ user: null });
    const { client, log } = makeClient();
    await runGoogleCallback(googleUser);
    const seq = log.map((l) => l.sql.replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" "));
    expect(seq).toEqual([
      "BEGIN", "SELECT pg_advisory_xact_lock(hashtext(lower($1)))".split(" ").slice(0, 3).join(" "),
      "UPDATE pending_signups SET", "INSERT INTO pending_signups", "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("23505 a l'INSERT : ROLLBACK, client libere, retry propose, aucune session", async () => {
    configurePool({ user: null });
    const { client, log } = makeClient({ code: "23505" });
    const res = await runGoogleCallback(googleUser);
    expect(log.some((l) => l.sql.trim() === "ROLLBACK")).toBe(true);
    expect(log.some((l) => l.sql.trim() === "COMMIT")).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(res.headers["location"]).toContain("/signin.html?error=google_signup_retry");
    expect(res.headers["location"]).toContain("plan=pro");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
