/**
 * 20. Agent B — organisations jetables pour la certification des add-ons SEO Change Impact et Conversion Opportunity Engine.
 * Parcours REEL (signin.html?plan=pro -> checkout -> Payment Element Stripe TEST, carte 4242, essai 14 j).
 * Imprime `[CERT-B] <etiquette> email=<adresse> sub=<id>` ; la suite se poursuit par l'API de la bete
 * (tools/certification-stripe/addons-b-api.mjs) et les preuves Stripe/base sont lues via les connecteurs.
 * E-mails `@flowpoint.test` (prefixe fp-cert-b-), cartes de test officielles. Aucun LIVE.
 */
import { test, expect, exigerContrat, emailSynthetique, consentement, jusquAuPaiement, attributionDeTest, saisirCarte, CARTES } from "./support/contrat.ts";

exigerContrat();

for (const addon of ["seo", "conv"] as const) {
  test(`inscription Pro d'essai jetable pour l'add-on ${addon}`, async ({ page, context }) => {
    const email = emailSynthetique(`b-${addon}`);
    await consentement(context);
    const espion = await jusquAuPaiement(page, "pro", email, attributionDeTest());
    await saisirCarte(page, CARTES.succes);
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-return\.html/, { timeout: 120_000 });
    await expect.poll(() => espion.souscriptions().length, { timeout: 120_000 }).toBe(1);
    console.log(`[CERT-B] ${addon} email=${email} sub=${espion.souscriptions()[0]} t=${new Date().toISOString()}`);
  });
}
