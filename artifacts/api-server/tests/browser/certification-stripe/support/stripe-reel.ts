/**
 * Support de la suite « Stripe reel » : configuration, e-mails d'essai, saisie dans les VRAIES iframes Stripe,
 * 3DS reel, preuves cote Stripe (API TEST) et base (optionnelle, jamais la production).
 */
import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { resoudreConfigStripeReel, emailDeTest } from "../../../../tools/certification-stripe/config.ts";
import { assertCleSecreteTest, assertCompteTest } from "../../../../tools/certification-stripe/garde-cles.ts";
import { calculerVerifications, calculerAbsenceSouscription, collecterDonnees, toutEstOk, type Verdict } from "../../../../tools/certification-stripe/verifications.ts";

export const cfg = resoudreConfigStripeReel();
export const SKIP_RAISON = `Certification Stripe reel sautee : ${cfg.raisons.join(" | ")}`;
const RUN = Date.now().toString(36);
let seq = 0;

/** Cartes de test OFFICIELLES Stripe (a confirmer dans la documentation Stripe « Testing » avant chaque campagne). */
export const CARTES = {
  succes: "4242424242424242",
  authentification3ds: "4000002500003155",      // 3DS2 requis, y compris pour un SetupIntent
  refusee: "4000000000000002",                  // refus generique (card_declined)
  refuseeFonds: "4000000000009995",             // refus « insufficient_funds » (comportement sur SetupIntent : a confirmer)
  authPuisRefus: "4000008400001629",            // 3DS requis, authentification reussie puis refus (a confirmer)
} as const;

/** Les tests se sautent EXPLICITEMENT si la configuration est incomplete (jamais d'echec silencieux, jamais de vert). */
export function exigerConfiguration(): void {
  base.skip(!cfg.pret, SKIP_RAISON);
}

export interface Fx { nouvelEmail: (etiquette: string) => string }
export const test = base.extend<Fx>({
  nouvelEmail: async ({}, use) => { await use((e) => { seq += 1; return emailDeTest(cfg.emailBase, RUN, `${e}-${seq}`); }); },
});
export { expect };

// ── Parcours applicatif (memes selecteurs que la suite #395) ────────────────────────────────────────────────
export const FORM = { firstName: "Test", lastName: "Certification", companyName: "Cert Test SARL", country: "FR", address: "12 rue de la Paix", city: "Paris", postalCode: "75001" };

export async function preparerContexte(context: BrowserContext, plan = "pro", consentement = true): Promise<void> {
  await context.addInitScript((p) => {
    try {
      if (!localStorage.getItem("fp:language")) localStorage.setItem("fp:language", "fr");
      if (!sessionStorage.getItem("__cert_cart_seeded")) {
        sessionStorage.setItem("__cert_cart_seeded", "1");
        localStorage.setItem("fp_cart", JSON.stringify({ plan: p, addons: {}, _v: 1, _updatedAt: Date.now() }));
      }
    } catch { /* ignore */ }
  }, plan);
  if (consentement) await context.addCookies([{ name: "fp_analytics_consent", value: "accepted", url: cfg.baseUrl }]);
}

export async function inscriptionJusquAuPaiement(page: Page, email: string): Promise<void> {
  await page.goto("/signin.html");
  await page.locator("#firstName").fill(FORM.firstName);
  await page.locator("#lastName").fill(FORM.lastName);
  await page.locator("#email").fill(email);
  await page.locator("#companyName").fill(FORM.companyName);
  await page.locator("#country").selectOption(FORM.country);
  await page.locator("#address").fill(FORM.address);
  await page.locator("#city").fill(FORM.city);
  await page.locator("#postalCode").fill(FORM.postalCode);
  await page.locator("#signup-btn").click();
  await page.waitForURL(/\/checkout\.html/, { timeout: 30_000 });
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-payment\.html/, { timeout: 30_000 });
}

// ── VRAI Payment Element (iframes Stripe) ───────────────────────────────────────────────────────────────────
/** L'iframe du Payment Element est montee dans #fp-payment-element ; la premiere iframe visible est celle des champs. */
export function cadrePaiement(page: Page) {
  return page.frameLocator("#fp-payment-element iframe").first();
}

export async function attendrePaymentElementReel(page: Page): Promise<void> {
  await expect(page.locator("#fp-payment-element iframe").first()).toBeAttached({ timeout: 60_000 });
  // La page vitrine fournit le bouton une fois l'element 'ready' (ou apres 8 s de filet de securite).
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 60_000 });
  const pk = await page.evaluate(() => (window as unknown as { Stripe?: unknown }).Stripe !== undefined);
  expect(pk, "Stripe.js reel charge (window.Stripe)").toBe(true);
}

/** Saisit une carte dans les champs reels. Les noms d'inputs (number, expiry, cvc) sont ceux du Payment Element (a confirmer). */
export async function saisirCarte(page: Page, numero: string): Promise<void> {
  const f = cadrePaiement(page);
  // Onglet « Carte » si la presentation en onglets est active.
  const onglet = f.getByRole("tab", { name: /carte|card/i }).first();
  if (await onglet.isVisible({ timeout: 3000 }).catch(() => false)) await onglet.click();
  await f.locator('input[name="number"]').fill(numero);
  await f.locator('input[name="expiry"]').fill("12 / 34");
  await f.locator('input[name="cvc"]').fill("123");
  const cp = f.locator('input[name="postalCode"]');
  if (await cp.isVisible({ timeout: 1500 }).catch(() => false)) await cp.fill("75001");
}

/** 3DS reel : cherche, dans toutes les frames (hooks.stripe.com), le bouton du formulaire d'authentification de test. */
export async function repondre3ds(page: Page, action: "reussir" | "echouer", delaiMs = 60_000): Promise<void> {
  const motif = action === "reussir" ? /complete/i : /fail/i;
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    for (const fr of page.frames()) {
      if (!/stripe\.(com|network)/.test(fr.url())) continue;
      const b = fr.getByRole("button", { name: motif }).first();
      if (await b.isVisible().catch(() => false)) { await b.click(); return; }
      const legacy = fr.locator(action === "reussir" ? "#test-source-authorize-3ds" : "#test-source-fail-3ds").first();
      if (await legacy.isVisible().catch(() => false)) { await legacy.click(); return; }
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Formulaire 3DS de test Stripe introuvable (hooks.stripe.com) : reseau bloque ou structure changee.");
}

/** Resolution de la reponse de confirmation Stripe (api.stripe.com/v1/setup_intents/seti_.../confirm). */
export async function attendreConfirmationStripe(page: Page) {
  const response = await page.waitForResponse(
    (r) => /api\.stripe\.com\/v1\/setup_intents\/seti_[^/]+\/confirm/.test(r.url()),
    { timeout: 90_000 },
  );
  const requestBody = response.request().postData() ?? "";
  const form = new URLSearchParams(requestBody);
  let returnUrl = form.get("return_url");
  if (!returnUrl) {
    try {
      returnUrl = (JSON.parse(requestBody) as { return_url?: string }).return_url ?? null;
    } catch { /* Stripe.js normally sends form-encoded parameters. */ }
  }
  expect(returnUrl, "Stripe SetupIntent confirmation must include return_url").toBeTruthy();
  const actualReturnUrl = new URL(returnUrl!);
  expect(actualReturnUrl.origin, "Stripe return_url must stay on the TEST page origin")
    .toBe(new URL(cfg.baseUrl).origin);
  expect(actualReturnUrl.pathname).toBe("/checkout-return.html");
  return response;
}

// ── Preuves cote Stripe (API TEST) ─────────────────────────────────────────────────────────────────────────
let stripeClient: any = null;
async function stripe() {
  if (!stripeClient) {
    const { default: Stripe } = await import("stripe");
    stripeClient = new Stripe(assertCleSecreteTest(process.env["STRIPE_TEST_SECRET_KEY"]));
    assertCompteTest(await stripeClient.balance.retrieve());
  }
  return stripeClient;
}

export const DEBUT = Math.floor(Date.now() / 1000) - 60;

export async function verdictsStripe(email: string, o: { positif: boolean }): Promise<Verdict[]> {
  const d = await collecterDonnees((await stripe()) as never, email, DEBUT);
  if (!o.positif) return calculerAbsenceSouscription(d);
  const prix = process.env["STRIPE_TEST_PRICE_ID_PRO"];
  return calculerVerifications(d, { ...(prix ? { prixAttendu: prix } : {}), livraisonEndpoint: cfg.mode === "R" });
}

/** Les webhooks arrivent de facon asynchrone : on re-verifie jusqu'au delai, puis on echoue avec le detail. */
export async function exigerPreuvesStripe(email: string, o: { positif: boolean; delaiMs?: number } = { positif: true }): Promise<Verdict[]> {
  const fin = Date.now() + (o.delaiMs ?? 120_000);
  let v: Verdict[] = [];
  while (Date.now() < fin) {
    v = await verdictsStripe(email, o);
    if (toutEstOk(v)) return v;
    await new Promise((r) => setTimeout(r, 4000));
  }
  const echecs = v.filter((x) => !x.ok).map((x) => `${x.nom} — ${x.detail}`);
  expect(echecs, `Preuves Stripe TEST non reunies pour ${email}`).toEqual([]);
  return v;
}

/** Stabilite : apres un delai, le nombre de souscriptions n'a pas augmente (rejeu, double clic, retard). */
export async function exigerUneSeuleSouscriptionStable(email: string, attenteMs = 15_000): Promise<void> {
  await new Promise((r) => setTimeout(r, attenteMs));
  const d = await collecterDonnees((await stripe()) as never, email, DEBUT);
  const vivantes = d.souscriptions.filter((s) => !["canceled", "incomplete_expired"].includes(s.status));
  expect(d.clients.length, "customers").toBe(1);
  expect(vivantes.length, `souscriptions vivantes (${vivantes.map((s) => s.id).join(",")})`).toBe(1);
}

// ── E-mails captures (Mode L uniquement) ───────────────────────────────────────────────────────────────────
export function mailsCaptures(to: string): Array<Record<string, any>> {
  if (!cfg.dossierMails || !fs.existsSync(cfg.dossierMails)) return [];
  return fs.readdirSync(cfg.dossierMails).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(cfg.dossierMails, f), "utf8")) as Record<string, any>).filter((m) => String(m["to"]).toLowerCase() === to.toLowerCase());
}

// ── Base (optionnelle, jamais la production) ───────────────────────────────────────────────────────────────
export function urlBaseVerifAutorisee(url: string | undefined): url is string {
  if (!url) return false;
  if (url.includes("sejbsuuaeokyuxuoaxzd")) throw new Error("REFUS : URL de la base de PRODUCTION.");
  return /@(127\.0\.0\.1|localhost)[:/]/.test(url) || url.includes("rrjllaiodpvtsphrtdqd");
}

export async function organisationEn(email: string): Promise<Record<string, any> | null | undefined> {
  const url = process.env["DATABASE_URL_VERIF"];
  if (!urlBaseVerifAutorisee(url)) return undefined;     // verification SQL non configuree : voir verifier-base.sh
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const r = await pool.query("SELECT id::text, plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at FROM organizations WHERE lower(owner_email)=lower($1)", [email]);
    return (r.rows[0] as Record<string, any>) ?? null;
  } finally { await pool.end(); }
}
