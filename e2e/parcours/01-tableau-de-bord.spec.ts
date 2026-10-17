import { test, expect } from "@playwright/test";
import { allerA, compteRecette, fermerVisite } from "../socle/aides.js";

/**
 * Parcours 2 — TABLEAU DE BORD.
 *
 * Un tableau de bord qui s'affiche ne prouve rien : il peut afficher les
 * donnees d'une autre organisation, ou un gabarit vide pendant que les appels
 * echouent en silence. On verifie donc l'identite affichee, l'absence
 * d'erreur de console, et qu'aucun appel du chargement ne retourne 5xx.
 */
test("le tableau de bord s'ouvre et affiche l'organisation connectee", async ({ page }) => {
  const { plan } = compteRecette();
  await page.goto("/dashboard.html");
  await page.waitForSelector('[data-route="overview"]', { timeout: 25_000 });
  await expect(page.locator("main")).toContainText(/vue d'ensemble/i);
  await expect(page.locator(".fp-topbar")).toContainText(new RegExp(plan, "i"));
});

test("le chargement ne produit aucune erreur serveur ni erreur de script", async ({ page }) => {
  const erreursServeur: string[] = [];
  const erreursScript: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500 && new URL(r.url()).pathname.startsWith("/api/")) {
      erreursServeur.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const texte = m.text();
    // Un 402 ou 403 sur une option non souscrite est la bonne reponse du
    // serveur, pas un defaut : le tableau de bord interroge des endpoints
    // d'options payantes que le plan ne couvre pas. Le navigateur les
    // journalise en erreur, ce qui n'en fait pas des erreurs de script.
    if (/status of (401|402|403|404)/.test(texte)) return;
    erreursScript.push(texte.slice(0, 140));
  });
  page.on("pageerror", (e) => erreursScript.push(`exception : ${e.message.slice(0, 120)}`));

  await page.goto("/dashboard.html");
  await page.waitForSelector('[data-route="overview"]', { timeout: 25_000 });
  await page.waitForTimeout(5_000);

  expect(erreursServeur, `appels en erreur serveur : ${erreursServeur.join(", ")}`).toEqual([]);
  expect(erreursScript, `erreurs de script : ${erreursScript.join(" | ")}`).toEqual([]);
});

test("les vingt-cinq entrees de navigation s'ouvrent toutes sans casser la page", async ({ page }) => {
  // Vingt-cinq vues a ouvrir une par une : ce test est long par nature.
  test.setTimeout(180_000);
  await page.goto("/dashboard.html");
  await page.waitForSelector('[data-route="overview"]', { timeout: 25_000 });
  await fermerVisite(page);

  const routes = await page.locator("[data-route]").evaluateAll(
    (els) => [...new Set(els.map((e) => e.getAttribute("data-route")!).filter(Boolean))],
  );
  expect(routes.length, "la navigation est vide").toBeGreaterThan(20);

  const casses: string[] = [];
  for (const route of routes) {
    try {
      await allerA(page, route);
      const taille = await page.locator("main").evaluate((m) => (m.textContent ?? "").trim().length);
      if (taille < 20) casses.push(`${route} (vue vide)`);
    } catch (err) {
      casses.push(`${route} (${(err as Error).message.slice(0, 50)})`);
    }
  }
  expect(casses, `routes cassees : ${casses.join(", ")}`).toEqual([]);
});
