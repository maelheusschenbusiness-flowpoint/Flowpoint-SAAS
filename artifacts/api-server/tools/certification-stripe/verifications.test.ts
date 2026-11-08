import { describe, it, expect } from "vitest";
import { calculerVerifications, calculerAbsenceSouscription, collecterDonnees, toutEstOk, type DonneesStripe } from "./verifications.ts";
import { fauxStripe } from "./fake-stripe.ts";

const T0 = 1_800_000_000;
const bon = (): DonneesStripe => ({
  email: "moi+fp-cert-a-b@exemple.fr",
  clients: [{ id: "cus_1", email: "moi+fp-cert-a-b@exemple.fr", livemode: false, invoice_settings: { default_payment_method: null } }],
  souscriptions: [{ id: "sub_1", customer: "cus_1", status: "trialing", created: T0, trial_end: T0 + 14 * 86400, livemode: false, default_payment_method: "pm_1", items: { data: [{ price: { id: "price_pro" }, quantity: 1 }] } }],
  souscriptionsRecentesDeLEmail: [{ id: "sub_1", customer: "cus_1", status: "trialing" }],
  moyensDePaiement: { pm_1: { id: "pm_1", customer: "cus_1" } },
  evenements: [
    { id: "evt_1", type: "setup_intent.succeeded", livemode: false, pending_webhooks: 0, created: T0 },
    { id: "evt_2", type: "customer.subscription.created", livemode: false, pending_webhooks: 0, created: T0 },
  ],
});
const echecs = (d: DonneesStripe, a = {}) => calculerVerifications(d, { maintenant: T0 + 60, prixAttendu: "price_pro", ...a }).filter((v) => !v.ok).map((v) => v.nom);

describe("calculerVerifications (faux Stripe en memoire)", () => {
  it("cas nominal : tout est OK", () => { expect(toutEstOk(calculerVerifications(bon(), { maintenant: T0 + 60, prixAttendu: "price_pro" }))).toBe(true); });
  it("deux customers : echec", () => { const d = bon(); d.clients.push({ id: "cus_2", email: d.email }); expect(echecs(d)).toContain("exactement UN customer pour l'e-mail"); });
  it("deux souscriptions vivantes : echec ; une annulee ne compte pas", () => {
    const d = bon(); d.souscriptions.push({ ...d.souscriptions[0]!, id: "sub_2" });
    expect(echecs(d)).toContain("exactement UNE souscription (non annulee)");
    const e = bon(); e.souscriptions.push({ ...e.souscriptions[0]!, id: "sub_2", status: "canceled" });
    expect(echecs(e)).toEqual([]);
  });
  it("statut active au lieu de trialing, trial_end hors tolerance, price ou quantite inattendus", () => {
    const a = bon(); a.souscriptions[0]!.status = "active"; expect(echecs(a)).toContain("status = trialing");
    const b = bon(); b.souscriptions[0]!.trial_end = T0 + 30 * 86400; expect(echecs(b)).toContain("trial_end ~ creation + 14 j");
    const c = bon(); c.souscriptions[0]!.items.data[0]!.price.id = "price_autre"; expect(echecs(c)).toContain("price attendu");
    const d = bon(); d.souscriptions[0]!.items.data[0]!.quantity = 2; expect(echecs(d)).toContain("quantite attendue");
  });
  it("moyen de paiement absent ou rattache a un autre customer : echec", () => {
    const a = bon(); a.souscriptions[0]!.default_payment_method = null; expect(echecs(a)).toContain("moyen de paiement par defaut attache au customer");
    const b = bon(); b.moyensDePaiement["pm_1"] = { id: "pm_1", customer: "cus_X" }; expect(echecs(b)).toContain("moyen de paiement par defaut attache au customer");
  });
  it("souscription orpheline (autre customer, meme e-mail) : echec", () => {
    const d = bon(); d.souscriptionsRecentesDeLEmail.push({ id: "sub_orph", customer: "cus_9", status: "incomplete" });
    expect(echecs(d)).toContain("aucune souscription orpheline");
  });
  it("evenement requis absent, ou livraison en attente : echec ; Mode L ignore pending_webhooks", () => {
    const a = bon(); a.evenements = a.evenements.filter((e) => e.type !== "setup_intent.succeeded"); expect(echecs(a)).toContain("evenement setup_intent.succeeded emis");
    const b = bon(); b.evenements[0]!.pending_webhooks = 2; expect(echecs(b)).toContain("evenements livres (pending_webhooks = 0)");
    expect(echecs(b, { livraisonEndpoint: false })).toEqual([]);
  });
  it("objet livemode=true : echec immediat", () => { const d = bon(); d.souscriptions[0]!.livemode = true; expect(echecs(d)).toContain("mode TEST uniquement"); });
  it("cas negatif : aucune souscription vivante", () => {
    const d = bon(); expect(toutEstOk(calculerAbsenceSouscription(d))).toBe(false);
    d.souscriptions = []; expect(toutEstOk(calculerAbsenceSouscription(d))).toBe(true);
  });
});

describe("collecterDonnees via un faux client Stripe en memoire", () => {
  it("rattache le SetupIntent sans customer par son moyen de paiement, et calcule un verdict GO", async () => {
    const email = "moi+fp-cert-a-b@exemple.fr";
    const etat = {
      customers: [{ id: "cus_1", email, created: T0 }, { id: "cus_autre", email: "autre@exemple.fr", created: T0 }],
      subscriptions: [{ id: "sub_1", customer: "cus_1", status: "trialing", created: T0, trial_end: T0 + 14 * 86400, default_payment_method: "pm_1", items: { data: [{ price: { id: "price_pro" }, quantity: 1 }] } }],
      paymentMethods: { pm_1: { id: "pm_1", customer: "cus_1" } },
      events: [
        { id: "evt_a", type: "setup_intent.succeeded", created: T0, pending_webhooks: 0, livemode: false, data: { object: { id: "seti_1", customer: null, payment_method: "pm_1" } } },
        { id: "evt_b", type: "customer.subscription.created", created: T0, pending_webhooks: 0, livemode: false, data: { object: { id: "sub_1", customer: "cus_1" } } },
        { id: "evt_x", type: "setup_intent.succeeded", created: T0, pending_webhooks: 1, livemode: false, data: { object: { id: "seti_etranger", customer: "cus_autre", payment_method: "pm_zzz" } } },
      ],
      supprimes: [], annulees: [],
    };
    const d = await collecterDonnees(fauxStripe(etat) as never, email, T0 - 10);
    expect(d.clients.map((c) => c.id)).toEqual(["cus_1"]);
    expect(d.evenements.map((e) => e.id).sort()).toEqual(["evt_a", "evt_b"]);     // l'evenement d'un autre client n'est pas compte
    expect(toutEstOk(calculerVerifications(d, { maintenant: T0 + 60, prixAttendu: "price_pro" }))).toBe(true);
  });
});
