/**
 * funnel-front-plan-direct.test.ts
 *
 * Non-regression du front du tunnel (A-01 / A-02 / A-04 / A-11) :
 *  - A-01 : un bouton de plan (pricing.html) mene directement a l'inscription /
 *    paiement, sans passer par « Panier », hors panier avec add-ons et hors
 *    abonne actif ;
 *  - A-02 : `cta_clique` est emis sur selection de plan et passage au
 *    checkout, et SEULEMENT si le visiteur a consenti ;
 *  - A-04 : signin.html saute l'ecran de choix du plan quand le panier en a un
 *    et transmet le plan au lien Google ;
 *  - A-11 : le jeton de pre-inscription Google est range en sessionStorage et
 *    n'est plus detruit par un message « Rechargez la page ».
 *
 * Le parcours navigateur complet (desktop + iPhone + Pixel) est verifie a part
 * avec Playwright ; ici on verrouille le contrat dans le code livre.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const EXPORT_DIR = join(process.cwd(), "../flowpoint-export");
const PRICING = readFileSync(join(EXPORT_DIR, "pricing.html"), "utf8");
const SIGNIN = readFileSync(join(EXPORT_DIR, "signin.html"), "utf8");
const FUNNEL_JS = readFileSync(join(EXPORT_DIR, "pricing-funnel.js"), "utf8");

function selectPlanSource(): string {
  const start = PRICING.indexOf("window.selectPlan = function (btn)");
  const end = PRICING.indexOf("/* ── Quantity helpers", start);
  return PRICING.slice(start, end);
}

describe("A-01 — pricing.html : le bouton du plan mene directement au parcours", () => {
  const src = selectPlanSource();

  it("appelle goToCheckout (donc l'override abonne et la redirection anonyme) apres avoir stocke le plan", () => {
    expect(src.indexOf("localStorage.setItem('fp_cart'")).toBeGreaterThan(-1);
    expect(src).toMatch(/window\.goToCheckout\(\)/);
    expect(src.indexOf("localStorage.setItem('fp_cart'")).toBeLessThan(src.indexOf("window.goToCheckout()"));
  });

  it("garde la garde « plan deja actif » avant toute navigation", () => {
    expect(src.indexOf("Ce plan est déjà votre plan actuel")).toBeGreaterThan(-1);
    expect(src.indexOf("Ce plan est déjà votre plan actuel")).toBeLessThan(src.indexOf("window.goToCheckout()"));
  });

  it("ne navigue pas si le panier contient des add-ons, pour un abonne, ou depuis le dashboard", () => {
    expect(src).toMatch(/addonCount === 0/);
    expect(src).toMatch(/!isSubscriber/);
    expect(src).toMatch(/!fromDash/);
  });

  it("laisse un moyen clair d'ajouter des add-ons", () => {
    expect(PRICING).toContain('id="fp-plans-flow-hint"');
    expect(PRICING).toContain('href="#fp-addons"');
    expect(PRICING).toContain('<section class="fp-addons-section" id="fp-addons">');
  });

  it("conserve l'override goToCheckout des abonnes et la redirection anonyme (flowpoint_pending_checkout)", () => {
    expect(PRICING).toContain("Override goToCheckout for active/trialing subscribers");
    expect(PRICING).toContain("flowpoint_pending_checkout");
    expect(PRICING).toContain("/signin.html?next=");
  });
});

/** Execute pricing-funnel.js dans un contexte minimal. */
function runFunnel(cookie: string) {
  const store = new Map<string, string>();
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  class FakeElement {
    id = "";
    disabled = false;
    constructor(private attrs: Record<string, string>, id = "") { this.id = id; }
    matches(sel: string) { return sel === ".fp-card-btn[data-plan]" && "data-plan" in this.attrs; }
    getAttribute(n: string) { return this.attrs[n] ?? null; }
    hasAttribute(n: string) { return n in this.attrs; }
    closest() { return this; }
  }
  const ctx: Record<string, unknown> = {
    Element: FakeElement,
    HTMLAnchorElement: class {},
    URLSearchParams,
    JSON,
    Date,
    Math,
    document: {
      cookie,
      addEventListener: (type: string, fn: (e: unknown) => void) => { (listeners[type] ??= []).push(fn); },
    },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    sessionStorage: { getItem: () => null },
    window: {
      location: { search: "" },
      crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
      fetch: (url: string, init: { body: string }) => {
        requests.push({ url, body: JSON.parse(init.body) });
        return { catch: () => undefined };
      },
    },
  };
  (ctx.window as Record<string, unknown>).window = ctx.window;
  runInNewContext(FUNNEL_JS, ctx);
  const click = (el: FakeElement) => listeners["click"]?.forEach((fn) => fn({ target: el }));
  return { requests, store, click, FakeElement, win: ctx.window as Record<string, unknown> };
}

describe("A-02 — cta_clique, emis seulement avec consentement", () => {
  it("emet cta_clique avec le plan quand le visiteur a accepte les cookies d'analyse", () => {
    const { requests, click, FakeElement } = runFunnel("fp_analytics_consent=accepted");
    click(new FakeElement({ "data-plan": "pro" }));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("/api/public/funnel-event");
    expect(requests[0]!.body).toMatchObject({ etape: "cta_clique", plan: "pro", source: "direct" });
    expect(String(requests[0]!.body["visiteurId"])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("emet aussi cta_clique au passage au checkout (bouton Panier)", () => {
    const { requests, click, FakeElement } = runFunnel("fp_analytics_consent=accepted");
    click(new FakeElement({}, "fp-cart-btn"));
    expect(requests.map((r) => r.body["etape"])).toEqual(["cta_clique"]);
  });

  it("n'emet rien, ne cree aucun identifiant sans consentement", () => {
    for (const cookie of ["", "fp_analytics_consent=refused", "other=1"]) {
      const { requests, store, click, FakeElement, win } = runFunnel(cookie);
      click(new FakeElement({ "data-plan": "standard" }));
      expect(requests).toHaveLength(0);
      expect(store.has("fp_vid")).toBe(false);
      expect((win["fpFunnelTrack"] as (s: string) => boolean)("cta_clique")).toBe(false);
    }
  });

  it("ignore un plan inconnu et ne clique pas sur un bouton desactive", () => {
    const { requests, click, FakeElement } = runFunnel("fp_analytics_consent=accepted");
    click(new FakeElement({ "data-plan": "enterprise" }));
    expect(requests[0]!.body["plan"]).toBeUndefined();
    const disabled = new FakeElement({ "data-plan": "pro" });
    disabled.disabled = true;
    click(disabled);
    expect(requests).toHaveLength(1);
  });

  it("pricing.html charge pricing-funnel.js", () => {
    expect(PRICING).toContain('<script src="/pricing-funnel.js" defer></script>');
  });
});

describe("A-04 — signin.html : plan unique, transmis a Google", () => {
  it("saute l'ecran de choix quand fp_cart contient deja un plan valide et frais", () => {
    const fn = SIGNIN.match(/function fpCartPlan\(\) \{[\s\S]*?\n  \}\n/)?.[0];
    expect(fn).toBeTruthy();
    const FP_PLANS = ["standard", "pro", "ultra"];
    const make = (cart: unknown) =>
      runInNewContext(`(${fn!.replace("function fpCartPlan", "function")})`, {
        FP_PLANS, JSON, Date, String,
        localStorage: { getItem: () => (cart === undefined ? null : JSON.stringify(cart)) },
      }) as () => string;
    expect(make({ plan: "pro", _updatedAt: Date.now() })()).toBe("pro");
    expect(make({ plan: "ULTRA", _updatedAt: Date.now() })()).toBe("ultra");
    expect(make({ plan: "pro", _updatedAt: Date.now() - 2 * 3600000 })()).toBe("");
    expect(make({ plan: "gold", _updatedAt: Date.now() })()).toBe("");
    expect(make({ addons: {} , _updatedAt: Date.now() })()).toBe("");
    expect(make(undefined)()).toBe("");
    expect(SIGNIN).toMatch(/function fpAfterPreRegister\(\)[\s\S]*?proceedWithPlan\(cartPlan, null\)/);
    expect(SIGNIN).toMatch(/\n\s+fpAfterPreRegister\(\);\n\s+\}\)\n\s+\.catch/);
  });

  it("construit /api/auth/google/login?plan=…&seller_code=…&fp_lid=…", () => {
    expect(SIGNIN).toContain("qs.push('plan=' + encodeURIComponent(plan))");
    expect(SIGNIN).toContain("qs.push('seller_code=' + encodeURIComponent(sellerRefParam))");
    expect(SIGNIN).toContain("qs.push('fp_lid=' + encodeURIComponent(fpLidValue))");
    expect(SIGNIN).toContain("'/api/auth/google/login?' + qs.join('&')");
  });

  it("lit plan au retour du callback, sans prendre le plan par defaut du serveur pour un choix", () => {
    expect(SIGNIN).toContain("urlParams.get('plan')");
    expect(SIGNIN).toContain("planParam === planSent");
  });
});

describe("A-11 — jeton de pre-inscription Google", () => {
  it("le jeton est range en sessionStorage des l'arrivee, retire de l'URL et restaure au rechargement", () => {
    expect(SIGNIN).toContain("sessionStorage.setItem('fp_pre_reg_token', googleResumeToken)");
    expect(SIGNIN).toContain("history.replaceState({}, '', '/signin.html')");
    expect(SIGNIN).toContain("fp_google_signup_resume");
    expect(SIGNIN).toMatch(/sessionStorage\.getItem\('fp_google_signup_resume'\)/);
  });

  it("ne demande plus de recharger la page quand le jeton manque", () => {
    expect(SIGNIN).not.toContain("Rechargez la page");
    expect(SIGNIN).toContain("fpBackToSignupForm(");
  });
});

describe("signin.html?plan= — lien direct du site vitrine", () => {
  const start = SIGNIN.indexOf("Lien direct depuis le site vitrine");
  const end = SIGNIN.indexOf("/* A-04 —", start);
  const block = SIGNIN.slice(SIGNIN.lastIndexOf("(function () {", start), end);

  function run(search: string, cart: unknown = null) {
    const store: Record<string, string> = cart ? { fp_cart: JSON.stringify(cart) } : {};
    const history: string[] = [];
    runInNewContext(block, {
      FP_PLANS: ["standard", "pro", "ultra"],
      URLSearchParams,
      Date, JSON, String,
      window: { location: { search } },
      localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
      history: { replaceState: (_s: unknown, _t: string, url: string) => { history.push(url); } },
    });
    return { cart: store["fp_cart"] ? JSON.parse(store["fp_cart"]) : null, history };
  }

  it("retient un plan de la liste blanche, garde les add-ons, nettoie l'URL", () => {
    const r = run("?plan=PRO&utm_source=x", { plan: "standard", addons: { seats: 2 } });
    expect(r.cart.plan).toBe("pro");
    expect(r.cart.addons).toEqual({ seats: 2 });
    expect(r.history).toEqual(["/signin.html?utm_source=x"]);
  });

  it("ignore tout identifiant hors liste blanche : aucun panier n'est créé", () => {
    for (const bad of ["?plan=enterprise", "?plan=pro%27%3Balert(1)", "?plan=", "?plan=__proto__", "?plan=29"]) {
      expect(run(bad).cart).toBeNull();
    }
  });

  it("ne touche pas au retour du callback Google (traité à part)", () => {
    expect(run("?google_signup=1&plan=ultra&pre_reg=abc").cart).toBeNull();
  });
});
