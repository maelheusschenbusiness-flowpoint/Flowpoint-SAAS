import { test, expect, request } from "@playwright/test";
import { allerA, compteRecette } from "../socle/aides.js";

/**
 * Parcours 6 — PERMISSIONS.
 *
 * Deux choses a prouver, et elles sont differentes :
 *   - l'interface propose bien les actions d'administration au proprietaire ;
 *   - le SERVEUR refuse ces actions a qui n'a pas le role, car masquer un
 *     bouton n'est pas une protection. C'est ce second point qui compte.
 */
test("le proprietaire voit les actions d'administration de l'equipe", async ({ page }) => {
  await allerA(page, "team");
  await expect(page.locator("#team-invite-btn")).toBeVisible();
});

test("une requete sans session est refusee sur chaque endpoint prive", async ({ baseURL }) => {
  // `request.newContext()` HERITE du storageState declare dans la config : sans
  // le vider explicitement, le contexte « anonyme » porte la session et tous
  // les endpoints repondent 200. Premiere version de ce test : six endpoints
  // prives etaient declares joignables sans session — c'etait le test qui etait
  // faux, pas le produit (verifie : `curl` sans cookie recoit bien 401).
  const anonyme = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const prives = [
    "/api/me", "/api/monitors", "/api/audits", "/api/team",
    "/api/missions", "/api/reports", "/api/settings/organization",
  ];
  const passants: string[] = [];
  for (const chemin of prives) {
    const r = await anonyme.get(chemin);
    if (r.status() !== 401 && r.status() !== 403 && r.status() !== 404) {
      passants.push(`${chemin} -> ${r.status()}`);
    }
  }
  await anonyme.dispose();
  expect(passants, `endpoints prives joignables sans session : ${passants.join(", ")}`).toEqual([]);
});

test("une cle d'administration absente ou fausse ne donne aucun acces", async ({ baseURL }) => {
  // `request.newContext()` HERITE du storageState declare dans la config : sans
  // le vider explicitement, le contexte « anonyme » porte la session et tous
  // les endpoints repondent 200. Premiere version de ce test : six endpoints
  // prives etaient declares joignables sans session — c'etait le test qui etait
  // faux, pas le produit (verifie : `curl` sans cookie recoit bien 401).
  const anonyme = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const sans = await anonyme.post("/api/admin/provision-qa-account", { data: {} });
  const fausse = await anonyme.post("/api/admin/provision-qa-account", {
    headers: { "x-admin-key": "x".repeat(64) }, data: {},
  });
  await anonyme.dispose();
  expect(sans.ok(), "le provisionnement a abouti SANS cle").toBe(false);
  expect(fausse.ok(), "le provisionnement a abouti avec une FAUSSE cle").toBe(false);
});

test("une organisation ne peut pas lire les donnees d'une autre en changeant l'identifiant", async ({ page, baseURL }) => {
  const { orgId } = compteRecette();
  const autre = "00000000-0000-4000-8000-0000000000ff";
  expect(autre).not.toBe(orgId);

  // Toute tentative de choisir son organisation par parametre doit etre ignoree
  // ou refusee : jamais honoree.
  for (const chemin of [
    `/api/monitors?orgId=${autre}`,
    `/api/audits?org_id=${autre}`,
    `/api/missions?orgId=${autre}`,
  ]) {
    const r = await page.request.get(`${baseURL}${chemin}`);
    if (!r.ok()) continue;                       // refus : parfait
    const texte = await r.text();
    expect(texte, `${chemin} a renvoye des donnees portant l'organisation d'autrui`)
      .not.toContain(autre);
  }
});
