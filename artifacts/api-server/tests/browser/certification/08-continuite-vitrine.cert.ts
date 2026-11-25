/**
 * 8. Continuite depuis le site vitrine (flowpoint.pro) vers app.flowpoint.pro — phase 1 « P0 ».
 *
 * Lien type : /signin.html?plan=<standard|pro|ultra>&lang=<en|fr>&fp_lid=…&utm_*=…&fp_source=…&fp_vid=…
 * On prouve, dans un vrai navigateur : plan repris et honore, langue (anglais par defaut, jamais deduite du
 * navigateur), panier / fp_lid / attribution conserves a travers l'inscription classique, Google (aller-retour),
 * le retour de connexion (lien magique) et le rechargement / retour arriere ; et que rien de forge cote client
 * (plan inconnu, panier perime, champs de prix) ne change le prix ni l'eligibilite decides par le serveur.
 * Google est SIMULE (voir 03-google.cert.ts) ; aucun appel reseau reel.
 */
import { test, expect, one, all, IS_LOCAL, BASE_URL } from "./support/fixtures";

test.skip(!IS_LOCAL, "Harnais local uniquement.");

/** Formulaire d'inscription de la branche : prenom, nom, e-mail (les autres champs n'existent plus). */
async function remplir(page: import("@playwright/test").Page, email: string) {
  await page.locator("#firstName").fill("Test");
  await page.locator("#lastName").fill("Certification");
  await page.locator("#email").fill(email);
}

const LID = "AbCdEfGhIjKlMnOpQrStUv";            // 22 caracteres [A-Za-z0-9_-]
const VID = "3f2b8a52-7c1e-4b6d-9a40-5e8f1c2d3b4a";
const vitrine = (o: Record<string, string> = {}) =>
  "/signin.html?" + new URLSearchParams({
    plan: "pro", lang: "fr", fp_lid: LID, utm_source: "smartlead", utm_medium: "email", utm_campaign: "p0",
    fp_source: "smartlead", fp_vid: VID, ...o,
  }).toString();

/** Visiteur neuf : aucune preference de langue (la fixture `langue` pose « fr » pour les autres suites). */
async function visiteurNeuf(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem("__cert_neuf")) return;
      sessionStorage.setItem("__cert_neuf", "1");
      localStorage.removeItem("fp:language");
    } catch { /* ignore */ }
  });
}
const stock = (page: import("@playwright/test").Page) => page.evaluate(() => ({
  cart: JSON.parse(localStorage.getItem("fp_cart") ?? "null"),
  lang: localStorage.getItem("fp:language"),
  vid: localStorage.getItem("fp_vid"),
  source: localStorage.getItem("fp_source"),
  lid: sessionStorage.getItem("fp_lid"),
  url: location.href,
}));

test.describe("8. Continuite depuis le site vitrine", () => {
  test("lien vitrine : plan, langue, fp_lid et attribution repris, puis conserves jusqu'au paiement (rechargement et retour arriere compris)", async ({ page, consent, newEmail, observed }) => {
    await consent(true); await visiteurNeuf(page);
    await page.goto(vitrine());
    let s = await stock(page);
    expect(s.cart.plan).toBe("pro");
    expect(s.lang).toBe("fr");
    expect(s.vid).toBe(VID);
    expect(s.source).toBe("smartlead");
    expect(s.lid).toBe(LID);
    expect(s.url, "le plan et l'identifiant visiteur sortent de la barre d'adresse").not.toMatch(/[?&](plan|fp_vid)=/);
    expect(s.url, "fp_lid et les UTM restent dans l'URL").toMatch(/fp_lid=AbCd.*utm_source=smartlead|utm_source=smartlead.*fp_lid=AbCd/);
    await expect(page.locator("#btn-google-oauth")).toHaveAttribute("href", new RegExp(`plan=pro.*fp_lid=${LID}.*language=fr`));

    await page.reload();                                   // rechargement : rien ne se perd
    s = await stock(page);
    expect([s.cart.plan, s.lang, s.vid, s.source, s.lid]).toEqual(["pro", "fr", VID, "smartlead", LID]);

    const email = newEmail("vit");
    await remplir(page, email);
    await page.locator("#signup-btn").click();
    await page.waitForURL(/\/checkout\.html\?plan=pro/, { timeout: 15_000 });
    await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
    const ligne = await one<{ fp_lid: string; language: string }>("SELECT fp_lid, language FROM pending_signups WHERE lower(email)=lower($1)", [email]);
    expect(ligne).toMatchObject({ fp_lid: LID, language: "fr" });

    await page.goBack();                                   // retour arriere vers l'inscription
    await page.waitForURL(/\/signin\.html/);
    s = await stock(page);
    expect([s.cart.plan, s.lang, s.vid, s.source, s.lid]).toEqual(["pro", "fr", VID, "smartlead", LID]);

    await page.goForward();
    await page.waitForURL(/\/checkout\.html/);
    await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
    await page.locator("#fp-pay-btn").click();
    await page.waitForURL(/\/checkout-payment\.html/, { timeout: 15_000 });
    await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
    const vus = observed.funnelCalls.map((c) => c.body).filter((b) => b["visiteurId"]);
    expect(vus.length).toBeGreaterThan(0);
    for (const b of vus) expect(b["visiteurId"]).toBe(VID);
  });

  test("langue : anglais par defaut (navigateur francais ignore), ?lang= n'amorce que sans preference existante", async ({ page }) => {
    await visiteurNeuf(page);
    await page.goto("/signin.html?plan=standard");        // contexte en fr-FR : doit rester en anglais
    let s = await stock(page);
    expect(s.lang).toBeNull();
    expect(await page.evaluate(() => (window as any).fpResolveLanguage())).toBe("en");
    await expect(page.locator("#btn-google-oauth")).toHaveAttribute("href", /language=en/);

    await page.goto("/signin.html?plan=standard&lang=fr"); // amorce
    expect((await stock(page)).lang).toBe("fr");
    await page.goto("/signin.html?plan=standard&lang=en"); // preference existante : gagne toujours
    expect((await stock(page)).lang).toBe("fr");
    await page.goto("/signin.html?lang=xx-evil");          // valeur inconnue : ignoree
    expect((await stock(page)).lang).toBe("fr");
  });

  test("Google aller-retour : plan, fp_lid, langue et attribution conserves, ecran de choix saute", async ({ page, request, consent, newEmail, useGoogleStub }) => {
    await consent(true); await visiteurNeuf(page);
    const code = `vit-${Date.now().toString(36)}`; const email = newEmail("gvit");
    await request.post(`${BASE_URL}/__fake/google/persona`, { data: { code, email, given_name: "Gaelle", family_name: "Test" } });
    await useGoogleStub(code);
    let depart = "";
    page.on("request", (rq) => { if (rq.url().includes("/api/auth/google/login")) depart = rq.url(); });
    await page.goto(vitrine({ plan: "ultra" }));
    await page.locator("#btn-google-oauth").click();
    await page.waitForURL(/\/checkout\.html/, { timeout: 20_000 });
    const u = new URL(depart);
    expect([u.searchParams.get("plan"), u.searchParams.get("fp_lid"), u.searchParams.get("language")]).toEqual(["ultra", LID, "fr"]);
    const s = await stock(page);
    expect([s.cart.plan, s.lang, s.vid, s.source, s.lid]).toEqual(["ultra", "fr", VID, "smartlead", LID]);
    const lignes = await all<{ fp_lid: string; language: string }>("SELECT fp_lid, language FROM pending_signups WHERE lower(email)=lower($1) AND consumed_at IS NULL", [email]);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ fp_lid: LID, language: "fr" });
    await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
  });

  test("falsification cote client : plan inconnu, panier perime ou champs de prix n'ouvrent ni plan, ni prix, ni essai", async ({ page, request }) => {
    await visiteurNeuf(page);
    // plan hors liste dans l'URL : ignore, l'ecran de choix reste.
    await page.goto("/signin.html?plan=enterprise");
    expect((await stock(page)).cart).toBeNull();
    await expect(page.locator("#btn-google-oauth")).not.toHaveAttribute("href", /plan=/);
    // panier de plus d'une heure : jamais honore (pas de saut de l'ecran de choix, pas de plan envoye a Google).
    await page.evaluate(() => localStorage.setItem("fp_cart", JSON.stringify({ plan: "ultra", addons: {}, _v: 1, _updatedAt: Date.now() - 2 * 3600_000 })));
    await page.goto("/signin.html");
    await expect(page.locator("#btn-google-oauth")).not.toHaveAttribute("href", /plan=/);
    // plan de panier invalide : idem.
    await page.evaluate(() => localStorage.setItem("fp_cart", JSON.stringify({ plan: "enterprise", addons: { x: 1 }, _v: 1, _updatedAt: Date.now() })));
    await page.goto("/signin.html");
    await expect(page.locator("#btn-google-oauth")).not.toHaveAttribute("href", /plan=/);

    // Serveur : le client ne transmet qu'un plan ; prix, essai et eligibilite sont decides ici.
    const cat = (await (await request.get(`${BASE_URL}/api/plans/catalog`)).json()) as { plans: Array<{ id: string; priceMinor: number }> };
    const prixPro = cat.plans.find((p) => p.id === "pro")!.priceMinor;
    const q = async (body: unknown) => request.post(`${BASE_URL}/api/billing/quote`, { data: body as object });
    expect((await q({ plan: "enterprise", addons: {} })).status()).toBe(400);
    expect((await q({ plan: "pro", addons: { piratage: 1 } })).status()).toBe(400);
    expect((await q({ plan: "pro", addons: { whiteLabel: -3 } })).status()).toBe(400);
    const forge = await q({ plan: "pro", addons: {}, trialEligible: true, trialDays: 365, priceMinor: 1, unitAmountMinor: 1, amountDueTodayMinor: 0, preRegisterToken: "forge" });
    expect(forge.status()).toBe(200);
    const { quote } = (await forge.json()) as { quote: { trialEligible: boolean; trialDays: number; lines: Array<{ kind: string; unitAmountMinor: number }> } };
    expect(quote.trialEligible).toBe(false);
    expect(quote.trialDays).toBe(0);
    expect(quote.lines.find((l) => l.kind === "plan")!.unitAmountMinor).toBe(prixPro);
    // Aucun intent de paiement pour un plan inconnu ou un jeton de pre-inscription forge.
    const pi = await request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan: "enterprise", addons: {}, preRegisterToken: "forge" } });
    expect(pi.status()).toBeGreaterThanOrEqual(400);
    const pi2 = await request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan: "pro", addons: {}, preRegisterToken: "forge", trialEligible: true } });
    expect(pi2.status()).toBeGreaterThanOrEqual(400);
  });
});
