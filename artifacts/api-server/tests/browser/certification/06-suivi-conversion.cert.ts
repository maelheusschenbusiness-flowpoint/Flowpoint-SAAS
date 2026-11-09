/**
 * 6. Suivi de conversion : etapes emises avec consentement, AUCUNE sans consentement, UTM/fp_lid conserves, idempotence.
 * Les etapes serveur (checkout_started, checkout_completed, trial_activated) sont lues dans funnel_events ; les webhooks
 * Stripe correspondants sont livres, SIGNES, par le harnais (le vrai Stripe ne peut pas joindre une machine locale).
 */
import { test, expect, one, all, IS_LOCAL, BASE_URL } from "./support/fixtures";
import { seedCart, remplirInscription, stripeState, attendre, paiementConfirmeSansFinalisation } from "./support/parcours";

test.skip(!IS_LOCAL, "Lit funnel_events : local uniquement.");

const LID = "AbCdEfGhIjKlMnOpQrStUv";                       // 22 caracteres [A-Za-z0-9_-]
const etapes = async (vid: string) => (await all<{ etape: string; n: string }>("SELECT etape, count(*)::text AS n FROM funnel_events WHERE visiteur_id=$1 GROUP BY etape", [vid])).reduce<Record<string, number>>((a, r) => ({ ...a, [r.etape]: Number(r.n) }), {});
const visiteur = (p: any) => p.evaluate(() => localStorage.getItem("fp_vid"));

test.describe("6. Suivi de conversion", () => {
  test("AVEC consentement : cta_clique, signup_started et signup_form_engaged sont emis, avec la meme identite de visiteur", async ({ page, consent, newEmail, observed }) => {
    await consent(true);
    await page.goto("/pricing.html?utm_source=smartlead&fp_lid=" + LID);
    await page.locator('.fp-card-btn[data-plan="pro"]').click();
    await page.waitForURL(/\/signin\.html/);
    await page.locator("#firstName").fill("Test");                  // premiere saisie => signup_form_engaged
    await page.locator("#lastName").fill("Cert");
    await page.waitForTimeout(800);
    const vid = await visiteur(page);
    expect(vid).toBeTruthy();
    const e = await attendre(async () => { const x = await etapes(vid); return x["cta_clique"] && x["signup_started"] && x["signup_form_engaged"] ? x : null; });
    expect(e, "etapes emises").toMatchObject({ cta_clique: 1, signup_started: 1, signup_form_engaged: 1 });
    const cta = await one<{ plan: string; source: string }>("SELECT plan, source FROM funnel_events WHERE visiteur_id=$1 AND etape='cta_clique'", [vid]);
    expect(cta).toMatchObject({ plan: "pro", source: "smartlead" });  // plan + source (UTM) portes
    // fp_lid : memorise d'une page a l'autre (sessionStorage) et transmis a l'inscription.
    expect(await page.evaluate(() => sessionStorage.getItem("fp_lid"))).toBe(LID);
    const corps = observed.funnelCalls.map((c) => c.body);
    expect(corps.length).toBeGreaterThanOrEqual(3);
    for (const c of corps) { expect(c["visiteurId"]).toBe(vid); expect(JSON.stringify(c)).not.toMatch(/@|Test|Cert/); }   // aucune donnee personnelle
    await remplirInscription(page, newEmail("lid"));
    await seedCart(page, "pro");
    await page.locator("#signup-btn").click();
    await page.waitForURL(/\/checkout\.html/);
    const ligne = await one<{ fp_lid: string }>("SELECT fp_lid FROM pending_signups ORDER BY created_at DESC LIMIT 1");
    expect(ligne!.fp_lid).toBe(LID);
  });

  test("SANS consentement : aucune requete de suivi, aucun identifiant de visiteur, aucune ligne en base", async ({ page, newEmail }) => {
    const avant = Number((await one<{ n: string }>("SELECT count(*)::text AS n FROM funnel_events"))!.n);
    const appels: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/public/funnel-event")) appels.push(r.url()); });
    await page.goto("/pricing.html?utm_source=smartlead&fp_lid=" + LID);
    await page.locator('.fp-card-btn[data-plan="pro"]').click();
    await page.waitForURL(/\/signin\.html/);
    await page.locator("#firstName").fill("Test");
    await remplirInscription(page, newEmail("nc"));
    await page.waitForTimeout(1200);
    expect(appels).toEqual([]);
    expect(await visiteur(page)).toBeNull();
    expect(Number((await one<{ n: string }>("SELECT count(*)::text AS n FROM funnel_events"))!.n)).toBe(avant);
  });

  test("consentement REFUSE (valeur autre que accepted) : rien n'est emis", async ({ page, context }) => {
    await context.addCookies([{ name: "fp_analytics_consent", value: "refused", url: BASE_URL }]);
    const appels: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/public/funnel-event")) appels.push(r.url()); });
    await page.goto("/pricing.html");
    await page.locator('.fp-card-btn[data-plan="standard"]').click();
    await page.waitForURL(/\/signin\.html/);
    await page.waitForTimeout(800);
    expect(appels).toEqual([]);
  });

  test("idempotence : recharger la page ou rejouer l'etape le meme jour ne cree pas de doublon", async ({ page, consent }) => {
    await consent(true);
    await page.goto("/signin.html");
    await page.waitForTimeout(600);
    const vid = await visiteur(page);
    for (let i = 0; i < 3; i++) { await page.reload(); await page.waitForTimeout(400); }
    const e = await attendre(async () => (await etapes(vid)));
    expect(e!["signup_started"]).toBe(1);
  });

  test("etapes serveur : checkout_started, checkout_completed et trial_activated, une seule fois chacune, meme apres rejeu des webhooks", async ({ page, request, consent, newEmail }) => {
    await consent(true);
    await page.goto("/signin.html");
    await page.waitForTimeout(500);
    const vid = await visiteur(page);
    const email = newEmail("srv");
    // Pre-inscription + intent AVEC l'identite du visiteur (comme checkout-payment.html).
    const pre = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: { firstName: "T", lastName: "C", email, companyName: "C", country: "FR", address: "1 rue", city: "Paris", postalCode: "75001", visiteurId: vid } });
    const token = ((await pre.json()) as any).preRegisterToken;
    const pi = await page.request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan: "pro", addons: {}, preRegisterToken: token, visiteurId: vid, source: "direct" } });
    expect(pi.status()).toBe(200);
    const clientSecret = ((await pi.json()) as any).clientSecret as string;
    const intentId = clientSecret.split("_secret_")[0]!;
    await request.post(`${BASE_URL}/__fake/stripe/confirm-setup`, { data: { clientSecret, card: "4242 4242 4242 4242" } });
    const fin = await request.post(`${BASE_URL}/api/public/finalize-checkout`, { data: { intentId, intentType: "setup", plan: "pro", addons: {}, preRegisterToken: token } });
    expect(fin.status()).toBe(200);
    const st = await stripeState(page);
    const intent = st.intents.find((i) => i["id"] === intentId) as any;
    const sub = st.subscriptions.find((s) => s["customer"] === intent.customer)!;
    const org = (await one<{ id: string }>("SELECT id::text FROM organizations WHERE lower(owner_email)=lower($1)", [email]))!;
    const evt = async (type: string, object: unknown, id: string) => { for (let i = 0; i < 2; i++) { const w = await request.post(`${BASE_URL}/__fake/webhook`, { data: { type, id, object } }); expect(((await w.json()) as any).status).toBe(200); } };   // 2 livraisons
    await evt("setup_intent.succeeded", { id: intentId, object: "setup_intent", customer: intent.customer, status: "succeeded", payment_method: intent.payment_method, metadata: intent.metadata }, `evt_cert_si_${vid}`);
    await evt("customer.subscription.created", { ...sub, object: "subscription", metadata: { ...sub.metadata, orgId: org.id } }, `evt_cert_sub_${vid}`);
    const e = await attendre(async () => { const x = await etapes(vid); return x["checkout_started"] && x["checkout_completed"] ? x : null; }, 10_000);
    expect(e, "etapes serveur").toBeTruthy();
    expect(e!["checkout_started"]).toBe(1);
    expect(e!["checkout_completed"]).toBe(1);
    // trial_activated est ecrit depuis customer.subscription.created ; il porte l'identite du visiteur si la metadonnee la transporte.
    const ta = await attendre(async () => (await all("SELECT 1 FROM funnel_events WHERE etape='trial_activated' AND org_ref IS NOT NULL")).length);
    expect(ta, "trial_activated emis au moins une fois").toBeTruthy();
    expect((await all("SELECT cle_idempotence FROM funnel_events WHERE etape='trial_activated' GROUP BY cle_idempotence HAVING count(*)>1"))).toHaveLength(0);
    void paiementConfirmeSansFinalisation;
  });
});
