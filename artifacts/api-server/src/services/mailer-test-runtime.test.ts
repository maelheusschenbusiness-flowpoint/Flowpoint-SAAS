import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resendSendMock } = vi.hoisted(() => ({ resendSendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSendMock };
  },
}));

import { mailer } from "./mailer.js";

const envKeys = [
  "NODE_ENV",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "SMTP_HOST",
  "SMTP_PASS",
  "TEST_MAIL_DIR",
  "ENABLE_TEST_MAILER",
  "RENDER",
  "FLY_APP_NAME",
  "REPLIT_DEPLOYMENT",
] as const;
const previousEnv = new Map<string, string | undefined>();

function activationEmail() {
  return mailer.sendActivationMagicLink({
    to: "signup@example.net",
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
    resendSendMock.mockReset().mockResolvedValue({
      data: { id: "mock-resend-email-id" },
      error: null,
    });
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses the configured Resend transport in a hosted TEST runtime", async () => {
    await expect(activationEmail()).resolves.toEqual({
      ok: true,
      id: "mock-resend-email-id",
    });
    expect(resendSendMock).toHaveBeenCalledTimes(1);
  });

  it("keeps local unit-test runs from sending real mail", async () => {
    delete process.env["RENDER"];
    await expect(activationEmail()).resolves.toEqual({
      ok: false,
      error: "TEST_MAILER_NOT_ENABLED",
    });
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});
