import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { mailer } from "./mailer.js";

const envKeys = [
  "NODE_ENV",
  "RESEND_API_KEY", "SMTP_HOST", "SMTP_PASS", "SMTP_PORT", "SMTP_SECURE",
  "SMTP_USER", "SMTP_FROM", "TEST_MAIL_DIR", "ENABLE_TEST_MAILER",
  "RENDER", "FLY_APP_NAME", "REPLIT_DEPLOYMENT",
] as const;
const previousEnv = new Map<string, string | undefined>();

describe("Nodemailer 10 SMTP fallback — mocked, no network delivery", () => {
  const sendMail = vi.fn();
  const createTransport = vi.spyOn(nodemailer, "createTransport");

  beforeEach(() => {
    previousEnv.clear();
    for (const key of envKeys) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.NODE_ENV = "test";
    process.env.SMTP_HOST = "smtp.invalid";
    process.env.SMTP_PASS = "mock-only";
    process.env.SMTP_USER = "flowpoint-test";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "true";
    sendMail.mockReset().mockResolvedValue({ messageId: "mock-message-id" });
    createTransport.mockReturnValue({ sendMail } as never);
  });

  afterEach(() => {
    createTransport.mockReset();
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("keeps SMTP host, TLS, port, and authentication options intact", async () => {
    const result = await mailer.sendWelcome({ to: "external@example.net", name: "Test" });
    expect(result).toEqual({ ok: true, id: "mock-message-id" });
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.invalid",
      port: 465,
      secure: true,
      auth: { user: "flowpoint-test", pass: "mock-only" },
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "external@example.net",
      subject: expect.stringContaining("FlowPoint"),
      html: expect.stringContaining("Bienvenue"),
    }));
  });

  it("sends signup activation and alert notifications through the same mocked transport", async () => {
    const activation = await mailer.sendActivationMagicLink({
      to: "signup@example.net",
      name: "New user",
      plan: "standard",
      magicLinkUrl: "https://app.example.test/signin.html?token=mock",
      isTrial: false,
    });
    const notification = await mailer.sendAlertRule({
      to: "ops@example.net",
      ruleName: "Latency",
      type: "latency",
      severity: "high",
      message: "Latency threshold exceeded",
      siteUrl: "https://example.test",
    });
    expect(activation.ok).toBe(true);
    expect(notification.ok).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[0]?.[0].to).toBe("signup@example.net");
    expect(sendMail.mock.calls[1]?.[0].to).toBe("ops@example.net");
  });

  it("returns SMTP errors to callers without throwing or retrying via a real transport", async () => {
    sendMail.mockRejectedValueOnce(new Error("mock timeout"));
    await expect(mailer.sendWelcome({ to: "external@example.net", name: "Test" }))
      .resolves.toEqual({ ok: false, error: "mock timeout" });
  });
});
