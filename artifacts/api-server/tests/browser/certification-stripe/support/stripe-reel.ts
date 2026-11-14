/**
 * Support de la suite « Stripe reel » : configuration, e-mails d'essai, saisie dans les VRAIES iframes Stripe,
 * 3DS reel, preuves cote Stripe (API TEST) et base (optionnelle, jamais la production).
 */
import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createStripeTestResourceCleanup } from "../../../../../../e2e/helpers/stripe-test-resource-cleanup.mjs";
import { resoudreConfigStripeReel, emailDeTest } from "../../../../tools/certification-stripe/config.ts";
import { assertCleSecreteTest, assertCompteTest } from "../../../../tools/certification-stripe/garde-cles.ts";
import { calculerVerifications, calculerAbsenceSouscription, collecterDonnees, toutEstOk, type Verdict } from "../../../../tools/certification-stripe/verifications.ts";

export const cfg = resoudreConfigStripeReel();
export const SKIP_RAISON = `Certification Stripe reel sautee : ${cfg.raisons.join(" | ")}`;
const RUN = Date.now().toString(36);
let seq = 0;
type StripeResourceCleanup = ReturnType<typeof createStripeTestResourceCleanup>;

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

export interface Fx {
  nouvelEmail: (etiquette: string) => Promise<string>;
  stripeCleanup: StripeResourceCleanup;
}
export const test = base.extend<Fx>({
  stripeCleanup: async ({}, use) => {
    const stripeTestKey = process.env["STRIPE_TEST_SECRET_KEY"] ?? "";
    const cleanup = createStripeTestResourceCleanup(await stripe(), stripeTestKey, "browser-certification");
    try {
      await use(cleanup);
    } finally {
      await cleanup.cleanup();
    }
  },
  nouvelEmail: async ({ stripeCleanup }, use) => {
    await use(async (e) => {
      seq += 1;
      const email = emailDeTest(cfg.emailBase, RUN, `${e}-${seq}`);
      await stripeCleanup.registerEmail(email);
      return email;
    });
  },
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

/**
 * Formulaire d'inscription DEPLOYE : prenom, nom, e-mail (les champs societe / adresse ont ete retires).
 * Les champs optionnels d'anciennes versions ne sont remplis que s'ils existent : la suite suit le formulaire reel
 * au lieu de casser a chaque changement.
 */
export async function remplirFormulaireInscription(page: Page, email: string): Promise<void> {
  await page.locator("#firstName").fill(FORM.firstName);
  await page.locator("#lastName").fill(FORM.lastName);
  await page.locator("#email").fill(email);
  const optionnels: Array<[string, string]> = [["#companyName", FORM.companyName], ["#address", FORM.address], ["#city", FORM.city], ["#postalCode", FORM.postalCode]];
  for (const [sel, valeur] of optionnels) {
    const champ = page.locator(sel);
    if (await champ.count() && await champ.first().isVisible().catch(() => false)) await champ.first().fill(valeur);
  }
  const pays = page.locator("#country");
  if (await pays.count() && await pays.first().isVisible().catch(() => false)) await pays.first().selectOption(FORM.country);
}

export async function inscriptionJusquAuPaiement(
  page: Page,
  email: string,
  cleanup: StripeResourceCleanup,
): Promise<void> {
  await page.goto("/signin.html");
  await remplirFormulaireInscription(page, email);
  await page.locator("#signup-btn").click();
  await page.waitForURL(/\/checkout\.html/, { timeout: 30_000 });
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 30_000 });
  const intentResponse = page.waitForResponse((response) => {
    try {
      const url = new URL(response.url());
      return url.origin === new URL(cfg.baseUrl).origin &&
        url.pathname === "/api/public/payment-intent" &&
        response.request().method() === "POST";
    } catch {
      return false;
    }
  }, { timeout: 30_000 });
  await page.locator("#fp-pay-btn").click();
  await page.waitForURL(/\/checkout-payment\.html/, { timeout: 30_000 });
  const response = await intentResponse;
  expect(response.status(), "the TEST SetupIntent endpoint should succeed").toBe(200);
  const result = await response.json() as { setupIntentId?: string };
  expect(result.setupIntentId, "the checkout should create a SetupIntent").toMatch(/^seti_/);
  cleanup.registerSetupIntent(result.setupIntentId!);
}

// ── VRAI Payment Element (iframes Stripe) ───────────────────────────────────────────────────────────────────
/** L'iframe du Payment Element est montee dans #fp-payment-element ; la premiere iframe visible est celle des champs. */
export function cadrePaiement(page: Page) {
  return page.frameLocator("#fp-payment-element iframe").first();
}

export async function attendrePaymentElementReel(page: Page): Promise<void> {
  installerDiagnosticStripe(page);
  await expect(page.locator("#fp-payment-element iframe").first()).toBeAttached({ timeout: 60_000 });
  // La page vitrine fournit le bouton une fois l'element 'ready' (ou apres 8 s de filet de securite).
  await expect(page.locator("#fp-pay-btn")).toBeEnabled({ timeout: 60_000 });
  const pk = await page.evaluate(() => (window as unknown as { Stripe?: unknown }).Stripe !== undefined);
  expect(pk, "Stripe.js reel charge (window.Stripe)").toBe(true);
}

const pagesInstrumentees = new WeakSet<Page>();
const setupIntentParPage = new WeakMap<Page, string>();

function urlSansSecrets(raw: string): string {
  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(
      /\/(seti|pi|pm|src|cs)_[^/]+/g,
      "/$1_[id]",
    ).replace(/\/acct_[^/]+/g, "/acct_[id]")
      .replace(/\/tds2_[^/]+/g, "/tds2_[token]");
    return `${url.hostname}${pathname}`;
  } catch {
    return "[URL illisible]";
  }
}

function texteSansSecrets(value: string): string {
  return value
    .replace(/\b(sk|pk)_(test|live)_[A-Za-z0-9]+/g, "$1_$2_[redacted]")
    .replace(/\b(seti|pi|pm)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, "$1_[id]_secret_[redacted]")
    .replace(/\b(?:acct|cs|cus|evt|in|pi|pm|seti|sub|clock|price|prod)_[A-Za-z0-9_]+\b/g, "[redacted-id]")
    .replace(/client_secret[=:]\s*[^&\s]+/gi, "client_secret=[redacted]")
    .slice(0, 400);
}

function hoteStripe(raw: string): boolean {
  try {
    return /(^|\.)stripe\.(com|network)$/i.test(new URL(raw).hostname);
  } catch {
    return false;
  }
}

function installerDiagnosticStripe(page: Page): void {
  if (pagesInstrumentees.has(page)) return;
  pagesInstrumentees.add(page);

  page.on("request", (request) => {
    if (hoteStripe(request.url())) {
      console.log(`[3DS diag] request ${request.method()} ${urlSansSecrets(request.url())}`);
    }
  });
  page.on("response", (response) => {
    if (hoteStripe(response.url())) {
      console.log(`[3DS diag] response ${response.status()} ${urlSansSecrets(response.url())}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (hoteStripe(request.url())) {
      console.log(`[3DS diag] requestfailed ${urlSansSecrets(request.url())}: ${texteSansSecrets(request.failure()?.errorText ?? "unknown")}`);
    }
  });
  page.on("framenavigated", (frame) => {
    const url = frame.url();
    if (hoteStripe(url) || /\/checkout-(?:payment|return)\.html(?:$|[?#])/.test(url)) {
      console.log(`[3DS diag] frame navigation ${urlSansSecrets(url)}`);
    }
  });
  page.on("pageerror", (error) => {
    console.log(`[3DS diag] pageerror ${texteSansSecrets(error.message)}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.log(`[3DS diag] console:error ${texteSansSecrets(message.text())}`);
    }
  });
}

async function logSetupIntentState(page: Page, checkpoint: string): Promise<void> {
  const id = setupIntentParPage.get(page);
  if (!id) {
    console.log(`[3DS diag] SetupIntent ${checkpoint}: ID unavailable`);
    return;
  }
  try {
    const intent = await (await stripe()).setupIntents.retrieve(id);
    console.log(
      `[3DS diag] SetupIntent ${checkpoint}: status=${intent.status} ` +
      `livemode=${intent.livemode} error=${intent.last_setup_error?.code ?? "none"}`,
    );
  } catch (error) {
    console.log(`[3DS diag] SetupIntent ${checkpoint} retrieve failed: ${texteSansSecrets(String(error))}`);
  }
}

async function waitForSetupIntentResolution(
  page: Page,
  timeoutMs = 12_000,
): Promise<"succeeded" | "requires_payment_method" | null> {
  const id = setupIntentParPage.get(page);
  if (!id) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const intent = await (await stripe()).setupIntents.retrieve(id);
      if (intent.status === "succeeded") {
        console.log("[3DS diag] ACS result confirmed by Stripe: status=succeeded");
        return "succeeded";
      }
      if (intent.status === "requires_payment_method" && intent.last_setup_error) {
        console.log(
          `[3DS diag] ACS result confirmed by Stripe: status=${intent.status} ` +
          `error=${intent.last_setup_error.code ?? "none"}`,
        );
        return "requires_payment_method";
      }
    } catch (error) {
      console.log(`[3DS diag] SetupIntent failure check: ${texteSansSecrets(String(error))}`);
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

/** Saisit une carte dans les champs reels. Les noms d'inputs (number, expiry, cvc) sont ceux du Payment Element (a confirmer). */
export async function saisirCarte(page: Page, numero: string): Promise<void> {
  const f = cadrePaiement(page);
  // Onglet « Carte » si la presentation en onglets est active.
  const onglet = f.getByRole("tab", { name: /carte|card/i }).first();
  if (await onglet.isVisible({ timeout: 3000 }).catch(() => false)) await onglet.click();
  else {
    // Stripe classe les moyens de paiement par pays : « Card » peut etre relegue dans la liste « Additional Payment Methods ».
    const liste = f.getByRole("combobox", { name: /additional payment methods|autres moyens/i }).first();
    if (await liste.isVisible({ timeout: 1500 }).catch(() => false)) await liste.selectOption({ label: "Card" }).catch(() => liste.selectOption({ label: "Carte" })).catch(() => undefined);
  }
  // Stripe Link peut afficher un champ téléphone et intercepter la confirmation;
  // ces scénarios certifient le parcours carte/3DS, pas l'inscription à Link.
  // Stripe Link : la case « Enregistrer mes informations » peut etre cochee par defaut et exige alors un telephone
  // (« Your phone number is incomplete ») ; ces scenarios certifient la carte / le 3DS, pas Link. On la decoche de facon verifiee.
  const enregistrerAvecLink = f.getByRole("checkbox", { name: /enregistrer mes informations|save my information/i }).first();
  for (let essai = 0; essai < 4; essai++) {
    if (!(await enregistrerAvecLink.isVisible({ timeout: 1500 }).catch(() => false))) break;
    if (!(await enregistrerAvecLink.isChecked().catch(() => false))) break;
    await f.locator("label[for='payment-linkOptInInput']").click({ timeout: 3_000 }).catch(() => undefined);
    if (await enregistrerAvecLink.isChecked().catch(() => false)) {
      await enregistrerAvecLink.evaluate((el) => (el as HTMLInputElement).click()).catch(() => undefined);
    }
    await page.waitForTimeout(400);
  }
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
  const hotesSignales = new Set<string>();
  while (Date.now() < fin) {
    for (const fr of page.frames()) {
      let hote = "";
      try { hote = new URL(fr.url()).hostname; } catch { /* frame without a parsed URL */ }
      if (!/stripe\.(com|network)$/i.test(hote)) continue;
      hotesSignales.add(hote);
      const titreDefi = fr.getByRole("heading", { name: /3D Secure 2 Test Page/i }).first();
      if (!await titreDefi.isVisible().catch(() => false)) continue;
      const b = fr.getByRole("button", { name: motif }).first();
      if (await b.isVisible().catch(() => false)) {
        const target = await b.evaluate((element) => {
          const button = element as HTMLButtonElement;
          const rect = button.getBoundingClientRect();
          return {
            tag: button.tagName,
            id: button.id || "(none)",
            type: button.type || "(none)",
            disabled: button.disabled,
            text: (button.innerText || "").trim().slice(0, 40),
            rect: `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`,
          };
        });
        await fr.evaluate(() => {
          const root = window as unknown as { __fp3dsEvents?: Array<Record<string, string>> };
          root.__fp3dsEvents = [];
          for (const type of ["pointerdown", "mousedown", "click"]) {
            document.addEventListener(type, (event) => {
              const target = event.target as HTMLElement | null;
              root.__fp3dsEvents?.push({
                type,
                tag: target?.tagName ?? "",
                id: target?.id ?? "",
                text: (target?.innerText ?? "").trim().slice(0, 40),
              });
            }, true);
          }
        });
        await b.evaluate((element) => {
          const button = element as HTMLButtonElement;
          button.dataset["fpCertPointer"] = "0";
          button.dataset["fpCertClick"] = "0";
          button.dataset["fpCertKey"] = "0";
          button.addEventListener("pointerdown", () => { button.dataset["fpCertPointer"] = "1"; }, true);
          button.addEventListener("click", () => { button.dataset["fpCertClick"] = "1"; }, true);
          button.addEventListener("keydown", () => { button.dataset["fpCertKey"] = "1"; }, true);
        });
        console.log(`[3DS diag] ACS button target ${JSON.stringify(target)}`);
        console.log(`[Stripe 3DS] Found ${action} action in a Stripe challenge frame (${hote}).`);
        await b.click();
        let observedEvents = await fr.evaluate(() => {
          const root = window as unknown as { __fp3dsEvents?: Array<Record<string, string>> };
          return root.__fp3dsEvents ?? [];
        }).catch(() => []);
        let clickDelivered = await b.getAttribute("data-fp-cert-click").catch(() => null);
        if (clickDelivered !== "1") {
          await b.scrollIntoViewIfNeeded().catch(() => undefined);
          const box = await b.boundingBox().catch(() => null);
          if (box) {
            console.log(
              `[3DS diag] locator click produced no ACS click; retrying as top-level mouse at ` +
              `${Math.round(box.x + box.width / 2)},${Math.round(box.y + box.height / 2)}`,
            );
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            clickDelivered = await b.getAttribute("data-fp-cert-click").catch(() => null);
            observedEvents = await fr.evaluate(() => {
              const root = window as unknown as { __fp3dsEvents?: Array<Record<string, string>> };
              return root.__fp3dsEvents ?? [];
            }).catch(() => []);
          }
        }
        if (clickDelivered !== "1") {
          console.log("[3DS diag] mouse input did not reach ACS button; trying focused Enter as an alternate real input.");
          await b.focus().catch(() => undefined);
          await b.press("Enter").catch(() => undefined);
          clickDelivered = await b.getAttribute("data-fp-cert-click").catch(() => null);
          observedEvents = await fr.evaluate(() => {
            const root = window as unknown as { __fp3dsEvents?: Array<Record<string, string>> };
            return root.__fp3dsEvents ?? [];
          }).catch(() => []);
        }
        const pointerDelivered = await b.getAttribute("data-fp-cert-pointer").catch(() => null);
        const keyDelivered = await b.getAttribute("data-fp-cert-key").catch(() => null);
        console.log(`[3DS diag] ACS input events ${JSON.stringify(observedEvents)}`);
        console.log(
          `[3DS diag] ACS element received pointerdown=${pointerDelivered} ` +
          `keydown=${keyDelivered} click=${clickDelivered}`,
        );
        const intentResolution = await waitForSetupIntentResolution(page);
        if (intentResolution) {
          const frameStillVisible = await titreDefi.isVisible().catch(() => false);
          console.log(
            `[3DS diag] Stripe intent is terminal (${intentResolution}); ` +
            `ACS document still visible=${frameStillVisible}.`,
          );
          return;
        }
        try {
          await titreDefi.waitFor({ state: "hidden", timeout: 4_000 });
        } catch {
          const challengeStillVisible = await titreDefi.isVisible().catch(() => false);
          const actionStillVisible = await b.isVisible().catch(() => false);
          const frames = page.frames().map((frame) => urlSansSecrets(frame.url())).join(", ");
          console.log(
            `[3DS diag] after ${action}: challengeVisible=${challengeStillVisible} ` +
            `actionVisible=${actionStillVisible} page=${urlSansSecrets(page.url())} frames=${frames}`,
          );
          await logSetupIntentState(page, `after-${action}-timeout`);
          throw new Error(`Stripe 3DS action ${action} left the challenge open.`);
        }
        console.log(`[3DS diag] challenge closed after ${action}; page=${urlSansSecrets(page.url())}`);
        await logSetupIntentState(page, `after-${action}`);
        return;
      }
      const legacy = fr.locator(action === "reussir" ? "#test-source-authorize-3ds" : "#test-source-fail-3ds").first();
      if (await legacy.isVisible().catch(() => false)) {
        console.log(`[Stripe 3DS] Found legacy ${action} action in a Stripe challenge frame (${hote}).`);
        await legacy.click();
        try {
          await titreDefi.waitFor({ state: "hidden", timeout: 12_000 });
        } catch {
          const challengeStillVisible = await titreDefi.isVisible().catch(() => false);
          const actionStillVisible = await legacy.isVisible().catch(() => false);
          const frames = page.frames().map((frame) => urlSansSecrets(frame.url())).join(", ");
          console.log(
            `[3DS diag] after legacy ${action}: challengeVisible=${challengeStillVisible} ` +
            `actionVisible=${actionStillVisible} page=${urlSansSecrets(page.url())} frames=${frames}`,
          );
          await logSetupIntentState(page, `after-legacy-${action}-timeout`);
          throw new Error(`Stripe 3DS legacy action ${action} left the challenge open.`);
        }
        console.log(`[3DS diag] challenge closed after legacy ${action}; page=${urlSansSecrets(page.url())}`);
        await logSetupIntentState(page, `after-legacy-${action}`);
        return;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Formulaire 3DS introuvable; Stripe challenge hosts seen: ${[...hotesSignales].join(", ") || "none"}.`);
}

/** Resolution de la reponse de confirmation Stripe (api.stripe.com/v1/setup_intents/seti_.../confirm). */
export async function attendreConfirmationStripe(page: Page, cleanup?: StripeResourceCleanup) {
  await page.evaluate(() => {
    const button = document.getElementById("fp-pay-btn") as HTMLButtonElement | null;
    const root = window as unknown as {
      __fpCheckoutClickDiag?: { clicks: number; modeAtClick: string; disabledAtClick: string };
    };
    root.__fpCheckoutClickDiag = { clicks: 0, modeAtClick: "(not clicked)", disabledAtClick: "(not clicked)" };
    button?.addEventListener("click", () => {
      const state = root.__fpCheckoutClickDiag;
      if (!state) return;
      state.clicks += 1;
      state.modeAtClick = button.getAttribute("data-mode") ?? "(unset)";
      state.disabledAtClick = String(button.disabled);
    }, true);
  });
  let response;
  try {
    response = await page.waitForResponse(
      (r) => /api\.stripe\.com\/v1\/setup_intents\/seti_[^/]+\/confirm/.test(r.url()),
      { timeout: 90_000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => {
      const root = window as unknown as {
        __fpCheckoutClickDiag?: { clicks: number; modeAtClick: string; disabledAtClick: string };
      };
      const button = document.getElementById("fp-pay-btn") as HTMLButtonElement | null;
      return {
        ...(root.__fpCheckoutClickDiag ?? { clicks: -1, modeAtClick: "unknown", disabledAtClick: "unknown" }),
        disabledNow: button ? String(button.disabled) : "missing",
        alert: document.getElementById("fp-alert")?.textContent?.trim().slice(0, 200) ?? "(none)",
      };
    }).catch(() => ({ clicks: -1, modeAtClick: "page unavailable", disabledAtClick: "unknown", disabledNow: "unknown", alert: "unavailable" }));
    console.log(`[Checkout diag] No SetupIntent confirm response: ${JSON.stringify(state)}`);
    throw error;
  }
  const clickState = await page.evaluate(() => {
    const root = window as unknown as {
      __fpCheckoutClickDiag?: { clicks: number; modeAtClick: string; disabledAtClick: string };
    };
    return root.__fpCheckoutClickDiag ?? null;
  }).catch(() => null);
  console.log(`[Checkout diag] SetupIntent confirm was triggered; CTA=${JSON.stringify(clickState)}`);
  const setupIntentId = /\/(seti_[^/]+)\/confirm(?:\?|$)/.exec(response.url())?.[1];
  if (setupIntentId) {
    cleanup?.registerSetupIntent(setupIntentId);
    setupIntentParPage.set(page, setupIntentId);
  }
  try {
    const confirmation = await response.json() as {
      payment_method?: string;
      status?: string;
      next_action?: { type?: string } | null;
      last_setup_error?: { code?: string } | null;
    };
    if (confirmation.payment_method) cleanup?.registerPaymentMethod(confirmation.payment_method);
    console.log(
      `[3DS diag] initial confirm response: http=${response.status()} ` +
      `status=${confirmation.status ?? "unknown"} next_action=${confirmation.next_action?.type ?? "none"} ` +
      `error=${confirmation.last_setup_error?.code ?? "none"}`,
    );
  } catch {
    // The response may be a non-JSON error; the SetupIntent ID is still tracked above.
    console.log(`[3DS diag] initial confirm response: http=${response.status()} body=non-json`);
  }
  await logSetupIntentState(page, "after-initial-confirm");
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

export type StripePlan = "standard" | "pro" | "ultra";
export interface StripeProofOptions {
  positif: boolean;
  delaiMs?: number;
  plan?: StripePlan;
}

export async function verdictsStripe(email: string, o: StripeProofOptions): Promise<Verdict[]> {
  const d = await collecterDonnees((await stripe()) as never, email, DEBUT);
  if (!o.positif) return calculerAbsenceSouscription(d);
  const prix = process.env[`STRIPE_TEST_PRICE_ID_${(o.plan ?? "pro").toUpperCase()}`];
  return calculerVerifications(d, { ...(prix ? { prixAttendu: prix } : {}), livraisonEndpoint: cfg.mode === "R" });
}

/** Les webhooks arrivent de facon asynchrone : on re-verifie jusqu'au delai, puis on echoue avec le detail. */
export async function exigerPreuvesStripe(email: string, o: StripeProofOptions = { positif: true }): Promise<Verdict[]> {
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
