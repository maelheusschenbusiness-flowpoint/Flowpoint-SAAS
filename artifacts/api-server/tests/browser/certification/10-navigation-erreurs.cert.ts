/**
 * 10. Navigation (entree directe, retour arriere, rechargement, panier existant) et ERREURS du tunnel, en anglais (defaut) et francais.
 *
 * Complete 02 (validations, doublon, honeypot), 04 (carte refusee, intent invalide, 500, Stripe.js absent, jeton perdu) : ici la
 * variable est la LANGUE et le CHEMIN (navigation), plus les erreurs absentes de 02/04 (429 reel, 5xx HTML, reseau coupe au paiement
 * puis reprise, echec de finalisation puis reprise, panier perime / invalide / corrompu).
 *
 * Partie A : lecture seule (local ET flowpoint-test.onrender.com). Parties B-D : ecrivent, local uniquement (base jetable).
 */
import { test, expect, T, langueCode, poserLangue, langueCoherente, orgDe, remplirInscription, defautConnu, prixCatalogue, BASE_URL, one, unexpectedConsoleErrors, ANON_OK, type Langue } from "./support/matrice";
import { IS_LOCAL, all } from "./support/fixtures";
import { stripeState } from "./support/parcours";

const LANGS: Langue[] = ["en", "fr"];
const FRAGMENTS_CASSES = /undefined|NaN|\[object|\{\{|null null/;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A. Navigation DIRECTE sur chaque page du tunnel, visiteur anonyme, sans etat (lecture seule)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface PageCas { nom: string; chemin: string; arrivee: RegExp; attendu: { en: RegExp; fr: RegExp }; bruit?: RegExp }
const PAGES: PageCas[] = [
  { nom: "inscription", chemin: "/signin.html", arrivee: /^\/signin\.html$/, attendu: { en: /Create your account/, fr: /Créer votre compte/ } },
  { nom: "recapitulatif (sans panier ni session)", chemin: "/checkout.html", arrivee: /^\/signin\.html$/, attendu: { en: /Create your account/, fr: /Créer votre compte/ } },
  { nom: "recapitulatif avec ?plan=pro (sans session)", chemin: "/checkout.html?plan=pro", arrivee: /^\/signin\.html$/, attendu: { en: /Create your account/, fr: /Créer votre compte/ } },
  { nom: "paiement (sans jeton)", chemin: "/checkout-payment.html", arrivee: /^\/signin\.html$/, attendu: { en: /Create your account/, fr: /Créer votre compte/ } },
  { nom: "retour sans parametre", chemin: "/checkout-return.html", arrivee: /^\/pricing\.html$/, attendu: { en: /Transparent pricing/, fr: /Des tarifs transparents/ } },
  { nom: "retour avec un intent inconnu (jamais un faux succes)", chemin: "/checkout-return.html?setup_intent=seti_inconnu&redirect_status=succeeded", arrivee: /^\/checkout-return\.html$/, attendu: { en: /not a confirmation/i, fr: /Ce n’est pas une confirmation|Ce n'est pas une confirmation/ },
    // CONSTAT P3 : un identifiant d'intent inconnu fait repondre 503 (et non 404/400) a /api/public/finalize-checkout : du bruit 5xx pour la supervision.
    bruit: /status of 503/ },
  { nom: "succes sans session de paiement", chemin: "/success.html", arrivee: /^\/success\.html$/, attendu: { en: /No payment to confirm/, fr: /Aucun paiement à confirmer/ } },
  { nom: "annulation", chemin: "/cancel.html", arrivee: /^\/cancel\.html$/, attendu: { en: /Payment canceled/, fr: /Paiement annulé/ } },
];

test.describe("10A. Navigation directe sur chaque page du tunnel (lecture seule)", () => {
  for (const cas of PAGES) {
    for (const l of LANGS) {
      test(`${cas.nom} | ${l} : page utile, bonne langue, aucune erreur de page, issue de sortie`, async ({ page, context, observed }) => {
        await poserLangue(context, l);
        await page.goto(cas.chemin);
        await page.waitForURL((u) => cas.arrivee.test(u.pathname), { timeout: 15_000 });
        await expect.poll(() => page.locator("body").innerText(), { timeout: 15_000, message: "texte attendu de la page" }).toMatch(cas.attendu[langueCode(l)]);
        const texte = await page.locator("body").innerText();
        expect(texte.trim().length, "page non blanche").toBeGreaterThan(60);
        expect(texte, "aucune valeur technique affichee").not.toMatch(FRAGMENTS_CASSES);
        await langueCoherente(page, l);
        expect(await page.locator("a[href], button").count(), "au moins une issue (lien ou bouton)").toBeGreaterThan(0);
        expect(observed.pageErrors).toEqual([]);
        expect(unexpectedConsoleErrors(observed, [...ANON_OK, /status of (400|404|409)/, ...(cas.bruit ? [cas.bruit] : [])])).toEqual([]);
      });
    }
  }

  test("annulation : « reprendre mon essai » ramene dans le tunnel (inscription ou recapitulatif), jamais une 404", async ({ page }) => {
    await page.goto("/cancel.html");
    const lien = page.getByRole("link", { name: /Resume my free trial|Reprendre mon essai/ }).first();
    await expect(lien).toBeVisible();
    await lien.click();
    await page.waitForURL(/\/(signin|checkout|pricing)\.html/, { timeout: 15_000 });
    // La page d'arrivee reste masquee un instant (garde d'authentification) : on attend son texte plutot que de le lire tout de suite.
    await expect.poll(async () => (await page.locator("body").innerText()).trim().length, { timeout: 15_000 }).toBeGreaterThan(60);
  });
});

if (IS_LOCAL) {
  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // B. Retour arriere, avance, rechargement
  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  test.describe("10B. Retour arriere / avance / rechargement", () => {
    test.setTimeout(120_000);
    test.beforeEach(async ({ useStripeStub }) => { await useStripeStub(); });

    for (const l of LANGS) {
      test(`${l} : retour arriere depuis le recapitulatif, puis avance, puis rechargement a chaque etape : plan et jeton conserves`, async ({ page, context, newEmail, observed }) => {
        await poserLangue(context, l);
        const t = T[langueCode(l)];
        const email = newEmail(`nav-${l}`);
        await page.goto("/pricing.html");
        await page.locator('.fp-card-btn[data-plan="ultra"]').click();
        await page.waitForURL(/\/signin\.html/);
        await remplirInscription(page, email);
        await page.locator("#signup-btn").click();
        await page.waitForURL(/\/checkout\.html\?plan=ultra/);
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });

        // Rechargement du recapitulatif : meme plan, meme prix, bouton actif.
        await page.reload();
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
        await expect(page.locator("#fp-pay-btn")).toContainText(t.checkoutCta);
        expect(new URL(page.url()).searchParams.get("plan")).toBe("ultra");

        // Retour arriere vers le formulaire : la page reste utilisable et en bonne langue (pas de page blanche, pas de plantage).
        await page.goBack();
        await page.waitForURL(/\/signin\.html/);
        await langueCoherente(page, l);
        await expect(page.locator("#signup-btn")).toBeVisible();
        // Avance : on retrouve le recapitulatif avec le plan.
        await page.goForward();
        await page.waitForURL(/\/checkout\.html/);
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });

        // Paiement : rechargement ET retour arriere sans perdre le jeton ni creer plusieurs inscriptions.
        await page.locator("#fp-pay-btn").click();
        await page.waitForURL(/\/checkout-payment\.html/);
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
        await page.reload();
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
        await expect(page.locator("#fp-pay-btn")).toContainText(t.payBtn);
        await page.goBack();
        await page.waitForURL(/\/checkout\.html/);
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
        await page.goForward();
        await page.waitForURL(/\/checkout-payment\.html/);
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });

        const att = await all("SELECT token FROM pending_signups WHERE lower(email)=lower($1) AND consumed_at IS NULL", [email]);
        expect(att, "une seule inscription en attente malgre retours et rechargements").toHaveLength(1);
        expect(await orgDe(email), "aucun compte avant le paiement").toBeNull();
        expect(observed.pageErrors).toEqual([]);
      });

      test(`${l} : rechargement et retour arriere APRES le succes : une seule organisation, une seule souscription, aucun second essai`, async ({ page, context, newEmail }) => {
        await poserLangue(context, l);
        const t = T[langueCode(l)];
        const email = newEmail(`apres-${l}`);
        await page.goto("/pricing.html");
        await page.locator('.fp-card-btn[data-plan="pro"]').click();
        await page.waitForURL(/\/signin\.html/);
        await remplirInscription(page, email);
        await page.locator("#signup-btn").click();
        await page.waitForURL(/\/checkout\.html/);
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
        await page.locator("#fp-pay-btn").click();
        await page.waitForURL(/\/checkout-payment\.html/);
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
        await page.locator("#fp-pay-btn").click();
        await page.waitForURL(/\/checkout-return\.html/);
        await expect(page.locator("#fp-title")).toHaveText(t.returnTitle, { timeout: 25_000 });
        const org1 = await orgDe(email);
        expect(org1?.["stripe_subscription_id"]).toBeTruthy();

        // Rechargement de la page de retour (paramètres Stripe encore dans l'URL) : pas de 2e compte, pas de faux echec bloquant.
        await page.reload();
        await page.waitForTimeout(4000);
        // Retour arriere vers la page de paiement puis nouveau clic : aucun second essai ne doit etre cree.
        await page.goBack().catch(() => undefined);
        await page.waitForTimeout(1500);
        const btn = page.locator("#fp-pay-btn");
        if (await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false)) { await btn.click().catch(() => undefined); await page.waitForTimeout(4000); }
        expect(await all("SELECT id FROM organizations WHERE lower(owner_email)=lower($1)", [email])).toHaveLength(1);
        expect(await all("SELECT id FROM users WHERE lower(email)=lower($1)", [email])).toHaveLength(1);
        const st = await stripeState(page);
        expect(st.subscriptions.filter((s) => s["customer"] === org1!["stripe_customer_id"]), "une seule souscription").toHaveLength(1);
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // C. Panier existant (fp_cart) : frais, perime (> 1 h), plan invalide, JSON corrompu
  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  test.describe("10C. Panier existant (fp_cart)", () => {
    test.setTimeout(90_000);
    const HEURE = 3_600_000;
    // planAttendu : repris par l'INSCRIPTION ; planRecap : repris par le RECAPITULATIF (un panier sans `_v` est accepte tel quel par checkout.html : panier « ancien format », par ex. restaure apres une redirection).
    type Panier = { nom: string; valeur: (() => string) | string; planAttendu: "pro" | null; planRecap?: "pro" | null };
    const PANIERS: Panier[] = [
      { nom: "frais (10 min)", valeur: () => JSON.stringify({ plan: "pro", addons: {}, _v: 1, _updatedAt: Date.now() - 10 * 60_000 }), planAttendu: "pro" },
      { nom: "perime (2 h)", valeur: () => JSON.stringify({ plan: "pro", addons: {}, _v: 1, _updatedAt: Date.now() - 2 * HEURE }), planAttendu: null },
      { nom: "juste perime (1 h 1 min)", valeur: () => JSON.stringify({ plan: "pro", addons: {}, _v: 1, _updatedAt: Date.now() - HEURE - 60_000 }), planAttendu: null },
      { nom: "plan invalide (platinum)", valeur: () => JSON.stringify({ plan: "platinum", addons: {}, _v: 1, _updatedAt: Date.now() }), planAttendu: null },
      { nom: "plan injecte (<script>)", valeur: () => JSON.stringify({ plan: "<img src=x onerror=alert(1)>", addons: {}, _v: 1, _updatedAt: Date.now() }), planAttendu: null },
      { nom: "JSON corrompu", valeur: "{plan:'pro'", planAttendu: null },
      { nom: "sans horodatage ni version (ancien format)", valeur: () => JSON.stringify({ plan: "pro", addons: {} }), planAttendu: null, planRecap: "pro" },
    ];

    for (const p of PANIERS) {
      for (const l of LANGS) {
        test(`inscription | panier ${p.nom} | ${l} : ${p.planAttendu ? "le plan est repris (« continuer vers le paiement »)" : "le plan n'est PAS repris (choix du plan propose), aucun plantage"}`, async ({ page, context, observed }) => {
          await poserLangue(context, l);
          const t = T[langueCode(l)];
          const valeur = typeof p.valeur === "function" ? p.valeur() : p.valeur;
          await page.goto("/pricing.html");
          await page.evaluate((v) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem("fp_cart", v); }, valeur);
          await page.goto("/signin.html");
          await expect(page.locator("#signup-btn-text")).toHaveText(p.planAttendu ? t.signupCta : t.signupCtaNoPlan);
          // Le lien Google ne transporte le plan que s'il est valide et frais.
          const href = (await page.locator("#btn-google-oauth").getAttribute("href")) ?? "";
          if (p.planAttendu) expect(href).toContain("plan=pro"); else expect(href).not.toMatch(/plan=/);
          await langueCoherente(page, l);
          expect(observed.pageErrors).toEqual([]);
        });
      }
    }

    for (const l of LANGS) {
      test(`inscription avec panier PERIME | ${l} : apres le formulaire, l'ecran de choix du plan s'affiche, le plan choisi arrive au recapitulatif`, async ({ page, context, newEmail }) => {
        await poserLangue(context, l);
        await page.goto("/pricing.html");
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem("fp_cart", JSON.stringify({ plan: "ultra", addons: {}, _v: 1, _updatedAt: Date.now() - 2 * 3_600_000 })); });
        await page.goto("/signin.html");
        await remplirInscription(page, newEmail(`perime-${l}`));
        await page.locator("#signup-btn").click();
        await expect(page.locator("#plan-screen")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("#signup-screen")).toBeHidden();
        await langueCoherente(page, l);
        await page.locator("#plan-screen .plan-card-btn[data-plan=\"pro\"]").click();
        await page.waitForURL(/\/checkout\.html\?plan=pro/, { timeout: 15_000 });
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
      });
    }

    // Recapitulatif avec un panier existant, visiteur pre-inscrit (jeton) : la page nettoie ce qui est perime ou invalide.
    for (const p of PANIERS) {
      const planRecap = p.planRecap !== undefined ? p.planRecap : p.planAttendu;
      test(`recapitulatif | panier ${p.nom} : ${planRecap ? "plan repris" : "panier ecarte, etat « panier vide » propre"}`, async ({ page, request, newEmail }) => {
        const pre = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: { firstName: "Test", lastName: "Panier", email: newEmail("rec") } });
        const token = ((await pre.json()) as { preRegisterToken: string }).preRegisterToken;
        const valeur = typeof p.valeur === "function" ? p.valeur() : p.valeur;
        await page.addInitScript(([tok, v]) => { try { if (!sessionStorage.getItem("__cart_init")) { sessionStorage.setItem("__cart_init", "1"); sessionStorage.setItem("fp_pre_reg_token", tok!); localStorage.setItem("fp_cart", v!); } } catch { /* ignore */ } }, [token, valeur]);
        await page.goto("/checkout.html");
        if (planRecap) {
          await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
          expect(new URL(page.url()).pathname).toBe("/checkout.html");
        } else {
          await expect(page.locator("#fp-empty")).toBeVisible({ timeout: 15_000 });
          await expect(page.locator("#fp-pay-btn")).not.toBeVisible();
          await expect(page.locator("#fp-empty a[href='/pricing.html']")).toBeVisible();
        }
      });
    }

    test("recapitulatif avec panier perime ET ?plan=ultra dans l'URL : le plan de l'URL est repris, pas le plan perime", async ({ page, request, newEmail }) => {
      const pre = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: { firstName: "Test", lastName: "Panier", email: newEmail("recurl") } });
      const token = ((await pre.json()) as { preRegisterToken: string }).preRegisterToken;
      await page.addInitScript((tok) => { try { if (!sessionStorage.getItem("__cart_init")) { sessionStorage.setItem("__cart_init", "1"); sessionStorage.setItem("fp_pre_reg_token", tok); localStorage.setItem("fp_cart", JSON.stringify({ plan: "standard", addons: {}, _v: 1, _updatedAt: Date.now() - 3 * 3_600_000 })); } } catch { /* ignore */ } }, token);
      await page.goto("/checkout.html?plan=ultra");
      await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
      const ultra = (await prixCatalogue(page)).ultra;
      await expect(page.locator("body")).toContainText(T.en.price(ultra), { useInnerText: true });   // recapitulatif Ultra (prix du catalogue), pas Standard
      await expect(page.locator("#fp-empty")).toBeHidden();
    });

    // Lien direct vers le recapitulatif par un visiteur sans compte (annonce, e-mail) : le plan du lien doit survivre a l'inscription.
    // Regression D3 (corrige) : checkout.html estampille le panier (_v / _updatedAt) avant la redirection anonyme.
    for (const l of LANGS) {
      test(`lien direct /checkout.html?plan=ultra par un visiteur anonyme | ${l} : le plan survit a l'inscription, sans re-choisir`, async ({ page, context, newEmail }) => {
        await poserLangue(context, l);
        const t = T[langueCode(l)];
        await page.goto("/checkout.html?plan=ultra");
        await page.waitForURL(/\/signin\.html/);
        await expect(page.locator("#signup-btn-text"), "le formulaire annonce la suite reelle (paiement)").toHaveText(t.signupCta);
        await remplirInscription(page, newEmail(`lien-${l}`));
        await page.locator("#signup-btn").click();
        await page.waitForURL(/\/checkout\.html\?plan=ultra/, { timeout: 15_000 });
        await expect(page.locator("#plan-screen")).toBeHidden();
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // D. Erreurs, dans chaque langue
  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  test.describe("10D. Erreurs du tunnel", () => {
    test.setTimeout(120_000);
    test.beforeEach(async ({ useStripeStub }) => { await useStripeStub(); });

    for (const l of LANGS) {
      test(`e-mail invalide | ${l} : message dans la langue, rien n'est envoye au serveur`, async ({ page, context }) => {
        await poserLangue(context, l);
        let envois = 0;
        page.on("request", (r) => { if (r.url().endsWith("/api/auth/pre-register")) envois += 1; });
        await page.goto("/signin.html");
        await remplirInscription(page, "pas-un-email");
        await page.locator("#signup-btn").click();
        await expect(page.locator("#signup-msg")).toHaveText(T[langueCode(l)].invalidEmail);
        await expect(page.locator("#signup-btn")).toBeEnabled();
        expect(envois).toBe(0);
      });

      // Compte existant (409) : le message dit qu'un compte existe, dans la langue de l'interface (cle sur le statut HTTP,
      // jamais sur le texte serveur, qui reste anglais), suivi du lien vers la connexion.
      // Regression (ex-defaut P2 corrige) : en anglais le message etait generique, en francais il s'affichait en anglais.
      test(`compte existant (409) | ${l} : message explicite dans la langue de l'interface + lien vers la connexion`, async ({ page, context, request, signupViaApi }) => {
        await poserLangue(context, l);
        const { email } = await signupViaApi(request);
        await page.goto("/signin.html");
        await remplirInscription(page, email);
        await page.locator("#signup-btn").click();
        await expect(page.locator("#signup-msg")).toContainText(T[langueCode(l)].exists, { useInnerText: true });
        await expect(page.locator("#signin-redir-link")).toHaveAttribute("href", "/login.html");
        await expect(page.locator("#signup-btn")).toBeEnabled();
      });

      test(`429 simule sur l'inscription | ${l} : message clair, bouton libere, aucune inscription`, async ({ page, context, newEmail }) => {
        await poserLangue(context, l);
        await page.route("**/api/auth/pre-register", (r) => r.fulfill({ status: 429, contentType: "application/json", headers: { "retry-after": "60" }, body: JSON.stringify({ error: "Too many attempts. Please try again later." }) }));
        await page.goto("/signin.html");
        const email = newEmail("429");
        await remplirInscription(page, email);
        await page.locator("#signup-btn").click();
        await expect(page.locator("#signup-msg")).toHaveClass(/error/);
        await expect(page.locator("#signup-msg")).not.toHaveText("");
        await expect(page.locator("#signup-btn")).toBeEnabled();
        await expect(page.locator("#signup-screen")).toBeVisible();
        expect(await one("SELECT 1 FROM pending_signups WHERE lower(email)=lower($1)", [email])).toBeNull();
      });

      test(`429 REEL du limiteur (10 requetes / 15 min / IP) | ${l} : le 11e essai est refuse proprement dans le navigateur`, async ({ page, context, request, newEmail, testIp }) => {
        await poserLangue(context, l);
        // Meme IP que le navigateur du test (X-Forwarded-For) : on epuise le quota par l'API, comme un client trop insistant.
        let refuse = false;
        for (let i = 0; i < 14 && !refuse; i++) {
          const r = await request.post(`${BASE_URL}/api/auth/pre-register`, { headers: { "X-Forwarded-For": testIp }, data: { firstName: "Quota", lastName: "Test", email: newEmail(`q${i}`) } });
          if (r.status() === 429) refuse = true;
        }
        expect(refuse, "le limiteur doit finir par repondre 429").toBe(true);
        await page.goto("/signin.html");
        const email = newEmail("apres429");
        await remplirInscription(page, email);
        await page.locator("#signup-btn").click();
        await expect(page.locator("#signup-msg")).toHaveClass(/error/);
        await expect(page.locator("#signup-msg")).not.toHaveText("");
        await expect(page.locator("#signup-btn")).toBeEnabled();
        expect(await one("SELECT 1 FROM pending_signups WHERE lower(email)=lower($1)", [email])).toBeNull();
        expect((await page.locator("#signup-msg").innerText()), "pas de valeur technique").not.toMatch(FRAGMENTS_CASSES);
      });

      for (const [nom, rep] of [["500 JSON", { status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal error" }) }], ["502 HTML (passerelle)", { status: 502, contentType: "text/html", body: "<html><h1>Bad gateway</h1></html>" }], ["503 vide", { status: 503, contentType: "text/plain", body: "" }]] as const) {
        test(`${nom} sur l'inscription | ${l} : message, bouton libere, pas de page blanche`, async ({ page, context, newEmail, observed }) => {
          await poserLangue(context, l);
          await page.route("**/api/auth/pre-register", (r) => r.fulfill(rep));
          await page.goto("/signin.html");
          await remplirInscription(page, newEmail("5xx"));
          await page.locator("#signup-btn").click();
          await expect(page.locator("#signup-msg")).toHaveClass(/error/);
          await expect(page.locator("#signup-msg")).not.toHaveText("");
          await expect(page.locator("#signup-btn")).toBeEnabled();
          expect((await page.locator("#signup-msg").innerText())).not.toMatch(/<html|Bad gateway|undefined/);
          expect(observed.pageErrors).toEqual([]);
        });
      }

      test(`reseau coupe pendant l'inscription | ${l} : message dans la langue, reprise au retour du reseau`, async ({ page, context, newEmail }) => {
        await poserLangue(context, l);
        const t = T[langueCode(l)];
        await page.goto("/signin.html");
        const email = newEmail("offline");
        await remplirInscription(page, email);
        await context.setOffline(true);
        await page.locator("#signup-btn").click();
        await expect(page.locator("#signup-msg")).toContainText(t.unreachable, { useInnerText: true });
        await expect(page.locator("#signup-btn")).toBeEnabled();
        await context.setOffline(false);
        await page.locator("#signup-btn").click();
        await page.waitForURL(/\/checkout\.html|\/signin\.html/, { timeout: 15_000 });
        await expect.poll(async () => !!(await one("SELECT 1 FROM pending_signups WHERE lower(email)=lower($1)", [email])), { timeout: 10_000 }).toBe(true);
      });

      test(`Stripe.js bloque | ${l} : message explicite dans la langue, paiement impossible, aucun compte`, async ({ page, context, newEmail }) => {
        await poserLangue(context, l);
        const email = newEmail("nojs");
        await page.route("https://js.stripe.com/**", (r) => r.abort("failed"));
        await page.goto("/pricing.html");
        await page.locator('.fp-card-btn[data-plan="pro"]').click();
        await page.waitForURL(/\/signin\.html/);
        await remplirInscription(page, email);
        await page.locator("#signup-btn").click();
        await page.waitForURL(/\/checkout\.html/);
        await page.locator("#fp-pay-btn").click();
        await page.waitForURL(/\/checkout-payment\.html/);
        await expect(page.locator("#fp-alert")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("#fp-alert")).toContainText(/Stripe|paiement|payment/i);
        await expect(page.locator("#fp-pay-btn")).toBeDisabled();
        await langueCoherente(page, l);
        expect(await orgDe(email)).toBeNull();
      });

      test(`intent refuse (429 puis reprise) | ${l} : alerte, paiement impossible, puis le rechargement retablit le paiement`, async ({ page, context, newEmail }) => {
        await poserLangue(context, l);
        let bloque = true;
        await page.route("**/api/public/payment-intent", (r) => bloque ? r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Too many requests. Please try again later." }) }) : r.continue());
        await page.goto("/pricing.html");
        await page.locator('.fp-card-btn[data-plan="standard"]').click();
        await page.waitForURL(/\/signin\.html/);
        await remplirInscription(page, newEmail("pi429"));
        await page.locator("#signup-btn").click();
        await page.waitForURL(/\/checkout\.html/);
        await page.locator("#fp-pay-btn").click();
        await page.waitForURL(/\/checkout-payment\.html/);
        await expect(page.locator("#fp-alert")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("#fp-pay-btn")).toBeDisabled();
        bloque = false;
        await page.reload();
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
      });

      test(`reseau coupe au moment de payer | ${l} : erreur affichee, bouton libere, la reprise aboutit sans doublon`, async ({ page, context, newEmail, mails }) => {
        await poserLangue(context, l);
        const t = T[langueCode(l)];
        const email = newEmail("payoff");
        await page.goto("/pricing.html");
        await page.locator('.fp-card-btn[data-plan="pro"]').click();
        await page.waitForURL(/\/signin\.html/);
        await remplirInscription(page, email);
        await page.locator("#signup-btn").click();
        await page.waitForURL(/\/checkout\.html/);
        await page.locator("#fp-pay-btn").click();
        await page.waitForURL(/\/checkout-payment\.html/);
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
        // La confirmation de carte du stub appelle le faux Stripe (/__fake) : on coupe cet appel comme un reseau defaillant.
        let coupe = true;
        await page.route("**/__fake/stripe/confirm-setup", (r) => coupe ? r.abort("internetdisconnected") : r.continue());
        await page.locator("#fp-pay-btn").click();
        await expect(page.locator("#fp-alert")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("#fp-pay-btn")).toBeEnabled();
        expect(new URL(page.url()).pathname).toBe("/checkout-payment.html");
        expect(await orgDe(email), "aucun compte tant que la carte n'est pas confirmee").toBeNull();
        coupe = false;
        await page.locator("#fp-pay-btn").click();
        await page.waitForURL(/\/checkout-return\.html/, { timeout: 15_000 });
        await expect(page.locator("#fp-title")).toHaveText(t.returnTitle, { timeout: 25_000 });
        expect(await all("SELECT id FROM organizations WHERE lower(owner_email)=lower($1)", [email])).toHaveLength(1);
        expect((await mails(email)).filter((m) => m["tag"] === "activation_magic_link")).toHaveLength(1);
      });

      test(`echec de la finalisation apres une carte confirmee (500) | ${l} : jamais un faux succes ; « reessayer » aboutit, un seul compte`, async ({ page, context, newEmail }) => {
        await poserLangue(context, l);
        const t = T[langueCode(l)];
        const email = newEmail("fin500");
        let echec = true;
        await page.route("**/api/public/finalize-checkout", (r) => echec ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal error" }) }) : r.continue());
        await page.goto("/pricing.html");
        await page.locator('.fp-card-btn[data-plan="pro"]').click();
        await page.waitForURL(/\/signin\.html/);
        await remplirInscription(page, email);
        await page.locator("#signup-btn").click();
        await page.waitForURL(/\/checkout\.html/);
        await page.locator("#fp-pay-btn").click();
        await page.waitForURL(/\/checkout-payment\.html/);
        await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
        await page.locator("#fp-pay-btn").click();
        await page.waitForURL(/\/checkout-return\.html/);
        await expect(page.locator("#fp-title")).not.toHaveText(t.returnTitle);
        await expect(page.locator("#fp-title")).not.toHaveText(/Finalizing|Finalisation/, { timeout: 30_000 });
        const titre = await page.locator("#fp-title").innerText();
        expect(titre, "aucun faux succes").not.toMatch(/ready|prêt|confirmed|confirmé|activé/i);
        expect(await orgDe(email)).toBeNull();
        echec = false;
        await page.getByRole("link", { name: /Try again|Réessayer/ }).first().click();
        await expect(page.locator("#fp-title")).toHaveText(t.returnTitle, { timeout: 30_000 });
        expect(await all("SELECT id FROM organizations WHERE lower(owner_email)=lower($1)", [email])).toHaveLength(1);
      });
    }
  });
}
