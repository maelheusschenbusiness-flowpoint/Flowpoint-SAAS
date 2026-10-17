import { test, expect } from "@playwright/test";
import { allerA, ouvrirOngletSecondaire } from "../socle/aides.js";

/**
 * Parcours 4 — MONITORING.
 *
 * Le monitoring est la fonction que le client regarde quand quelque chose va
 * mal. Elle doit s'afficher meme sans aucun moniteur, et la creation doit etre
 * joignable.
 */
test("la vue monitoring s'affiche, y compris sans aucun moniteur", async ({ page }) => {
  await allerA(page, "monitors");
  await expect(page.locator("main")).toContainText(/monitor/i);
  await expect(page.locator("#monitor-new-btn")).toBeVisible();
});

test("les onglets du monitoring s'ouvrent tous", async ({ page }) => {
  await allerA(page, "monitors");
  const casses: string[] = [];
  for (const onglet of ["Status", "Performance", "Incidents", "Config", "SLA"]) {
    let ouvert = false;
    try { ouvert = await ouvrirOngletSecondaire(page, onglet); }
    catch { casses.push(`${onglet} (inatteignable)`); continue; }
    if (!ouvert) { casses.push(`${onglet} (absent)`); continue; }
    await page.waitForTimeout(800);
    const taille = await page.locator("main").evaluate((m) => (m.textContent ?? "").trim().length);
    if (taille < 40) casses.push(`${onglet} (vue vide)`);
  }
  expect(casses, `onglets du monitoring en defaut : ${casses.join(", ")}`).toEqual([]);
});

test("l'etat du monitoring en barre haute reste coherent", async ({ page }) => {
  await allerA(page, "monitors");
  const barre = page.locator("#topbar-status");
  await expect(barre).toBeVisible();
  // Sans moniteur, l'etat ne doit pas afficher une panne : il doit dire qu'il
  // n'y a rien a surveiller.
  await expect(barre).not.toContainText(/panne|down|incident/i);
});

test("une panne de l'API monitoring n'efface pas la navigation", async ({ page }) => {
  await page.route("**/api/monitors**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"indisponible"}' }));
  await allerA(page, "monitors");
  await page.waitForTimeout(2_500);
  await expect(page.locator('[data-route="overview"]')).toBeVisible();
  await allerA(page, "overview");
  await expect(page.locator("main")).toContainText(/vue d'ensemble/i);
});
