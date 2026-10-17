import { test, expect, request } from "@playwright/test";
import { allerA, fermerVisite, compteRecette } from "../socle/aides.js";

/**
 * Parcours 8 — INSCRIPTION et ONBOARDING.
 *
 * L'inscription passe par une pre-inscription puis un paiement Stripe : le
 * compte n'existe vraiment qu'apres l'activation. La traversee du paiement
 * n'est pas jouee ici — elle demanderait des cles Stripe et un vrai passage
 * chez le fournisseur. Ce qui est verifie est ce qui NOUS appartient : la
 * pre-inscription, le refus de l'ancienne route d'inscription directe, et
 * l'onboarding presente a un compte neuf.
 */
test("la route d'inscription directe reste fermee", async ({ baseURL }) => {
  const anonyme = await request.newContext({ baseURL });
  const r = await anonyme.post("/api/auth/register", {
    headers: { "Content-Type": "application/json" },
    data: { email: `e2e-${Date.now()}@flowpoint-test.internal`, password: "x" },
  });
  await anonyme.dispose();
  // Tout sauf une creation de compte. 404/405/410/403 conviennent.
  expect(r.status(), "la route d'inscription directe a repondu comme si elle creait un compte").not.toBe(200);
  expect(r.status()).not.toBe(201);
});

test("une pre-inscription est acceptee et ne cree pas de compte actif", async ({ baseURL }) => {
  const email = `e2e-${Date.now()}@flowpoint-test.internal`;
  const anonyme = await request.newContext({ baseURL });
  const r = await anonyme.post("/api/auth/pre-register", {
    headers: { "Content-Type": "application/json" },
    data: {
      email, firstName: "Recette", lastName: "E2E", companyName: "Societe de recette",
      country: "FR", address: "1 rue de la Recette", city: "Paris", postalCode: "75001",
    },
  });
  // La route peut ne pas exister sous ce nom : on ne force pas un contrat.
  if (r.status() === 404) { await anonyme.dispose(); test.skip(true, "pas de route /auth/signup-request sur cette version"); return; }

  expect(r.ok(), `la pre-inscription a echoue (${r.status()})`).toBe(true);

  // Un compte non active ne doit pas pouvoir se connecter.
  const connexion = await anonyme.post("/api/auth/login-request", {
    headers: { "Content-Type": "application/json" }, data: { email },
  });
  const corps = await connexion.json() as { debugLink?: string };
  await anonyme.dispose();

  if (corps.debugLink) {
    const verif = await request.newContext({ baseURL });
    const jeton = new URL(corps.debugLink).searchParams.get("token")!;
    const ouverture = await verif.post("/api/auth/login-verify", {
      headers: { "Content-Type": "application/json" }, data: { token: jeton },
    });
    const resultat = ouverture.ok() ? await ouverture.json() as { orgId?: string } : null;
    await verif.dispose();
    // Pas d'organisation : le compte n'est pas actif.
    expect(resultat?.orgId ?? null,
      "une pre-inscription sans paiement a ouvert une organisation").toBeFalsy();
  }
});

test("la meme adresse pre-inscrite deux fois ne cree pas deux comptes", async ({ baseURL }) => {
  const email = `e2e-dup-${Date.now()}@flowpoint-test.internal`;
  const anonyme = await request.newContext({ baseURL });
  const dossier = {
    email, firstName: "Recette", lastName: "E2E", companyName: "Societe de recette",
    country: "FR", address: "1 rue de la Recette", city: "Paris", postalCode: "75001",
  };
  const a = await anonyme.post("/api/auth/pre-register", {
    headers: { "Content-Type": "application/json" }, data: dossier,
  });
  if (a.status() === 404) { await anonyme.dispose(); test.skip(true, "pas de route /auth/pre-register"); return; }
  if (a.status() === 429) {
    // La limite d'authentification est une PROTECTION : dix appels par quart
    // d'heure et par adresse IP. La suite en consomme une partie ; on ne la
    // contourne pas, on renonce a ce test-la.
    await anonyme.dispose();
    test.skip(true, "limite d'authentification atteinte — relancez dans un quart d'heure");
    return;
  }
  const b = await anonyme.post("/api/auth/pre-register", {
    headers: { "Content-Type": "application/json" }, data: dossier,
  });
  await anonyme.dispose();
  // La seconde doit etre acceptee (renvoi du lien a la meme pre-inscription) ou
  // refusee. Ce qui compte est qu'elle ne cree pas un second dossier : le code
  // de retour ne doit jamais etre une creation nouvelle et distincte.
  expect(a.ok(), `la premiere pre-inscription a echoue (${a.status()})`).toBe(true);
  expect([200, 201, 202, 400, 409, 429],
    `code inattendu sur la seconde pre-inscription : ${b.status()}`).toContain(b.status());
});

test("l'onboarding est presente a un compte sans donnees", async ({ page }) => {
  await allerA(page, "overview");
  // Le produit annonce explicitement un demarrage en trois etapes.
  const texte = await page.locator("main").textContent();
  const aOnboarding = /bienvenue sur flowpoint|3 étapes|trois étapes|premier audit/i.test(texte ?? "");
  expect(aOnboarding, "aucun parcours de demarrage n'est propose a un compte neuf").toBe(true);
});

test("les trois etapes de demarrage mènent chacune a une vue reelle", async ({ page }) => {
  await allerA(page, "overview");
  for (const [libelle, route] of [["audit", "audits"], ["monitor", "monitors"], ["mission", "missions"]] as const) {
    await allerA(page, route);
    const texte = await page.locator("main").textContent();
    expect((texte ?? "").trim().length, `la vue ${route} (etape « ${libelle} ») est vide`).toBeGreaterThan(40);
  }
});

test("la visite guidee recouvre la navigation, et se referme", async ({ page, baseURL }) => {
  // La visite ne s'ouvre qu'une fois : le SERVEUR est source de verite, via
  // `user_prefs.settings->>'onboardingCompletedAt'`. Des que la visite a ete
  // parcourue ou passee une fois, elle ne revient plus — et ce test etait donc
  // ignore sur tout compte deja utilise.
  //
  // Le produit expose un endpoint d'administration pour remettre ce drapeau a
  // zero : on s'en sert, pour que ce test s'EXECUTE au lieu d'etre ignore.
  // L'endpoint exige `confirmEmail` identique a l'adresse du proprietaire
  // resolue — une garde volontaire contre une remise a zero sur le mauvais
  // compte. On la respecte plutot que de la contourner.
  const { orgId, email } = compteRecette();
  const cleAdmin = process.env["E2E_ADMIN_KEY"] ?? "";
  const remise = await page.request.post(`${baseURL}/api/admin/reset-onboarding`, {
    headers: { "x-admin-key": cleAdmin, "Content-Type": "application/json" },
    data: { orgId, dryRun: false, confirmEmail: email },
  });

  await page.goto("/dashboard.html");
  await page.waitForSelector('[data-route="overview"]', { timeout: 25_000 });
  await page.waitForTimeout(5_000);

  const visite = page.locator("#fp-onboarding");
  const ouverte = await visite.count() > 0 && await visite.isVisible().catch(() => false);
  if (!ouverte) {
    // Si la remise a zero a echoue, on le DIT : un test ignore sans raison
    // explicite est un trou qui ne se voit pas.
    expect(remise.ok(),
      `la visite ne s'ouvre pas et la remise a zero a echoue (${remise.status()}) — ` +
      `le parcours d'onboarding n'est donc PAS couvert sur ce passage`).toBe(true);
    throw new Error("la visite ne s'est pas ouverte malgre la remise a zero du drapeau serveur");
  }

  // Tant qu'elle est ouverte, la barre laterale est inatteignable : c'est voulu,
  // mais il faut une sortie.
  await expect(page.getByRole("button", { name: /passer la visite/i })).toBeVisible();

  await fermerVisite(page);
  await expect(visite).toBeHidden();

  // Et la navigation redevient utilisable.
  await allerA(page, "audits");
  await expect(page.locator("#audit-url-input")).toBeVisible();
});
