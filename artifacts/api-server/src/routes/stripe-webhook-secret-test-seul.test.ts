/**
 * stripe-webhook-secret-test-seul.test.ts
 *
 * Regression tests for strict Stripe webhook mode isolation. Signatures are
 * generated locally; the database is mocked and no Stripe API is called.
 */
import { vi, describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
// Ce fichier ne teste QUE la resolution du secret et la verification de
// signature. La base est simulee : aucune organisation ne correspond, donc le
// gestionnaire n'ecrit rien et ne depend d'aucun PostgreSQL.
vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

function signer(corps: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${corps}`).digest("hex")}`;
}

/**
 * Monte le routeur dans un environnement entierement maitrise : les variables
 * sont posees AVANT l'import, et le module est recharge a chaque fois.
 */
async function envoyer(opts: {
  mode?: "TEST" | "LIVE";
  secretPrincipal?: string;
  secretDeTest?: string;
  secretQuiSigne: string;
  livemode?: boolean;
  keyMismatch?: boolean;
}): Promise<number> {
  const mode = opts.mode ?? "TEST";
  const sauve = {
    p: process.env["STRIPE_WEBHOOK_SECRET"],
    r: process.env["STRIPE_WEBHOOK_SECRET_RENDER"],
    t: process.env["STRIPE_TEST_WEBHOOK_SECRET"],
    m: process.env["STRIPE_TEST_MODE"],
    k: process.env["STRIPE_TEST_KEY"],
    l: process.env["STRIPE_LIVE_API_KEY"],
    s: process.env["STRIPE_SECRET_KEY"],
    n: process.env["NODE_ENV"],
    u: process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"],
  };
  try {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    delete process.env["STRIPE_WEBHOOK_SECRET_RENDER"];
    delete process.env["STRIPE_TEST_WEBHOOK_SECRET"];
    delete process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"];
    delete process.env["STRIPE_SECRET_KEY"];
    process.env["NODE_ENV"] = "development";
    process.env["STRIPE_TEST_MODE"] = mode === "TEST" ? "true" : "false";
    if (mode === "TEST") {
      process.env["STRIPE_TEST_KEY"] = "sk_test_pour_ce_test";
      delete process.env["STRIPE_LIVE_API_KEY"];
    } else {
      delete process.env["STRIPE_TEST_KEY"];
      if (opts.keyMismatch) {
        delete process.env["STRIPE_LIVE_API_KEY"];
        process.env["STRIPE_SECRET_KEY"] = "sk_test_pour_ce_test";
      } else {
        process.env["STRIPE_LIVE_API_KEY"] = "sk_live_pour_ce_test";
      }
    }
    if (opts.secretPrincipal) process.env["STRIPE_WEBHOOK_SECRET"] = opts.secretPrincipal;
    if (opts.secretDeTest) process.env["STRIPE_TEST_WEBHOOK_SECRET"] = opts.secretDeTest;

    vi.resetModules();
    const { default: routeur } = await import("./stripe-webhook.js");
    const app = express();
    app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }),
      (req: express.Request & { rawBody?: Buffer }, _res, next) => { req.rawBody = req.body as Buffer; next(); });
    app.use("/api", routeur);

    const corps = JSON.stringify({
      type: "flowpoint.test.unknown",
      livemode: opts.livemode ?? mode === "LIVE",
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    const r = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signer(corps, opts.secretQuiSigne))
      .send(corps);               // CHAINE : supertest serialiserait un Buffer en JSON
    return r.status;
  } finally {
    for (const [cle, val] of [
      ["STRIPE_WEBHOOK_SECRET", sauve.p], ["STRIPE_WEBHOOK_SECRET_RENDER", sauve.r],
      ["STRIPE_TEST_WEBHOOK_SECRET", sauve.t], ["STRIPE_TEST_MODE", sauve.m],
      ["STRIPE_TEST_KEY", sauve.k], ["STRIPE_LIVE_API_KEY", sauve.l],
      ["STRIPE_SECRET_KEY", sauve.s], ["NODE_ENV", sauve.n],
      ["ALLOW_UNSIGNED_STRIPE_WEBHOOKS", sauve.u],
    ] as const) {
      if (val === undefined) delete process.env[cle]; else process.env[cle] = val;
    }
    vi.resetModules();
  }
}

describe("le secret de webhook de test suffit a lui seul", () => {
  it("un evenement TEST signe avec le seul STRIPE_TEST_WEBHOOK_SECRET est accepte", async () => {
    const code = await envoyer({ secretDeTest: "whsec_test_seul", secretQuiSigne: "whsec_test_seul" });
    expect(code).toBe(200);
  });

  it("un secret LIVE seul n'est pas utilise en mode TEST", async () => {
    const code = await envoyer({ secretPrincipal: "whsec_principal", secretQuiSigne: "whsec_principal" });
    expect(code).toBe(503);
  });

  it("en mode TEST, le secret LIVE n'est jamais essaye en repli", async () => {
    const parTest = await envoyer({
      secretPrincipal: "whsec_principal", secretDeTest: "whsec_test",
      secretQuiSigne: "whsec_test",
    });
    const parLive = await envoyer({
      secretPrincipal: "whsec_principal", secretDeTest: "whsec_test",
      secretQuiSigne: "whsec_principal",
      livemode: true,
    });
    expect(parTest).toBe(200);
    expect(parLive).toBe(400);
  });

  it("refuse un evenement LIVE signe avec le secret de test", async () => {
    const code = await envoyer({
      secretDeTest: "whsec_test",
      secretQuiSigne: "whsec_test",
      livemode: true,
    });
    expect(code).toBe(400);
  });

  it("un evenement LIVE signe avec le secret LIVE passe en mode LIVE", async () => {
    const code = await envoyer({
      mode: "LIVE",
      secretPrincipal: "whsec_live",
      secretQuiSigne: "whsec_live",
    });
    expect(code).toBe(200);
  });

  it("un evenement TEST signe avec le secret de test est refuse en mode LIVE", async () => {
    const code = await envoyer({
      mode: "LIVE",
      secretPrincipal: "whsec_live",
      secretDeTest: "whsec_test",
      secretQuiSigne: "whsec_test",
      livemode: false,
    });
    expect(code).toBe(400);
  });

  it("le secret TEST seul ne peut pas verifier un webhook en mode LIVE", async () => {
    const code = await envoyer({
      mode: "LIVE",
      secretDeTest: "whsec_test",
      secretQuiSigne: "whsec_test",
    });
    expect(code).toBe(503);
  });

  it("refuse une cle TEST quand le mode configure est LIVE", async () => {
    const code = await envoyer({
      mode: "LIVE",
      keyMismatch: true,
      secretPrincipal: "whsec_live",
      secretQuiSigne: "whsec_live",
    });
    expect(code).toBe(503);
  });

  it("la correction n'ouvre rien : un secret inconnu est toujours refuse en 400", async () => {
    const code = await envoyer({
      secretPrincipal: "whsec_principal", secretDeTest: "whsec_test",
      secretQuiSigne: "whsec_celui_d_un_attaquant",
    });
    expect(code, "un secret inconnu a ete accepte").toBe(400);
  });

  it("aucun secret configure : refus, et jamais un passage silencieux", async () => {
    const code = await envoyer({ secretQuiSigne: "whsec_peu_importe" });
    expect(code).toBe(503);
  });
});
