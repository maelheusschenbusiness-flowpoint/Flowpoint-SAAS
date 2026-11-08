/**
 * 4. Paiement : SetupIntent (Payment Element simule), essai 14 jours, finalisation, erreurs.
 * Stripe.js est remplace par un stub local (route Playwright) ; le serveur parle a un faux Stripe en memoire.
 * Les comportements CORRIGES par des PR en cours sont ASSERTES tels que le produit doit se comporter ;
 * ils sont sautes (test.fixme) avec la reference de la PR tant que CERT_RUN_PENDING n'est pas pose.
 */
import { test, expect, one, all, IS_LOCAL, BASE_URL, ANON_OK, unexpectedConsoleErrors, pendingFix } from "./support/fixtures";
import { seedCart, remplirInscription, inscriptionJusquAuPaiement, payer, stripeState, paiementConfirmeSansFinalisation, attendre } from "./support/parcours";

test.skip(!IS_LOCAL, "Ecrit des comptes et utilise le faux Stripe : local uniquement.");

const orgOf = (email: string) => one<Record<string, any>>("SELECT id::text, plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, trial_consumed_at FROM organizations WHERE lower(owner_email)=lower($1)", [email]);

test.describe("4. Paiement (SetupIntent, essai 14 jours)", () => {
  test.beforeEach(async ({ useStripeStub }) => { await useStripeStub(); });

  test("parcours nominal : tarifs -> inscription -> carte -> essai de 14 jours -> compte active", async ({ page, newEmail, consent, shot, observed, mails }) => {
    const email = newEmail("ok");
    await consent(true);
    await page.goto("/pricing.html");
    await page.locator('.fp-card-btn[data-plan="pro"]').click();
    await page.waitForURL(/\/signin\.html/);
    await remplirInscription(page, email);
    await page.locator("#signup-btn").click();
    await page.waitForURL(/\/checkout\.html\?plan=pro/);
    await shot(page, "recapitulatif");
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-payment\.html/);
    await expect(page.locator("#fp-pay-btn")).toHaveText("Démarrer l'essai gratuit →", { timeout: 15_000 });
    await expect(page.locator("#fp-pay-btn")).toBeEnabled();
    await expect(page.locator("#fp-trial-note")).toContainText("Aucun débit aujourd'hui");
    await expect(page.locator("#fp-trial-note")).toContainText("14");
    await shot(page, "paiement");
    const appels = await page.evaluate(() => (window as any).__fpStripeCalls as Array<{ fn: string; pk?: string }>);
    expect(appels.find((a) => a.fn === "Stripe")?.pk).toMatch(/^pk_test_/);       // jamais pk_live_ en test
    await payer(page);
    await page.waitForURL(/\/checkout-return\.html/);
    await expect(page.locator("#fp-title")).toHaveText("Compte activé ! Vérifiez vos emails", { timeout: 20_000 });
    await shot(page, "retour");

    // Etat reel : 1 organisation en essai de 14 jours, adossee a UNE souscription trialing.
    const org = await orgOf(email);
    expect(org).toMatchObject({ plan: "pro", subscription_status: "trialing" });
    expect(org!.stripe_subscription_id).toBeTruthy();
    const jours = (new Date(org!.trial_ends_at).getTime() - Date.now()) / 86_400_000;
    expect(jours).toBeGreaterThan(13.5); expect(jours).toBeLessThan(14.1);
    expect(org!.trial_consumed_at).toBeTruthy();
    const st = await stripeState(page);
    const subs = st.subscriptions.filter((s) => s["customer"] === org!.stripe_customer_id);
    expect(subs).toHaveLength(1);
    expect(subs[0]!["status"]).toBe("trialing");
    expect(subs[0]!["items"].data[0].price.id).toBe("price_fake_pro");
    // Le lien magique est envoye (capture, jamais de vrai e-mail).
    const m = await attendre(async () => (await mails(email)).find((x) => x["tag"] === "activation_magic_link"));
    expect(m, "e-mail d'activation capture").toBeTruthy();
    expect(String(m!["token"])).toMatch(/^[a-f0-9]{64}$/);
    // Etat du navigateur nettoye apres succes.
    expect(await page.evaluate(() => [localStorage.getItem("fp_cart"), sessionStorage.getItem("fp_pre_reg_token")])).toEqual([null, null]);
    expect(unexpectedConsoleErrors(observed, ANON_OK)).toEqual([]);
  });

  test("carte refusee : message clair, bouton debloque, aucun compte, puis reussite avec une autre carte", async ({ page, newEmail, shot }) => {
    const email = newEmail("refus");
    await seedCart(page, "standard");
    await inscriptionJusquAuPaiement(page, email);
    await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
    await page.locator("#fake-card-number").fill("4000 0000 0000 0002");
    await payer(page);
    await expect(page.locator("#fp-alert")).toContainText("Votre carte a été refusée.");
    await expect(page.locator("#fp-pay-btn")).toBeEnabled();
    await expect(page.locator("#fp-pay-btn")).toHaveText("Démarrer l'essai gratuit →");
    expect(new URL(page.url()).pathname).toBe("/checkout-payment.html");
    await shot(page, "refus");
    expect(await orgOf(email)).toBeNull();
    expect((await stripeState(page)).subscriptions.filter((s) => (s["metadata"] as any)?.org_id === email)).toHaveLength(0);
    // Reprise : une carte valide aboutit sur la meme page, sans repartir de zero.
    await page.locator("#fake-card-number").fill("4242 4242 4242 4242");
    await payer(page);
    await expect(page.locator("#fp-title")).toHaveText("Compte activé ! Vérifiez vos emails", { timeout: 20_000 });
    expect((await orgOf(email))?.subscription_status).toBe("trialing");
  });

  test("intent invalide : le serveur refuse -> erreur affichee, aucun formulaire de carte, paiement impossible", async ({ page, newEmail }) => {
    await seedCart(page, "pro");
    await page.route("**/api/public/payment-intent", (r) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Sélection non facturable.", code: "INVALID_SELECTION" }) }));
    await page.goto("/signin.html");
    await remplirInscription(page, newEmail("inv"));
    await page.locator("#signup-btn").click();
    await page.waitForURL(/\/checkout\.html/);
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-payment\.html/);
    await expect(page.locator("#fp-alert")).toContainText("Sélection non facturable.");
    await expect(page.locator("#fp-pay-btn")).toBeDisabled();
  });

  test("erreur serveur 500 (corps non JSON) : message d'erreur, pas de page blanche", async ({ page, newEmail }) => {
    await seedCart(page, "pro");
    await page.route("**/api/public/payment-intent", (r) => r.fulfill({ status: 500, contentType: "text/html", body: "<html>boom</html>" }));
    await page.goto("/signin.html");
    await remplirInscription(page, newEmail("e500"));
    await page.locator("#signup-btn").click();
    await page.waitForURL(/\/checkout\.html/);
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-payment\.html/);
    await expect(page.locator("#fp-alert")).toBeVisible();
    await expect(page.locator("#fp-pay-btn")).toBeDisabled();
  });

  test("Stripe.js indisponible (bloqueur / reseau) : message explicite, paiement impossible", async ({ page, newEmail }) => {
    await seedCart(page, "pro");
    await page.route("https://js.stripe.com/**", (r) => r.abort("failed"));
    await page.goto("/signin.html");
    await remplirInscription(page, newEmail("nojs"));
    await page.locator("#signup-btn").click();
    await page.waitForURL(/\/checkout\.html/);
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-payment\.html/);
    await expect(page.locator("#fp-alert")).toContainText("Stripe.js n'a pas pu se charger");
    await expect(page.locator("#fp-pay-btn")).toBeDisabled();
  });

  test("jeton d'inscription perdu avant le paiement : retour au formulaire, aucun intent cree", async ({ page, newEmail }) => {
    await seedCart(page, "pro");
    await inscriptionJusquAuPaiement(page, newEmail("jeton"));
    await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });   // l'intent de cette page est cree
    const avant = (await stripeState(page)).intents.length;
    await page.evaluate(() => { sessionStorage.removeItem("fp_pre_reg_token"); localStorage.removeItem("fp_pre_reg_token"); });
    await page.reload();
    await page.waitForURL(/\/signin\.html/, { timeout: 15_000 });
    expect((await stripeState(page)).intents.length).toBe(avant);
  });

  test("jeton perdu APRES la confirmation de la carte : le retour retrouve l'inscription par l'intent (chemin C) et active l'essai", async ({ page, request, newEmail, mails }) => {
    const email = newEmail("jetonC");
    const { intentId } = await paiementConfirmeSansFinalisation(request, email);
    // Nouvel onglet, stockage vide : ni jeton, ni panier.
    await page.goto(`/checkout-return.html?setup_intent=${intentId}&redirect_status=succeeded`);
    const org = await attendre(async () => (await orgOf(email)));
    expect(org, "organisation creee malgre le jeton perdu").toBeTruthy();
    expect(org!.subscription_status).toBe("trialing");
    expect(org!.stripe_subscription_id).toBeTruthy();
    await expect(page.locator("#fp-title")).not.toHaveText(/Erreur de finalisation/);
    expect(await attendre(async () => (await mails(email)).find((x) => x["tag"] === "activation_magic_link"))).toBeTruthy();
  });

  test("retour avec un intent NON confirme (3DS abandonne) : erreur de finalisation, aucun compte active", async ({ page, request, newEmail }) => {
    const email = newEmail("nonconf");
    const pre = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: { firstName: "T", lastName: "C", email, companyName: "C", country: "FR", address: "1 rue", city: "Paris", postalCode: "75001" } });
    const token = ((await pre.json()) as any).preRegisterToken as string;
    const pi = await request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan: "pro", addons: {}, preRegisterToken: token } });
    const intentId = (((await pi.json()) as any).clientSecret as string).split("_secret_")[0];
    await page.addInitScript((t) => { sessionStorage.setItem("fp_pre_reg_token", t); }, token);
    await page.goto(`/checkout-return.html?setup_intent=${intentId}&redirect_status=failed`);
    await expect(page.locator("#fp-title")).toHaveText("Erreur de finalisation", { timeout: 15_000 });
    expect(await orgOf(email)).toBeNull();
  });

  test.describe("comportements cibles (PR en cours)", () => {
    test("onglet ferme apres confirmation : le webhook setup_intent.succeeded cree la SOUSCRIPTION d'essai et active le compte", async ({ page, request, newEmail }) => {
      pendingFix("fix/essai-sans-souscription-20261108", "aujourd'hui le webhook active le compte (isTrial: true) SANS creer de souscription Stripe : essai sans abonnement adosse.");
      const email = newEmail("webhook");
      const { intentId, token } = await paiementConfirmeSansFinalisation(request, email);
      const intent = (await stripeState(page)).intents.find((i) => i["id"] === intentId) as any;
      const w = await request.post(`${BASE_URL}/__fake/webhook`, { data: { type: "setup_intent.succeeded", object: { id: intentId, object: "setup_intent", customer: intent.customer, payment_method: intent.payment_method, status: "succeeded", metadata: intent.metadata } } });
      expect(((await w.json()) as any).status).toBe(200);
      const org = await attendre(async () => { const o = await orgOf(email); return o?.stripe_subscription_id ? o : null; }, 10_000);
      expect(org, "organisation avec souscription apres le seul webhook").toBeTruthy();
      expect(org!.subscription_status).toBe("trialing");
      const subs = (await stripeState(page)).subscriptions.filter((s) => s["customer"] === org!.stripe_customer_id);
      expect(subs).toHaveLength(1);
      expect(subs[0]!["status"]).toBe("trialing");
      void token;
    });

    test("success.html ouvert directement ne declare AUCUN abonnement active", async ({ page }) => {
      pendingFix("fix/faux-succes-paiement-20261108", "success.html affiche « Abonnement active — 14 jours d'essai offerts » sans session_id ni verification serveur.");
      await page.goto("/success.html");
      await expect(page.locator("body")).not.toContainText("Abonnement activé");
      await expect(page.locator("body")).not.toContainText("14 jours d'essai offerts");
    });

    test("retour Stripe en echec (redirect_status=failed, intent inconnu, visiteur sans session) n'affiche pas « paiement enregistre »", async ({ page }) => {
      pendingFix("fix/faux-succes-paiement-20261108", "checkout-return.html rend « Paiement enregistre » sur un 401, meme quand Stripe annonce redirect_status=failed.");
      await page.goto("/checkout-return.html?setup_intent=seti_inconnu&redirect_status=failed");
      await expect(page.locator("#fp-title")).toBeVisible();
      await expect(page.locator("#fp-title")).not.toHaveText(/Paiement enregistré|Compte activé|confirmée/);
    });
  });
});
