/**
 * Langue des pages publiques : ANGLAIS par défaut, même avec un navigateur configuré en français
 * (le profil de cette certification est `fr-FR`), sans préférence enregistrée.
 *
 * Signalement du 17/11 : création de compte, connexion et tarifs s'affichaient en français sur
 * app.flowpoint.pro. Cause : la production sert la branche `Flowpoint`, dont les pages publiques sont
 * rédigées en français et n'ont pas `fp-locale.js` (voir docs/PUBLIC-PAGES-LANGUE-PAR-DEFAUT.md).
 * Ce parcours fige le comportement de `Test-Replit` dans un navigateur réel : aucune préférence ->
 * anglais ; une préférence explicite prise en charge est respectée ; textes, infobulles, métadonnées
 * et états ouverts par une interaction sans français en mode anglais.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGES = [
  "signin", "login", "login-verify", "pricing", "checkout", "checkout-payment",
  "checkout-return", "success", "cancel", "accept-invitation", "report-view",
];

const FRENCH = /\b(votre|vos|vous|nous|pour|avec|mois|essai|gratuit|gratuits|créer|compte|tarifs?|choisissez|connecter|connexion|déjà|prénom|entreprise|paiement|annulé|disponible|bientôt|rejoindre|équipe|expirée?|révoquée?)\b|[éèêàçùôîû]/i;

/** Tout texte, infobulle, étiquette ou métadonnée VISIBLE qui ressemble à du français. */
async function frenchOnPage(page: Page): Promise<string[]> {
  return page.evaluate((source) => {
    const re = new RegExp(source, "i");
    const found = new Set<string>();
    const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || p.closest("[data-fp-user-content]") || !visible(p)) continue;
      const t = (n.nodeValue ?? "").trim();
      if (t && re.test(t)) found.add("texte : " + t.slice(0, 90));
    }
    document.querySelectorAll("[title],[aria-label],[placeholder]").forEach((el) => {
      if (!visible(el)) return;
      for (const a of ["title", "aria-label", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v && re.test(v)) found.add(`${a} : ${v.slice(0, 90)}`);
      }
    });
    document.querySelectorAll('meta[name="description"],meta[property^="og:"],meta[name^="twitter:"]').forEach((m) => {
      const c = (m as HTMLMetaElement).content;
      if (c && !/^https?:/.test(c) && re.test(c)) found.add("meta : " + c.slice(0, 90));
    });
    if (re.test(document.title)) found.add("titre : " + document.title);
    return [...found];
  }, FRENCH.source);
}

async function openPage(page: Page, name: string, search = "") {
  await page.goto(`/${name}.html${search}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
}

test.describe("pages publiques : anglais par défaut (navigateur fr-FR, aucune préférence)", () => {
  for (const name of PAGES) {
    test(`${name}.html s'affiche en anglais`, async ({ page }) => {
      await openPage(page, name);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
      expect(await page.evaluate(() => localStorage.getItem("fp:language"))).toBeNull();
      expect(await frenchOnPage(page)).toEqual([]);
    });
  }

  test("tarifs : le tableau comparatif ouvert et ses infobulles restent en anglais", async ({ page }) => {
    await openPage(page, "pricing");
    await page.evaluate(() => { (window as unknown as { toggleCmpRows?: () => void }).toggleCmpRows?.(); });
    await page.waitForTimeout(500);
    expect(await frenchOnPage(page)).toEqual([]);
  });

  test("invitation : chaque message d'erreur du lien est en anglais", async ({ page }) => {
    for (const reason of ["expired", "already_accepted", "revoked", "other"]) {
      await page.route("**/team/invitations/validate*", (route) => route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ reason }) }));
      await openPage(page, "accept-invitation", "?token=abc");
      expect(await frenchOnPage(page), `reason=${reason}`).toEqual([]);
      await page.unroute("**/team/invitations/validate*");
    }
    await page.route("**/team/invitations/validate*", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await openPage(page, "accept-invitation", "?token=abc");
    expect(await frenchOnPage(page), "404").toEqual([]);
  });
});

test.describe("pages publiques : une langue choisie volontairement est respectée", () => {
  test("français enregistré : connexion et inscription s'affichent en français", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("fp:language", "fr"));
    for (const name of ["signin", "login"]) {
      await openPage(page, name);
      expect(await page.evaluate(() => document.documentElement.lang), name).toBe("fr");
      expect((await frenchOnPage(page)).length, name).toBeGreaterThan(0);
    }
  });

  test("anglais enregistré gagne sur ?lang=fr ; sans préférence, ?lang=fr est retenu", async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("fp:language", "en"); sessionStorage.setItem("seeded", "1"); } });
    await openPage(page, "login", "?lang=fr");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    await page.evaluate(() => localStorage.removeItem("fp:language"));
    await openPage(page, "login", "?lang=fr");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("fr");
  });
});
