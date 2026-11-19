/**
 * 20. Campagne add-ons « A » (Organic Campaign Tracker, Technical SEO Fix Verification) - creation des organisations jetables
 * par le VRAI parcours d'inscription (Payment Element reel, carte 4242, essai 14 j) sur la beta de test.
 * Chaque test imprime `[CERTA] <etiquette> email=<adresse> sub=<sub_...>` : la suite des preuves (achat de l'add-on, webhooks,
 * droits, annulation) est conduite par `tools/certification-addons-a/` et le connecteur Stripe TEST.
 * Utilisateurs (`@flowpoint.test`, prefixe fp-cert-a-) et cartes sont SYNTHETIQUES. Mode contrat : aucune cle secrete.
 */
import { test, expect, exigerContrat, consentement, jusquAuPaiement, attributionDeTest, saisirCarte, CARTES } from "./support/contrat.ts";

exigerContrat();

const COMPTES: Array<{ etiquette: string; plan: "standard" | "pro" | "ultra" }> = (process.env["CERT_A_COMPTES"] ?? "tracker:pro,tech:standard")
  .split(",").map((s) => { const [etiquette, plan] = s.split(":"); return { etiquette: etiquette!, plan: plan as "standard" | "pro" | "ultra" }; });

for (const { etiquette, plan } of COMPTES) {
  test(`compte ${etiquette} (${plan}) : inscription reelle -> carte 4242 -> essai -> abonnement`, async ({ page, context }) => {
    const email = `fp-cert-a-${etiquette}-${Date.now().toString(36)}@flowpoint.test`;
    await consentement(context);
    const espion = await jusquAuPaiement(page, plan, email, attributionDeTest());
    await saisirCarte(page, CARTES.succes);
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-return\.html/, { timeout: 120_000 });
    await expect.poll(() => espion.souscriptions().length, { timeout: 120_000 }).toBe(1);
    const sub = espion.souscriptions()[0]!;
    console.log(`[CERTA] ${etiquette} plan=${plan} email=${email} sub=${sub}`);
  });
}
