import { test, expect, request } from "@playwright/test";
import { compteRecette, demanderLienDeConnexion } from "../socle/aides.js";

/**
 * Parcours 1 — CONNEXION, joue en entier.
 *
 * C'est le parcours le plus critique du produit : sans lui, rien d'autre n'est
 * atteignable. Il repart donc d'une page vierge, sans reutiliser la session du
 * socle, et traverse toute la chaine : saisie de l'adresse, demande de lien,
 * verification du lien, arrivee sur le tableau de bord.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("la page de connexion s'affiche et attend une adresse", async ({ page }) => {
  await page.goto("/login.html");
  await expect(page.getByPlaceholder("vous@exemple.com")).toBeVisible();
  await expect(page.getByRole("button", { name: /lien de connexion/i })).toBeEnabled();
});

test("demander un lien affiche une confirmation, sans divulguer le lien a l'ecran", async ({ page }) => {
  const { email } = compteRecette();
  await page.goto("/login.html");
  await page.getByPlaceholder("vous@exemple.com").fill(email);
  await page.getByRole("button", { name: /lien de connexion/i }).click();

  await expect(page.getByText(/lien envoy/i)).toBeVisible({ timeout: 15_000 });
  // Le jeton ne doit jamais apparaitre dans la page : il part par courriel.
  await expect(page.locator("body")).not.toContainText("login-verify.html?token=");
});

test("le lien de verification ouvre une session et mene au tableau de bord", async ({ page, baseURL }) => {
  const { email } = compteRecette();
  const api = await request.newContext({ baseURL });
  const lien = await demanderLienDeConnexion(api, email);
  await api.dispose();

  await page.goto(lien);
  await page.waitForURL(/dashboard\.html/, { timeout: 30_000 });
  await expect(page.locator('[data-route="overview"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#fp-logout-btn")).toBeVisible();
});

test("un jeton de verification ne sert qu'une fois", async ({ page, baseURL }) => {
  const { email } = compteRecette();
  const api = await request.newContext({ baseURL });
  const lien = await demanderLienDeConnexion(api, email);
  await api.dispose();

  const jeton = new URL(lien).searchParams.get("token")!;
  const api2 = await request.newContext({ baseURL });
  const premier = await api2.post("/api/auth/login-verify", {
    headers: { "Content-Type": "application/json" }, data: { token: jeton },
  });
  const second = await api2.post("/api/auth/login-verify", {
    headers: { "Content-Type": "application/json" }, data: { token: jeton },
  });
  await api2.dispose();

  expect(premier.ok(), "la premiere verification doit reussir").toBe(true);
  expect(second.ok(), "un jeton rejoue a ete accepte une seconde fois").toBe(false);
  void page;
});

test("un jeton inconnu est refuse", async ({ baseURL }) => {
  const api = await request.newContext({ baseURL });
  const r = await api.post("/api/auth/login-verify", {
    headers: { "Content-Type": "application/json" },
    data: { token: "f".repeat(64) },
  });
  await api.dispose();
  expect(r.ok()).toBe(false);
});
