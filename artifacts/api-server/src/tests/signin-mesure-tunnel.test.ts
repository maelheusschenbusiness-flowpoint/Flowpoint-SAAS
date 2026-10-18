/**
 * signin-mesure-tunnel.test.ts
 *
 * `signin.html` est la premiere etape du tunnel qu'on puisse mesurer cote
 * prospect : `/` et `/index.html` y redirigent (app.ts), et le formulaire y
 * vit. Le site vitrine `flowpoint.pro`, lui, n'est dans AUCUN depot de ce
 * compte — verifie le 18/10/2026 : trois depots existent, aucun ne le
 * contient. Son instrumentation reste donc a faire ailleurs.
 *
 * Ce que ces tests verrouillent :
 *   - `signup_started` est bien emis ;
 *   - `signup_form_completed` porte le MEME identifiant de visiteur, sans quoi
 *     les deux etapes ne se joignent pas et le taux d'abandon du formulaire
 *     reste incalculable ;
 *   - aucune donnee personnelle ne part vers le point de mesure ;
 *   - la mesure ne peut jamais bloquer une inscription ;
 *   - et le formulaire n'a pas ete modifie : memes champs, memes validations.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import {
  lireAttributionFunnel,
  metadataAttributionFunnel,
  normaliserAttributionFunnel,
} from "../services/funnel-events.js";

const PAGE = readFileSync(join(process.cwd(), "../flowpoint-export/signin.html"), "utf8");
const CHECKOUT_PAGE = readFileSync(join(process.cwd(), "../flowpoint-export/checkout-payment.html"), "utf8");
const PAYMENT_INTENT_ROUTE = readFileSync(join(process.cwd(), "src/routes/public-billing.ts"), "utf8");

/** Les blocs de script en ligne, pour en verifier la syntaxe. */
function blocsEnLigne(): string[] {
  return [...PAGE.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
}

function executerMesure(cookie: string) {
  const debut = PAGE.indexOf("var FP_TRACKING_SOURCES =");
  const fin = PAGE.indexOf("/* ── Step 1: form submit", debut);
  const script = PAGE.slice(debut, fin);
  const stockage = new Map<string, string>();
  const requetes: Array<{ url: string; options: { body: string } }> = [];
  const contexte: Record<string, unknown> = {
    URL,
    URLSearchParams,
    JSON,
    Date,
    Math,
    document: { cookie, referrer: "" },
    localStorage: {
      getItem: (key: string) => stockage.get(key) ?? null,
      setItem: (key: string, value: string) => stockage.set(key, value),
    },
    fetch: (url: string, options: { body: string }) => {
      requetes.push({ url, options });
      return { catch: () => undefined };
    },
    window: {
      crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
      location: {
        search: "?fp_vid=123e4567-e89b-42d3-a456-426614174000&fp_src=smartlead&plan=pro",
        pathname: "/signin.html",
        hash: "",
      },
      history: {
        state: null,
        replaceState: () => undefined,
      },
    },
  };

  new Script(`${script}\nglobalThis.__visitorId = fpVid();\nglobalThis.__source = fpSource();`).runInNewContext(contexte);
  return { contexte, stockage, requetes };
}

function executerAttributionCheckout(cookie: string, visitorId: string, source: string) {
  const debut = CHECKOUT_PAGE.indexOf("function fpFunnelAttribution()");
  const fin = CHECKOUT_PAGE.indexOf("async function initStripe()", debut);
  const stockage = new Map<string, string>([["fp_vid", visitorId], ["fp_source", source]]);
  const contexte: Record<string, unknown> = {
    document: { cookie },
    localStorage: {
      getItem: (key: string) => stockage.get(key) ?? null,
    },
  };
  new Script(`${CHECKOUT_PAGE.slice(debut, fin)}\nglobalThis.__attribution = fpFunnelAttribution();`).runInNewContext(contexte);
  return contexte.__attribution as Record<string, unknown>;
}

describe("la mesure est posee et exploitable", () => {
  it("signup_started est emis au chargement", () => {
    expect(PAGE).toContain("fpEtape('signup_started')");
  });

  it("le formulaire transmet le MEME identifiant de visiteur", () => {
    // C'est ce lien qui rend le tunnel joignable : sans lui, on sait combien de
    // formulaires ont ete envoyes, mais pas combien ont ete commences.
    expect(PAGE).toContain("visiteurId: fpVid()");
    const i = PAGE.indexOf("/api/auth/pre-register");
    const j = PAGE.indexOf("visiteurId: fpVid()");
    expect(j, "visiteurId n'est pas dans le corps du POST pre-register").toBeGreaterThan(i);
  });

  it("l'identifiant est aleatoire et persistant, jamais derive d'une donnee personnelle", () => {
    const i = PAGE.indexOf("function fpVid()");
    expect(i).toBeGreaterThan(-1);
    const fn = PAGE.slice(i, i + 700);
    expect(fn).toContain("randomUUID");
    expect(fn).toContain("localStorage");
    for (const interdit of ["email", "firstName", "lastName", "companyName", "postalCode", "address"]) {
      expect(fn, `fpVid() derive l'identifiant de ${interdit}`).not.toContain(interdit);
    }
  });

  it("AUCUNE DONNEE PERSONNELLE ne part vers le point de mesure", () => {
    const i = PAGE.indexOf("function fpEtape(");
    expect(i).toBeGreaterThan(-1);
    const fn = PAGE.slice(i, i + 700);
    expect(fn).toContain("/api/public/funnel-event");
    for (const interdit of ["email", "firstName", "lastName", "companyName",
                            "postalCode", "address", "city", "phone", "vat"]) {
      expect(fn, `la mesure transmet ${interdit}`).not.toContain(interdit);
    }
  });

  it("reprend un identifiant et une source valides seulement avec le consentement", () => {
    const avecConsentement = executerMesure("fp_analytics_consent=accepted");
    expect(avecConsentement.contexte.__visitorId).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(avecConsentement.contexte.__source).toBe("smartlead");
    expect(JSON.parse(avecConsentement.requetes[0].options.body)).toMatchObject({
      etape: "signup_started",
      visiteurId: "123e4567-e89b-42d3-a456-426614174000",
      source: "smartlead",
    });

    const sansConsentement = executerMesure("fp_analytics_consent=refused");
    expect(sansConsentement.contexte.__visitorId).toBe("");
    expect(sansConsentement.stockage.has("fp_vid")).toBe(false);
    expect(sansConsentement.requetes).toHaveLength(0);
  });

  it("ignore les identifiants et sources reçus qui ne respectent pas les formats attendus", () => {
    const debut = PAGE.indexOf("var FP_TRACKING_SOURCES =");
    const helper = PAGE.slice(debut, PAGE.indexOf("function fpIngestAttribution()", debut));
    const contexte: Record<string, unknown> = {};
    new Script(`${helper}\nglobalThis.__validId = fpValidVisitorId('not-an-id');\nglobalThis.__validSource = fpValidSource('customer@example.com');`)
      .runInNewContext(contexte);
    expect(contexte.__validId).toBe(false);
    expect(contexte.__validSource).toBe(false);
  });

  it("le Checkout transmet le meme identifiant uniquement avec consentement", () => {
    const attribution = executerAttributionCheckout(
      "fp_analytics_consent=accepted",
      "123e4567-e89b-42d3-a456-426614174000",
      "smartlead",
    );
    expect(attribution).toEqual({
      visiteurId: "123e4567-e89b-42d3-a456-426614174000",
      source: "smartlead",
    });
    expect(executerAttributionCheckout(
      "fp_analytics_consent=refused",
      "123e4567-e89b-42d3-a456-426614174000",
      "smartlead",
    )).toEqual({});
    expect(executerAttributionCheckout(
      "fp_analytics_consent=accepted",
      "not-an-id",
      "not-a-source",
    )).toEqual({});
  });

  it("checkout_started est ajouté après le PaymentIntent existant, avec consentement et idempotence", () => {
    const creation = PAYMENT_INTENT_ROUTE.indexOf("const pi = await stripe.paymentIntents.create");
    const emission = PAYMENT_INTENT_ROUTE.indexOf('etape: "checkout_started"', creation);
    expect(creation).toBeGreaterThan(-1);
    expect(emission).toBeGreaterThan(creation);
    const bloc = PAYMENT_INTENT_ROUTE.slice(creation, PAYMENT_INTENT_ROUTE.indexOf("if (hasPlan) {", creation));
    expect(PAYMENT_INTENT_ROUTE).toContain("...metadataAttributionFunnel(");
    expect(bloc).toContain("cleIdempotence: `checkout_started:${pi.id}`");
    expect(bloc).toContain("const _funnelAttribution = lireAttributionFunnel(metadata)");
    expect(bloc).toContain("if (_funnelAttribution)");
    expect(bloc.match(/stripe\.paymentIntents\.create/g)).toHaveLength(1);
  });

  it("checkout_started est aussi ajouté après le SetupIntent de l'essai, avec consentement et idempotence", () => {
    const creation = PAYMENT_INTENT_ROUTE.indexOf("const si = await stripe.setupIntents.create");
    const emission = PAYMENT_INTENT_ROUTE.indexOf('etape: "checkout_started"', creation);
    expect(creation).toBeGreaterThan(-1);
    expect(emission).toBeGreaterThan(creation);
    const bloc = PAYMENT_INTENT_ROUTE.slice(creation, PAYMENT_INTENT_ROUTE.indexOf("logger.info({ plan: planKey, hasCustomer", creation));
    expect(bloc).toContain("cleIdempotence: `checkout_started:${si.id}`");
    expect(bloc).toContain("const _setupFunnelAttribution = lireAttributionFunnel(metadata)");
    expect(bloc).toContain("if (_setupFunnelAttribution)");
  });

  it("checkout_completed suit les intents réels et garde le visiteur jusqu'aux abonnements", () => {
    const webhook = readFileSync(join(process.cwd(), "src/routes/stripe-webhook.ts"), "utf8");
    const sessionCase = webhook.indexOf('case "checkout.session.completed"');
    const checkoutCompleted = webhook.indexOf('etape: "checkout_completed"', sessionCase);
    const intentCase = webhook.indexOf('case "payment_intent.succeeded":');
    const intentCompleted = webhook.indexOf('etape: "checkout_completed"', intentCase);
    const subscriptionCase = webhook.indexOf('case "customer.subscription.created":');
    const trialActivated = webhook.indexOf('"trial_activated"', subscriptionCase);
    expect(sessionCase).toBeGreaterThan(-1);
    expect(checkoutCompleted).toBeGreaterThan(sessionCase);
    expect(intentCase).toBeGreaterThan(-1);
    expect(intentCompleted).toBeGreaterThan(intentCase);
    expect(webhook).toContain('case "setup_intent.succeeded":');
    expect(webhook).toContain("lireAttributionFunnel(piMeta)");
    expect(subscriptionCase).toBeGreaterThan(-1);
    expect(trialActivated).toBeGreaterThan(subscriptionCase);
    expect(webhook).toContain("visiteurId: _attribution?.visiteurId ?? null");

    const billing = readFileSync(join(process.cwd(), "src/routes/public-billing.ts"), "utf8");
    expect(billing).toContain("metadataAttributionFunnel(");
    expect(billing).toContain('intentMeta["fp_visitor_id"]');
  });
});

describe("la mesure ne peut pas nuire", () => {
  it("l'emission n'est jamais attendue, et ses erreurs sont avalees", () => {
    const i = PAGE.indexOf("function fpEtape(");
    const fn = PAGE.slice(i, i + 700);
    expect(fn, "l'emission est attendue — elle pourrait retarder la page").not.toContain("await ");
    expect(fn, "une erreur reseau remonterait a l'utilisateur").toContain(".catch(");
    expect(fn).toContain("try");
  });

  it("chaque helper tolere un stockage indisponible (navigation privee)", () => {
    for (const nom of ["fpVid", "fpSource", "fpEtape"]) {
      const i = PAGE.indexOf(`function ${nom}(`);
      expect(i, `${nom} a disparu`).toBeGreaterThan(-1);
      expect(PAGE.slice(i, i + 700), `${nom} ne protege pas son acces`).toContain("catch");
    }
  });

  it("tous les scripts en ligne restent syntaxiquement valides", () => {
    const blocs = blocsEnLigne();
    expect(blocs.length).toBeGreaterThan(0);
    for (const [i, b] of blocs.entries()) {
      expect(() => new Script(b), `le bloc ${i} ne compile plus`).not.toThrow();
    }
  });
});

describe("LE FORMULAIRE N'A PAS ETE MODIFIE", () => {
  it("les sept champs obligatoires et leurs validations sont intacts", () => {
    // Contrainte explicite : ne pas toucher au formulaire. La mesure est
    // purement additive, ce test l'atteste.
    for (const champ of ["firstName", "lastName", "email", "companyName",
                         "address", "city", "postalCode"]) {
      expect(PAGE, `le champ ${champ} a disparu`).toContain(`val('${champ}')`);
    }
    for (const message of ["Le prénom est requis.", "Le nom est requis.",
                           "Adresse email invalide.", "Le pays est requis.",
                           "L'adresse est requise.", "La ville est requise.",
                           "Le code postal est requis."]) {
      expect(PAGE, `la validation « ${message} » a disparu`).toContain(message);
    }
  });

  it("la carte bancaire reste exigee : le parcours passe toujours par Checkout", () => {
    expect(PAGE).toContain("/api/auth/pre-register");
    expect(PAGE, "un chemin d'essai sans Checkout est apparu").not.toContain("skip_checkout");
  });
});

describe("attribution commerciale respecte le consentement", () => {
  const visiteur = "123e4567-e89b-42d3-a456-426614174000";

  it("ne conserve aucune attribution sans consentement accepté", () => {
    expect(normaliserAttributionFunnel("refused", visiteur, "google")).toBeNull();
    expect(metadataAttributionFunnel("unknown", visiteur, "google")).toEqual({});
  });

  it("valide le visiteur et normalise la source autorisée", () => {
    expect(normaliserAttributionFunnel("accepted", visiteur, "google")).toEqual({ visiteurId: visiteur, source: "google" });
    expect(normaliserAttributionFunnel("accepted", "not-an-id", "google")).toBeNull();
    expect(normaliserAttributionFunnel("accepted", visiteur, "email@example.com")).toEqual({ visiteurId: visiteur, source: null });
  });

  it("propage seulement l'attribution consentie", () => {
    const metadata = metadataAttributionFunnel("accepted", visiteur, "smartlead");
    expect(metadata).toEqual({ fp_analytics_consent: "accepted", fp_visitor_id: visiteur, fp_source: "smartlead" });
    expect(lireAttributionFunnel(metadata)).toEqual({ visiteurId: visiteur, source: "smartlead" });
    expect(lireAttributionFunnel({ fp_visitor_id: visiteur, fp_source: "google" })).toBeNull();
  });
});
