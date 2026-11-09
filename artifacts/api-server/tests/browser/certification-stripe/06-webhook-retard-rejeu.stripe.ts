/**
 * 6. Webhook EN RETARD puis REJEU de l'evenement (idempotence). Mode L uniquement.
 * Prerequis : `stripe listen` ARRETE avant le test (CERT_STRIPE_LISTENER_ARRETE=1) ; l'application locale tourne.
 * Deroule : carte confirmee (finalize bloque) -> setup_intent.succeeded cree cote Stripe mais NON livre -> aucune souscription ->
 * rejeu signe de l'evenement 3 fois vers l'application -> UNE souscription, jamais deux.
 */
import { test, expect, exigerConfiguration, cfg, preparerContexte, inscriptionJusquAuPaiement, attendrePaymentElementReel, saisirCarte, attendreConfirmationStripe, CARTES, exigerPreuvesStripe, exigerUneSeuleSouscriptionStable, verdictsStripe, DEBUT } from "./support/stripe-reel";
import { rejouerEvenement } from "../../../tools/certification-stripe/rejeu";
import { assertCleSecreteTest } from "../../../tools/certification-stripe/garde-cles";

exigerConfiguration();
test.skip(cfg.mode !== "L", "Rejeu signe : Mode L uniquement (en Mode R, rejouer depuis le tableau de bord Stripe : docs/CERTIFICATION-STRIPE-REEL.md).");
test.skip(process.env["CERT_STRIPE_LISTENER_ARRETE"] !== "1", "Webhook en retard : arretez `stripe listen`, puis relancez avec CERT_STRIPE_LISTENER_ARRETE=1.");

test("webhook en retard puis rejeu x3 : aucune souscription avant, UNE apres, toujours UNE ensuite", async ({ page, context, nouvelEmail }) => {
  const email = nouvelEmail("retard");
  await preparerContexte(context);
  await context.route("**/api/public/finalize-checkout", (r) => r.abort());
  await inscriptionJusquAuPaiement(page, email);
  await attendrePaymentElementReel(page);
  await saisirCarte(page, CARTES.succes);
  const conf = attendreConfirmationStripe(page);
  await page.locator("#fp-pay-btn").click();
  const seti = /(seti_[A-Za-z0-9]+)/.exec((await conf).url())![1]!;
  await page.close();
  await new Promise((r) => setTimeout(r, 15_000));
  const avant = await verdictsStripe(email, { positif: false });
  expect(avant.filter((v) => !v.ok), "aucune souscription tant que le webhook n'est pas livre").toEqual([]);
  // Retrouver l'evenement setup_intent.succeeded de ce SetupIntent.
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(assertCleSecreteTest(process.env["STRIPE_TEST_SECRET_KEY"]));
  const evts = await stripe.events.list({ type: "setup_intent.succeeded", created: { gte: DEBUT }, limit: 50 });
  const evt = evts.data.find((e) => (e.data.object as { id?: string }).id === seti);
  expect(evt, `evenement setup_intent.succeeded pour ${seti}`).toBeTruthy();
  const r = await rejouerEvenement({ evenementId: evt!.id, url: `${cfg.baseUrl}/api/billing/webhook`, fois: 3 });
  expect(r.statuts.every((s) => s >= 200 && s < 300), `statuts du rejeu : ${r.statuts.join(",")}`).toBe(true);
  await exigerPreuvesStripe(email, { positif: true, delaiMs: 120_000 });
  await exigerUneSeuleSouscriptionStable(email);
});
