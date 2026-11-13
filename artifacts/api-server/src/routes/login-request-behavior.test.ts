import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_REQUEST_ACCEPTED_RESPONSE } from "../services/login-request-policy.js";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  loadOrgSettings: vi.fn(),
  loginLinkSend: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.poolConnect,
  },
}));

vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: mocks.loadOrgSettings,
}));

vi.mock("../lib/logger.js", () => ({ logger: mocks.logger }));
vi.mock("../services/mailer.js", () => ({
  mailer: { sendLoginLink: mocks.loginLinkSend },
  captureTestMail: vi.fn(),
}));
vi.mock("../services/store.js", () => ({ store: {} }));
vi.mock("../services/funnel-events.js", () => ({
  enregistrerEtape: vi.fn(),
  normaliserAttributionFunnel: vi.fn(),
}));
vi.mock("../services/sessions.js", () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  invalidateAllSessions: vi.fn(),
  SESSION_TTL_MS: 60_000,
}));
vi.mock("../middlewares/rateLimiter.js", () => ({
  authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/stripe-factory.js", () => ({
  createStripeClient: vi.fn(),
  getStripeKey: vi.fn(),
}));
vi.mock("../lib/fp-lid.js", () => ({ normalizeFpLid: vi.fn() }));
vi.mock("../lib/conversion-events.js", () => ({ stableEventId: vi.fn() }));
vi.mock("../lib/conversion-outbox.js", () => ({ queueConversionEvent: vi.fn() }));

const { default: authRouter } = await import("./auth.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", authRouter);
  return app;
}

function readyMailTokenStore() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  mocks.poolConnect.mockResolvedValue(client);
  return client;
}

function tokenCleanupQueryCount() {
  return mocks.poolQuery.mock.calls.filter(([sql]) =>
    String(sql).includes("DELETE FROM magic_link_tokens"),
  ).length;
}

describe("POST /api/auth/login-request", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REPLIT_DEV_DOMAIN", "");
    vi.stubEnv("PUBLIC_BASE_URL", "https://flowpoint-test.example.test");
    vi.stubEnv("RESEND_API_KEY", "test-only-placeholder");
    vi.stubEnv("RESEND_FROM", "FlowPoint <noreply@example.test>");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_PASS", "");
    vi.stubEnv("TEST_MAIL_DIR", "");
    vi.stubEnv("ALLOWED_EMAILS", "");
    vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "");

    mocks.poolQuery.mockResolvedValue({ rows: [{ status: "active" }] });
    mocks.poolConnect.mockReset();
    mocks.loadOrgSettings.mockResolvedValue(null);
    mocks.loginLinkSend.mockReset().mockResolvedValue({ ok: true, id: "mailer-test-id" });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the same neutral body when no account exists and sends no email", async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    mocks.loadOrgSettings.mockResolvedValue(null);

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "unknown@example.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    expect(mocks.poolConnect).not.toHaveBeenCalled();
    expect(mocks.loginLinkSend).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).toContain("aucun compte");
  });

  it("returns the same neutral body when the email is outside the allowlist", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "allowed@example.test");

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "not-allowed@example.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.loginLinkSend).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).toContain("not on allowlist");
  });

  it("does not reveal pending, suspended or inactive account states", async () => {
    for (const status of ["pending", "suspended", "disabled"]) {
      mocks.poolQuery.mockResolvedValue({ rows: [{ status }] });

      const response = await request(makeApp())
        .post("/api/auth/login-request")
        .send({ email: "qa@example.test" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    }

    mocks.poolQuery.mockResolvedValue({ rows: [] });
    mocks.loadOrgSettings.mockResolvedValue({ subscriptionStatus: "pending_billing" });
    const legacyResponse = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "legacy@example.test" });

    expect(legacyResponse.status).toBe(200);
    expect(legacyResponse.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    expect(mocks.poolConnect).not.toHaveBeenCalled();
    expect(mocks.loginLinkSend).not.toHaveBeenCalled();
  });

  it("uses the same neutral response after the shared mailer accepts the message", async () => {
    readyMailTokenStore();

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "qa@example.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    expect(mocks.loginLinkSend).toHaveBeenCalledOnce();
    expect(mocks.loginLinkSend.mock.calls[0][0]).toMatchObject({
      to: "qa@example.test",
      magicLinkUrl: expect.stringContaining("/login-verify.html?token="),
    });
    expect(mocks.loginLinkSend.mock.calls[0][0]).not.toHaveProperty("from");
    expect(mocks.loginLinkSend.mock.calls[0][0]).not.toHaveProperty("subject");
    expect(JSON.stringify(mocks.logger.info.mock.calls)).toContain("email accepted by transport");
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain("qa@example.test");
  });

  it("keeps a suppressed-recipient/provider rejection neutral and logs the failure", async () => {
    readyMailTokenStore();
    mocks.loginLinkSend.mockResolvedValue({
      ok: false,
      error: "EMAIL_SEND_FAILED: Recipient qa@example.test is suppressed",
    });

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "qa@example.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    expect(JSON.stringify(response.body)).not.toContain("qa@example.test");
    expect(JSON.stringify(response.body)).not.toContain("suppressed");
    expect(JSON.stringify(mocks.logger.error.mock.calls)).toContain("login-request: email delivery failed");
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("qa@example.test");
    expect(tokenCleanupQueryCount()).toBe(1);
  });

  it("keeps a thrown shared-mailer error neutral, logs it and removes its token", async () => {
    readyMailTokenStore();
    mocks.loginLinkSend.mockRejectedValue(new Error("network failure for qa@example.test"));

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "qa@example.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    expect(JSON.stringify(response.body)).not.toContain("qa@example.test");
    expect(tokenCleanupQueryCount()).toBe(1);
  });

  it("keeps SMTP delivery errors neutral, logs them and removes their token", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "smtp.example.test");
    vi.stubEnv("SMTP_PASS", "test-only-placeholder");
    readyMailTokenStore();
    mocks.loginLinkSend.mockResolvedValue({
      ok: false,
      error: "SMTP_SEND_FAILED: SMTP rejected qa@example.test",
    });

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "qa@example.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    expect(JSON.stringify(response.body)).not.toContain("qa@example.test");
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("qa@example.test");
    expect(JSON.stringify(mocks.logger.error.mock.calls)).toContain("SMTP_SEND_FAILED");
    expect(mocks.loginLinkSend).toHaveBeenCalledOnce();
    expect(tokenCleanupQueryCount()).toBe(1);
  });

  it("logs token cleanup failure while keeping the response neutral", async () => {
    readyMailTokenStore();
    mocks.loginLinkSend.mockRejectedValue(new Error("delivery failure"));
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM magic_link_tokens")) {
        throw new Error("cleanup database unavailable");
      }
      return { rows: [{ status: "active" }] };
    });

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "qa@example.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    expect(JSON.stringify(mocks.logger.error.mock.calls)).toContain("MAGIC_TOKEN_CLEANUP_FAILED");
    expect(JSON.stringify(response.body)).not.toContain("qa@example.test");
  });

  it("returns an explicit service error when the legacy account lookup throws", async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    mocks.loadOrgSettings.mockRejectedValue(new Error("database lookup failed"));

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "qa@example.test" });

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("temporairement indisponible");
    expect(mocks.poolConnect).not.toHaveBeenCalled();
    expect(mocks.loginLinkSend).not.toHaveBeenCalled();
  });

  it("keeps a magic-token storage failure neutral and does not send email", async () => {
    mocks.poolConnect.mockRejectedValue(new Error("token store unavailable"));

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "qa@example.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(LOGIN_REQUEST_ACCEPTED_RESPONSE);
    expect(mocks.loginLinkSend).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.logger.error.mock.calls)).toContain("MAGIC_TOKEN_STORE_FAILED");
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("qa@example.test");
  });

  it("returns the transport error before account lookup or token creation", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("TEST_MAIL_DIR", "/tmp/test-mail-is-not-a-production-transport");

    const response = await request(makeApp())
      .post("/api/auth/login-request")
      .send({ email: "qa@example.test" });

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("non configuré");
    expect(mocks.poolConnect).not.toHaveBeenCalled();
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.loginLinkSend).not.toHaveBeenCalled();
  });
});
