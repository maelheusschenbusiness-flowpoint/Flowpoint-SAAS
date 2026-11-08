import { describe, it, expect } from "vitest";
import { planifierNettoyage, executerNettoyage } from "./nettoyage.ts";
import { motifEmailCampagne } from "./config.ts";
import { fauxStripe } from "./fake-stripe.ts";

const T0 = 1_800_000_000;
const etat = () => ({
  customers: [
    { id: "cus_c1", email: "moi+fp-cert-a-nominal-1@exemple.fr", created: T0 },
    { id: "cus_c2", email: "moi+fp-cert-a-refus-2@exemple.fr", created: T0 },
    { id: "cus_reel", email: "client.reel@exemple.fr", created: T0 },
    { id: "cus_alias_reel", email: "moi+famille@exemple.fr", created: T0 },
    { id: "cus_ancien", email: "moi+fp-cert-z-vieux-1@exemple.fr", created: T0 - 10_000 },
  ],
  subscriptions: [
    { id: "sub_1", customer: "cus_c1", status: "trialing" }, { id: "sub_0", customer: "cus_c1", status: "canceled" },
    { id: "sub_reel", customer: "cus_reel", status: "active" },
  ],
  paymentMethods: {}, events: [], supprimes: [] as string[], annulees: [] as string[],
});

describe("nettoyage Stripe TEST", () => {
  it("planifie uniquement les customers de campagne recents ; dry-run ne modifie rien", async () => {
    const e = etat();
    const plan = await planifierNettoyage(fauxStripe(e) as never, motifEmailCampagne("moi@exemple.fr"), T0 - 100);
    expect(plan.map((p) => p.customerId).sort()).toEqual(["cus_c1", "cus_c2"]);
    expect(plan.find((p) => p.customerId === "cus_c1")!.souscriptions.map((s) => s.id)).toEqual(["sub_1"]);
    expect(e.supprimes).toEqual([]); expect(e.annulees).toEqual([]);
  });
  it("adresses exactes (compte Google de test) : seules celles-la, sans toucher aux autres", async () => {
    const e = etat();
    const plan = await planifierNettoyage(fauxStripe(e) as never, ["Client.Reel@exemple.fr"], T0 - 100);
    expect(plan.map((p) => p.customerId)).toEqual(["cus_reel"]);
  });
  it("execution : annule les souscriptions de campagne et supprime ces customers seulement", async () => {
    const e = etat();
    const plan = await planifierNettoyage(fauxStripe(e) as never, motifEmailCampagne("moi@exemple.fr"), T0 - 100);
    const r = await executerNettoyage(fauxStripe(e) as never, plan);
    expect(r).toEqual({ souscriptionsAnnulees: 1, customersSupprimes: 2 });
    expect(e.supprimes.sort()).toEqual(["cus_c1", "cus_c2"]);
    expect(e.annulees).toEqual(["sub_1"]);
    expect(e.customers.map((c) => c.id)).toContain("cus_reel");
    expect(e.customers.map((c) => c.id)).toContain("cus_alias_reel");
  });
});
