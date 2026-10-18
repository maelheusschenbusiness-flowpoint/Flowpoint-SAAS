/**
 * stripe-webhook-secret-test-seul.test.ts
 *
 * DEFAUT MESURE LE 18/10/2026, pendant la certification Stripe.
 *
 * `handleStripeWebhook` n'entrait dans sa branche verifiee que si
 * STRIPE_WEBHOOK_SECRET (ou _RENDER) etait posee ; STRIPE_TEST_WEBHOOK_SECRET
 * n'etait consultee qu'a l'interieur de cette branche, en repli.
 *
 * Or `render.yaml` ne declare, pour le service `flowpoint-test`, que
 * STRIPE_TEST_WEBHOOK_SECRET. Un environnement configure ainsi — c'est-a-dire
 * exactement comme il est documente — tombait dans la branche NON SIGNEE :
 * chaque evenement Stripe refuse en 503, aucun abonnement active, et la
 * variable posee par l'operateur silencieusement ignoree.
 *
 * Le refus etait sur. Il etait muet sur sa cause, et il rendait la
 * certification du parcours payant impossible sur l'environnement prevu pour
 * elle. Ces tests verrouillent les deux sens.
 */
import { vi, describe, it, expect } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
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
  secretPrincipal?: string;
  secretDeTest?: string;
  secretQuiSigne: string;
}): Promise<number> {
  const sauve = {
    p: process.env["STRIPE_WEBHOOK_SECRET"],
    r: process.env["STRIPE_WEBHOOK_SECRET_RENDER"],
    t: process.env["STRIPE_TEST_WEBHOOK_SECRET"],
    m: process.env["STRIPE_TEST_MODE"],
    k: process.env["STRIPE_TEST_KEY"],
    u: process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"],
  };
  try {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    delete process.env["STRIPE_WEBHOOK_SECRET_RENDER"];
    delete process.env["STRIPE_TEST_WEBHOOK_SECRET"];
    delete process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"];
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_KEY"] = "sk_test_pour_ce_test";
    if (opts.secretPrincipal) process.env["STRIPE_WEBHOOK_SECRET"] = opts.secretPrincipal;
    if (opts.secretDeTest) process.env["STRIPE_TEST_WEBHOOK_SECRET"] = opts.secretDeTest;

    vi.resetModules();
    const { default: routeur } = await import("./stripe-webhook.js");
    const app = express();
    app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }),
      (req: express.Request & { rawBody?: Buffer }, _res, next) => { req.rawBody = req.body as Buffer; next(); });
    app.use("/api", routeur);

    const corps = JSON.stringify({
      id: `evt_${randomUUID()}`, type: "invoice.payment_failed",
      created: Math.floor(Date.now() / 1000),
      data: { object: { customer: "cus_aucune_org_connue", attempt_count: 1 } },
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
      ["STRIPE_TEST_KEY", sauve.k], ["ALLOW_UNSIGNED_STRIPE_WEBHOOKS", sauve.u],
    ] as const) {
      if (val === undefined) delete process.env[cle]; else process.env[cle] = val;
    }
    vi.resetModules();
  }
}

describe("le secret de webhook de test suffit a lui seul", () => {
  it("DEFAUT CORRIGE : signe avec le seul STRIPE_TEST_WEBHOOK_SECRET, l'evenement est verifie", async () => {
    // Avant correction : 503 — la branche verifiee n'etait meme pas atteinte.
    const code = await envoyer({ secretDeTest: "whsec_test_seul", secretQuiSigne: "whsec_test_seul" });
    expect(code, "un environnement configure avec le seul secret de test refuse encore les evenements").not.toBe(503);
    expect(code, "la signature a ete rejetee").not.toBe(400);
  });

  it("le secret principal seul continue de fonctionner — comportement inchange", async () => {
    const code = await envoyer({ secretPrincipal: "whsec_principal", secretQuiSigne: "whsec_principal" });
    expect(code).not.toBe(503);
    expect(code).not.toBe(400);
  });

  it("les deux secrets poses : une signature valide pour l'un OU l'autre est acceptee", async () => {
    const parTest = await envoyer({
      secretPrincipal: "whsec_principal", secretDeTest: "whsec_test",
      secretQuiSigne: "whsec_test",
    });
    const parPrincipal = await envoyer({
      secretPrincipal: "whsec_principal", secretDeTest: "whsec_test",
      secretQuiSigne: "whsec_principal",
    });
    for (const code of [parTest, parPrincipal]) {
      expect(code).not.toBe(503);
      expect(code).not.toBe(400);
    }
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
