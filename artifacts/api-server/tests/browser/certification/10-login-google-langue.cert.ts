/**
 * 10. login.html : le bouton Google transmet la langue choisie.
 * Phase 1 « P0 » : sans `language`, le serveur retenait l'anglais pour une inscription Google lancee depuis cette page.
 * Google est SIMULE : la requete de depart est interceptee et abandonnee, aucun appel reel.
 */
import { test, expect, IS_LOCAL } from "./support/fixtures";

test.skip(!IS_LOCAL, "Harnais local uniquement.");

const LID = "AbCdEfGhIjKlMnOpQrStUv";

test.describe("10. Connexion Google", () => {
  test("le bouton Google de login.html transmet la langue choisie et le fp_lid", async ({ page, context }) => {
    await page.addInitScript((lid) => {
      try { localStorage.setItem("fp:language", "fr"); sessionStorage.setItem("fp_lid", lid); } catch { /* ignore */ }
    }, LID);
    let depart = "";
    await context.route("**/api/auth/google/login**", async (route) => { depart = route.request().url(); await route.abort("blockedbyclient"); });
    await page.goto("/login.html");
    const bouton = page.locator("#fp-google-btn");
    await expect(bouton).toBeVisible({ timeout: 10_000 });
    await bouton.click();
    await expect.poll(() => depart).not.toBe("");
    const u = new URL(depart);
    expect(u.searchParams.get("language")).toBe("fr");
    expect(u.searchParams.get("fp_lid")).toBe(LID);
  });

  test("sans preference enregistree : anglais, jamais deduit du navigateur", async ({ page, context }) => {
    await page.addInitScript(() => { try { localStorage.removeItem("fp:language"); } catch { /* ignore */ } });
    let depart = "";
    await context.route("**/api/auth/google/login**", async (route) => { depart = route.request().url(); await route.abort("blockedbyclient"); });
    await page.goto("/login.html");
    await page.locator("#fp-google-btn").click();
    await expect.poll(() => depart).not.toBe("");
    expect(new URL(depart).searchParams.get("language")).toBe("en");
  });
});
