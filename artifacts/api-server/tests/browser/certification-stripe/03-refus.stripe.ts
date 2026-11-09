/** 3. Carte refusee reelle : message clair, aucune souscription, puis reprise avec 4242 -> UNE souscription. */
import { test, expect, exigerConfiguration, preparerContexte, inscriptionJusquAuPaiement, attendrePaymentElementReel, saisirCarte, CARTES, exigerPreuvesStripe, exigerUneSeuleSouscriptionStable } from "./support/stripe-reel";

exigerConfiguration();

for (const [nom, carte] of [["4000 0000 0000 0002", CARTES.refusee], ["4000 0000 0000 9995 (a confirmer sur SetupIntent)", CARTES.refuseeFonds]] as const) {
  test(`carte refusee ${nom} puis reprise reussie`, async ({ page, context, nouvelEmail }) => {
    const email = nouvelEmail("refus");
    await preparerContexte(context);
    await inscriptionJusquAuPaiement(page, email);
    await attendrePaymentElementReel(page);
    await saisirCarte(page, carte);
    await page.locator("#fp-pay-btn").click();
    await expect(page.locator("#fp-alert")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#fp-pay-btn")).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe("/checkout-payment.html");
    await exigerPreuvesStripe(email, { positif: false, delaiMs: 20_000 });
    // Reprise : on remplace le numero par une carte valide, sur la meme page.
    await saisirCarte(page, CARTES.succes);
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-return\.html/, { timeout: 90_000 });
    await expect(page.locator("#fp-title")).toHaveText(/Compte activé/i, { timeout: 90_000 });
    await exigerPreuvesStripe(email);
    await exigerUneSeuleSouscriptionStable(email);
  });
}
