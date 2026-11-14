/** 11. Scenarios d'echec REELS (mode contrat) : aucune souscription ni droit premium incorrect n'est cree. */
import { test, expect, exigerContrat, emailSynthetique, consentement, jusquAuPaiement, attributionDeTest, saisirCarte, repondre3ds, sauterSiHCaptcha, CARTES } from "./support/contrat.ts";

exigerContrat();

test("carte refusee (4000 0000 0000 0002) : message d'erreur, aucune finalisation, on reste sur le paiement", async ({ page, context }) => {
  await consentement(context);
  const espion = await jusquAuPaiement(page, "pro", emailSynthetique("refus"), attributionDeTest());
  await saisirCarte(page, CARTES.refusee);
  await page.locator("#fp-pay-btn").click();
  await expect(page.locator("#fp-alert")).toBeVisible({ timeout: 60_000 });
  expect(new URL(page.url()).pathname).toBe("/checkout-payment.html");
  await page.waitForTimeout(5_000);
  expect(espion.par(/finalize-checkout/, "POST"), "aucune finalisation apres un refus").toHaveLength(0);
  expect(espion.souscriptions()).toHaveLength(0);
});

test("3-D Secure reussi (4000 0025 0000 3155) : une souscription", async ({ page, context }) => {
  await consentement(context);
  const espion = await jusquAuPaiement(page, "standard", emailSynthetique("3ds-ok"), attributionDeTest());
  await saisirCarte(page, CARTES.authentification3ds);
  await page.locator("#fp-pay-btn").click();
  await sauterSiHCaptcha(page);
  await repondre3ds(page, "reussir");
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 120_000 });
  await expect.poll(() => espion.souscriptions().length, { timeout: 120_000 }).toBe(1);
});

test("3-D Secure echoue : erreur, aucune finalisation, aucune souscription", async ({ page, context }) => {
  await consentement(context);
  const espion = await jusquAuPaiement(page, "standard", emailSynthetique("3ds-ko"), attributionDeTest());
  await saisirCarte(page, CARTES.authentification3ds);
  await page.locator("#fp-pay-btn").click();
  await sauterSiHCaptcha(page);
  await repondre3ds(page, "echouer");
  await expect(page.locator("#fp-alert")).toBeVisible({ timeout: 60_000 });
  expect(new URL(page.url()).pathname).toBe("/checkout-payment.html");
  await page.waitForTimeout(5_000);
  expect(espion.souscriptions()).toHaveLength(0);
});

test("double clic sur le bouton de validation : une seule souscription", async ({ page, context }) => {
  await consentement(context);
  const espion = await jusquAuPaiement(page, "pro", emailSynthetique("double-clic"), attributionDeTest());
  await saisirCarte(page, CARTES.succes);
  await page.locator("#fp-pay-btn").dblclick();
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 120_000 });
  await expect.poll(() => espion.souscriptions().length, { timeout: 120_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(8_000);
  expect(espion.souscriptions(), "double clic : UNE souscription").toHaveLength(1);
});

test("deux onglets ouverts sur le meme paiement : une seule souscription", async ({ page, context }) => {
  await consentement(context);
  const espion1 = await jusquAuPaiement(page, "pro", emailSynthetique("deux-onglets"), attributionDeTest());
  const url = page.url();
  const page2 = await context.newPage();
  const { espionner } = await import("./support/contrat.ts");
  const espion2 = espionner(page2);
  await page2.goto(url);
  await saisirCarte(page, CARTES.succes);
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 120_000 });
  await expect.poll(() => espion1.souscriptions().length, { timeout: 120_000 }).toBe(1);
  // Le second onglet tente a son tour : jamais une deuxieme souscription.
  await page2.bringToFront();
  const bouton = page2.locator("#fp-pay-btn");
  if (await bouton.isVisible().catch(() => false) && await bouton.isEnabled().catch(() => false)) {
    await attendreOnglet(page2);
    await saisirCarte(page2, CARTES.succes).catch(() => undefined);
    await bouton.click().catch(() => undefined);
    await page2.waitForTimeout(15_000);
  }
  const ids = new Set([...espion1.souscriptions(), ...espion2.souscriptions()]);
  expect(ids.size, "deux onglets : une seule souscription").toBe(1);
});

async function attendreOnglet(p: import("@playwright/test").Page) {
  await p.locator("#fp-payment-element iframe").first().waitFor({ state: "attached", timeout: 60_000 }).catch(() => undefined);
}

test("actualisation pendant la finalisation puis retour navigateur : jamais une deuxieme souscription", async ({ page, context }) => {
  await consentement(context);
  const espion = await jusquAuPaiement(page, "standard", emailSynthetique("actualisation"), attributionDeTest());
  await saisirCarte(page, CARTES.succes);
  await page.locator("#fp-pay-btn").click();
  await page.waitForTimeout(600);
  await page.reload().catch(() => undefined);
  await page.waitForTimeout(10_000);
  await page.goBack().catch(() => undefined);
  await page.waitForTimeout(10_000);
  expect(espion.souscriptions().length, "au plus une souscription").toBeLessThanOrEqual(1);
});
