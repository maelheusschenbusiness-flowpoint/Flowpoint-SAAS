import { readFileSync } from "node:fs";
import type { Page, APIRequestContext } from "@playwright/test";

export type CompteRecette = { email: string; orgId: string; userId: string; plan: string };

export function compteRecette(): CompteRecette {
  return JSON.parse(readFileSync("e2e/.compte.json", "utf8")) as CompteRecette;
}

/**
 * Garantit que la page porte une session valide, en se reconnectant au besoin.
 *
 * MESURE DU 17/10/2026 : FlowPoint n'autorise QU'UNE session active par
 * utilisateur — une nouvelle connexion revoque la precedente (verifie : la
 * session 1 passe de 200 a 401 des que la session 2 est ouverte). Le parcours
 * de connexion, qui se connecte plusieurs fois, invalidait donc la session
 * enregistree par le socle, et les vingt-cinq tests suivants echouaient tous
 * sans que rien n'indique pourquoi.
 *
 * Chaque parcours authentifie s'assure donc lui-meme de sa session.
 */
export async function assurerSession(page: Page): Promise<void> {
  const r = await page.request.get("/api/me").catch(() => null);
  if (r && r.status() === 200) return;

  const { email } = compteRecette();
  const lien = await demanderLienDeConnexion(page.request, email);
  await page.goto(lien);
  await page.waitForURL(/dashboard\.html/, { timeout: 45_000 });
  await page.waitForSelector('[data-route="overview"]', { timeout: 45_000 });
}

/**
 * Ferme la visite guidee si elle est ouverte.
 *
 * Sur un compte neuf, la visite d'onboarding s'ouvre et son fond recouvre la
 * navigation : tout clic sur la barre laterale devient impossible tant qu'elle
 * est la. C'est le comportement voulu — elle est refermable par « Passer la
 * visite » et par la touche Echap — mais un test qui l'ignore se bloque sur
 * la vue suivante sans jamais dire pourquoi.
 */
export async function fermerVisite(page: Page): Promise<void> {
  const passer = page.getByRole("button", { name: /passer la visite/i }).first();
  if (await passer.count() > 0 && await passer.isVisible().catch(() => false)) {
    await passer.click({ timeout: 5_000 }).catch(() => undefined);
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(400);
}

/**
 * Ouvre le tableau de bord sur une route donnee.
 *
 * Toutes les entrees ne posent pas une ancre : certaines ouvrent un panneau
 * lateral ou une modale. Attendre l'ancre sur chacune coutait quinze secondes
 * de delai par vue recalcitrante — assez pour faire expirer la traversee
 * complete. On attend donc l'ancre si elle vient, et on se contente sinon d'un
 * court temps de pose : ce qui est verifie ensuite, c'est que la vue n'est pas
 * vide.
 */
export async function allerA(page: Page, route: string): Promise<void> {
  if (!page.url().includes("dashboard.html")) {
    await assurerSession(page);
    if (!page.url().includes("dashboard.html")) {
      await page.goto("/dashboard.html");
      await page.waitForSelector('[data-route="overview"]', { timeout: 25_000 });
    }
    await fermerVisite(page);
  }
  await page.click(`[data-route="${route}"]`, { timeout: 10_000 });
  await page
    .waitForFunction((r) => location.hash === `#${r}`, route, { timeout: 2_500 })
    .catch(() => undefined);
  await page.waitForTimeout(600);
}

/**
 * Demande un lien de connexion et le rend. En environnement non production, la
 * route renvoie le lien directement (`debugLink`) — c'est le mecanisme prevu
 * par le produit pour les tests automatises.
 */
export async function demanderLienDeConnexion(api: APIRequestContext, email: string): Promise<string> {
  const r = await api.post("/api/auth/login-request", {
    headers: { "Content-Type": "application/json" },
    data: { email },
  });
  const corps = await r.json() as { ok?: boolean; debugLink?: string; error?: string };
  if (!corps.debugLink) {
    throw new Error(
      `Aucun lien de connexion rendu (${r.status()}) : ${corps.error ?? JSON.stringify(corps)}. ` +
      `En production la route ne rend jamais le lien — ce test ne peut viser qu'un environnement local ou de recette.`
    );
  }
  return corps.debugLink;
}

/**
 * Ouvre un onglet de la sous-navigation d'une vue (`.fp-sub-nav-item`).
 *
 * `getByRole("button", { name, exact: true })` ne les trouvait pas : leur nom
 * accessible porte parfois une icone, et ils apparaissent quelques secondes
 * apres la vue. On cible donc la classe reelle et on attend qu'elle existe.
 *
 * Rend `false` si l'onglet n'existe pas sur cette vue — a l'appelant de
 * decider si c'est un defaut.
 */
export async function ouvrirOngletSecondaire(page: Page, libelle: string): Promise<boolean> {
  const onglets = page.locator("main .fp-sub-nav-item");
  await onglets.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  const cible = onglets.filter({ hasText: new RegExp(`^\\s*${libelle}\\s*$`, "i") }).first();
  if (await cible.count() === 0) {
    // Repli : certains libelles portent une icone collee au texte.
    const large = onglets.filter({ hasText: libelle }).first();
    if (await large.count() === 0) return false;
    await large.click({ timeout: 8_000 });
    return true;
  }
  await cible.click({ timeout: 8_000 });
  return true;
}
