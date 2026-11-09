/**
 * 7. Etats d'abonnement dans le dashboard et garde d'acces serveur (PR #376) et mode LECTURE SEULE (PR #401).
 * Etats prepares par SQL sur la base JETABLE locale (aucune donnee reelle).
 */
import { test, expect, db, IS_LOCAL, unexpectedApiFailures } from "./support/fixtures";
import { ouvrirDashboard } from "./support/parcours";

test.skip(!IS_LOCAL, "Fixtures SQL : base jetable locale uniquement.");

const DAY = "interval '1 day'";
// mode : full = acces complet ; read_only = lectures ouvertes, ecritures 402 SUBSCRIPTION_READ_ONLY (#401) ; blocked = 402 SUBSCRIPTION_REQUIRED.
interface Etat { nom: string; status: string; trialEnds: string | null; periodEnd: string | null; mode: "full" | "read_only" | "blocked"; sub: boolean; pastDueSince?: string }
const ETATS: Etat[] = [
  { nom: "trialing (10 jours restants)", status: "trialing", trialEnds: `now() + 10 * ${DAY}`, periodEnd: `now() + 10 * ${DAY}`, mode: "full", sub: true },
  { nom: "active", status: "active", trialEnds: null, periodEnd: `now() + 20 * ${DAY}`, mode: "full", sub: true },
  { nom: "past_due, periode payee encore valide (grace)", status: "past_due", trialEnds: null, periodEnd: `now() + 5 * ${DAY}`, mode: "full", sub: true },
  { nom: "past_due, periode terminee", status: "past_due", trialEnds: null, periodEnd: `now() - 2 * ${DAY}`, mode: "read_only", sub: true, pastDueSince: `now() - 10 * ${DAY}` },
  { nom: "canceled, periode payee encore valide", status: "canceled", trialEnds: null, periodEnd: `now() + 5 * ${DAY}`, mode: "full", sub: true },
  { nom: "canceled, periode terminee", status: "canceled", trialEnds: null, periodEnd: `now() - 2 * ${DAY}`, mode: "read_only", sub: true },
  { nom: "expired (essai termine sans abonnement)", status: "expired", trialEnds: `now() - 3 * ${DAY}`, periodEnd: null, mode: "blocked", sub: false },
];

test.describe("7. Etats d'abonnement et garde d'acces", () => {
  for (const e of ETATS) {
    test(`${e.nom} : acces ${e.mode === "full" ? "ouvert" : e.mode === "read_only" ? "en lecture seule (ecritures 402)" : "ferme (402)"}, regularisation toujours possible, dashboard charge`, async ({ page, request, signupViaApi, magicToken, observed, shot }) => {
      const { email, orgId } = await signupViaApi(request);
      const set = `subscription_status='${e.status}', trial_ends_at=${e.trialEnds ?? "NULL"}, current_period_end=${e.periodEnd ?? "NULL"}, cancel_at_period_end=false${e.pastDueSince ? `, past_due_since=${e.pastDueSince}` : ""}`;
      await db().query(`UPDATE organizations SET ${set}${e.sub ? "" : ", stripe_subscription_id=NULL"} WHERE id=$1::uuid`, [orgId]);
      await db().query(`UPDATE org_settings SET subscription_status='${e.status}', trial_ends_at=${e.trialEnds ?? "NULL"}${e.sub ? "" : ", stripe_subscription_id=NULL"} WHERE org_id=$1`, [email]).catch(() => undefined);

      await ouvrirDashboard(page, await magicToken(email));
      await shot(page, "dashboard");
      const rep = await page.evaluate(async (sonde) => {
        const me = await (await fetch("/api/me")).json();
        const paid = await fetch("/api/monitors");                    // route payante hors liste d'exemptions
        const write = sonde ? await fetch("/api/monitors", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }) : null;   // sonde d'ecriture : seulement en lecture seule
        const sub = await fetch("/api/billing/subscription");         // regularisation : toujours accessible
        const plans = await fetch("/api/plans/catalog");
        return { me, paid: paid.status, paidBody: await paid.json().catch(() => ({})), readOnlyHeader: paid.headers.get("x-fp-access-mode"), write: write?.status ?? 0, writeBody: write ? await write.json().catch(() => ({})) : {}, sub: sub.status, plans: plans.status };
      }, e.mode === "read_only");
      expect(rep.me.hasPaidAccess, "hasPaidAccess").toBe(e.mode === "full");
      if (e.mode === "full") expect(rep.paid).not.toBe(402);
      else if (e.mode === "read_only") {
        expect(rep.paid, "lecture").not.toBe(402);
        expect(rep.readOnlyHeader).toBe("read_only");
        expect(rep.write, "ecriture").toBe(402);
        expect(rep.writeBody.code).toBe("SUBSCRIPTION_READ_ONLY");
      } else { expect(rep.paid).toBe(402); expect(rep.paidBody.code).toBe("SUBSCRIPTION_REQUIRED"); }
      expect(rep.sub).toBe(200);
      expect(rep.plans).toBe(200);
      // Le dashboard lui-meme charge toujours (le client doit pouvoir regulariser) ; aucune erreur 500/401 inattendue.
      await expect(page.locator('[data-route="overview"]')).toBeVisible();
      await page.evaluate(() => { location.hash = "billing/plans"; });
      await page.waitForTimeout(1500);
      await shot(page, "facturation");
      expect(unexpectedApiFailures(observed)).toEqual([]);
      expect(observed.pageErrors).toEqual([]);
    });
  }

  test("trialing : la facturation annonce l'essai gratuit", async ({ page, request, signupViaApi, magicToken }) => {
    const { email } = await signupViaApi(request);
    await ouvrirDashboard(page, await magicToken(email), "billing/plans");
    await expect(page.getByText(/Essai gratuit|Free trial/).first()).toBeVisible({ timeout: 15_000 });
  });
});
