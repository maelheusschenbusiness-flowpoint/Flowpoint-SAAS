/**
 * 2. Inscription par e-mail : validations, erreurs, honeypot, plan conserve, pas de doublon d'organisation (PR #379).
 * ECRIT dans la base jetable : local uniquement.
 */
import { test, expect, db, one, all, IS_LOCAL, BASE_URL, ANON_OK, unexpectedConsoleErrors, COMPLETE_FORM } from "./support/fixtures";
import { seedCart, remplirInscription, stripeState } from "./support/parcours";

test.skip(!IS_LOCAL, "Ecrit des comptes : local (base jetable) uniquement.");

test.describe("2. Inscription e-mail", () => {
  const CAS: Array<[string, Record<string, string>, string]> = [
    ["prenom manquant", { firstName: "" }, "Le prénom est requis."],
    ["nom manquant", { lastName: "" }, "Le nom est requis."],
    ["e-mail invalide", { __email: "pas-un-email" }, "Adresse email invalide."],
    ["e-mail jetable", { __email: "x@mailinator.com" }, "Les adresses email temporaires ne sont pas acceptées."],
    ["entreprise manquante", { companyName: "" }, "Le nom de l'entreprise est requis."],
    ["adresse manquante", { address: "" }, "L'adresse est requise."],
    ["ville manquante", { city: "" }, "La ville est requise."],
    ["code postal manquant", { postalCode: "" }, "Le code postal est requis."],
  ];
  for (const [nom, champs, message] of CAS) {
    test(`validation : ${nom}`, async ({ page, newEmail }) => {
      let preRegisterCalls = 0;
      page.on("request", (r) => { if (r.url().endsWith("/api/auth/pre-register")) preRegisterCalls += 1; });
      await page.goto("/signin.html");
      const { __email, ...rest } = champs;
      await remplirInscription(page, __email ?? newEmail("val"), rest);
      await page.locator("#signup-btn").click();
      await expect(page.locator("#signup-msg")).toHaveText(message);
      await expect(page.locator("#signup-msg")).toHaveClass(/error/);
      if (nom === "e-mail jetable") {
        // CONSTAT P2 : la liste cote navigateur compare le domaine COMPLET (« mailinator.com ») a des noms sans extension
        // (« mailinator ») : elle ne declenche jamais. Le serveur refuse (400, meme message) : aucune inscription n'est creee.
        expect(preRegisterCalls).toBeLessThanOrEqual(1);
        expect(await one("SELECT 1 FROM pending_signups WHERE lower(email)='x@mailinator.com'")).toBeNull();
      } else {
        expect(preRegisterCalls).toBe(0);                 // rien n'est envoye au serveur
      }
      await expect(page.locator("#signup-screen")).toBeVisible();
    });
  }

  test("compte existant : message d'erreur serveur et lien vers la connexion", async ({ page, request, signupViaApi }) => {
    const { email } = await signupViaApi(request);
    await page.goto("/signin.html");
    await remplirInscription(page, email);
    await page.locator("#signup-btn").click();
    await expect(page.locator("#signup-msg")).toContainText("Un compte existe déjà");
    await expect(page.locator("#signin-redir-link")).toHaveAttribute("href", "/login.html");
    await expect(page.locator("#signup-btn")).toBeEnabled();    // le bouton ne reste pas bloque
  });

  test("serveur injoignable : message clair, bouton debloque", async ({ page, newEmail }) => {
    await page.route("**/api/auth/pre-register", (r) => r.abort("failed"));
    await page.goto("/signin.html");
    await remplirInscription(page, newEmail("net"));
    await page.locator("#signup-btn").click();
    await expect(page.locator("#signup-msg")).toContainText("Impossible de joindre le serveur");
    await expect(page.locator("#signup-btn")).toBeEnabled();
  });

  test("honeypot : un robot n'obtient ni compte, ni ligne d'inscription, ni intent Stripe", async ({ page, newEmail }) => {
    const email = newEmail("bot");
    const avant = (await stripeState(page)).intents.length;
    await seedCart(page, "pro");
    await page.goto("/signin.html");
    await remplirInscription(page, email, { honeypot: "http://spam.invalid" });
    await page.locator("#signup-btn").click();
    await page.waitForURL(/\/checkout\.html/, { timeout: 15_000 });
    expect(await one("SELECT 1 FROM pending_signups WHERE lower(email)=lower($1)", [email])).toBeNull();
    expect(await one("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email])).toBeNull();
    expect(await one("SELECT 1 FROM organizations WHERE lower(owner_email)=lower($1)", [email])).toBeNull();
    // Le faux jeton « hp_… » ne mene a aucun paiement.
    const r = await page.request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan: "pro", addons: {}, preRegisterToken: "hp_123" } });
    expect(r.status()).toBe(401);
    expect((await stripeState(page)).intents.length).toBe(avant);
  });

  test("plan conserve : du formulaire a la page de recapitulatif, sans re-choisir", async ({ page, newEmail, shot, observed }) => {
    await page.goto("/pricing.html");
    await page.locator('.fp-card-btn[data-plan="pro"]').click();
    await page.waitForURL(/\/signin\.html/);
    await remplirInscription(page, newEmail("plan"));
    await shot(page, "formulaire-rempli");
    await page.locator("#signup-btn").click();
    await page.waitForURL(/\/checkout\.html\?plan=pro/);
    await expect(page.locator("#plan-screen")).toBeHidden();
    await expect(page.getByText("79", { exact: false }).first()).toBeVisible();      // prix du plan Pro, fourni par le devis serveur
    await expect(page.locator("#fp-pay-btn")).toBeEnabled();
    await shot(page, "recapitulatif");
    expect(unexpectedConsoleErrors(observed, ANON_OK)).toEqual([]);
  });

  test("rejeu : un meme e-mail pre-inscrit deux fois ne laisse qu'UNE inscription active", async ({ request, newEmail }) => {
    const email = newEmail("rejeu");
    for (let i = 0; i < 2; i++) {
      const r = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: { ...COMPLETE_FORM, email } });
      expect(r.status()).toBe(200);
    }
    const rows = await all("SELECT token FROM pending_signups WHERE lower(email)=lower($1) AND consumed_at IS NULL", [email]);
    expect(rows).toHaveLength(1);
  });

  test("rejeu : finaliser deux fois le meme paiement ne cree ni 2e organisation, ni 2e utilisateur, ni 2e abonnement", async ({ request, signupViaApi, page }) => {
    const { email, token, intentId } = await signupViaApi(request);
    for (let i = 0; i < 2; i++) {
      const r = await request.post(`${BASE_URL}/api/public/finalize-checkout`, { data: { intentId, intentType: "setup", plan: "pro", addons: {}, preRegisterToken: token } });
      expect(r.status(), `rejeu ${i + 1}`).toBe(200);
    }
    expect(await all("SELECT id FROM organizations WHERE lower(owner_email)=lower($1)", [email])).toHaveLength(1);
    expect(await all("SELECT id FROM users WHERE lower(email)=lower($1)", [email])).toHaveLength(1);
    const org = await one<{ stripe_customer_id: string }>("SELECT stripe_customer_id FROM organizations WHERE lower(owner_email)=lower($1)", [email]);
    const st = await stripeState(page);
    expect(st.subscriptions.filter((s) => s["customer"] === org!.stripe_customer_id)).toHaveLength(1);
    void db;
  });
});
