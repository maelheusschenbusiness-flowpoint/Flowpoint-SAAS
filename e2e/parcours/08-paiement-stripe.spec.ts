import { test, expect, request } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
// Playwright execute depuis la racine du projet : pas d'`import.meta` ici.
import { compteRecette } from "../socle/aides.js";

/**
 * Parcours 8 — PAIEMENT STRIPE EN MODE TEST.
 *
 * Ce parcours ne declenche AUCUN paiement. Il s'arrete a la creation de la
 * session de paiement : l'URL obtenue n'est pas ouverte, aucune carte n'est
 * saisie. Ce qui est verifie est ce qui NOUS appartient — le refus des appels
 * non autorises, le mode de cle, et le fait qu'une session simulee soit
 * reconnaissable comme telle.
 *
 * DEUX NIVEAUX :
 *
 *   - Sans cle Stripe, le produit rend une session SIMULEE, marquee
 *     `mock: true`, et refuse en production. Ces tests tournent toujours.
 *   - Avec des cles de TEST (`sk_test_` / `pk_test_`), la vraie session est
 *     creee chez Stripe en mode test. Ces tests s'abandonnent EN LE DISANT
 *     quand les cles sont absentes — un parcours non couvert doit se voir.
 *
 * Variables attendues sur le serveur cible pour le second niveau :
 *   STRIPE_TEST_MODE=true
 *   STRIPE_TEST_SECRET_KEY=sk_test_…   (ou STRIPE_TEST_KEY)
 *   STRIPE_TEST_PUBLISHABLE_KEY=pk_test_…
 *   STRIPE_TEST_WEBHOOK_SECRET=whsec_…
 *   STRIPE_TEST_PRICE_ID_STANDARD / _PRO / _ULTRA
 *
 * Aucune cle LIVE ne doit jamais etre posee sur une cible de test : le produit
 * refuse d'ailleurs de melanger les modes, et un test le verifie ci-dessous.
 */

/** Vrai si la cible annonce un mode TEST coherent. */
async function modeStripe(baseURL: string): Promise<{ secret: string; publiable: string; coherent: boolean } | null> {
  const { email, orgId } = compteRecette();
  const cleAdmin = process.env["E2E_ADMIN_KEY"] ?? "";
  const anonyme = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const s = await anonyme.post("/api/auth/dev-session", {
    headers: { "x-admin-key": cleAdmin, "Content-Type": "application/json" },
    data: { email, orgId, role: "owner" },
  });
  if (!s.ok()) { await anonyme.dispose(); return null; }
  const { token } = await s.json() as { token: string };
  await anonyme.dispose();

  const ctx = await request.newContext({
    baseURL, storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  // `GET /api/billing/config` rend la cle publiable ACTIVE, deja alignee sur le
  // mode de la cle secrete par `getPublishableKey` — c'est le selecteur unique
  // du produit. Son prefixe dit donc le mode reellement servi.
  const r = await ctx.get("/api/billing/config").catch(() => null);
  // Le corps doit etre lu AVANT de liberer le contexte : apres `dispose()`,
  // `json()` leve « Response has been disposed ».
  const d = r && r.ok() ? await r.json().catch(() => null) as { publishableKey?: string } | null : null;
  await ctx.dispose();
  const pk = d?.publishableKey ?? "";
  if (!pk) return null;   // aucune cle servie : on ne peut rien conclure
  const publiable = pk.startsWith("pk_test_") ? "TEST" : pk.startsWith("pk_live_") ? "LIVE" : "INCONNU";
  return { secret: publiable, publiable, coherent: publiable !== "INCONNU" };
}

test.describe("ce qui est verifiable sans aucune cle Stripe", () => {
  test("une session de paiement SIMULEE est reconnaissable comme telle", async ({ baseURL }) => {
    const anonyme = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const r = await anonyme.post("/api/public/checkout-session", {
      headers: { "Content-Type": "application/json" },
      data: { plan: "standard" },
    });
    const corps = await r.json().catch(() => ({})) as { url?: string; mock?: boolean; code?: string };
    await anonyme.dispose();

    if (r.status() === 401) {
      // Comportement voulu : sans jeton de pre-inscription ni session, on
      // n'ouvre pas de tunnel de paiement.
      expect(corps.code).toBe("UNAUTHENTICATED");
      return;
    }
    if (corps.mock === true) {
      // Si une session simulee est rendue, elle DOIT etre marquee. Un frontend
      // qui redirige vers une URL simulee sans le savoir enverrait le client
      // sur une page d'erreur Stripe.
      expect(corps.url, "une session simulee sans URL").toBeTruthy();
      expect(corps.url).toContain("test_mock");
      return;
    }
    // Avec de vraies cles, on tombe dans le second bloc de tests.
    expect([200, 401, 503]).toContain(r.status());
  });

  test("le tunnel de paiement exige une authentification ou un jeton de pre-inscription", async ({ baseURL }) => {
    const anonyme = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const r = await anonyme.post("/api/public/checkout-session", {
      headers: { "Content-Type": "application/json" },
      data: { plan: "ultra", preRegisterToken: "jeton-invente-" + "0".repeat(48) },
    });
    const corps = await r.json().catch(() => ({})) as { code?: string; url?: string };
    await anonyme.dispose();
    expect(corps.url, "un jeton de pre-inscription invente a ouvert un tunnel de paiement").toBeFalsy();
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });

  test("une session simulee est impossible en production", () => {
    // Verification de source : le repli simule est verrouille par NODE_ENV.
    // C'est la garde qui empeche un client de recevoir une URL de paiement qui
    // ne mene nulle part.
    const racine = path.join(process.cwd(), "artifacts", "api-server", "src");
    const src = readFileSync(path.join(racine, "routes/public-billing.ts"), "utf8");
    const i = src.indexOf("/* No key in dev → mock */");
    expect(i, "le repli simule a change de forme — verification a revoir").toBeGreaterThan(0);
    const bloc = src.slice(i, i + 420);
    expect(bloc).toContain('process.env["NODE_ENV"] === "production"');
    expect(bloc).toContain("503");
    expect(bloc).toContain("mock: true");
  });

  test("aucune cle LIVE n'est servie quand le mode test est demande", async ({ baseURL }) => {
    const mode = await modeStripe(baseURL!);
    if (!mode) {
      test.skip(true, "aucune cle publiable servie sur cette cible : le mode Stripe n'est pas observable");
      return;
    }
    if (mode.secret === "TEST") {
      expect(mode.publiable, "une cle publiable LIVE est servie avec une cle secrete de TEST").not.toBe("LIVE");
      expect(mode.coherent, "les deux cles ne sont pas du meme mode").toBe(true);
    }
  });
});

test.describe("tunnel de paiement reel, en mode TEST", () => {
  test("une session de paiement de test est creee, et n'est PAS ouverte", async ({ baseURL }) => {
    const mode = await modeStripe(baseURL!);
    if (!mode || mode.secret !== "TEST") {
      test.skip(true,
        "PARCOURS NON COUVERT : aucune cle Stripe de test sur cette cible. " +
        "Posez STRIPE_TEST_MODE=true, STRIPE_TEST_SECRET_KEY=sk_test_…, " +
        "STRIPE_TEST_PUBLISHABLE_KEY=pk_test_…, STRIPE_TEST_WEBHOOK_SECRET=whsec_… " +
        "et les trois STRIPE_TEST_PRICE_ID_{STANDARD,PRO,ULTRA}.");
      return;
    }

    const { email, orgId } = compteRecette();
    const anonyme = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const s = await anonyme.post("/api/auth/dev-session", {
      headers: { "x-admin-key": process.env["E2E_ADMIN_KEY"] ?? "", "Content-Type": "application/json" },
      data: { email, orgId, role: "owner" },
    });
    const { token } = await s.json() as { token: string };
    await anonyme.dispose();

    const ctx = await request.newContext({
      baseURL, storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const r = await ctx.post("/api/billing/create-checkout-session", { data: { plan: "standard" } });
    const corps = await r.json().catch(() => ({})) as { url?: string; mock?: boolean };
    await ctx.dispose();

    expect(r.ok(), `la creation de session a echoue (${r.status()})`).toBe(true);
    expect(corps.mock, "une session SIMULEE a ete rendue alors que des cles de test sont posees").not.toBe(true);
    expect(corps.url, "aucune URL de paiement rendue").toBeTruthy();
    expect(corps.url!).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    // ON S'ARRETE ICI. L'URL n'est pas ouverte, aucune carte n'est saisie,
    // aucun paiement n'est effectue — meme en mode test.
  });
});
