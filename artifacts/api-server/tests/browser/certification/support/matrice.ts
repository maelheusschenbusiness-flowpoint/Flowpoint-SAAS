/**
 * Support de la matrice plan x langue x methode (09, 10, 11).
 *
 * Difference avec les parcours 01-07 : ceux-ci FORCENT le francais (fixture `langue`, auto) pour ecrire leurs assertions dans
 * une seule langue. Ici la langue est la variable testee : la fixture est neutralisee et chaque test choisit explicitement
 *   - « en »     : AUCUNE preference enregistree, navigateur fr-FR (profil Playwright) -> l'interface doit etre en anglais ;
 *   - « fr »     : preference enregistree (localStorage['fp:language']='fr', comme le selecteur de langue du site) ;
 *   - « fr-url » : aucune preference, lien `?lang=fr` (continuite depuis le site vitrine).
 */
import type { Page, BrowserContext } from "@playwright/test";
import { test as testBase, expect, BASE_URL, one, unexpectedApiFailures, unexpectedConsoleErrors, ANON_OK, type Observed } from "./fixtures";
import { remplirInscription, payer, stripeState } from "./parcours";

export { expect, BASE_URL, one, unexpectedApiFailures, unexpectedConsoleErrors, ANON_OK };
export type { Observed };

export const test = testBase.extend({
  // Neutralise l'installation automatique de la preference « fr » (support/fixtures.ts) : la langue est la variable du test.
  langue: [async ({}, use) => { await use(); }, { auto: true } as any],
});

/**
 * DEFAUT PRODUIT DOCUMENTE : le test decrit le comportement ATTENDU ; il est `test.fixme` (non execute, ne casse pas la barriere) tant
 * que le defaut n'est pas corrige, et devient bloquant des que CERT_RUN_PENDING=1 (rejeu de preuve, ou apres correction).
 */
export const defautConnu: typeof testBase = (process.env["CERT_RUN_PENDING"] === "1" ? test : test.fixme) as unknown as typeof testBase;

export type Plan = "standard" | "pro" | "ultra";
export type Langue = "en" | "fr" | "fr-url";
export const langueCode = (l: Langue): "en" | "fr" => (l === "en" ? "en" : "fr");

/** Pose la langue AVANT toute navigation. Retourne le suffixe d'URL a ajouter aux liens d'entree. */
export async function poserLangue(context: BrowserContext, l: Langue): Promise<string> {
  if (l === "fr") await context.addInitScript(() => { try { localStorage.setItem("fp:language", "fr"); } catch { /* ignore */ } });
  return l === "fr-url" ? "?lang=fr" : "";
}

/** Textes du tunnel, tels que rendus par le produit (sources anglaises + traduction du site, fp-locale.js). */
export const T = {
  en: {
    htmlLang: "en", signupCta: "Continue to payment →", signupCtaNoPlan: "Continue to plan selection →",
    checkoutCta: "Start my 14-day free trial →", payBtn: "Start my free trial", due0: /€0/, trialNote: /Card required/, noteTrial: /14-day/,
    returnTitle: "Your account is ready! Check your email", mailSubject: /Your FlowPoint (Standard|Pro|Ultra) account is ready/,
    price: (n: number) => new RegExp(`€\\s?${n}\\s?/\\s?month`),
    // Fragments de l'AUTRE langue, qui ne doivent pas apparaitre dans une interface anglaise.
    autre: ["Continuer", "Prénom", "essai gratuit", "Carte bancaire requise", "Annulable", "Récapitulatif", "Paiement sécurisé"],
    invalidEmail: "Please enter a valid email address.", exists: /An account already exists/i, unreachable: /Unable to reach the server|reach the server/i,
  },
  fr: {
    htmlLang: "fr", signupCta: "Continuer vers le paiement →", signupCtaNoPlan: "Continuer vers le choix du plan →",
    checkoutCta: "Commencer mon essai gratuit de 14 jours →", payBtn: "Commencer mon essai gratuit", due0: /0\s?€/, trialNote: /Carte bancaire requise/, noteTrial: /14 jours/,
    returnTitle: "Votre compte est prêt ! Consultez vos emails", mailSubject: /Ton compte FlowPoint (Standard|Pro|Ultra) est prêt/,
    price: (n: number) => new RegExp(`${n}\\s?€\\s?/\\s?mois`),
    autre: ["Continue to", "First name", "free trial", "Card required", "Cancel anytime", "Summary", "Secure payment"],
    invalidEmail: "Adresse email invalide.", exists: /Un compte existe déjà/i, unreachable: /Impossible de joindre le serveur/i,
  },
} as const;

let _prix: Record<Plan, number> | null = null;
/** Prix mensuel par plan, tel que servi par le catalogue serveur (jamais code en dur dans le test). */
export async function prixCatalogue(page: Page): Promise<Record<Plan, number>> {
  if (_prix) return _prix;
  const cat = (await (await page.request.get(`${BASE_URL}/api/plans/catalog`)).json()) as { plans: Array<{ id: Plan; priceEur: number }> };
  _prix = Object.fromEntries(cat.plans.map((p) => [p.id, p.priceEur])) as Record<Plan, number>;
  return _prix;
}

/** Aucun fragment de l'autre langue dans le texte visible de la page (hors champ de carte du stub, qui est un outil du harnais). */
export async function langueCoherente(page: Page, l: Langue): Promise<void> {
  const code = langueCode(l);
  await expect.poll(() => page.evaluate(() => document.documentElement.lang), { message: "attribut lang du document" }).toBe(T[code].htmlLang);
  const texte = await page.locator("body").innerText();
  const fuites = T[code].autre.filter((frag) => texte.includes(frag));
  expect(fuites, `fragments de l'autre langue visibles sur ${new URL(page.url()).pathname}`).toEqual([]);
}

export const orgDe = (email: string) => one<Record<string, any>>(
  "SELECT id::text, plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, trial_consumed_at, language FROM organizations WHERE lower(owner_email)=lower($1)", [email]);

/** Etapes communes recapitulatif -> paiement -> retour, a partir de /checkout.html (plan deja connu). */
export async function recapitulatifJusquAuRetour(page: Page, o: { plan: Plan; l: Langue; observed?: Observed }): Promise<void> {
  const t = T[langueCode(o.l)];
  const prix = (await prixCatalogue(page))[o.plan];
  await page.waitForURL(new RegExp(`/checkout\\.html\\?plan=${o.plan}`), { timeout: 20_000 });
  await expect(page.locator("#plan-screen")).toBeHidden();
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator("#fp-pay-btn")).toContainText(t.checkoutCta);
  await expect(page.locator("body")).toContainText(t.price(prix), { useInnerText: true });
  await langueCoherente(page, o.l);
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-payment\.html/, { timeout: 15_000 });
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator("#fp-pay-btn")).toContainText(t.payBtn);
  await expect(page.locator("#fp-trial-note")).toContainText(t.trialNote);
  await expect(page.locator("#fp-trial-note")).toContainText(t.noteTrial);
  const appels = await page.evaluate(() => (window as any).__fpStripeCalls as Array<{ fn: string; pk?: string }>);
  expect(appels.find((a) => a.fn === "Stripe")?.pk, "cle publique Stripe de TEST").toMatch(/^pk_test_/);
  await payer(page);
  await page.waitForURL(/\/checkout-return\.html/, { timeout: 15_000 });
  await expect(page.locator("#fp-title")).toHaveText(t.returnTitle, { timeout: 25_000 });
  await langueCoherente(page, o.l);
}

/** Etat reel apres le retour : essai de 14 jours, CARTE ATTACHEE, plan facture, langue memorisee, e-mail dans la langue. */
export async function verifierCompteEssai(page: Page, email: string, o: { plan: Plan; l: Langue; mails: (to: string) => Promise<Array<Record<string, unknown>>> }): Promise<void> {
  const code = langueCode(o.l);
  let org: Record<string, any> | null = null;
  await expect.poll(async () => { org = await orgDe(email); return org?.subscription_status ?? null; }, { timeout: 15_000 }).toBe("trialing");
  expect(org).toMatchObject({ plan: o.plan, subscription_status: "trialing" });
  const jours = (new Date(org!["trial_ends_at"]).getTime() - Date.now()) / 86_400_000;
  expect(jours, "essai de 14 jours").toBeGreaterThan(13.5); expect(jours).toBeLessThan(14.1);
  expect(org!["trial_consumed_at"]).toBeTruthy();
  const st = await stripeState(page);
  const subs = st.subscriptions.filter((s) => s["customer"] === org!["stripe_customer_id"]);
  expect(subs, "une seule souscription").toHaveLength(1);
  expect(subs[0]!["status"]).toBe("trialing");
  expect(subs[0]!["items"].data[0].price.id).toBe(`price_fake_${o.plan}`);
  expect(subs[0]!["default_payment_method"], "CARTE OBLIGATOIRE : l'essai porte un moyen de paiement").toMatch(/^pm_/);
  expect(org!["language"], "langue choisie a l'inscription memorisee sur l'organisation").toBe(code);
  let mail: Record<string, unknown> | undefined;
  await expect.poll(async () => { mail = (await o.mails(email)).find((x) => x["tag"] === "activation_magic_link"); return !!mail; }, { timeout: 12_000 }).toBe(true);
  expect(String(mail!["subject"]), "e-mail d'activation dans la langue choisie").toMatch(T[code].mailSubject);
}

export { remplirInscription };
