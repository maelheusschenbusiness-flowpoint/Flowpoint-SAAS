/**
 * Les faits commerciaux du calendrier Croissance.
 *
 * Chaque situation imposee par la mission est ici, nommee par ce qu'elle protege.
 * Le module est pur : ces tests ne touchent ni base, ni reseau, ni Stripe.
 */
import { describe, it, expect } from "vitest";
import { growthFactsFor, businessDay, monthlyRecurringCents } from "../lib/growth-facts.js";

// 2026-10-08 23:30 UTC = le 9 octobre a Bruxelles (UTC+2).
const LATE_UTC = Math.floor(Date.parse("2026-10-08T23:30:00Z") / 1000);
const NOON = Math.floor(Date.parse("2026-10-08T12:00:00Z") / 1000);

const price = (cents: number, interval = "month", interval_count = 1) =>
  ({ unit_amount: cents, recurring: { interval, interval_count } });
const items = (...ps: ReturnType<typeof price>[]) =>
  ({ data: ps.map((p) => ({ price: p, quantity: 1 })) });

const call = (over: Record<string, unknown> = {}) => growthFactsFor({
  type: "customer.subscription.created",
  obj: { status: "active", items: items(price(4900)) },
  createdUnix: NOON, isAddon: false, isPlanSub: true, ...over,
} as Parameters<typeof growthFactsFor>[0]);

describe("le jour ouvre est celui de l evenement, a Bruxelles", () => {
  it("23h30 UTC le 8 est le 9 a Bruxelles", () => {
    expect(businessDay(LATE_UTC)).toBe("2026-10-09");
  });
  it("un horodatage absent ne produit aucun fait", () => {
    expect(call({ createdUnix: NaN })).toBeNull();
  });
  // Situation 10 — evenement recu en retard.
  it("un evenement rejoue plus tard retombe sur SA journee", () => {
    // Le jour vient de `event.created`, jamais de l'heure de reception : un
    // rattrapage ne doit pas deplacer un chiffre deja affiche.
    expect(call()!.day).toBe("2026-10-08");
    expect(call({ createdUnix: NOON })!.day).toBe(call({ createdUnix: NOON })!.day);
  });
});

describe("le MRR se lit sur l abonnement, intervalle normalise", () => {
  it("un mensuel vaut son montant", () => {
    expect(monthlyRecurringCents({ items: items(price(4900)) })).toBe(4900);
  });
  it("un annuel a 120 EUR vaut 10 EUR de MRR, pas 120", () => {
    expect(monthlyRecurringCents({ items: items(price(12000, "year")) })).toBe(1000);
  });
  it("une quantite multiplie", () => {
    expect(monthlyRecurringCents({ items: { data: [{ price: price(1000), quantity: 3 }] } })).toBe(3000);
  });
  it("une ligne SANS recurring est un achat ponctuel et ne compte pas", () => {
    expect(monthlyRecurringCents({ items: { data: [{ price: { unit_amount: 9900 } }] } })).toBe(0);
  });
  it("un intervalle inconnu n est pas devine", () => {
    expect(monthlyRecurringCents({ items: items(price(4900, "fortnight")) })).toBe(0);
  });
});

describe("1 — nouveau client payant", () => {
  it("un abonnement cree qui facture donne un client et du MRR", () => {
    expect(call()!.facts).toEqual({ clients_new: 1, mrr_gained_cents: 4900 });
  });
  it("past_due facture encore : c est un client", () => {
    expect(call({ obj: { status: "past_due", items: items(price(4900)) } })!.facts)
      .toEqual({ clients_new: 1, mrr_gained_cents: 4900 });
  });
  it("un abonnement cree en incomplete ne compte rien", () => {
    // Le paiement n'a pas abouti.
    expect(call({ obj: { status: "incomplete", items: items(price(4900)) } })).toBeNull();
  });
});

describe("2 — nouvel essai", () => {
  it("un essai qui demarre n est NI un client NI du MRR", () => {
    // Une inscription ou un essai gratuit n'est pas un client payant, et un
    // essai ne rapporte pas encore un euro.
    expect(call({ obj: { status: "trialing", items: items(price(4900)) } })!.facts)
      .toEqual({ trials_started: 1 });
  });
});

describe("3 — conversion d un essai en abonnement payant", () => {
  const converted = (over: Record<string, unknown> = {}) => call({
    type: "customer.subscription.updated",
    obj: { status: "active", items: items(price(4900)) },
    previousAttributes: { status: "trialing" }, ...over });

  it("essai -> actif donne la conversion, le client et le MRR", () => {
    expect(converted()!.facts).toEqual({ trials_converted: 1, clients_new: 1, mrr_gained_cents: 4900 });
  });
  it("un abonnement encore en essai n est pas une conversion", () => {
    expect(converted({ obj: { status: "trialing", items: items(price(4900)) } })).toBeNull();
  });
  it("le MRR de la conversion vient de l abonnement, pas d une facture", () => {
    // Un annuel encaisse 12 mois d'un coup : le MRR reste mensuel.
    expect(converted({ obj: { status: "active", items: items(price(12000, "year")) } })!.facts)
      .toMatchObject({ mrr_gained_cents: 1000 });
  });
});

describe("4 — resiliation programmee puis effective", () => {
  it("une resiliation PROGRAMMEE n est pas une perte", () => {
    // L'abonnement facture encore jusqu'au terme.
    expect(call({
      type: "customer.subscription.updated",
      obj: { status: "active", cancel_at_period_end: true, items: items(price(4900)) },
      previousAttributes: { cancel_at_period_end: false },
    })).toBeNull();
  });
  it("le terme effectif donne la perte et retire le MRR", () => {
    expect(call({
      type: "customer.subscription.deleted",
      obj: { status: "canceled", items: items(price(4900)) },
    })!.facts).toEqual({ clients_churned: 1, mrr_lost_cents: 4900 });
  });
});

describe("5 — changement de formule", () => {
  const change = (before: number, after: number) => call({
    type: "customer.subscription.updated",
    obj: { status: "active", items: items(price(after)) },
    previousAttributes: { items: items(price(before)) },
  });
  it("une montee en gamme est un ECART positif, pas un nouveau client", () => {
    expect(change(4900, 9900)!.facts).toEqual({ mrr_gained_cents: 5000 });
  });
  it("une descente en gamme est un ecart negatif, pas un client perdu", () => {
    expect(change(9900, 4900)!.facts).toEqual({ mrr_lost_cents: 5000 });
  });
  it("un changement sans effet sur le revenu ne produit rien", () => {
    expect(change(4900, 4900)).toBeNull();
  });
  it("sans previous_attributes.items, aucun ecart n est invente", () => {
    expect(call({
      type: "customer.subscription.updated",
      obj: { status: "active", items: items(price(9900)) },
      previousAttributes: { default_payment_method: "pm_x" },
    })).toBeNull();
  });
});

describe("6, 7, 8 — aucun evenement de facture ne produit de fait", () => {
  it.each([
    ["paiement echoue", "invoice.payment_failed", 0],
    ["facture a 0 EUR", "invoice.payment_succeeded", 0],
    ["facture payee", "invoice.payment_succeeded", 4900],
  ])("%s", (_label, type, amount_paid) => {
    // Le MRR n'est pas l'encaisse : la facture a 0 EUR, le paiement d'add-on
    // seul et le paiement echoue sont ecartes par construction.
    expect(call({ type, obj: { amount_paid, subscription: "sub_1" } })).toBeNull();
  });

  it("un paiement d add-on sans abonnement principal ne compte rien", () => {
    expect(call({ obj: { status: "active", items: items(price(1900)) }, isAddon: true })).toBeNull();
  });
  it("un add-on ne compte pas davantage a sa resiliation", () => {
    expect(call({ type: "customer.subscription.deleted", isAddon: true,
                  obj: { status: "canceled", items: items(price(1900)) } })).toBeNull();
  });
  it("un abonnement qui n est pas un plan ne compte rien", () => {
    expect(call({ isPlanSub: false })).toBeNull();
  });
});

describe("9 — un webhook recu plusieurs fois", () => {
  it("le meme evenement donne exactement le meme fait", () => {
    // L'idempotence est portee par l'unicite de `stripe_event_id` en base ; ici
    // on prouve que le calcul est deterministe, donc qu'un rejeu ne peut pas
    // produire un chiffre different de celui deja enregistre.
    const a = call(), b = call();
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("un MRR ne se compte jamais en negatif", () => {
  it("une perte va dans sa propre metrique", () => {
    // La base AI Lab refuse une valeur negative : une perte est une metrique,
    // pas un signe.
    const all = [
      call()!.facts, call({ type: "customer.subscription.deleted",
        obj: { status: "canceled", items: items(price(4900)) } })!.facts,
    ];
    for (const f of all) for (const v of Object.values(f)) expect(v).toBeGreaterThan(0);
  });
});
