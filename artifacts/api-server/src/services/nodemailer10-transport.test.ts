import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";

describe("Nodemailer 10 stream transport (no SMTP connection)", () => {
  it("composes external-recipient transactional mail and normalizes an IDN address", async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const result = await transport.sendMail({
      from: "FlowPoint <noreply@example.test>",
      to: "person@compa\u00adny.com",
      subject: "Activation",
      text: "Activate your account",
      html: "<p>Activate your account</p>",
    });
    expect(result.envelope.to).toEqual(["person@company.com"]);
    expect(result.message.toString()).toContain("Subject: Activation");
    expect(result.message.toString()).toContain("multipart/alternative");
  });

  it("does not invent recipients for a malformed address", async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const result = await transport.sendMail({
      from: "FlowPoint <noreply@example.test>",
      to: "not-an-email",
      subject: "Validation",
      text: "This is not delivered",
    });
    expect(result.envelope.to).toEqual([]);
  });
});
