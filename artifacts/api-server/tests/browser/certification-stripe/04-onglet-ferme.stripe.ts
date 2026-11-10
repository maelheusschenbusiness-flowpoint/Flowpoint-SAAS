/**
 * 4. Onglet ferme juste apres `confirmSetup` : le webhook SEUL doit creer la souscription (PR #393).
 * L'appel /api/public/finalize-checkout est BLOQUE cote navigateur : il ne peut donc pas masquer un defaut du webhook.
 * Prerequis : le webhook Stripe est livre a l'application (Mode L : `stripe listen` actif ; Mode R : endpoint enregistre).
 */
import { test, expect, exigerConfiguration, preparerContexte, inscriptionJusquAuPaiement, attendrePaymentElementReel, saisirCarte, attendreConfirmationStripe, CARTES, exigerPreuvesStripe, exigerUneSeuleSouscriptionStable, organisationEn } from "./support/stripe-reel";

exigerConfiguration();

test("onglet ferme apres confirmSetup : le webhook seul cree UNE souscription trialing", async ({ page, context, nouvelEmail, stripeCleanup }) => {
  const email = await nouvelEmail("onglet-ferme");
  await preparerContexte(context);
  await context.route("**/api/public/finalize-checkout", (r) => r.abort());
  await inscriptionJusquAuPaiement(page, email, stripeCleanup);
  await attendrePaymentElementReel(page);
  await saisirCarte(page, CARTES.succes);
  const confirmation = attendreConfirmationStripe(page, stripeCleanup);
  await page.locator("#fp-pay-btn").click();
  const rep = await confirmation;
  expect(rep.status(), "confirmation Stripe acceptee").toBe(200);
  await page.close();                                         // l'utilisateur ferme l'onglet : aucun retour navigateur
  await exigerPreuvesStripe(email, { positif: true, delaiMs: 180_000 });
  await exigerUneSeuleSouscriptionStable(email);
  const org = await organisationEn(email);
  if (org !== undefined) expect(org, "organisation activee par le webhook seul").toMatchObject({ subscription_status: "trialing" });
});
