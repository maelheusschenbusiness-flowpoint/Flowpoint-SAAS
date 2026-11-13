import { test, expect } from "@playwright/test";
import { assurerSession } from "../socle/aides.js";

/**
 * Parcours 7 — DECONNEXION.
 *
 * Se deconnecter doit reellement couper l'acces. Un bouton qui vide l'ecran
 * sans revoquer la session cote serveur laisse un jeton valide dans la nature :
 * c'est ce point qui est verifie, pas l'apparence.
 */
test("se deconnecter coupe reellement l'acces, cote navigateur ET cote serveur", async ({ page, baseURL }) => {
  // Les trois verifications sont faites dans UNE session : chaque reconnexion
  // consomme le quota d'authentification (10 par quart d'heure et par IP), et
  // chaque connexion revoque les autres sessions.
  // Les parcours de connexion joues juste avant ont revoque la session
  // partagee : FlowPoint n'autorise qu'une session active par utilisateur.
  await assurerSession(page);
  await page.goto("/dashboard.html");
  await page.waitForSelector("#fp-logout-btn", { timeout: 25_000 });

  const jeton = await page.evaluate(() =>
    sessionStorage.getItem("fp_session_token") ?? localStorage.getItem("fp_session_token"));

  await page.locator("#fp-logout-btn").click();
  await page.waitForURL(/login\.html|signin\.html|\/$/, { timeout: 20_000 });

  // 1. On est ramene hors du tableau de bord.
  await expect(page.locator("body")).not.toContainText(/vue d'ensemble/i);

  // 2. Y revenir ne redonne pas les donnees.
  await page.goto("/dashboard.html");
  await page.waitForTimeout(4_000);
  const contenu = await page.locator("body").textContent();
  const renvoye = /login\.html|signin\.html/.test(page.url());
  expect(renvoye || !/vue d'ensemble/i.test(contenu ?? ""),
    "le tableau de bord reste accessible apres deconnexion").toBe(true);

  // 3. Et surtout : le jeton d'avant la deconnexion n'ouvre plus rien. C'est
  //    le seul point qui distingue une vraie revocation d'un simple nettoyage
  //    du navigateur.
  if (jeton) {
    const r = await page.request.get(`${baseURL}/api/me`, {
      headers: { Authorization: `Bearer ${jeton}` },
    });
    expect(r.status(), "le jeton d'avant la deconnexion ouvre encore une session").not.toBe(200);
  }
});
