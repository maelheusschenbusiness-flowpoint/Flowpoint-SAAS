import { describe, expect, it } from "vitest";
import { validatePublicHttpsWebhook } from "./webhook-url-safety.js";

describe("validatePublicHttpsWebhook", () => {
  const publicDns = async () => ["93.184.216.34"];
  it("accepts a public HTTPS URL", async () => {
    expect(await validatePublicHttpsWebhook("https://hooks.example.com/abc", publicDns))
      .toMatchObject({ ok: true, url: "https://hooks.example.com/abc" });
  });
  it.each([
    "http://hooks.example.com",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://10.0.0.8/hook",
    "https://user:pass@hooks.example.com/hook",
  ])("rejects unsafe target %s", async url => {
    expect((await validatePublicHttpsWebhook(url, publicDns)).ok).toBe(false);
  });
  it("rejects DNS names resolving to private addresses", async () => {
    expect((await validatePublicHttpsWebhook("https://hooks.example.com", async () => ["93.184.216.34", "192.168.1.2"])).ok).toBe(false);
  });
});
