import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resendSendMock, smtpSendMock } = vi.hoisted(() => ({
  resendSendMock: vi.fn(),
  smtpSendMock: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSendMock };
  },
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: smtpSendMock })),
  },
}));

import { mailer } from "./mailer.js";

const envKeys = [
  "NODE_ENV",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "SMTP_HOST",
  "SMTP_PASS",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "TEST_MAIL_DIR",
  "ENABLE_TEST_MAILER",
  "ENABLE_HOSTED_TEST_EMAIL_DELIVERY",
  "TEST_EMAIL_RECIPIENT_ALLOWLIST",
  "RENDER",
  "FLY_APP_NAME",
  "REPLIT_DEPLOYMENT",
  "FLOWPOINT_AUTOMATED_TESTS",
  "VITEST",
  "NODE_TEST_CONTEXT",
  "JEST_WORKER_ID",
  "CI",
] as const;
const previousEnv = new Map<string, string | undefined>();

function activationEmail(to = "signup@example.net") {
  return mailer.sendActivationMagicLink({
    to,
    name: "New user",
    plan: "standard",
    magicLinkUrl: "https://app.example.test/login-verify.html?token=test",
    isTrial: true,
    lookupByEmail: false,
  });
}

describe("mailer in hosted test runtimes", () => {
  beforeEach(() => {
    previousEnv.clear();
    for (const key of envKeys) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env["NODE_ENV"] = "test";
    process.env["RENDER"] = "true";
    process.env["RESEND_API_KEY"] = "mock-resend-key";
    process.env["ENABLE_HOSTED_TEST_EMAIL_DELIVERY"] = "true";
    process.env["TEST_EMAIL_RECIPIENT_ALLOWLIST"] = "signup@example.net";
    process.env["FLOWPOINT_AUTOMATED_TESTS"] = "false";
    process.env["CI"] = "false";
    process.env["SMTP_HOST"] = "smtp.invalid";
    process.env["SMTP_PASS"] = "mock-smtp-password";
    resendSendMock.mockReset().mockResolvedValue({
      data: { id: "mock-resend-email-id" },
      error: null,
    });
    smtpSendMock.mockReset().mockResolvedValue({ messageId: "mock-smtp-id" });
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses mocked Resend only for an explicitly enabled, allowlisted hosted TEST recipient", async () => {
    await expect(activationEmail()).resolves.toEqual({
      ok: true,
      id: "mock-resend-email-id",
    });
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(smtpSendMock).not.toHaveBeenCalled();
  });

  it("fails closed when hosted TEST delivery is not explicitly enabled", async () => {
    delete process.env["ENABLE_HOSTED_TEST_EMAIL_DELIVERY"];
    await expect(activationEmail()).resolves.toEqual({
      ok: false,
      error: "TEST_MAILER_NOT_ENABLED",
    });
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(smtpSendMock).not.toHaveBeenCalled();
  });

  it("rejects recipients outside the exact TEST allowlist", async () => {
    await expect(activationEmail("other@example.net")).resolves.toEqual({
      ok: false,
      error: "TEST_MAILER_NOT_ENABLED",
    });
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(smtpSendMock).not.toHaveBeenCalled();
  });

  it("blocks provider delivery during automated tests despite hosted TEST configuration", async () => {
    process.env["FLOWPOINT_AUTOMATED_TESTS"] = "true";
    process.env["CI"] = "true";
    await expect(activationEmail()).resolves.toEqual({
      ok: false,
      error: "TEST_MAILER_NOT_ENABLED",
    });
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(smtpSendMock).not.toHaveBeenCalled();
  });

  it("does not fall back to SMTP when Resend fails in hosted TEST", async () => {
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: { message: "mock Resend failure" },
    });
    await expect(activationEmail()).resolves.toEqual({
      ok: false,
      error: "mock Resend failure",
    });
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(smtpSendMock).not.toHaveBeenCalled();
  });

  it("keeps local unit-test runs blocked even when mail settings are present", async () => {
    delete process.env["RENDER"];
    process.env["FLOWPOINT_AUTOMATED_TESTS"] = "true";
    await expect(activationEmail()).resolves.toEqual({
      ok: false,
      error: "TEST_MAILER_NOT_ENABLED",
    });
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(smtpSendMock).not.toHaveBeenCalled();
  });
});
