/** 2. 3DS reel : authentification reussie (souscription) et authentification ECHOUEE/abandonnee (aucune souscription). */
import { test, expect, exigerConfiguration, preparerContexte, inscriptionJusquAuPaiement, attendrePaymentElementReel, saisirCarte, attendreConfirmationStripe, repondre3ds, CARTES, exigerPreuvesStripe, organisationEn } from "./support/stripe-reel";

exigerConfiguration();

test("3DS requis (4000 0025 0000 3155) : authentification reussie -> une souscription trialing", async ({ page, context, nouvelEmail, stripeCleanup }) => {
  const email = await nouvelEmail("3ds-ok");
  await preparerContexte(context, "standard");
  await inscriptionJusquAuPaiement(page, email, stripeCleanup);
  await attendrePaymentElementReel(page);
  await saisirCarte(page, CARTES.authentification3ds);
  const confirmation = attendreConfirmationStripe(page, stripeCleanup);
  await page.locator("#fp-pay-btn").click();
  await confirmation;
  await repondre3ds(page, "reussir");
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 90_000 });
  await expect(page.locator("#fp-title")).toHaveText(/Compte activé/i, { timeout: 90_000 });
  await exigerPreuvesStripe(email, { positif: true, plan: "standard" });
});

test("3DS echoue (bouton « Fail authentication ») : message d'erreur, aucune souscription, organisation non premium", async ({ page, context, nouvelEmail, stripeCleanup }) => {
  const email = await nouvelEmail("3ds-ko");
  await preparerContexte(context, "standard");
  await inscriptionJusquAuPaiement(page, email, stripeCleanup);
  await attendrePaymentElementReel(page);
  await saisirCarte(page, CARTES.authentification3ds);
  const confirmation = attendreConfirmationStripe(page, stripeCleanup);
  await page.locator("#fp-pay-btn").click();
  await confirmation;
  await repondre3ds(page, "echouer");
  await expect(page.locator("#fp-alert")).toBeVisible({ timeout: 60_000 });
  expect(new URL(page.url()).pathname).toBe("/checkout-payment.html");
  await expect(page.getByText(/Compte activé|Abonnement activé|Paiement enregistré/i)).toHaveCount(0);
  await exigerPreuvesStripe(email, { positif: false, delaiMs: 30_000, plan: "standard" });
  const org = await organisationEn(email);
  if (org !== undefined) expect(org === null || org["subscription_status"] !== "trialing", "organisation non premium").toBe(true);
});

test("3DS requis puis refus apres authentification (4000 0084 0000 1629, a confirmer) : aucune souscription", async ({ page, context, nouvelEmail, stripeCleanup }) => {
  const email = await nouvelEmail("3ds-refus");
  await preparerContexte(context, "standard");
  await inscriptionJusquAuPaiement(page, email, stripeCleanup);
  await attendrePaymentElementReel(page);
  await saisirCarte(page, CARTES.authPuisRefus);
  const confirmation = attendreConfirmationStripe(page, stripeCleanup);
  await page.locator("#fp-pay-btn").click();
  await confirmation;
  await repondre3ds(page, "reussir").catch(() => undefined);   // selon le comportement reel de la carte sur SetupIntent
  await expect(page.locator("#fp-alert").or(page.locator("#fp-title"))).toBeVisible({ timeout: 60_000 });
  const d = await exigerPreuvesStripe(email, { positif: false, delaiMs: 30_000, plan: "standard" });
  expect(d.every((x) => x.ok)).toBe(true);
});
