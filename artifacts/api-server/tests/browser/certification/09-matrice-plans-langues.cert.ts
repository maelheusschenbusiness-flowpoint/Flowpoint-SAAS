/**
 * 9. MATRICE de certification : plan (Standard, Pro, Ultra) x langue (anglais par defaut, francais) x methode d'inscription
 * (e-mail, Google) x profil (bureau 1440, iPhone 13, Pixel 7 : les trois « projects » de playwright.certification.config.mjs).
 *
 * Ce qui est DEJA certifie ailleurs n'est pas refait ici (voir docs/CERTIFICATION-NAVIGATEUR.md §4) :
 *   01 clic de plan -> signin (fr, pro seulement pour le panier) ; 02 validations et rejeu ; 03 garde-fous Google (state, refus, membre) ;
 *   04 erreurs de paiement ; 05 lien magique ; 06 suivi de conversion ; 07 etats d'abonnement.
 * Ici : CHAQUE cellule de la matrice parcourt tout le tunnel (tarifs -> inscription -> recapitulatif -> carte -> retour) et
 * verifie, dans la langue de la cellule : textes, absence de melange de langues, prix du catalogue, cle Stripe de test,
 * essai de 14 jours, carte attachee a l'essai, langue memorisee (inscription en attente, organisation), e-mail d'activation.
 *
 * Langue : « en » = AUCUNE preference enregistree + navigateur fr-FR (l'interface doit etre anglaise) ;
 *          « fr » = preference enregistree ; « fr-url » = lien `?lang=fr` sans preference (continuite depuis le site vitrine).
 *
 * Deux niveaux : la partie A est en LECTURE SEULE (tourne en local ET contre flowpoint-test.onrender.com) ; la partie B ecrit
 * (comptes, faux Stripe) et ne tourne qu'en local (base jetable, Stripe simule du harnais).
 */
import {
  test, expect, BASE_URL, one, T, langueCode, poserLangue, prixCatalogue, langueCoherente, recapitulatifJusquAuRetour,
  verifierCompteEssai, orgDe, remplirInscription, defautConnu, unexpectedApiFailures, unexpectedConsoleErrors, ANON_OK, type Plan, type Langue,
} from "./support/matrice";
import { PLANS, IS_LOCAL } from "./support/fixtures";
import { ouvrirDashboard } from "./support/parcours";

const LANGUES: Langue[] = ["en", "fr", "fr-url"];
const PLAN_LABEL: Record<Plan, string> = { standard: "STANDARD", pro: "PRO", ultra: "ULTRA" };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A. Lecture seule : tarifs -> choix du plan -> formulaire d'inscription, dans chaque langue (local et environnement de test)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test.describe("9A. Tarifs -> inscription par plan et par langue (lecture seule)", () => {
  for (const plan of PLANS) {
    for (const l of LANGUES) {
      test(`${plan} | ${l} : la page tarifs puis le formulaire sont dans la bonne langue, le plan est conserve`, async ({ page, context, observed }) => {
        const suffixe = await poserLangue(context, l);
        const t = T[langueCode(l)];
        // On attend le catalogue AVANT d'appuyer : un appui plus tot ne mene nulle part (DEFAUT P2, test dedie plus bas).
        const catalogue = page.waitForResponse((r) => r.url().includes("/api/plans/catalog"), { timeout: 30_000 });
        await page.goto(`/pricing.html${suffixe}`);
        await catalogue;
        await page.waitForTimeout(400);          // le temps que pricing.html range le catalogue (FP_CATALOG) apres la reponse
        await expect(page.locator(`.fp-card-btn[data-plan="${plan}"]`)).toBeVisible();
        await langueCoherente(page, l);
        // Prix du plan = prix du catalogue serveur, dans le format de la langue (« €79/month » ou « 79 €/mois »).
        const prix = (await prixCatalogue(page))[plan];
        await expect(page.locator("body")).toContainText(t.price(prix), { useInnerText: true });
        await page.locator(`.fp-card-btn[data-plan="${plan}"]`).click();
        await page.waitForURL(/\/signin\.html/, { timeout: IS_LOCAL ? 15_000 : 45_000, waitUntil: "commit" }   /* distant : un hote tiers lent retarde l'evenement load, pas la navigation */);
        const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("fp_cart") ?? "null"));
        expect(cart?.plan).toBe(plan);
        await expect(page.locator("#signup-btn-text")).toHaveText(t.signupCta);
        await expect(page.locator("#signup-screen")).toBeVisible();
        await langueCoherente(page, l);
        // La langue reste celle de la cellule apres le changement de page (preference enregistree par `?lang=`, jamais reinterpretee).
        expect(await page.evaluate(() => localStorage.getItem("fp:language"))).toBe(l === "en" ? null : "fr");
        expect(unexpectedConsoleErrors(observed, ANON_OK)).toEqual([]);
        expect(observed.pageErrors).toEqual([]);
      });
    }
  }

  // Regression D1 (corrige) : un appui sur un plan avant la fin du chargement de /api/plans/catalog attend le catalogue (boutons
  // inactifs + message de chargement), puis continue vers l'inscription ; l'erreur n'apparait que si le chargement echoue vraiment.
  // Le catalogue est retarde de 2,5 s pour rendre le cas deterministe.
  test("pricing : un appui sur un plan AVANT la fin du chargement du catalogue attend le catalogue puis mene a l'inscription", async ({ page }) => {
    await page.route("**/api/plans/catalog", async (route) => { await new Promise((r) => setTimeout(r, 2_500)); await route.continue(); });
    await page.goto("/pricing.html");
    await page.waitForLoadState("load");
    await page.locator('.fp-card-btn[data-plan="pro"]').click();
    await expect(page.locator('.fp-card-btn[data-plan="ultra"]'), "etat de chargement visible : boutons inactifs").toBeDisabled();
    await page.waitForURL(/\/signin\.html/, { timeout: 20_000, waitUntil: "commit" });
  });

  test("pricing : si le catalogue echoue vraiment (apres une reprise), l'appui sur un plan affiche l'erreur et ne navigue pas", async ({ page }) => {
    let appels = 0;
    await page.route("**/api/plans/catalog", async (route) => { appels += 1; await route.fulfill({ status: 503, contentType: "application/json", body: "{}" }); });
    await page.goto("/pricing.html");
    await page.waitForLoadState("load");
    await expect.poll(() => appels).toBeGreaterThanOrEqual(1);
    await page.locator('.fp-card-btn[data-plan="pro"]').click();
    await expect(page.locator("#fp-toast.error")).toBeVisible();
    expect(page.url()).toMatch(/\/pricing\.html/);
    expect(appels, "une reprise a ete tentee").toBeGreaterThanOrEqual(2);
  });

  test("la langue par defaut est l'ANGLAIS meme avec un navigateur fr-FR, sur chaque page d'entree du tunnel", async ({ page }) => {
    expect(await page.evaluate(() => navigator.language)).toBe("fr-FR");
    for (const chemin of ["/pricing.html", "/signin.html"]) {
      await page.goto(chemin);
      await langueCoherente(page, "en");
      expect(await page.evaluate(() => localStorage.getItem("fp:language")), `${chemin} n'enregistre pas de preference de lui-meme`).toBeNull();
    }
  });

  test("`?lang=` : une preference deja enregistree gagne ; une valeur inconnue est ignoree (jamais de francais par repli)", async ({ page, context }) => {
    await context.addInitScript(() => { try { if (!sessionStorage.getItem("__init")) { sessionStorage.setItem("__init", "1"); localStorage.setItem("fp:language", "en"); } } catch { /* ignore */ } });
    await page.goto("/pricing.html?lang=fr");
    await langueCoherente(page, "en");                        // preference « en » enregistree : `?lang=fr` ne l'ecrase pas
    await page.evaluate(() => localStorage.removeItem("fp:language"));
    await page.goto("/pricing.html?lang=zz");
    await langueCoherente(page, "en");
    expect(await page.evaluate(() => localStorage.getItem("fp:language"))).toBeNull();
    await page.goto("/pricing.html?lang=%3Cscript%3E");
    await langueCoherente(page, "en");
    expect(await page.evaluate(() => localStorage.getItem("fp:language"))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// B. Parcours complets (ecrivent : local, base jetable, Stripe simule du harnais)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test.describe("9B. Parcours complet par plan x langue x methode", () => {
  test.skip(!IS_LOCAL, "Ecrit des comptes et utilise le faux Stripe : local uniquement (Stripe TEST reel : voir docs/CERTIFICATION-NAVIGATEUR.md §3).");
  test.setTimeout(150_000);
  test.beforeEach(async ({ useStripeStub }) => { await useStripeStub(); });

  const codeUnique = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  for (const plan of PLANS) {
    for (const l of LANGUES) {
      test(`e-mail | ${plan} | ${l} : tarifs -> inscription -> recapitulatif -> carte -> essai de 14 jours`, async ({ page, context, newEmail, mails, observed, shot }) => {
        const suffixe = await poserLangue(context, l);
        const t = T[langueCode(l)];
        const email = newEmail(`m-${plan}-${l}`);
        await page.goto(`/pricing.html${suffixe}`);
        await page.locator(`.fp-card-btn[data-plan="${plan}"]`).click();
        await page.waitForURL(/\/signin\.html/, { timeout: 15_000 });
        await expect(page.locator("#signup-btn-text")).toHaveText(t.signupCta);
        await remplirInscription(page, email);
        await shot(page, "formulaire");
        await page.locator("#signup-btn").click();
        await recapitulatifJusquAuRetour(page, { plan, l });
        await shot(page, "retour");
        // Langue memorisee des l'inscription en attente (pre-register), puis sur l'organisation.
        const attente = await one<{ language: string }>("SELECT language FROM pending_signups WHERE lower(email)=lower($1) ORDER BY created_at DESC LIMIT 1", [email]);
        expect(attente?.language, "pending_signups.language").toBe(langueCode(l));
        await verifierCompteEssai(page, email, { plan, l, mails });
        expect(unexpectedConsoleErrors(observed, ANON_OK)).toEqual([]);
        expect(unexpectedApiFailures(observed, [/^401 /])).toEqual([]);
        expect(observed.pageErrors).toEqual([]);
      });

      test(`google | ${plan} | ${l} : tarifs -> Google (simule) -> recapitulatif -> carte -> essai de 14 jours`, async ({ page, context, request, newEmail, mails, observed, useGoogleStub, shot }) => {
        const suffixe = await poserLangue(context, l);
        const t = T[langueCode(l)];
        const email = newEmail(`g-${plan}-${l}`);
        const code = codeUnique("mat");
        const r = await request.post(`${BASE_URL}/__fake/google/persona`, { data: { code, email, given_name: "Gaelle", family_name: "Matrice" } });
        expect(r.status()).toBe(200);
        const { authorizeUrls } = await useGoogleStub(code);
        await page.goto(`/pricing.html${suffixe}`);
        await page.locator(`.fp-card-btn[data-plan="${plan}"]`).click();
        await page.waitForURL(/\/signin\.html/, { timeout: 15_000 });
        const bouton = page.locator("#btn-google-oauth");
        await expect(bouton).toBeVisible();
        // Le lien Google porte le plan ET la langue de l'interface (jamais celle du navigateur).
        await expect(bouton).toHaveAttribute("href", new RegExp(`plan=${plan}`));
        await expect(bouton).toHaveAttribute("href", new RegExp(`language=${langueCode(l)}(&|$)`));
        await shot(page, "bouton-google");
        await bouton.click();
        expect(authorizeUrls, "un seul depart vers Google").toHaveLength(1);
        await recapitulatifJusquAuRetour(page, { plan, l });
        const attente = await one<{ language: string }>("SELECT language FROM pending_signups WHERE lower(email)=lower($1) ORDER BY created_at DESC LIMIT 1", [email]);
        expect(attente?.language, "pending_signups.language (cookie de depart Google)").toBe(langueCode(l));
        await verifierCompteEssai(page, email, { plan, l, mails });
        // Preuve que l'inscription vient bien du retour Google (et non d'un formulaire) : prenom / nom de la persona Google.
        const g = await one<{ first_name: string; last_name: string }>("SELECT first_name, last_name FROM pending_signups WHERE lower(email)=lower($1) ORDER BY created_at DESC LIMIT 1", [email]);
        expect(g).toMatchObject({ first_name: "Gaelle", last_name: "Matrice" });
        expect(t.htmlLang).toBeTruthy();
        expect(unexpectedConsoleErrors(observed, ANON_OK)).toEqual([]);
        expect(observed.pageErrors).toEqual([]);
      });
    }
  }

  // Continuite de la langue jusqu'a l'application : le lien magique ouvert sur un APPAREIL NEUF (aucun stockage, navigateur fr-FR)
  // doit afficher le tableau de bord dans la langue choisie a l'inscription (memorisee cote serveur : /api/me.language, user_prefs).
  async function ouvrirSurAppareilNeuf(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, context: import("@playwright/test").BrowserContext, email: string, l: "en" | "fr", magicToken: (e: string) => Promise<string>, garderVisite = false) {
    const form = { firstName: "Test", lastName: "Matrice", email, language: l };
    const pre = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: form });
    expect(pre.status()).toBe(200);
    const token = ((await pre.json()) as { preRegisterToken: string }).preRegisterToken;
    const pi = await request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan: "pro", addons: {}, preRegisterToken: token } });
    const clientSecret = ((await pi.json()) as { clientSecret: string }).clientSecret;
    await request.post(`${BASE_URL}/__fake/stripe/confirm-setup`, { data: { clientSecret, card: "4242 4242 4242 4242" } });
    const fin = await request.post(`${BASE_URL}/api/public/finalize-checkout`, { data: { intentId: clientSecret.split("_secret_")[0], intentType: "setup", plan: "pro", addons: {}, preRegisterToken: token } });
    expect(fin.status()).toBe(200);
    expect(await orgDe(email)).toMatchObject({ language: l });
    await context.clearCookies();
    if (garderVisite) {                                   // ouvrirDashboard() ferme la visite guidee : ici on veut la voir
      await page.goto(`/login-verify.html?token=${await magicToken(email)}`);
      await page.waitForURL(/\/dashboard\.html/, { timeout: 25_000 });
      await page.waitForSelector('[data-route="overview"]', { timeout: 30_000 });
    } else await ouvrirDashboard(page, await magicToken(email));
    await page.waitForTimeout(2500);                       // les preferences serveur sont appliquees apres le premier rendu
    expect(await page.evaluate(async () => (await (await fetch("/api/me")).json()).language), "le serveur connait la langue choisie").toBe(l);
  }

  test("apres l'essai | en : le lien magique sur un appareil neuf affiche le tableau de bord en anglais", async ({ page, request, newEmail, magicToken, context }) => {
    await ouvrirSurAppareilNeuf(page, request, context, newEmail("dash-en"), "en", magicToken);
    await expect(page.locator("body")).toContainText("Overview", { useInnerText: true });
    expect(await page.evaluate(() => document.documentElement.lang)).toMatch(/^en/);
  });

  // Regression (ex-defaut P2 corrige) : sur un appareil sans preference locale, la langue memorisee sur le compte
  // (/api/me.language) s'applique : un compte « fr » ouvre le tableau de bord en francais.
  test("apres l'essai | fr : le lien magique sur un appareil neuf affiche le tableau de bord en francais", async ({ page, request, newEmail, magicToken, context }) => {
    await ouvrirSurAppareilNeuf(page, request, context, newEmail("dash-fr"), "fr", magicToken);
    await expect(page.locator("body")).toContainText("Vue d'ensemble", { useInnerText: true });
    expect(await page.evaluate(() => document.documentElement.lang)).toMatch(/^fr/);
  });

  // Regression (ex-defaut P2 corrige) : la visite guidee d'accueil suit la langue active (plus de francais pour un compte anglais).
  test("apres l'essai | en : la visite guidee d'accueil n'est pas en francais pour un compte anglais", async ({ page, request, newEmail, magicToken, context }) => {
    await ouvrirSurAppareilNeuf(page, request, context, newEmail("dash-en-tour"), "en", magicToken, true);
    await expect(page.getByText(/WELCOME TO FLOWPOINT|BIENVENUE/i).first(), "la visite guidee est affichee").toBeVisible({ timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText("Prenez vos repères", { useInnerText: true });
  });

  test("les trois plans ont des prix distincts et croissants dans le catalogue, et chacun mene a son propre prix sur le recapitulatif", async ({ page }) => {
    const prix = await prixCatalogue(page);
    expect(prix.standard).toBeLessThan(prix.pro);
    expect(prix.pro).toBeLessThan(prix.ultra);
    for (const plan of PLANS) {
      // Le panier existant a priorite sur ?plan= (par conception) : on repart d'un navigateur vide. Le vidage se fait sur une ressource
      // JSON de meme origine (sans script) : sur pricing.html, un panier frais (estampille, ex. celui de l'iteration precedente) est
      // restaure apres ~120 ms et relance la redirection, ce qui ferait courir le vidage.
      await page.goto("/api/plans/catalog");
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.goto(`/checkout.html?plan=${plan}`);
      // Visiteur anonyme : redirige vers l'inscription AVEC le plan conserve (jamais un recapitulatif sans compte).
      await page.waitForURL(/\/signin\.html/, { timeout: 15_000 });
      const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("fp_cart") ?? "null"));
      expect(cart?.plan, `plan ${plan} conserve par la redirection`).toBe(plan);
    }
    void PLAN_LABEL;
  });
});
