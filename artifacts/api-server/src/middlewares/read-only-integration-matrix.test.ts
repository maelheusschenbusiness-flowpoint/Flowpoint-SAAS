/**
 * Integration #373/#392/#394/#397/#399/#400/#401 — matrice de la LECTURE SEULE sur les VRAIS chemins
 * de routes (credits IA, facturation, /billing/verify, webhook Stripe, exports). Billing mocke : aucun I/O.
 */
import { vi, describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../services/billing-context.js", async (orig) => ({
  ...(await orig<typeof import("../services/billing-context.js")>()),
  loadBillingContext: vi.fn(async () => ({
    accessMode: "read_only", accessReason: "past_due_grace_expired", subscriptionStatus: "past_due",
    plan: "pro", graceEndsAt: null, currentPeriodEnd: null, trialEndsAt: null, canStartTrial: false,
  })),
}));

import { requirePaidAccess } from "./requirePaidAccess.js";

function app(withOrg: boolean) {
  const a = express();
  a.use(express.json());
  if (withOrg) a.use((req, _res, next) => { (req as unknown as { orgId: string }).orgId = "11111111-1111-4111-8111-111111111111"; next(); });
  a.use("/api", requirePaidAccess);
  a.all("/api/*splat", (_q, r) => { r.json({ ok: true }); });
  return a;
}

const BLOCKED: Array<[string, string]> = [
  ["post", "/api/ai-credits/consume"],
  ["post", "/api/addons/whiteLabel/activate"],
  ["post", "/api/audits"],
  ["patch", "/api/me/settings"],
];
const ALLOWED: Array<[string, string]> = [
  ["get", "/api/billing/verify"],              // #397 : jamais bloque
  ["get", "/api/ai-credits/usage"],
  ["get", "/api/reports/export"],               // export de SES donnees
  ["post", "/api/billing/portal"],
  ["post", "/api/billing/reactivate"],
  ["post", "/api/billing/checkout-ai-credits"], // achat : regularisation/paiement
  ["post", "/api/billing/ai-credits-intent"],
  ["post", "/api/billing/usage-events"],
  ["delete", "/api/settings/data"],
];

describe("lecture seule x routes reelles", () => {
  for (const [m, p] of BLOCKED) {
    it(`${m.toUpperCase()} ${p} : 402 SUBSCRIPTION_READ_ONLY`, async () => {
      const r = await (request(app(true)) as any)[m](p).send({});
      expect(r.status).toBe(402);
      expect(r.body.code).toBe("SUBSCRIPTION_READ_ONLY");
    });
  }
  for (const [m, p] of ALLOWED) {
    it(`${m.toUpperCase()} ${p} : accessible`, async () => {
      const r = await (request(app(true)) as any)[m](p).send({});
      expect(r.status).toBe(200);
    });
  }
  it("webhook Stripe : jamais soumis aux gardes d'acces (avec ou sans contexte d'organisation)", async () => {
    for (const withOrg of [false, true]) {
      const r = await request(app(withOrg)).post("/api/webhooks/stripe").send({});
      expect(r.status).toBe(200);
    }
  });
});
