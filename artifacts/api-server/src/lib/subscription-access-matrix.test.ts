/**
 * subscription-access-matrix.test.ts — table de verite de l'acces payant (B-03/B-04).
 *
 * Verrouille, etat par etat, ce que prescrit lib/subscription-state.ts :
 * seuls `active`, `trialing` et une periode DEJA PAYEE encore valide ouvrent
 * l'acces ; `pending_billing`, `incomplete`, `none` et tout statut inconnu
 * ferment l'acces. La grace d'un `past_due` est bornee par la fin de periode
 * payee (current_period_end), jamais ouverte.
 */
import { describe, it, expect } from "vitest";
import { normalizeSubscriptionStatus, grantsPaidAccess } from "./subscription-state.js";

const NOW = new Date("2026-11-08T12:00:00Z");
const future = "2026-11-20T00:00:00Z";
const past = "2026-11-01T00:00:00Z";
const SUB = "sub_123";
const CUS = "cus_123";

function access(raw: string | null, o: { sub?: string | null; cus?: string | null; trialEnds?: string | null; consumed?: string | null; periodEnd?: string | null } = {}) {
  const status = normalizeSubscriptionStatus({
    rawStatus: raw,
    stripeSubscriptionId: o.sub === undefined ? SUB : o.sub,
    stripeCustomerId: o.cus === undefined ? CUS : o.cus,
    trialEndsAt: o.trialEnds ?? null,
    trialConsumedAt: o.consumed ?? null,
  });
  return { status, granted: grantsPaidAccess({ status, currentPeriodEnd: o.periodEnd ?? null, now: NOW }) };
}

describe("grantsPaidAccess — table de verite par etat d'abonnement", () => {
  it("actif => acces", () => expect(access("active")).toMatchObject({ status: "active", granted: true }));

  it("essai Stripe en cours => acces", () =>
    expect(access("trialing", { trialEnds: future, consumed: past })).toMatchObject({ status: "trialing", granted: true }));

  it("essai expire sans abonnement => pas d'acces", () => {
    const r = access("trialing", { sub: null, trialEnds: past, consumed: past });
    expect(r.granted).toBe(false);
    expect(["incomplete", "none"]).toContain(r.status);
  });

  it("faux essai DB sans trial_consumed_at (pending_billing) => pas d'acces", () =>
    expect(access("trialing", { sub: null, trialEnds: future, consumed: null })).toMatchObject({ status: "pending_billing", granted: false }));

  it("pending_billing => pas d'acces premium", () =>
    expect(access("pending_billing", { sub: null })).toMatchObject({ status: "pending_billing", granted: false }));

  it("past_due DANS la periode payee (grace bornee) => acces", () =>
    expect(access("past_due", { periodEnd: future })).toMatchObject({ status: "past_due", granted: true }));

  it("past_due HORS periode payee => pas d'acces", () =>
    expect(access("past_due", { periodEnd: past })).toMatchObject({ status: "past_due", granted: false }));

  it("past_due sans date de periode connue => pas d'acces par defaut", () =>
    expect(access("past_due")).toMatchObject({ granted: false }));

  it("unpaid / paused : acces uniquement tant que la periode payee court", () => {
    for (const s of ["unpaid", "paused"]) {
      expect(access(s, { periodEnd: future }).granted).toBe(true);
      expect(access(s, { periodEnd: past }).granted).toBe(false);
      expect(access(s).granted).toBe(false);
    }
  });

  it("annule : periode payee en cours => acces ; terminee ou inconnue => pas d'acces", () => {
    expect(access("canceled", { periodEnd: future })).toMatchObject({ status: "canceled", granted: true });
    expect(access("canceled", { periodEnd: past }).granted).toBe(false);
    expect(access("canceled").granted).toBe(false);
  });

  it("incomplete / none => pas d'acces", () => {
    expect(access("incomplete", { sub: null }).granted).toBe(false);
    expect(access(null, { sub: null, cus: null })).toMatchObject({ status: "none", granted: false });
  });

  it("statut brut inconnu ou 'expired' => pas d'acces (jamais d'acces par defaut)", () => {
    for (const raw of ["expired", "incomplete_expired", "garbage", ""]) {
      expect(access(raw, { sub: null }).granted).toBe(false);
    }
  });

  it("'active' declare sans identifiant d'abonnement (etat impossible) => pas d'acces", () =>
    expect(access("active", { sub: null, cus: null })).toMatchObject({ status: "none", granted: false }));

  it("une date de periode invalide n'ouvre jamais l'acces", () =>
    expect(access("canceled", { periodEnd: "pas-une-date" }).granted).toBe(false));
});
