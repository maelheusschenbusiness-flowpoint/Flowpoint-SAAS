/**
 * C-02 — SSRF webhooks d'integration : DNS epingle, revalidation a chaque envoi,
 * aucune redirection suivie, creation validee.
 * Aucun appel reseau reel : node:https est simule.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const httpsRequest = vi.hoisted(() => vi.fn());
vi.mock("node:https", async () => {
  const actual = await vi.importActual<typeof import("node:https")>("node:https");
  return { ...actual, request: httpsRequest, default: { ...actual, request: httpsRequest } };
});

import { postWebhookPinned, validatePublicHttpsWebhook } from "./webhook-url-safety.js";
import { createIntegration } from "./integrations-service.js";

function fakeRequest(status: number) {
  httpsRequest.mockImplementation((_opts: unknown, cb: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void; destroy: () => void };
    req.write = vi.fn();
    req.destroy = vi.fn();
    req.end = () => {
      const res = Object.assign(new EventEmitter(), { statusCode: status, headers: {}, destroy: vi.fn() });
      queueMicrotask(() => cb(res));
    };
    return req;
  });
}

const headers = { "Content-Type": "application/json" };

describe("postWebhookPinned (C-02)", () => {
  beforeEach(() => httpsRequest.mockReset());

  it("se connecte a l'IP validee (DNS epingle) et conserve Host/SNI", async () => {
    fakeRequest(200);
    const r = await postWebhookPinned("https://hooks.example.com/a", {
      headers, body: "{}", resolve: async () => ["93.184.216.34"],
    });
    expect(r).toMatchObject({ ok: true, statusCode: 200 });
    const opts = httpsRequest.mock.calls[0]![0] as Record<string, any>;
    expect(opts.hostname).toBe("93.184.216.34");
    expect(opts.servername).toBe("hooks.example.com");
    expect(opts.headers.Host).toBe("hooks.example.com");
    expect(opts.method).toBe("POST");
  });

  it("DNS rebinding : une seconde resolution privee est bloquee, aucune requete emise", async () => {
    let calls = 0;
    const resolve = async () => (++calls === 1 ? ["93.184.216.34"] : ["169.254.169.254"]);
    const r = await postWebhookPinned("https://rebind.example.com/x", { headers, body: "{}", resolve });
    expect(r.ok).toBe(false);
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("un en-tete personnalise ne peut pas surcharger Host", async () => {
    fakeRequest(200);
    await postWebhookPinned("https://hooks.example.com/a", {
      headers: { ...headers, Host: "169.254.169.254" }, body: "{}", resolve: async () => ["93.184.216.34"],
    });
    const opts = httpsRequest.mock.calls[0]![0] as Record<string, any>;
    expect(opts.headers.Host).toBe("hooks.example.com");
  });

  it("n'envoie rien vers un hote prive / metadata / loopback", async () => {
    for (const url of [
      "https://127.0.0.1/h", "https://169.254.169.254/latest", "https://100.64.0.1/h",
      "https://10.1.2.3/h", "https://localhost/h", "http://hooks.example.com/h",
    ]) {
      const r = await postWebhookPinned(url, { headers, body: "{}", resolve: async () => ["93.184.216.34"] });
      expect(r.ok, url).toBe(false);
    }
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("ne suit jamais une redirection (3xx = echec)", async () => {
    fakeRequest(302);
    const r = await postWebhookPinned("https://hooks.example.com/a", {
      headers, body: "{}", resolve: async () => ["93.184.216.34"],
    });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(302);
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });
});

describe("validatePublicHttpsWebhook - IPv6", () => {
  it.each(["::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1"])(
    "refuse un nom resolvant vers %s", async addr => {
      expect((await validatePublicHttpsWebhook("https://h.example.com", async () => [addr])).ok).toBe(false);
    });
});

describe("createIntegration valide la destination (C-02)", () => {
  it.each(["https://169.254.169.254/x", "https://127.0.0.1/x", "http://hooks.example.com/x"])(
    "refuse %s avant toute ecriture", async url => {
      await expect(createIntegration("org-1", "pro", { name: "n", endpointUrl: url })).rejects.toThrow();
    });
});
