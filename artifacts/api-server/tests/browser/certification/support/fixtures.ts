import { test as base, expect, type Page, type APIRequestContext, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
import { BASE_URL, IS_LOCAL } from "./cible";
import { db, one, all } from "./db";

const STUB_JS = fs.readFileSync(path.resolve(HERE, "../harness/stripe-js-stub.js"), "utf8");

export const PLANS = ["standard", "pro", "ultra"] as const;
export const COMPLETE_FORM = {
  firstName: "Test", lastName: "Certification", companyName: "Cert Test SARL", country: "FR",
  address: "12 rue de la Paix", city: "Paris", postalCode: "75001",
};

/** Reponses d'API « gardees » PAR LE PRODUIT (droit d'un add-on / plan absent) : attendues, pas des defauts. */
const GATED_CODES = new Set(["ADDON_REQUIRED", "PLAN_REQUIRED", "FEATURE_REQUIRED", "SUBSCRIPTION_REQUIRED"]);

export interface Observed { responses: Array<{ url: string; status: number; code?: string }>; consoleErrors: Array<{ text: string; url: string }>; pageErrors: string[]; funnelCalls: Array<{ body: Record<string, unknown> }> }

export interface Fixtures {
  langue: void;
  /** Adresse IP unique par test (X-Forwarded-For, trust proxy = 1) : les limiteurs par IP ne se croisent pas. */
  testIp: string;
  observed: Observed;
  /** Stripe.js remplace par le stub local (route) ; `{loaderror:true}` pour simuler un Stripe.js defaillant. */
  useStripeStub: (opts?: { loaderror?: boolean; neverReady?: boolean }) => Promise<void>;
  /** accounts.google.com simule : redirige vers le callback local avec le `state` recu et un `code` de persona. */
  useGoogleStub: (personaCode: string, opts?: { error?: string }) => Promise<{ authorizeUrls: URL[] }>;
  consent: (accepted: boolean) => Promise<void>;
  newEmail: (label?: string) => string;
  shot: (page: Page, name: string) => Promise<void>;
  /** Cree par l'API (comme le navigateur) un compte COMPLET en essai : pre-inscription, intent, confirmation, finalisation. */
  signupViaApi: (request: APIRequestContext, o?: { email?: string; plan?: string }) => Promise<{ email: string; token: string; intentId: string; orgId: string | null }>;
  mails: (to: string) => Promise<Array<Record<string, unknown>>>;
  magicToken: (email: string) => Promise<string>;
}

let ipSeq = 0;
const IP_RUN = 1 + Math.floor(Math.random() * 250);    // propre a chaque execution : les limiteurs par IP du serveur (fenetre 15 min) ne se croisent pas d'un passage a l'autre
let emailSeq = 0;
const RUN = Date.now().toString(36);

export const test = base.extend<Fixtures & { extraHTTPHeaders: Record<string, string> }>({
  testIp: async ({}, use) => { ipSeq += 1; await use(`10.${IP_RUN}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`); },
  extraHTTPHeaders: async ({ testIp }, use) => { await use({ "X-Forwarded-For": testIp }); },

  // Le produit lit la langue dans localStorage['fp:language'] (defaut « en », meme avec un navigateur francais).
  // Les assertions de texte sont ecrites en francais : on fixe la langue, sauf test qui la teste (CERT_NO_LANG).
  langue: [async ({ context }, use) => {
    await context.addInitScript(() => { try { if (!localStorage.getItem("fp:language")) localStorage.setItem("fp:language", "fr"); } catch { /* ignore */ } });
    await use();
  }, { auto: true }],

  observed: async ({ page }, use) => {
    const o: Observed = { responses: [], consoleErrors: [], pageErrors: [], funnelCalls: [] };
    page.on("response", async (r) => {
      const u = new URL(r.url());
      if (u.origin !== BASE_URL || !u.pathname.startsWith("/api/")) return;
      let code: string | undefined;
      if (r.status() >= 400) { try { code = ((await r.json()) as { code?: string }).code; } catch { /* corps non JSON */ } }
      o.responses.push({ url: u.pathname, status: r.status(), code });
    });
    page.on("console", (m) => { if (m.type() === "error") o.consoleErrors.push({ text: m.text(), url: m.location().url }); });
    page.on("pageerror", (e) => o.pageErrors.push(String(e.message)));
    page.on("request", (rq) => { if (rq.url().endsWith("/api/public/funnel-event") && rq.method() === "POST") { try { o.funnelCalls.push({ body: JSON.parse(rq.postData() ?? "{}") }); } catch { /* ignore */ } } });
    await use(o);
  },

  useStripeStub: async ({ page }, use) => {
    await use(async (opts = {}) => {
      // Playwright applique la route enregistree EN DERNIER d'abord : generique d'abord, specifique ensuite.
      await page.route("https://*.stripe.com/**", (route) => route.fulfill({ status: 204, body: "" }));
      await page.route("https://js.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: `window.__FP_STRIPE_STUB=${JSON.stringify(opts)};\n${STUB_JS}` }));
    });
  },

  useGoogleStub: async ({ context }, use) => {
    await use(async (personaCode, opts = {}) => {
      const authorizeUrls: URL[] = [];
      // Filet : jamais de contact avec le vrai Google (les redirections serveur ne passent pas par page.route).
      await context.route("https://accounts.google.com/**", (route) => route.abort("blockedbyclient"));
      // On intercepte la REPONSE du serveur au depart (sans suivre la redirection) : elle porte le Location vers Google ET le
      // cookie de state, qu'on laisse passer tel quel. On remplace seulement la destination par le callback local.
      await context.route("**/api/auth/google/login**", async (route) => {
        const resp = await route.fetch({ maxRedirects: 0 });
        const loc = resp.headers()["location"] ?? "";
        if (!loc.startsWith("https://accounts.google.com/")) { await route.fulfill({ response: resp }); return; }
        const u = new URL(loc); authorizeUrls.push(u);
        const back = new URL(u.searchParams.get("redirect_uri") ?? `${BASE_URL}/api/auth/google/callback`);
        if (opts.error) back.searchParams.set("error", opts.error); else back.searchParams.set("code", personaCode);
        const st = u.searchParams.get("state"); if (st) back.searchParams.set("state", st);
        await route.fulfill({ response: resp, headers: { ...resp.headers(), location: back.toString() } });
      });
      return { authorizeUrls };
    });
  },

  consent: async ({ context }, use) => {
    await use(async (accepted) => {
      if (accepted) await context.addCookies([{ name: "fp_analytics_consent", value: "accepted", url: BASE_URL }]);
    });
  },

  newEmail: async ({}, use) => { await use((label = "t") => { emailSeq += 1; return `cert-${label}-${RUN}-${emailSeq}@example.invalid`; }); },

  shot: async ({}, use, testInfo: TestInfo) => {
    await use(async (page, name) => {
      const dir = path.join(testInfo.project.outputDir, "..", "captures", testInfo.project.name);
      fs.mkdirSync(dir, { recursive: true });
      const slug = testInfo.titlePath.slice(1).join("_").replace(/[^a-z0-9]+/gi, "-").slice(0, 70);
      await page.screenshot({ path: path.join(dir, `${slug}__${name}.png`), fullPage: false }).catch(() => {});
    });
  },

  mails: async ({ request }, use) => {
    await use(async (to) => ((await (await request.get(`${BASE_URL}/__fake/mails?to=${encodeURIComponent(to)}`)).json()) as { mails: Array<Record<string, unknown>> }).mails);
  },

  magicToken: async ({ request }, use) => {
    await use(async (email) => {
      await request.post(`${BASE_URL}/__fake/mails/clear`);
      const r = await request.post(`${BASE_URL}/api/auth/login-request`, { data: { email } });
      expect(r.status()).toBe(200);
      for (let i = 0; i < 20; i++) {
        const m = ((await (await request.get(`${BASE_URL}/__fake/mails?to=${encodeURIComponent(email)}`)).json()) as { mails: Array<{ token?: string }> }).mails.at(-1);
        if (m?.token) return m.token;
        await new Promise((res) => setTimeout(res, 150));
      }
      throw new Error(`Aucun e-mail de lien magique capture pour ${email}`);
    });
  },

  signupViaApi: async ({ newEmail }, use) => {
    await use(async (request, o = {}) => {
      const email = o.email ?? newEmail("api");
      const plan = o.plan ?? "pro";
      const pre = await request.post(`${BASE_URL}/api/auth/pre-register`, { data: { ...COMPLETE_FORM, email } });
      expect(pre.status(), "pre-register").toBe(200);
      const token = ((await pre.json()) as { preRegisterToken: string }).preRegisterToken;
      const pi = await request.post(`${BASE_URL}/api/public/payment-intent`, { data: { plan, addons: {}, preRegisterToken: token } });
      expect(pi.status(), "payment-intent").toBe(200);
      const clientSecret = ((await pi.json()) as { clientSecret: string }).clientSecret;
      const intentId = clientSecret.split("_secret_")[0]!;
      const conf = await request.post(`${BASE_URL}/__fake/stripe/confirm-setup`, { data: { clientSecret, card: "4242 4242 4242 4242" } });
      expect(((await conf.json()) as { setupIntent?: unknown }).setupIntent).toBeTruthy();
      const fin = await request.post(`${BASE_URL}/api/public/finalize-checkout`, { data: { intentId, intentType: "setup", plan, addons: {}, preRegisterToken: token } });
      expect(fin.status(), "finalize-checkout").toBe(200);
      const org = await one<{ id: string }>("SELECT id::text FROM organizations WHERE lower(owner_email)=lower($1)", [email]);
      return { email, token, intentId, orgId: org?.id ?? null };
    });
  },
});

export { expect, db, one, all, IS_LOCAL, BASE_URL };

/** Reponses d'API en echec qui ne sont PAS des garde-fous produit attendus. */
export function unexpectedApiFailures(o: Observed, allow: Array<RegExp> = []): string[] {
  return o.responses
    .filter((r) => r.status >= 400)
    .filter((r) => !(r.code && GATED_CODES.has(r.code)))
    .filter((r) => !allow.some((re) => re.test(`${r.status} ${r.url}`)))
    .map((r) => `${r.status} ${r.url}${r.code ? ` (${r.code})` : ""}`);
}

/** Erreurs console qui ne viennent ni d'un hote tiers injoignable ni d'un garde-fou produit attendu. */
export function unexpectedConsoleErrors(o: Observed, allow: Array<RegExp> = []): string[] {
  const gatedUrls = new Set(o.responses.filter((r) => r.code && GATED_CODES.has(r.code)).map((r) => r.url));
  return o.consoleErrors
    .filter((e) => { try { const u = new URL(e.url); return u.origin === BASE_URL; } catch { return true; } })     // hotes tiers : hors perimetre
    .filter((e) => { const m = e.text.match(/https?:\/\/[^\s'"]+/); try { return !m || new URL(m[0]).origin === BASE_URL; } catch { return true; } })   // message qui designe un hote tiers (polices, analytics) : reseau, pas produit
    .filter((e) => !(/status of (402|403)/.test(e.text) && (() => { try { return gatedUrls.has(new URL(e.url).pathname); } catch { return false; } })()))
    .filter((e) => !allow.some((re) => re.test(e.text)))
    .map((e) => `${e.text.slice(0, 160)} @ ${e.url}`);
}

/** Visiteur anonyme : les sondes de session (/api/me, /api/billing/subscription...) repondent 401 — attendu — et le navigateur le journalise. */
export const ANON_OK: RegExp[] = [/status of 401/, /ERR_(FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)/];
