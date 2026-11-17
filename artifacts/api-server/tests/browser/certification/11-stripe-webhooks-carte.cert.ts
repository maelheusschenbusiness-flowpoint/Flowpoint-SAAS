/**
 * 11. Stripe SIMULE du harnais : CARTE OBLIGATOIRE (aucun essai sans moyen de paiement), essai de 14 jours par plan, et
 * WEBHOOKS (customer.subscription.*, invoice.*, payment_intent.*, checkout.session.completed) -> effet sur l'organisation.
 *
 * Niveau 1 (ce fichier) = faux Stripe en memoire + evenements livres SIGNES par /__fake/webhook (meme verification de signature que
 * Stripe reel). Niveau 2 (Stripe TEST reel) : voir 11C, lecture seule, uniquement contre flowpoint-test.onrender.com ; les parcours
 * de carte reels ne sont PAS executes (aucun objet de test nettoyable sans cle d'administration) — voir la PR.
 *
 * Ecrit dans la base jetable : local uniquement (sauf 11C).
 */
import { test, expect, T, orgDe, BASE_URL, one, defautConnu, type Plan } from "./support/matrice";
import { PLANS, IS_LOCAL, all, db } from "./support/fixtures";
import { stripeState } from "./support/parcours";

type Sub = Record<string, any>;

test.describe("11A. Carte obligatoire et essai de 14 jours", () => {
  test.skip(!IS_LOCAL, "Ecrit des comptes et utilise le faux Stripe : local uniquement.");
  test.setTimeout(90_000);

  const preparer = async (request: import("@playwright/test").APIRequestContext, email: string, plan: Plan = "pro") => {
    const pre = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: { firstName: "Test", lastName: "Carte", email } });
    expect(pre.status()).toBe(200);
    const token = ((await pre.json()) as { preRegisterToken: string }).preRegisterToken;
    const pi = await request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan, addons: {}, preRegisterToken: token } });
    expect(pi.status()).toBe(200);
    const body = (await pi.json()) as { clientSecret: string; mode: string; immediateAmount: number };
    return { token, clientSecret: body.clientSecret, intentId: body.clientSecret.split("_secret_")[0]!, mode: body.mode, immediate: body.immediateAmount };
  };
  const finaliser = (request: import("@playwright/test").APIRequestContext, o: { intentId: string; token: string; plan?: string }) =>
    request.post(`${BASE_URL}/api/public/finalize-checkout`, { data: { intentId: o.intentId, intentType: "setup", plan: o.plan ?? "pro", addons: {}, preRegisterToken: o.token } });

  for (const plan of PLANS) {
    test(`${plan} : l'essai est un SetupIntent a 0 EUR, 14 jours, avec carte attachee, au bon prix de plan`, async ({ request, newEmail, page }) => {
      const email = newEmail(`carte-${plan}`);
      const { token, clientSecret, intentId, mode, immediate } = await preparer(request, email, plan);
      expect(mode, "l'essai passe par un SetupIntent (collecte de carte), pas par une souscription sans moyen de paiement").toBe("setup");
      expect(immediate, "rien n'est debite aujourd'hui").toBe(0);
      expect(clientSecret).toMatch(/^seti_/);
      expect(await orgDe(email), "aucune organisation avant la carte").toBeNull();
      const conf = await request.post(`${BASE_URL}/__fake/stripe/confirm-setup`, { data: { clientSecret, card: "4242 4242 4242 4242" } });
      expect(((await conf.json()) as { setupIntent?: unknown }).setupIntent).toBeTruthy();
      expect((await finaliser(request, { intentId, token, plan })).status()).toBe(200);
      const org = (await orgDe(email))!;
      expect(org).toMatchObject({ plan, subscription_status: "trialing" });
      const subs = (await stripeState(page)).subscriptions.filter((s) => s["customer"] === org["stripe_customer_id"]) as Sub[];
      expect(subs).toHaveLength(1);
      const jours = (subs[0]!["trial_end"] - subs[0]!["created"]) / 86_400;
      expect(jours, "essai Stripe de 14 jours").toBeGreaterThan(13.9); expect(jours).toBeLessThan(14.1);
      expect(subs[0]!["default_payment_method"]).toMatch(/^pm_/);
      expect(subs[0]!["items"].data[0].price.id).toBe(`price_fake_${plan}`);
    });
  }

  test("carte NON confirmee : finaliser l'essai est refuse (aucune organisation, aucune souscription, aucun e-mail)", async ({ request, newEmail, page, mails }) => {
    const email = newEmail("sanscarte");
    const { token, intentId } = await preparer(request, email);
    const avant = (await stripeState(page)).subscriptions.length;
    const fin = await finaliser(request, { intentId, token });
    expect(fin.status(), "refus explicite").toBeGreaterThanOrEqual(400);
    expect(fin.status()).toBeLessThan(500);
    expect(await orgDe(email)).toBeNull();
    expect(await one("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email])).toBeNull();
    expect((await stripeState(page)).subscriptions.length, "aucune souscription creee").toBe(avant);
    expect((await mails(email)).filter((m) => m["tag"] === "activation_magic_link")).toHaveLength(0);
  });

  test("carte REFUSEE : aucun essai ; finaliser apres le refus reste impossible", async ({ request, newEmail, page }) => {
    const email = newEmail("refuse");
    const { token, clientSecret, intentId } = await preparer(request, email);
    const conf = await request.post(`${BASE_URL}/__fake/stripe/confirm-setup`, { data: { clientSecret, card: "4000 0000 0000 0002" } });
    expect(((await conf.json()) as { error?: { code: string } }).error?.code).toBe("card_declined");
    expect((await finaliser(request, { intentId, token })).status()).toBeGreaterThanOrEqual(400);
    expect(await orgDe(email)).toBeNull();
    expect((await stripeState(page)).subscriptions.filter((s) => (s["metadata"] as any)?.pre_register_token === token)).toHaveLength(0);
  });

  test("navigateur : retour Stripe « succeeded » FALSIFIE sur une carte jamais confirmee -> aucun succes affiche, aucun compte", async ({ page, request, newEmail, context }) => {
    await context.addInitScript(() => { try { localStorage.setItem("fp:language", "en"); } catch { /* ignore */ } });
    const email = newEmail("falsif");
    const { token, intentId } = await preparer(request, email);
    await page.addInitScript((t) => { try { sessionStorage.setItem("fp_pre_reg_token", t); } catch { /* ignore */ } }, token);
    await page.goto(`/checkout-return.html?setup_intent=${intentId}&redirect_status=succeeded`);
    await expect(page.locator("#fp-title")).not.toHaveText(/Finalizing/, { timeout: 30_000 });
    expect(await page.locator("#fp-title").innerText(), "pas de faux succes").not.toMatch(/ready|prêt|confirmed|confirmé|activé/i);
    expect(await orgDe(email)).toBeNull();
  });

  test("plan transmis a la finalisation : le prix de la souscription est TOUJOURS celui du catalogue serveur pour ce plan (jamais un prix venu du client)", async ({ request, newEmail, page }) => {
    // Le SetupIntent est a 0 EUR et ne porte pas de plan : le plan est choisi a la finalisation parmi une liste blanche, et le PRIX est
    // resolu par le serveur. On verifie la coherence plan <-> prix, y compris avec des corps de requete hostiles.
    const email = newEmail("falsplan");
    const { token, clientSecret, intentId } = await preparer(request, email, "standard");
    await request.post(`${BASE_URL}/__fake/stripe/confirm-setup`, { data: { clientSecret, card: "4242 4242 4242 4242" } });
    const hostile = await request.post(`${BASE_URL}/api/public/finalize-checkout`, { data: { intentId, intentType: "setup", plan: "ultra", priceId: "price_fake_standard", amount: 1, addons: {}, preRegisterToken: token } });
    expect(hostile.status()).toBeLessThan(500);
    const org = await orgDe(email);
    if (hostile.status() === 200) {
      expect(["standard", "pro", "ultra"]).toContain(org?.["plan"]);
      const subs = (await stripeState(page)).subscriptions.filter((s) => s["customer"] === org!["stripe_customer_id"]) as Sub[];
      expect(subs).toHaveLength(1);
      expect(subs[0]!["items"].data[0].price.id, "prix = prix du catalogue pour le plan facture").toBe(`price_fake_${org!["plan"]}`);
    } else {
      expect(org).toBeNull();
    }
  });

  // DEFAUT P3 (documente, remonte) : finalize-checkout avec une carte CONFIRMEE et un plan hors liste blanche (« platinum ») repond
  // 200 {"success":true,"message":"Rien à activer."} : un faux succes d'API (aucune organisation, aucune souscription). Le navigateur
  // ne l'emet pas (checkout.html assainit le panier ; sans panier le serveur retrouve le plan de l'inscription : verifie a part),
  // donc impact limite aux appels directs ; la reponse devrait etre un 4xx.
  defautConnu("plan hors liste blanche a la finalisation (« platinum ») : refus 4xx ou activation d'un plan connu, jamais un « succes » sans rien activer (DEFAUT P3 : 200 « Rien a activer »)", async ({ request, newEmail }) => {
    const email = newEmail("platinum");
    const { token, clientSecret, intentId } = await preparer(request, email, "pro");
    await request.post(`${BASE_URL}/__fake/stripe/confirm-setup`, { data: { clientSecret, card: "4242 4242 4242 4242" } });
    const r = await finaliser(request, { intentId, token, plan: "platinum" });
    expect(r.status()).toBeLessThan(500);
    const org = await orgDe(email);
    if (r.status() >= 400) expect(org).toBeNull(); else expect(["standard", "pro", "ultra"]).toContain(org?.["plan"]);
  });

  test("plan ABSENT du panier au retour de paiement (panier supprime / perime) : le compte est tout de meme active avec le plan de l'inscription", async ({ page, context, newEmail, useStripeStub }) => {
    await useStripeStub();
    await context.addInitScript(() => { try { localStorage.setItem("fp:language", "en"); } catch { /* ignore */ } });
    const email = newEmail("sanspanier");
    await page.goto("/pricing.html");
    await page.locator('.fp-card-btn[data-plan="ultra"]').click();
    await page.waitForURL(/\/signin\.html/);
    for (const [id, v] of [["firstName", "Test"], ["lastName", "Panier"], ["email", email]]) await page.locator(`#${id}`).fill(v);
    await page.locator("#signup-btn").click();
    await page.waitForURL(/\/checkout\.html/);
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-payment\.html/);
    await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
    await page.evaluate(() => localStorage.removeItem("fp_cart"));          // panier perdu entre la carte et le retour
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-return\.html/);
    await expect(page.locator("#fp-title")).toHaveText(T.en.returnTitle, { timeout: 25_000 });
    expect(await orgDe(email)).toMatchObject({ plan: "ultra", subscription_status: "trialing" });
  });

  test("pre-inscrit sans carte : demander un lien de connexion ne donne ni compte ni session", async ({ request, newEmail }) => {
    const email = newEmail("preinscrit");
    await preparer(request, email);
    await request.post(`${BASE_URL}/__fake/mails/clear`);
    const r = await request.post(`${BASE_URL}/api/auth/login-request`, { data: { email } });
    expect(r.status()).toBeLessThan(500);
    await new Promise((res) => setTimeout(res, 800));
    const m = ((await (await request.get(`${BASE_URL}/__fake/mails?to=${encodeURIComponent(email)}`)).json()) as { mails: Array<{ token?: string; tag?: string }> }).mails;
    expect(m.filter((x) => x.token), "aucun lien magique n'est emis pour un compte sans carte").toHaveLength(0);
    expect(await orgDe(email), "aucune organisation sans carte").toBeNull();
    expect(await one("SELECT 1 FROM users WHERE lower(email)=lower($1) AND status='active'", [email])).toBeNull();
  });

  test("signature Stripe : un evenement non signe ou mal signe est refuse et ne change rien", async ({ request, signupViaApi }) => {
    const { email } = await signupViaApi(request);
    const avant = await orgDe(email);
    for (const entetes of [{} as Record<string, string>, { "stripe-signature": "t=1,v1=deadbeef" } as Record<string, string>]) {
      const r = await request.post(`${BASE_URL}/api/webhooks/stripe`, { headers: { "content-type": "application/json", ...entetes }, data: { id: "evt_forge", object: "event", type: "customer.subscription.deleted", data: { object: { id: "sub_x", customer: avant!["stripe_customer_id"], status: "canceled" } } } });
      expect([400, 401, 403]).toContain(r.status());
    }
    expect(await orgDe(email)).toEqual(avant);
  });
});

test.describe("11B. Webhooks -> effet sur l'organisation (par plan)", () => {
  test.skip(!IS_LOCAL, "Ecrit des comptes et livre des evenements au serveur local : local uniquement.");
  test.setTimeout(90_000);

  type Ctx = { email: string; orgId: string; customer: string; sub: Sub };
  const amorcer = async (request: import("@playwright/test").APIRequestContext, page: import("@playwright/test").Page, signupViaApi: any, plan: Plan): Promise<Ctx> => {
    const { email, orgId } = await signupViaApi(request, { plan });
    const org = (await orgDe(email))!;
    const sub = ((await stripeState(page)).subscriptions as Sub[]).find((s) => s["customer"] === org["stripe_customer_id"])!;
    return { email, orgId: orgId!, customer: org["stripe_customer_id"], sub };
  };
  let seq = 0;
  const evt = async (request: import("@playwright/test").APIRequestContext, type: string, object: Record<string, unknown>, id = `evt_cert11_${Date.now().toString(36)}_${++seq}`) => {
    const w = await request.post(`${BASE_URL}/__fake/webhook`, { data: { type, id, object } });
    const j = (await w.json()) as { status: number; body: string };
    return { ...j, id };
  };
  const statut = async (email: string) => (await orgDe(email))!["subscription_status"] as string;
  const attendre = async (fn: () => Promise<unknown>, attendu: unknown) => expect.poll(fn, { timeout: 10_000 }).toEqual(attendu);

  for (const plan of PLANS) {
    test(`${plan} : cycle de vie complet (essai -> actif -> impaye -> regularise -> annule) via les webhooks`, async ({ request, page, signupViaApi }) => {
      const c = await amorcer(request, page, signupViaApi, plan);
      const prix = `price_fake_${plan}`;
      expect(await statut(c.email)).toBe("trialing");

      // 1. customer.subscription.updated : fin de l'essai, premier prelevement -> active
      const fin = Math.floor(Date.now() / 1000) + 30 * 86_400;
      let r = await evt(request, "customer.subscription.updated", { ...c.sub, object: "subscription", status: "active", trial_end: Math.floor(Date.now() / 1000) - 60, current_period_end: fin });
      expect(r.status).toBe(200);
      await attendre(() => statut(c.email), "active");
      expect((await orgDe(c.email))!["plan"]).toBe(plan);

      // 2. invoice.payment_failed -> past_due
      r = await evt(request, "invoice.payment_failed", { id: `in_cert_${seq}`, object: "invoice", customer: c.customer, subscription: c.sub["id"], attempt_count: 1, amount_due: 7900, next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 86_400 });
      expect(r.status).toBe(200);
      await attendre(() => statut(c.email), "past_due");

      // 3. invoice.payment_succeeded avec montant paye -> active de nouveau
      r = await evt(request, "invoice.payment_succeeded", { id: `in_cert_ok_${seq}`, object: "invoice", customer: c.customer, subscription: c.sub["id"], amount_paid: 7900, billing_reason: "subscription_cycle" });
      expect(r.status).toBe(200);
      await attendre(() => statut(c.email), "active");

      // 4. customer.subscription.deleted -> canceled (plan de base remis a standard par le produit)
      r = await evt(request, "customer.subscription.deleted", { ...c.sub, object: "subscription", status: "canceled", current_period_end: Math.floor(Date.now() / 1000) - 3600 });
      expect(r.status).toBe(200);
      await attendre(() => statut(c.email), "canceled");
      expect((await orgDe(c.email))!["plan"], "plan apres annulation").toBe("standard");
      // Les prix de reference ne sont pas touches par les evenements.
      expect(((await stripeState(page)).subscriptions as Sub[]).find((s) => s["id"] === c.sub["id"])!["items"].data[0].price.id).toBe(prix);
    });
  }

  test("invoice.payment_succeeded a 0 EUR (debut d'essai) NE passe PAS l'organisation en « active »", async ({ request, page, signupViaApi }) => {
    const c = await amorcer(request, page, signupViaApi, "pro");
    const r = await evt(request, "invoice.payment_succeeded", { id: "in_cert_zero", object: "invoice", customer: c.customer, subscription: c.sub["id"], amount_paid: 0, billing_reason: "subscription_create" });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 800));
    expect(await statut(c.email)).toBe("trialing");
  });

  test("changement de plan : customer.subscription.updated avec un autre prix -> plan de l'organisation aligne, puis retour", async ({ request, page, signupViaApi }) => {
    const c = await amorcer(request, page, signupViaApi, "standard");
    const vers = async (plan: Plan) => {
      // metadata.plan de l'abonnement est prioritaire sur le prix (parsePlanFromSubscription) : un changement de plan reel le met a jour avec le prix.
      const r = await evt(request, "customer.subscription.updated", { ...c.sub, object: "subscription", status: "trialing", metadata: { ...c.sub["metadata"], plan }, items: { data: [{ id: "si_cert", price: { id: `price_fake_${plan}` }, quantity: 1, metadata: {} }] } });
      expect(r.status).toBe(200);
      await attendre(async () => (await orgDe(c.email))!["plan"], plan);
    };
    await vers("ultra");
    await vers("pro");
    await vers("standard");
  });

  test("resiliation programmee : cancel_at_period_end=true est enregistre, l'acces reste ouvert jusqu'a la fin de la periode", async ({ request, page, signupViaApi }) => {
    const c = await amorcer(request, page, signupViaApi, "pro");
    const r = await evt(request, "customer.subscription.updated", { ...c.sub, object: "subscription", status: "active", cancel_at_period_end: true, current_period_end: Math.floor(Date.now() / 1000) + 10 * 86_400 });
    expect(r.status).toBe(200);
    await attendre(async () => (await db().query("SELECT cancel_at_period_end FROM organizations WHERE id=$1::uuid", [c.orgId])).rows[0]?.cancel_at_period_end, true);
    expect(await statut(c.email)).toBe("active");
  });

  test("idempotence : le meme evenement livre deux fois n'est applique qu'une fois (billing_events)", async ({ request, page, signupViaApi }) => {
    const c = await amorcer(request, page, signupViaApi, "pro");
    const id = `evt_cert11_dup_${Date.now().toString(36)}`;
    const payload = { id: `in_dup_${seq}`, object: "invoice", customer: c.customer, subscription: c.sub["id"], attempt_count: 1 };
    const a = await evt(request, "invoice.payment_failed", payload, id);
    const b = await evt(request, "invoice.payment_failed", payload, id);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(JSON.parse(b.body)).toMatchObject({ duplicate: true });
    expect(await all("SELECT 1 FROM billing_events WHERE stripe_event_id=$1", [id])).toHaveLength(1);
    expect(await statut(c.email)).toBe("past_due");
  });

  // Evenements recus par le serveur mais SANS effet attendu sur l'abonnement du tunnel (credits IA / add-ons / evenements autres).
  for (const [type, objet] of [
    ["payment_intent.succeeded", (c: Ctx) => ({ id: "pi_cert_x", object: "payment_intent", customer: c.customer, status: "succeeded", amount: 1500, currency: "eur", metadata: {} })],
    ["payment_intent.payment_failed", (c: Ctx) => ({ id: "pi_cert_f", object: "payment_intent", customer: c.customer, status: "requires_payment_method", amount: 1500, currency: "eur", metadata: {}, last_payment_error: { message: "declined" } })],
    ["checkout.session.completed", (c: Ctx) => ({ id: "cs_test_cert", object: "checkout.session", customer: c.customer, mode: "payment", payment_status: "paid", metadata: {} })],
  ] as const) {
    test(`${type} sans metadonnees de produit : accepte (200), l'abonnement et le plan ne bougent pas`, async ({ request, page, signupViaApi }) => {
      const c = await amorcer(request, page, signupViaApi, "pro");
      const avant = await orgDe(c.email);
      const r = await evt(request, type, objet(c));
      expect(r.status, `reponse du serveur a ${type}`).toBe(200);
      await new Promise((res) => setTimeout(res, 700));
      const apres = await orgDe(c.email);
      expect(apres).toMatchObject({ plan: avant!["plan"], subscription_status: avant!["subscription_status"], stripe_subscription_id: avant!["stripe_subscription_id"] });
    });
  }

  const evenementSansMoyen = async (request: import("@playwright/test").APIRequestContext, page: import("@playwright/test").Page, email: string) => {
    const pre = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: { firstName: "Test", lastName: "Webhook", email } });
    const token = ((await pre.json()) as { preRegisterToken: string }).preRegisterToken;
    const pi = await request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan: "pro", addons: {}, preRegisterToken: token } });
    const clientSecret = ((await pi.json()) as { clientSecret: string }).clientSecret;
    const intentId = clientSecret.split("_secret_")[0]!;
    const intent = (await stripeState(page)).intents.find((i) => i["id"] === intentId) as any;
    const avant = (await stripeState(page)).subscriptions.length;
    const r = await evt(request, "setup_intent.succeeded", { id: intentId, object: "setup_intent", customer: intent.customer, payment_method: null, status: "requires_payment_method", metadata: intent.metadata });
    return { r, avant };
  };

  test("setup_intent.succeeded dont le moyen de paiement est ABSENT (evenement signe mais incomplet) : aucune organisation, aucune souscription", async ({ request, newEmail, page }) => {
    const email = newEmail("whsansmp");
    const { avant } = await evenementSansMoyen(request, page, email);
    await new Promise((res) => setTimeout(res, 1000));
    expect(await orgDe(email), "aucune organisation sans moyen de paiement").toBeNull();
    expect((await stripeState(page)).subscriptions.length, "aucune souscription creee").toBe(avant);
  });

  // DEFAUT P3 (documente, remonte) : un setup_intent.succeeded sans moyen de paiement fait repondre 500 au webhook (Stripe reessaierait
  // pendant des jours) ; un evenement irrecevable devrait etre acquitte (200) ou refuse (4xx). Stripe reel n'envoie pas cet etat : impact faible.
  defautConnu("setup_intent.succeeded sans moyen de paiement : le webhook repond sans 5xx (DEFAUT P3 : 500)", async ({ request, newEmail, page }) => {
    const { r } = await evenementSansMoyen(request, page, newEmail("whsansmp2"));
    expect(r.status).toBeLessThan(500);
  });

  test("evenement d'un client inconnu : accepte sans effet (200) — ne doit pas faire boucler les reessais Stripe", async ({ request }) => {
    const r = await evt(request, "customer.subscription.updated", { id: "sub_inconnue", object: "subscription", customer: "cus_inconnu", status: "active", items: { data: [{ id: "si", price: { id: "price_fake_pro" }, quantity: 1, metadata: {} }] }, metadata: {} });
    expect(r.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 11C. Environnement de test deploye (Stripe TEST reel) : LECTURE SEULE. Aucune inscription, aucune carte, aucun achat.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test.describe("11C. flowpoint-test.onrender.com : sondes en lecture seule", () => {
  test.skip(IS_LOCAL, "Cible distante uniquement : CERT_BASE_URL=https://flowpoint-test.onrender.com");

  test("le catalogue sert les trois plans et le tunnel est en ligne", async ({ request }) => {
    const r = await request.get(`${BASE_URL}/api/plans/catalog`);
    expect(r.status()).toBe(200);
    const ids = ((await r.json()) as { plans: Array<{ id: string }> }).plans.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["standard", "pro", "ultra"]));
  });

  test("le point d'entree des webhooks Stripe refuse un evenement non signe (secret de webhook configure, rien n'est ecrit)", async ({ request }) => {
    const r = await request.post(`${BASE_URL}/api/webhooks/stripe`, { headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" }, data: { id: "evt_cert_probe", object: "event", type: "ping", data: { object: {} } } });
    expect([400, 401, 403]).toContain(r.status());
  });

  test("la page de paiement n'embarque aucune cle live (pk_live_) dans ses ressources publiques", async ({ request }) => {
    for (const chemin of ["/checkout-payment.html", "/checkout.html", "/pricing.html", "/signin.html"]) {
      const corps = await (await request.get(`${BASE_URL}${chemin}`)).text();
      expect(corps, chemin).not.toMatch(/pk_live_|sk_live_|sk_test_|whsec_/);
    }
  });
  void T;
});
