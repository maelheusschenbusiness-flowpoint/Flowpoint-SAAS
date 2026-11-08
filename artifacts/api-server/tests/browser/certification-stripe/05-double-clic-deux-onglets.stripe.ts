/** 5. Double clic et deux onglets sur la meme page de paiement : exactement UNE souscription. */
import { test, expect, exigerConfiguration, preparerContexte, inscriptionJusquAuPaiement, attendrePaymentElementReel, saisirCarte, CARTES, exigerPreuvesStripe, exigerUneSeuleSouscriptionStable } from "./support/stripe-reel";

exigerConfiguration();

test("double clic sur « Demarrer l'essai » : une seule souscription", async ({ page, context, nouvelEmail }) => {
  const email = nouvelEmail("double-clic");
  await preparerContexte(context);
  await inscriptionJusquAuPaiement(page, email);
  await attendrePaymentElementReel(page);
  await saisirCarte(page, CARTES.succes);
  await page.locator("#fp-pay-btn").dblclick();
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 90_000 });
  await exigerPreuvesStripe(email);
  await exigerUneSeuleSouscriptionStable(email);
});

test("deux onglets : les deux confirment la meme carte en meme temps : une seule souscription", async ({ page, context, nouvelEmail }) => {
  const email = nouvelEmail("deux-onglets");
  await preparerContexte(context);
  await inscriptionJusquAuPaiement(page, email);
  const url = page.url();
  const second = await context.newPage();                      // meme contexte : le jeton de pre-inscription (localStorage) est partage
  await second.goto(url);
  await attendrePaymentElementReel(page);
  await attendrePaymentElementReel(second);
  await saisirCarte(page, CARTES.succes);
  await saisirCarte(second, CARTES.succes);
  await Promise.all([page.locator("#fp-pay-btn").click(), second.locator("#fp-pay-btn").click()]);
  await expect.poll(async () => (/checkout-return/.test(page.url()) || /checkout-return/.test(second.url())), { timeout: 90_000 }).toBe(true);
  await exigerPreuvesStripe(email);
  await exigerUneSeuleSouscriptionStable(email);
});
