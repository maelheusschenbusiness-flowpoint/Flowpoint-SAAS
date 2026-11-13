import { chromium, request } from "@playwright/test";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifierCible } from "./garde-cible.js";

/**
 * Preparation unique avant tous les parcours.
 *
 * 1. Verifie que la cible est bien locale ou de recette.
 * 2. Provisionne une organisation de recette via l'endpoint d'administration
 *    prevu pour cela, et en recupere un jeton de session.
 * 3. Ouvre un navigateur, pose la session, et enregistre l'etat pour que les
 *    parcours suivants n'aient pas a rejouer la connexion.
 *
 * Le parcours de CONNEXION, lui, repart d'une page vierge : c'est le parcours
 * le plus critique du produit, il se joue en entier.
 */
export default async function preparation(): Promise<void> {
  const base = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:4321";
  verifierCible(base);

  const cleAdmin = process.env["E2E_ADMIN_KEY"] ?? "";
  if (!cleAdmin) {
    throw new Error(
      "E2E_ADMIN_KEY est absente. Le socle provisionne une organisation de recette " +
      "via /api/admin/provision-qa-account, qui exige cette cle. Elle doit venir de " +
      "l'environnement, jamais du depot."
    );
  }

  const api = await request.newContext({ baseURL: base });
  const reponse = await api.post("/api/admin/provision-qa-account", {
    headers: { "x-admin-key": cleAdmin, "Content-Type": "application/json" },
    data: {},
  });

  type Compte = { email: string; orgId: string; userId: string; plan: string };
  let compte: Compte;

  if (reponse.ok()) {
    compte = await reponse.json() as Compte;
  } else if (reponse.status() === 429 && existsSync("e2e/.compte.json")) {
    // Le provisionnement est volontairement limite a cinq appels par heure et
    // par adresse IP. Relancer la suite plusieurs fois de suite epuise donc le
    // quota — et c'est tant mieux : cet endroit cree des comptes. L'organisation
    // de recette etant idempotente, on reutilise celle du passage precedent.
    compte = JSON.parse(readFileSync("e2e/.compte.json", "utf8")) as Compte;
    // eslint-disable-next-line no-console
    console.log(`[E2E] provisionnement limite (429) — reutilisation de l'organisation ${compte.orgId}`);
  } else {
    throw new Error(
      `Le provisionnement du compte de recette a echoue (${reponse.status()}). ` +
      `Verifiez que le serveur cible tourne, que ENABLE_QA_FIXTURES=true et que ` +
      `E2E_ADMIN_KEY correspond a son ADMIN_KEY.`
    );
  }
  await api.dispose();

  // ATTENTION : `storageState` de Playwright ne conserve PAS sessionStorage, et
  // le produit s'authentifie par le cookie `fp_token` pose par la verification
  // du lien. Poser le jeton dans le stockage ne suffisait donc pas : les vingt
  // premiers passages se sont tous arretes sur un tableau de bord vide.
  //
  // Le socle joue donc une VRAIE connexion : demande de lien, puis
  // verification. L'etat enregistre porte alors le cookie, comme chez un
  // utilisateur.
  // Reutiliser une session encore valide epargne un appel d'authentification :
  // la limite est de dix par quart d'heure et par adresse IP, et la suite en
  // consomme la moitie. Ce n'est pas une limite a contourner, c'est une
  // protection — on evite simplement de la gaspiller.
  if (existsSync("e2e/.session.json")) {
    const essai = await request.newContext({ baseURL: base, storageState: "e2e/.session.json" });
    const toujoursValide = await essai.get("/api/me").then((r) => r.status() === 200).catch(() => false);
    await essai.dispose();
    if (toujoursValide) {
      writeFileSync("e2e/.compte.json", JSON.stringify(compte, null, 2));
      // eslint-disable-next-line no-console
      console.log(`[E2E] cible ${base} — session precedente encore valide, organisation ${compte.orgId}`);
      return;
    }
  }

  const api2 = await request.newContext({ baseURL: base });
  const demande = await api2.post("/api/auth/login-request", {
    headers: { "Content-Type": "application/json" },
    data: { email: compte.email },
  });
  const corps = await demande.json() as { debugLink?: string; error?: string };
  await api2.dispose();
  if (!corps.debugLink) {
    throw new Error(
      `Aucun lien de connexion rendu (${demande.status()}) : ${corps.error ?? "reponse inattendue"}. ` +
      `En production la route ne rend jamais le lien — ces tests ne peuvent viser qu'un ` +
      `environnement local ou de recette.`
    );
  }

  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({ baseURL: base });
  const page = await contexte.newPage();
  await page.goto(corps.debugLink);
  await page.waitForURL(/dashboard\.html/, { timeout: 45_000 });
  await page.waitForSelector('[data-route="overview"]', { timeout: 45_000 });

  mkdirSync(path.dirname("e2e/.session.json"), { recursive: true });
  await contexte.storageState({ path: "e2e/.session.json" });
  await navigateur.close();

  // Les parcours ont besoin de l'organisation et de l'adresse, pas du jeton.
  writeFileSync("e2e/.compte.json", JSON.stringify({
    email: compte.email, orgId: compte.orgId, userId: compte.userId, plan: compte.plan,
  }, null, 2));

  // eslint-disable-next-line no-console
  console.log(`[E2E] cible ${base} — organisation de recette ${compte.orgId} (plan ${compte.plan})`);
}
