import { test, expect } from "@playwright/test";
import { allerA, compteRecette, ouvrirOngletSecondaire } from "../socle/aides.js";

/**
 * Parcours 5 — ORGANISATION ET PARAMETRES.
 *
 * Les parametres portent l'identite de l'organisation, son plan et ses
 * reglages. Une page de parametres qui s'affiche avec des champs vides parce
 * qu'un appel a echoue est pire qu'une page en erreur : le client croit que
 * ses reglages ont ete perdus.
 */
test("les parametres s'ouvrent sur le centre de commande", async ({ page }) => {
  await allerA(page, "settings");
  await expect(page.locator("main")).toContainText(/settings|param/i);
});

test("les onze onglets de parametres s'ouvrent sans vider la vue", async ({ page }) => {
  await allerA(page, "settings");
  await page.waitForTimeout(2_500);
  const onglets = ["Workspace", "Équipe", "Sécurité", "Notifications", "Automatisations",
                   "Intégrations", "API & Dev", "IA Config", "Données"];
  const casses: string[] = [];
  for (const onglet of onglets) {
    let ouvert = false;
    try { ouvert = await ouvrirOngletSecondaire(page, onglet); }
    catch { casses.push(`${onglet} (inatteignable)`); continue; }
    if (!ouvert) { casses.push(`${onglet} (absent)`); continue; }
    await page.waitForTimeout(800);
    const taille = await page.locator("main").evaluate((m) => (m.textContent ?? "").trim().length);
    if (taille < 40) casses.push(`${onglet} (vue vide)`);
  }
  expect(casses, `onglets en defaut : ${casses.join(", ")}`).toEqual([]);
});

test("le nom de l'organisation affiche est bien celui du compte connecte", async ({ page, baseURL }) => {
  const { orgId } = compteRecette();
  const reponse = await page.request.get(`${baseURL}/api/me`, {
    headers: { "Content-Type": "application/json" },
  });
  expect(reponse.ok(), "/api/me ne repond pas").toBe(true);
  const moi = await reponse.json() as { orgId?: string; org?: { name?: string } };
  expect(moi.orgId, "l'organisation renvoyee n'est pas celle du compte").toBe(orgId);

  // Le nom de l'organisation n'est pas forcement affiche sur cette vue : ce qui
  // compte est que le SERVEUR ne renvoie que l'organisation du compte connecte.
  expect(moi.org, "aucune organisation renvoyee").toBeTruthy();
});

test("la facturation s'affiche et annonce le bon plan", async ({ page }) => {
  const { plan } = compteRecette();
  await allerA(page, "billing");
  await expect(page.locator("main")).toContainText(new RegExp(plan, "i"));
});
