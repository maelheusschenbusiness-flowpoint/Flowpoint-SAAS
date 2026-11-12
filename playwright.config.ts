import { defineConfig, devices } from "@playwright/test";

/**
 * Tests E2E navigateur des parcours critiques de FlowPoint.
 *
 * CIBLE. `E2E_BASE_URL` designe l'instance a tester, par defaut un serveur
 * local. Ces tests CREENT des comptes et des donnees : ils ne doivent jamais
 * viser la production. Le socle refuse de demarrer si l'URL ne ressemble pas a
 * un environnement local ou de recette (voir e2e/socle/garde-cible.ts).
 *
 * AUTHENTIFICATION. Le parcours de connexion est joue en entier — demande de
 * lien, recuperation du lien, verification — parce que c'est le parcours le
 * plus critique du produit. Les autres parcours reutilisent l'etat de session
 * enregistre par le socle, pour ne pas rejouer la connexion vingt fois.
 */
export default defineConfig({
  testDir: "./e2e/parcours",
  globalSetup: "./e2e/socle/preparation.ts",
  // Un echec intermittent sur un parcours critique est un echec : pas de reprise.
  retries: 0,
  // Les parcours partagent une organisation : ils s'executent en serie.
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "e2e/resultats.json" }]],
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:4321",
    storageState: "e2e/.session.json",
    // Une trace et une capture seulement en cas d'echec : de quoi comprendre
    // sans produire des centaines de mega-octets a chaque passage.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
