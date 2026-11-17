/**
 * 12. Retour aux tarifs et CHANGEMENT de plan (non-regression des corrections D1 et D3).
 *
 * Un visiteur qui a choisi un plan doit toujours pouvoir revenir aux tarifs et en choisir un autre : la restauration d'un panier frais
 * par pricing.html ne doit pas le renvoyer de force vers l'inscription, et le dernier plan choisi l'emporte.
 * Visiteur anonyme, aucune ecriture serveur (localStorage seulement) : tourne en local comme contre la beta.
 */
import { test, expect, poserLangue, langueCoherente, type Langue } from "./support/matrice";

const LANGS: Langue[] = ["en", "fr"];
const planDuPanier = (page: import("@playwright/test").Page) =>
  page.evaluate(() => { try { return JSON.parse(localStorage.getItem("fp_cart") || "null")?.plan ?? null; } catch { return "corrompu"; } });
// Absence de navigation : on laisse a pricing.html le temps de restaurer un panier et de relancer une redirection eventuelle.
const resteSurPricing = async (page: import("@playwright/test").Page) => {
  await page.waitForLoadState("load");
  await page.evaluate(() => new Promise<void>(r => setTimeout(r, 1500)));
  expect(new URL(page.url()).pathname, "pricing.html ne doit pas renvoyer le visiteur vers l'inscription").toBe("/pricing.html");
};

test.describe("12. Retour aux tarifs et changement de plan", () => {
  test.setTimeout(90_000);
  for (const l of LANGS) {
    test(`${l} : plan choisi, retour arriere aux tarifs, autre plan : le dernier choix l'emporte`, async ({ page, context }) => {
      await poserLangue(context, l);
      await page.goto("/pricing.html");
      await page.locator('.fp-card-btn[data-plan="pro"]').click();
      await page.waitForURL(/\/signin\.html/);
      expect(await planDuPanier(page)).toBe("pro");

      await page.goBack();
      await page.waitForURL(/\/pricing\.html/);
      await resteSurPricing(page);
      await langueCoherente(page, l);

      await page.locator('.fp-card-btn[data-plan="ultra"]').click();
      await page.waitForURL(/\/signin\.html/);
      expect(await planDuPanier(page), "le second choix remplace le premier").toBe("ultra");
    });

    test(`${l} : lien direct ?plan=pro, retour aux tarifs par la navigation, autre plan : pas de blocage ni de plan fige`, async ({ page, context }) => {
      await poserLangue(context, l);
      await page.goto("/checkout.html?plan=pro");
      await page.waitForURL(/\/signin\.html/);
      expect(await planDuPanier(page)).toBe("pro");

      await page.goto("/pricing.html");
      await resteSurPricing(page);

      await page.locator('.fp-card-btn[data-plan="ultra"]').click();
      await page.waitForURL(/\/signin\.html/);
      expect(await planDuPanier(page)).toBe("ultra");
    });
  }
});
