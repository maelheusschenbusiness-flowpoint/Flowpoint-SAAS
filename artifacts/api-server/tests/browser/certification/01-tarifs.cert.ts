/**
 * 1. Tarifs : chaque plan mene DIRECTEMENT au parcours d'inscription, plan conserve (PR #374).
 * Lecture seule : aucune ecriture, tourne aussi contre l'environnement de test.
 */
import { test, expect, PLANS, unexpectedConsoleErrors, ANON_OK, BASE_URL } from "./support/fixtures";

test.describe("1. Tarifs -> choix du plan", () => {
  for (const plan of PLANS) {
    test(`le bouton « ${plan} » mene au parcours d'inscription avec le plan conserve`, async ({ page, observed, shot }) => {
      await page.goto("/pricing.html");
      const btn = page.locator(`.fp-card-btn[data-plan="${plan}"]`);
      await expect(btn).toBeVisible();
      await shot(page, "tarifs");
      await btn.scrollIntoViewIfNeeded();
      await btn.click();

      // Arrivee directe sur le parcours (visiteur anonyme => inscription), sans etape intermediaire.
      await page.waitForURL(/\/signin\.html/, { timeout: 15_000 });
      expect(new URL(page.url()).pathname).toBe("/signin.html");

      // Plan conserve dans le panier, avec horodatage frais.
      const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("fp_cart") ?? "null"));
      expect(cart?.plan).toBe(plan);
      expect(Date.now() - cart._updatedAt).toBeLessThan(60_000);

      // Le formulaire annonce la suite reelle (paiement), pas un nouveau choix de plan.
      await expect(page.locator("#signup-btn-text")).toHaveText("Continuer vers le paiement →");
      await expect(page.locator("#plan-screen")).toBeHidden();
      await shot(page, "inscription");
      expect(unexpectedConsoleErrors(observed, ANON_OK)).toEqual([]);
    });
  }

  test("l'essai de 14 jours et la carte obligatoire sont annonces sur le plan choisi", async ({ page }) => {
    await page.goto("/pricing.html");
    await page.locator('.fp-card-btn[data-plan="pro"]').click();
    await page.waitForURL(/\/signin\.html/);
    await page.goto("/signin.html");   // fp_cart garde le plan ; l'ecran de choix n'est affiche qu'apres le formulaire
    await expect(page.locator("#signup-screen")).toBeVisible();
    await expect(page.getByText("14 jours d'essai gratuit", { exact: false }).first()).toBeAttached();
    await expect(page.getByText("Carte requise", { exact: false }).first()).toBeAttached();
  });

  test("la page tarifs est utilisable au format mobile (pas de debordement horizontal)", async ({ page }) => {
    await page.goto("/pricing.html");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    for (const p of PLANS) await expect(page.locator(`.fp-card-btn[data-plan="${p}"]`)).toBeVisible();
  });
  void BASE_URL;
});
