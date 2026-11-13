/**
 * Mode « contrat » : parcours navigateur REEL (vrai Stripe.js, vrai Payment Element, vrai 3DS, webhooks reels recus par le service)
 * dont les assertions reposent sur les REPONSES API de l'application et les evenements emis, sans cle secrete ni acces base.
 * Les preuves cote Stripe / base (suite complete 01-06) restent disponibles quand les secrets sont fournis.
 * Utilisateurs, e-mails (`@flowpoint.test`, non livrables) et cartes sont SYNTHETIQUES.
 */
import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { cfg, CARTES, saisirCarte, repondre3ds, attendrePaymentElementReel, remplirFormulaireInscription } from "./stripe-reel.ts";

export { base as test, expect, CARTES, saisirCarte, repondre3ds, attendrePaymentElementReel };

export function exigerContrat(): void {
  base.skip(!cfg.pretContrat, `Certification Stripe (mode contrat) sautee : ${cfg.raisonsContrat.join(" | ")}`);
}

const RUN = Date.now().toString(36);
let seq = 0;
export const emailSynthetique = (etiquette: string): string =>
  `fp-cert-${etiquette}-${RUN}-${++seq}@flowpoint.test`.toLowerCase().replace(/[^a-z0-9@.-]/g, "-");

export const PLANS = ["standard", "pro", "ultra"] as const;
export type Plan = (typeof PLANS)[number];

export interface Appel { methode: string; chemin: string; statut: number; requete: any; corps: any }
export interface Espion {
  appels: Appel[];
  par: (chemin: RegExp, methode?: string) => Appel[];
  /** Identifiants d'abonnement distincts renvoyes par finalize-checkout (reponses `success`). */
  souscriptions: () => string[];
  evenementsFunnel: () => Array<{ etape: string; visiteurId?: string; source?: string }>;
}

/** Enregistre les reponses API de l'application (sans jamais journaliser de secret). */
export function espionner(page: Page): Espion {
  const appels: Appel[] = [];
  const base_ = new URL(cfg.baseUrl).origin;
  page.on("response", async (r) => {
    try {
      const u = new URL(r.url());
      if (u.origin !== base_ || !u.pathname.startsWith("/api/")) return;
      let corps: any = null; try { corps = await r.json(); } catch { /* corps non JSON */ }
      let requete: any = null; try { requete = JSON.parse(r.request().postData() || "null"); } catch { /* idem */ }
      appels.push({ methode: r.request().method(), chemin: u.pathname, statut: r.status(), requete, corps });
    } catch { /* page fermee en cours de route */ }
  });
  const par = (chemin: RegExp, methode?: string) => appels.filter((a) => chemin.test(a.chemin) && (!methode || a.methode === methode));
  return {
    appels, par,
    souscriptions: () => [...new Set(par(/finalize-checkout/, "POST").filter((a) => a.corps?.success && /^sub_/.test(a.corps.subscriptionId ?? "")).map((a) => a.corps.subscriptionId as string))],
    evenementsFunnel: () => par(/funnel-event/, "POST").map((a) => a.requete).filter(Boolean),
  };
}

export async function consentement(context: BrowserContext, accepte = true): Promise<void> {
  if (accepte) await context.addCookies([{ name: "fp_analytics_consent", value: "accepted", url: cfg.baseUrl }]);
}

export interface Attribution { vid: string; utm_source: string; utm_medium: string; utm_campaign: string; fp_source: string; fp_ref?: string; fp_lid?: string }
export const attributionDeTest = (extra: Partial<Attribution> = {}): Attribution =>
  ({ vid: randomUUID(), utm_source: "cert", utm_medium: "e2e", utm_campaign: "stripe_test", fp_source: "other_campaign", ...extra });

/** Entree `signin.html?plan=…` (comme le bouton du site vitrine), formulaire reel, checkout, creation du SetupIntent. */
export async function jusquAuPaiement(page: Page, plan: Plan, email: string, a: Attribution = attributionDeTest()): Promise<Espion> {
  const espion = espionner(page);
  const q = new URLSearchParams({ plan, lang: "en", utm_source: a.utm_source, utm_medium: a.utm_medium, utm_campaign: a.utm_campaign, fp_source: a.fp_source, fp_vid: a.vid });
  if (a.fp_ref) q.set("fp_ref", a.fp_ref);
  if (a.fp_lid) q.set("fp_lid", a.fp_lid);
  await page.goto(`/signin.html?${q}`);
  await remplirFormulaireInscription(page, email);
  await page.locator("#signup-btn").click();
  await page.waitForURL(/\/checkout\.html/, { timeout: 60_000 });
  const panier = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("fp_cart") || "null"); } catch { return null; } });
  expect(panier?.plan, "le plan choisi sur le site est conserve jusqu'au checkout").toBe(plan);
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 60_000 });
  const intention = page.waitForResponse((r) => r.url().includes("/api/public/payment-intent") && r.request().method() === "POST", { timeout: 60_000 });
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-payment\.html/, { timeout: 60_000 });
  const r = await intention;
  expect(r.status(), "SetupIntent TEST cree").toBe(200);
  await attendrePaymentElementReel(page);
  return espion;
}

export function verifierDevis(espion: Espion, plan: Plan): void {
  const intention = espion.par(/payment-intent/, "POST").at(-1);
  expect(intention?.statut).toBe(200);
  expect(intention?.corps?.mode, "mode SetupIntent : aucun debit a l'inscription").toBe("setup");
  expect(intention?.corps?.immediateAmount, "montant immediat 0 EUR").toBe(0);
  expect(intention?.corps?.quote?.plan, "devis du plan choisi").toBe(plan);
  expect(intention?.corps?.quote?.trialDays, "essai de 14 jours").toBe(14);
  expect(intention?.corps?.quote?.trialEligible, "essai accorde").toBe(true);
  expect(String(intention?.corps?.clientSecret ?? ""), "secret client TEST").toMatch(/^seti_.+_secret_/);
  expect(String(intention?.corps?.publishableKey ?? ""), "cle publiable TEST, jamais LIVE").toMatch(/^pk_test_/);
}
