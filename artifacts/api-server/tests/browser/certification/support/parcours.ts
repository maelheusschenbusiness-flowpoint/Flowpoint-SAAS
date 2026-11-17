import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { BASE_URL, COMPLETE_FORM_REF } from "./parcours-const";

/** Pose le panier une seule fois par onglet (comme un clic sur un plan de pricing.html). */
export async function seedCart(page: Page, plan: string): Promise<void> {
  await page.addInitScript((p) => {
    try {
      if (sessionStorage.getItem("__cert_cart_seeded")) return;
      sessionStorage.setItem("__cert_cart_seeded", "1");
      localStorage.setItem("fp_cart", JSON.stringify({ plan: p, addons: {}, _v: 1, _updatedAt: Date.now() }));
    } catch { /* ignore */ }
  }, plan);
}

export async function remplirInscription(page: Page, email: string, o: Partial<typeof COMPLETE_FORM_REF> & { honeypot?: string } = {}): Promise<void> {
  const f = { ...COMPLETE_FORM_REF, ...o };
  await page.locator("#firstName").fill(f.firstName);
  await page.locator("#lastName").fill(f.lastName);
  await page.locator("#email").fill(email);
  // Depuis « Inscription : formulaire reduit a prenom, nom, e-mail » (4759b92b), societe / pays / adresse / ville / code postal
  // ne sont plus demandes : on ne les remplit que si le formulaire les porte encore (compatibilite des anciens parcours).
  const optionnels: Array<[string, string, boolean]> = [["#companyName", f.companyName, false], ["#country", f.country, true], ["#address", f.address, false], ["#city", f.city, false], ["#postalCode", f.postalCode, false]];
  for (const [sel, val, isSelect] of optionnels) {
    if (!(await page.locator(sel).count())) continue;
    if (isSelect) await page.locator(sel).selectOption(val); else await page.locator(sel).fill(val);
  }
  if (o.honeypot) await page.locator("#_hp").evaluate((el, v) => { (el as HTMLInputElement).value = v; }, o.honeypot);
}

/** Parcours complet dans le navigateur, jusqu'a la page de retour. Le plan vient du panier deja pose. */
export async function inscriptionJusquAuPaiement(page: Page, email: string): Promise<void> {
  await page.goto("/signin.html");
  await remplirInscription(page, email);
  await page.locator("#signup-btn").click();
  await page.waitForURL(/\/checkout\.html/, { timeout: 15_000 });
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-payment\.html/, { timeout: 15_000 });
}

export async function payer(page: Page): Promise<void> {
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
  await page.locator("#fp-pay-btn").click();
}

export const stripeState = async (page: Page) =>
  (await (await page.request.get(`${BASE_URL}/__fake/stripe/state`)).json()) as { customers: Array<Record<string, unknown>>; intents: Array<Record<string, unknown>>; subscriptions: Array<Record<string, any>>; calls: string[] };

import type { APIRequestContext } from "@playwright/test";
import { COMPLETE_FORM_REF as FORM } from "./parcours-const";

/** Pre-inscription + intent + confirmation de la carte, SANS finalisation (le navigateur a ete ferme). */
export async function paiementConfirmeSansFinalisation(request: APIRequestContext, email: string, plan = "pro") {
  const pre = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: { ...FORM, email } });
  expect(pre.status()).toBe(200);
  const token = ((await pre.json()) as { preRegisterToken: string }).preRegisterToken;
  const pi = await request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan, addons: {}, preRegisterToken: token } });
  expect(pi.status()).toBe(200);
  const clientSecret = ((await pi.json()) as { clientSecret: string }).clientSecret;
  const intentId = clientSecret.split("_secret_")[0]!;
  const conf = await request.post(`${BASE_URL}/__fake/stripe/confirm-setup`, { data: { clientSecret, card: "4242 4242 4242 4242" } });
  expect(((await conf.json()) as { setupIntent?: unknown }).setupIntent).toBeTruthy();
  return { token, clientSecret, intentId };
}

export async function attendre<T>(fn: () => Promise<T | null | undefined | false>, ms = 8000): Promise<T | null> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
  return null;
}

/** Ouvre le lien magique, attend le dashboard, ferme la visite guidee. */
export async function ouvrirDashboard(page: Page, token: string, hash = ""): Promise<void> {
  await page.goto(`/login-verify.html?token=${token}`);
  await page.waitForURL(/\/dashboard\.html/, { timeout: 25_000 });
  await page.waitForSelector('[data-route="overview"]', { timeout: 30_000 });
  const passer = page.getByRole("button", { name: /passer la visite|skip/i }).first();
  if (await passer.isVisible().catch(() => false)) await passer.click({ timeout: 5_000 }).catch(() => undefined);
  if (hash) {
    await page.waitForTimeout(2500);      // l'etat de facturation du dashboard est charge apres le premier rendu (surtout sur mobile)
    await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(800);
  }
}
