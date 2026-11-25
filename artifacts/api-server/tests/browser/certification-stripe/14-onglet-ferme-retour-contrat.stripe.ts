/**
 * 14. Onglet ferme, retour arriere, double soumission du formulaire (mode contrat, campagne du 18/11/2026).
 * Chaque test imprime `[CERT14] <etiquette> email=<adresse>` : les preuves cote Stripe (abonnements du client) et base
 * (organisations de cette adresse) se lisent ensuite avec le connecteur Stripe TEST et Supabase « Flowpoint test » (lecture seule).
 */
import { test, expect, exigerContrat, emailSynthetique, consentement, jusquAuPaiement, attributionDeTest, saisirCarte, CARTES, espionner } from "./support/contrat.ts";
import { remplirFormulaireInscription } from "./support/stripe-reel.ts";

exigerContrat();

test("onglet ferme juste apres la confirmation Stripe (finalize bloque) : le webhook seul cree l'abonnement", async ({ page, context }) => {
  const email = emailSynthetique("onglet-ferme");
  console.log(`[CERT14] onglet-ferme email=${email}`);
  await consentement(context);
  await context.route("**/api/public/finalize-checkout", (r) => r.abort());
  await jusquAuPaiement(page, "pro", email, attributionDeTest());
  await saisirCarte(page, CARTES.succes);
  const conf = page.waitForResponse((r) => /api\.stripe\.com\/v1\/setup_intents\/seti_[^/]+\/confirm/.test(r.url()), { timeout: 60_000 });
  await page.locator("#fp-pay-btn").click();
  expect((await conf).status(), "confirmation Stripe acceptee").toBe(200);
  await page.close();
});

test("retour arriere avant paiement : retour sur checkout puis nouveau passage, une seule souscription", async ({ page, context }) => {
  const email = emailSynthetique("retour-avant");
  console.log(`[CERT14] retour-avant email=${email}`);
  await consentement(context);
  const espion = await jusquAuPaiement(page, "standard", email, attributionDeTest());
  await page.goBack();
  await page.waitForURL(/\/checkout\.html/, { timeout: 30_000 });
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-payment\.html/, { timeout: 60_000 });
  const { attendrePaymentElementReel } = await import("./support/contrat.ts");
  await attendrePaymentElementReel(page);
  await saisirCarte(page, CARTES.succes);
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 120_000 });
  await expect.poll(() => espion.souscriptions().length, { timeout: 120_000 }).toBe(1);
});

test("retour arriere apres paiement : revenir sur la page de paiement ne cree pas de seconde souscription", async ({ page, context }) => {
  const email = emailSynthetique("retour-apres");
  console.log(`[CERT14] retour-apres email=${email}`);
  await consentement(context);
  const espion = await jusquAuPaiement(page, "ultra", email, attributionDeTest());
  await saisirCarte(page, CARTES.succes);
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 120_000 });
  await expect.poll(() => espion.souscriptions().length, { timeout: 120_000 }).toBe(1);
  await page.goBack().catch(() => undefined);
  await page.waitForTimeout(8_000);
  const url = new URL(page.url()).pathname;
  console.log(`[CERT14] retour-apres page_apres_retour=${url}`);
  const bouton = page.locator("#fp-pay-btn");
  if (/checkout-payment/.test(url) && await bouton.isVisible().catch(() => false) && await bouton.isEnabled().catch(() => false)) {
    await saisirCarte(page, CARTES.succes).catch(() => undefined);
    await bouton.click().catch(() => undefined);
    await page.waitForTimeout(15_000);
  }
  expect(espion.souscriptions(), "une seule souscription apres retour arriere").toHaveLength(1);
});

test("double soumission du formulaire d'inscription (double clic) : une seule organisation", async ({ page, context }) => {
  const email = emailSynthetique("double-inscription");
  console.log(`[CERT14] double-inscription email=${email}`);
  await consentement(context);
  const espion = espionner(page);
  const a = attributionDeTest();
  await page.goto(`/signin.html?plan=pro&lang=en&utm_source=${a.utm_source}&utm_medium=${a.utm_medium}&utm_campaign=${a.utm_campaign}&fp_source=${a.fp_source}&fp_vid=${a.vid}`);
  await remplirFormulaireInscription(page, email);
  await page.locator("#signup-btn").dblclick();
  await page.waitForURL(/\/checkout\.html/, { timeout: 60_000 });
  await page.waitForTimeout(5_000);
  const pre = espion.par(/pre-register/, "POST");
  console.log(`[CERT14] double-inscription pre-register statuts=${pre.map((p) => p.statut).join(",")}`);
  expect(pre.length, "au moins un appel").toBeGreaterThan(0);
});
