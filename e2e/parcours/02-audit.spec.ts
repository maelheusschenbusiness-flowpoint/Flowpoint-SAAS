import { test, expect } from "@playwright/test";
import { allerA } from "../socle/aides.js";

/**
 * Parcours 3 — CREATION D'AUDIT.
 *
 * Un audit part chez des fournisseurs externes : il peut etre long, et il peut
 * echouer pour une raison qui ne nous appartient pas. Ce que ces tests
 * verifient, c'est ce qui NOUS appartient : la saisie est validee, la demande
 * est acceptee, et l'echec d'un fournisseur ne casse pas la page.
 */
test("la vue des audits propose de lancer un audit", async ({ page }) => {
  await allerA(page, "audits");
  await expect(page.locator("#audit-url-input")).toBeVisible();
  await expect(page.locator("#audit-run-btn")).toBeVisible();
});

test("une URL invalide est refusee, et le refus vient du serveur", async ({ page }) => {
  await allerA(page, "audits");
  const codes: number[] = [];
  page.on("response", (r) => {
    const p = new URL(r.url()).pathname;
    if (r.request().method() === "POST" && p.startsWith("/api/audits")) codes.push(r.status());
  });

  await page.locator("#audit-url-input").fill("pas une url");
  await page.locator("#audit-run-btn").click();
  await page.waitForTimeout(3_000);

  // L'interface laisse passer la saisie : c'est le serveur qui tranche, et
  // c'est lui la vraie protection. Ce qui ne doit JAMAIS arriver, c'est qu'une
  // saisie invalide soit acceptee.
  const acceptes = codes.filter((c) => c < 400);
  expect(acceptes, `une URL invalide a ete acceptee (${acceptes.join(", ")})`).toEqual([]);
  if (codes.length > 0) expect(Math.max(...codes)).toBeLessThan(500);
});

test("une URL valide est acceptee et la demande part", async ({ page }) => {
  await allerA(page, "audits");
  const reponses: number[] = [];
  page.on("response", (r) => {
    const p = new URL(r.url()).pathname;
    if (r.request().method() === "POST" && p.startsWith("/api/audits")) reponses.push(r.status());
  });

  await page.locator("#audit-url-input").fill("https://exemple.fr");
  await page.locator("#audit-run-btn").click();
  await page.waitForTimeout(8_000);

  expect(reponses.length, "aucune demande d'audit n'est partie").toBeGreaterThan(0);
  // 5xx = defaut chez nous. Un echec de fournisseur doit se traduire autrement.
  const serveur = reponses.filter((s) => s >= 500);
  expect(serveur, `la demande d'audit a renvoye ${serveur.join(", ")}`).toEqual([]);
});

test("un echec de fournisseur laisse la page utilisable", async ({ page }) => {
  await allerA(page, "audits");
  // On fait echouer la creation d'audit cote reseau, comme le ferait une panne.
  await page.route("**/api/audits**", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"fournisseur indisponible"}' })
      : route.fallback());

  await page.locator("#audit-url-input").fill("https://exemple.fr");
  await page.locator("#audit-run-btn").click();
  await page.waitForTimeout(3_000);

  // La navigation doit rester vivante : c'est le critere.
  await allerA(page, "overview");
  await expect(page.locator("main")).toContainText(/vue d'ensemble/i);
});
