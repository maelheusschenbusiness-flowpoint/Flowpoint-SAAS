// @vitest-environment node
/**
 * Faux succes de paiement — pages statiques success.html / checkout-return.html.
 *
 * Contrat : un ecran de succes n'apparait QUE si le serveur confirme l'etat
 * reel ; sinon un etat explicite distinct (aucun paiement, echec, session
 * invalide, connexion requise, en attente, erreur serveur). API mockee, jsdom,
 * aucun reseau, aucun Stripe.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const EXPORT_DIR = resolve(__dirname, "../../../flowpoint-export");
const read = (f: string) => readFileSync(resolve(EXPORT_DIR, f), "utf8");
const LOCALE_SRC = read("fp-locale.js");

type Reply = { status?: number; json?: unknown; reject?: boolean };
type Routes = Record<string, Reply | Reply[] | ((url: string) => Reply)>;

interface Page {
  win: any;
  doc: Document;
  calls: string[];
  navigations: string[];
  text: () => string;
  state: () => string | null;
  waitFor: (cond: () => boolean, ms?: number) => Promise<void>;
  close: () => void;
}

/** Charge une page statique avec fetch mocke. Les delais >= 1 s sont ramenes a 1 ms. */
function load(file: string, search: string, routes: Routes, opts: { lang?: string; cart?: unknown; token?: boolean } = {}): Page {
  const calls: string[] = [];
  const navigations: string[] = [];
  const queues = new Map<string, Reply[]>();
  const fetchMock = (input: string, init?: { method?: string }) => {
    const url = String(input);
    calls.push((init?.method || "GET") + " " + url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    let reply: Reply = { status: 404, json: { error: "unmocked " + url } };
    if (key) {
      const r = routes[key];
      if (typeof r === "function") reply = r(url);
      else if (Array.isArray(r)) {
        const q = queues.get(key) ?? [...r];
        queues.set(key, q);
        reply = q.length > 1 ? q.shift()! : q[0]!;
      } else reply = r;
    }
    if (reply.reject) return Promise.reject(new TypeError("network"));
    const status = reply.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(reply.json ?? {}),
    });
  };
  const vc = new VirtualConsole(); // silence "not implemented" de jsdom
  const dom = new JSDOM(read(file), {
    url: "http://localhost/" + file + search,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w: any) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.fetch = fetchMock;
      w.__fpNavigate = (u: string) => navigations.push(u);
      const st = w.setTimeout.bind(w);
      w.setTimeout = (f: () => void, ms?: number, ...a: unknown[]) => st(f, ms && ms >= 1000 ? 1 : ms, ...a);
      try {
        w.localStorage.setItem("fp:language", opts.lang ?? "fr");
        if (opts.cart) w.localStorage.setItem("fp_cart", JSON.stringify(opts.cart));
        if (opts.token) w.sessionStorage.setItem("fp_session_token", "tok");
      } catch { /* ignore */ }
      w.eval(LOCALE_SRC);
    },
  });
  const doc = dom.window.document;
  return {
    win: dom.window,
    doc,
    calls,
    navigations,
    text: () => {
      const clone = doc.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script,style").forEach((n) => n.remove());
      return clone.textContent || "";
    },
    state: () => doc.getElementById("fp-card")?.getAttribute("data-state") ?? null,
    waitFor: async (cond, ms = 3000) => {
      const t0 = Date.now();
      while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error("timeout: " + (doc.getElementById("fp-card")?.textContent || doc.body.textContent || "").replace(/\s+/g, " ").slice(0, 400));
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    // Pas de window.close() : des sondes bornees peuvent encore tourner ; la fenetre est jetable.
    close: () => {},
  };
}

const RESTORE_401 = { status: 401, json: { error: "no session" } };
const RESTORE_OK = { status: 200, json: { token: "tok" } };
const noFalseSuccess = (t: string) => {
  expect(t).not.toMatch(/Paiement confirmé/i);
  expect(t).not.toMatch(/Payment confirmed/i);
  expect(t).not.toMatch(/Abonnement activé/i);
  expect(t).not.toMatch(/Subscription activated/i);
  expect(t).not.toMatch(/14 jours d'essai offerts/);
  expect(t).not.toMatch(/14-day free trial started/i);
};

describe("success.html — jamais de succes presume", () => {
  it("le HTML statique n'annonce aucun succes (JS desactive / avant verification)", () => {
    const html = read("success.html");
    const body = html.slice(html.indexOf("<body"), html.indexOf("<script>", html.indexOf("<body")));
    noFalseSuccess(body);
    // Source anglaise depuis le 10/11/2026 : le titre statique annonce une verification, jamais un succes.
    expect(html).toMatch(/<title>[^<]*Verifying/);
  });

  it("ouverte sans parametre : 'aucun paiement a confirmer', aucun appel serveur", async () => {
    const p = load("success.html", "", {});
    await p.waitFor(() => p.state() === "none");
    expect(p.text()).toMatch(/Aucun paiement à confirmer/);
    noFalseSuccess(p.text());
    expect(p.calls).toEqual([]);
    expect((p.doc.getElementById("fp-pricing-btn") as HTMLAnchorElement).style.display).toBe("flex");
    p.close();
  });

  it("session_id mal forme (placeholder litteral) : session invalide, pas de succes", async () => {
    const p = load("success.html", "?session_id=%7BCHECKOUT_SESSION_ID%7D", {});
    await p.waitFor(() => p.state() === "invalid");
    noFalseSuccess(p.text());
    expect(p.calls).toEqual([]);
    p.close();
  });

  it("session inconnue de Stripe (visiteur anonyme, 400) : session introuvable, pas de succes", async () => {
    const p = load("success.html", "?session_id=cs_test_invalid", {
      "/api/auth/session-restore": RESTORE_401,
      "/api/auth/checkout-complete": { status: 400, json: { error: "Session de paiement introuvable ou invalide." } },
    });
    await p.waitFor(() => p.state() === "invalid");
    expect(p.text()).toMatch(/introuvable ou expirée/);
    noFalseSuccess(p.text());
    p.close();
  });

  it("connecte + billing/verify ok : ecran de succes (seul chemin) + redirection programmee", async () => {
    const p = load("success.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_OK,
      "/api/billing/verify": { status: 200, json: { ok: true, plan: "pro", checkoutType: "subscription" } },
    }, { cart: { plan: "pro", addons: {} } });
    await p.waitFor(() => p.state() === "confirmed");
    expect(p.text()).toMatch(/Paiement confirmé/);
    expect(p.text()).toMatch(/Plan Pro/);
    expect(p.doc.title).toMatch(/Paiement confirmé/);
    expect(p.win.localStorage.getItem("fp_cart")).toBeNull();
    p.close();
  });

  it("connecte + verify 402 (paiement non termine) : paiement non finalise, pas de succes, panier conserve", async () => {
    const p = load("success.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_OK,
      "/api/billing/verify": { status: 402, json: { error: "Payment not completed", status: "open" } },
    }, { cart: { plan: "pro", addons: {} } });
    await p.waitFor(() => p.state() === "failed");
    expect(p.text()).toMatch(/Paiement non finalisé/);
    noFalseSuccess(p.text());
    expect(p.win.localStorage.getItem("fp_cart")).not.toBeNull();
    p.close();
  });

  it("verify 202 en continu : polling BORNE puis 'confirmation en attente' + bouton reessayer", async () => {
    const p = load("success.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_OK,
      "/api/billing/verify": { status: 202, json: { ok: false, pending: true, status: "processing" } },
    });
    await p.waitFor(() => p.state() === "pending", 5000);
    expect(p.text()).toMatch(/Confirmation en attente/);
    noFalseSuccess(p.text());
    const polls = p.calls.filter((c) => c.includes("/api/billing/verify")).length;
    expect(polls).toBe(15);
    expect((p.doc.getElementById("fp-retry-btn") as HTMLElement).style.display).toBe("flex");
    p.close();
  });

  it("verify 401 : connexion requise ; 403 : paiement d'un autre compte ; jamais de succes", async () => {
    const a = load("success.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_OK,
      "/api/billing/verify": { status: 401, json: { error: "unauthorized" } },
    });
    await a.waitFor(() => a.state() === "signin");
    noFalseSuccess(a.text());
    expect((a.doc.getElementById("fp-login-btn") as HTMLAnchorElement).getAttribute("href")).toContain("/login.html");
    a.close();
    const b = load("success.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_OK,
      "/api/billing/verify": { status: 403, json: { error: "x" } },
    });
    await b.waitFor(() => b.state() === "invalid");
    expect(b.text()).toMatch(/n'appartient pas à ce compte/);
    noFalseSuccess(b.text());
    b.close();
  });

  it("verify 500 : erreur serveur explicite avec reessai, pas de succes", async () => {
    const p = load("success.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_OK,
      "/api/billing/verify": { status: 500, json: { error: "Failed to verify checkout session" } },
    });
    await p.waitFor(() => p.state() === "error");
    expect(p.text()).toMatch(/Vérification impossible/);
    noFalseSuccess(p.text());
    p.close();
  });

  it("reseau coupe en continu : erreur apres tentatives bornees, pas de succes", async () => {
    const p = load("success.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_OK,
      "/api/billing/verify": { reject: true },
    });
    await p.waitFor(() => p.state() === "error", 5000);
    noFalseSuccess(p.text());
    expect(p.calls.filter((c) => c.includes("/api/billing/verify")).length).toBe(15);
    p.close();
  });

  it("anonyme : checkout-complete 402 puis 200 -> succes 'e-mail de connexion envoye'", async () => {
    const p = load("success.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_401,
      "/api/auth/checkout-complete": [{ status: 402, json: { pending: true } }, { status: 200, json: { ok: true, emailSent: true } }],
    });
    await p.waitFor(() => p.state() === "confirmed");
    expect(p.text()).toMatch(/lien de connexion/);
    p.close();
  });

  it("langue : EN pour 'en', repli anglais pour une langue sans traduction", async () => {
    const en = load("success.html", "", {}, { lang: "en" });
    await en.waitFor(() => en.state() === "none");
    expect(en.text()).toMatch(/No payment to confirm/);
    en.close();
    const de = load("success.html", "", {}, { lang: "de" });
    await de.waitFor(() => de.state() === "none");
    expect(de.text()).toMatch(/No payment to confirm/);
    de.close();
  });
});

describe("checkout-return.html — etats explicites", () => {
  const FIN = "/api/public/finalize-checkout";

  it("payment_intent invalide + redirect_status=failed + finalize 401 : 'Paiement echoue', jamais 'enregistre'", async () => {
    const p = load("checkout-return.html", "?payment_intent=pi_invalid&redirect_status=failed", {
      [FIN]: { status: 401, json: { error: "auth_required" } },
    });
    await p.waitFor(() => /Paiement échoué/.test(p.text()));
    expect(p.text()).not.toMatch(/enregistr/i);
    noFalseSuccess(p.text());
    const link = p.doc.querySelector("#fp-sub a.fp-btn") as HTMLAnchorElement;
    expect(link?.textContent).toMatch(/Réessayer le paiement/);
    p.close();
  });

  it("sans redirect_status + finalize 401 : connexion requise, rien n'est 'enregistre'", async () => {
    const p = load("checkout-return.html", "?payment_intent=pi_x", {
      [FIN]: { status: 401, json: { error: "auth_required" } },
    });
    await p.waitFor(() => /Connectez-vous pour vérifier/.test(p.text()));
    expect(p.text()).not.toMatch(/enregistr/i);
    expect(p.text()).not.toMatch(/conservé/i);
    noFalseSuccess(p.text());
    p.close();
  });

  it("finalize success : seul cas qui affiche la confirmation de commande", async () => {
    const p = load("checkout-return.html", "?payment_intent=pi_ok&redirect_status=succeeded", {
      [FIN]: { status: 200, json: { success: true } },
    });
    await p.waitFor(() => /Votre commande est confirmée/.test(p.text()));
    p.close();
  });

  it("finalize 400 'processing' en continu : polling borne puis 'confirmation en attente'", async () => {
    const p = load("checkout-return.html", "?payment_intent=pi_proc&redirect_status=processing", {
      [FIN]: { status: 400, json: { error: "Paiement non confirmé (statut: processing)." } },
    });
    await p.waitFor(() => /Confirmation en attente/.test(p.text()), 5000);
    expect(p.calls.filter((c) => c.includes(FIN)).length).toBe(11);
    noFalseSuccess(p.text());
    p.close();
  });

  it("finalize 400 'requires_payment_method' : paiement echoue", async () => {
    const p = load("checkout-return.html", "?setup_intent=seti_x", {
      [FIN]: { status: 400, json: { error: "Configuration non confirmée (statut: requires_payment_method)." } },
    });
    await p.waitFor(() => /Paiement échoué/.test(p.text()));
    p.close();
  });

  it("finalize 500 ou reseau : erreur serveur explicite (pas 'votre paiement a peut-etre abouti')", async () => {
    for (const reply of [{ status: 500, json: { error: "boom" } }, { reject: true }]) {
      const p = load("checkout-return.html", "?payment_intent=pi_x", { [FIN]: reply });
      await p.waitFor(() => /Vérification impossible/.test(p.text()));
      expect(p.text()).not.toMatch(/peut-être abouti/);
      p.close();
    }
  });

  it("awaitingWebhook jamais confirme : 'en attente', AUCUNE redirection de succes", async () => {
    const p = load("checkout-return.html", "?payment_intent=cs_test_x&redirect_status=succeeded", {
      [FIN]: { status: 200, json: { success: true, awaitingWebhook: true } },
      "/api/billing/verify": { status: 202, json: { ok: false, pending: true } },
    });
    await p.waitFor(() => /Confirmation en attente/.test(p.text()), 5000);
    expect(p.navigations).toEqual([]);
    p.close();
  });

  it("session_id=cs_test_invalid (anonyme, checkout-complete 400) : session introuvable, pas 'paiement conserve'", async () => {
    const p = load("checkout-return.html", "?session_id=cs_test_invalid", {
      "/api/auth/session-restore": RESTORE_401,
      "/api/auth/checkout-complete": { status: 400, json: { error: "Session de paiement introuvable ou invalide." } },
    });
    await p.waitFor(() => /introuvable ou expirée/.test(p.text()));
    expect(p.text()).not.toMatch(/conservé/);
    expect(p.text()).not.toMatch(/enregistr/i);
    p.close();
  });

  it("session_id + connecte + billing/verify 403 : paiement d'un autre compte", async () => {
    const p = load("checkout-return.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_OK,
      "/api/billing/verify": { status: 403, json: { error: "x" } },
    });
    await p.waitFor(() => /n’appartient pas à ce compte/.test(p.text()));
    expect(p.text()).not.toMatch(/conservé/);
    p.close();
  });

  it("session_id + billing/verify 401 : connexion requise sans pretendre que le paiement est conserve", async () => {
    const p = load("checkout-return.html", "?session_id=cs_test_abc123", {
      "/api/auth/session-restore": RESTORE_OK,
      "/api/billing/verify": { status: 401, json: { error: "unauthorized" } },
    });
    await p.waitFor(() => /Connectez-vous pour vérifier/.test(p.text()));
    expect(p.text()).not.toMatch(/conservé/);
    p.close();
  });
});

describe("checkout-payment.html — echec de chargement de Stripe.js", () => {
  const src = read("checkout-payment.html");
  it("n'accuse plus systematiquement un bloqueur de publicites", () => {
    expect(src).not.toMatch(/Désactivez votre bloqueur de publicités/);
  });
  it("distingue CSP, hors-ligne et echec generique, avec un bouton Reessayer", () => {
    expect(src).toMatch(/securitypolicyviolation/);
    expect(src).toMatch(/navigator\.onLine === false/);
    expect(src).toMatch(/showAlert\(stripeLoadMessage\(\), true\)/);
    expect(src).toMatch(/fp-retry-load/);
  });
});
