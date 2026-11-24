/**
 * addon-catalog-reference.test.ts — TEST BLOQUANT du catalogue d'add-ons.
 *
 * `addon-catalog.reference.json` (meme dossier) est la liste VALIDEE des add-ons,
 * reconstituee depuis l'historique (voir `baseline`, `changes`, `source`). Ce test
 * exige que lib/plans.ts, l'API /plans/catalog, le devis et les listes du front
 * (dashboard Billing, pricing.html) soient EXACTEMENT conformes a ce fichier :
 *
 *   - ajouter, retirer ou renommer une cle        -> mettre a jour le JSON (et citer la source) ;
 *   - changer un statut / un prix / un plan        -> idem, deliberement ;
 *   - un add-on « coming soon » (ou retire) ne doit JAMAIS etre achetable ni activable ;
 *   - aucune cle ni aucun libelle en double ;
 *   - toute cle du front doit exister dans la reference.
 *
 * Ne PAS regenerer le JSON pour « faire passer » le test : toute divergence doit
 * etre une decision documentee (champ `source`, `changes`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import * as plansModule from "./plans.js";
import { createBillingQuote } from "../services/billing-quote.js";
import plansRouter from "../routes/plans.js";

vi.hoisted(() => {
  process.env["STRIPE_TEST_MODE"] = "false";
});

vi.mock("../services/stripe-factory.js", () => ({
  getStripeKey: vi.fn(() => "sk_live_catalog_fixture"),
  isStripeTestMode: vi.fn(() => false),
  createStripeClient: vi.fn(async () => null),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = plansModule as unknown as Record<string, any>;

interface RefEntry {
  key: string;
  label: string;
  type: string;
  status: string;
  plansAllowed: string[];
  plansIncluded: string[];
  price: { amountMinor: number; currency: string; interval: string };
  quantity: boolean;
  inBranch: boolean;
  gating?: string;
  source: string;
  validatedTarget?: string;
  validatedPlansAllowed?: string[];
  validatedPlansIncluded?: string[];
  grandfatheredIncluded?: string[];
  deviationReason?: string;
}

interface UiExpectation {
  expectedCards: { priceGateClosed: number; priceGateOpen: number };
  expectedByPlan: Record<
    "priceGateOpen" | "priceGateClosed",
    Record<string, { included: number; soon: number; enable: number; planUnavailable: number }>
  >;
  noBillingCard: Record<string, string>;
  notCardsBecauseNotInBranch: string[];
}

const reference = JSON.parse(
  readFileSync(fileURLToPath(new URL("./addon-catalog.reference.json", import.meta.url)), "utf8"),
) as { version: number; addons: RefEntry[]; ui: UiExpectation };

const dashboardSources = [
  ["src/frontend/dashboard.js", "../../../../src/frontend/dashboard.js"],
  ["artifacts/flowpoint-export/dashboard.js", "../../../flowpoint-export/dashboard.js"],
].map(([name, rel]) => ({
  name: name as string,
  text: readFileSync(fileURLToPath(new URL(rel as string, import.meta.url)), "utf8"),
}));
const pricingHtml = readFileSync(
  fileURLToPath(new URL("../../../flowpoint-export/pricing.html", import.meta.url)),
  "utf8",
);

const PLANS = ["standard", "pro", "ultra"] as const;
const refByKey = new Map(reference.addons.map((e) => [e.key, e]));
const inBranch = reference.addons.filter((e) => e.inBranch);

function openPriceGatedAddons(): void {
  const gated = P["PRICE_GATED_ADDONS"] as Record<string, { priceEnvVar: string }> | undefined;
  if (!gated || typeof P["applyPriceGatedAddons"] !== "function") return;
  const env: Record<string, string> = {};
  for (const [key, g] of Object.entries(gated)) env[g.priceEnvVar] = `price_reference_fixture_${key}`;
  P["applyPriceGatedAddons"](env, false);
}

function statusOf(key: string): string {
  if ((P["REMOVED_ADDONS"] as Set<string>).has(key)) return "removed";
  if ((P["RETIRED_ADDONS"] as Set<string> | undefined)?.has(key)) return "retired";
  return P["getAddonAvailability"](key) as string;
}

beforeAll(() => {
  openPriceGatedAddons();
});

describe("catalogue d'add-ons : reference versionnee", () => {
  it("la reference est bien formee (cles et libelles uniques, champs obligatoires)", () => {
    expect(reference.version).toBe(1);
    const keys = reference.addons.map((e) => e.key);
    expect(new Set(keys).size, "cle en double dans la reference").toBe(keys.length);
    const labels = reference.addons.map((e) => e.label.trim().toLowerCase());
    expect(new Set(labels).size, "libelle en double dans la reference").toBe(labels.length);
    for (const e of reference.addons) {
      expect(["feature", "capacity", "ai-credits", "retention", "seats"], `${e.key} type`).toContain(e.type);
      expect(["available", "coming_soon", "beta", "retired", "removed"], `${e.key} status`).toContain(e.status);
      expect(e.source.trim().length, `${e.key} doit citer sa source`).toBeGreaterThan(20);
      expect(e.price.currency).toBe("EUR");
      expect(["month", "one_time"]).toContain(e.price.interval);
    }
  });

  it("tout ecart avec la cible validee est documente", () => {
    for (const e of reference.addons) {
      const hasDeviation =
        e.validatedTarget !== undefined ||
        e.validatedPlansAllowed !== undefined ||
        e.validatedPlansIncluded !== undefined;
      if (hasDeviation) expect(e.deviationReason?.length ?? 0, `${e.key} : deviationReason`).toBeGreaterThan(30);
    }
  });

  it("l'ensemble des cles de lib/plans.ts est exactement celui de la reference (aucun ajout, aucun retrait)", () => {
    const codeKeys = Object.keys(P["ADDON_DEFINITIONS"]).sort();
    expect(codeKeys).toEqual(inBranch.map((e) => e.key).sort());
    for (const e of reference.addons.filter((x) => !x.inBranch)) {
      expect(codeKeys, `${e.key} est declare « pas encore porte » : il ne doit pas etre dans le code`).not.toContain(e.key);
    }
  });

  it("libelle, prix, periodicite et quantite correspondent a la reference", () => {
    for (const e of inBranch) {
      const def = P["ADDON_DEFINITIONS"][e.key];
      expect(def.name, `${e.key} libelle`).toBe(e.label);
      expect(Math.round(def.priceEur * 100), `${e.key} prix`).toBe(e.price.amountMinor);
      expect(def.oneTime ? "one_time" : "month", `${e.key} periodicite`).toBe(e.price.interval);
      expect(Boolean(def.quantity), `${e.key} quantite`).toBe(e.quantity);
    }
  });

  it("statut, plans autorises a l'achat et plans inclus correspondent a la reference", () => {
    for (const e of inBranch) {
      expect(statusOf(e.key), `${e.key} statut`).toBe(e.status);
      const allowed = PLANS.filter((p) => P["isPlanAllowedAddon"](p, e.key));
      expect(allowed, `${e.key} plans autorises`).toEqual(e.plansAllowed);
      const included = PLANS.filter((p) => (P["PLAN_INCLUDED_ADDONS"][p] as Set<string>)?.has(e.key));
      expect(included, `${e.key} plans inclus`).toEqual(e.plansIncluded);
    }
  });

  it("les cles retirees restent reconnues (droits historiques) mais ne sont jamais vendues", () => {
    for (const e of inBranch.filter((x) => x.status === "removed" || x.status === "retired")) {
      expect(P["ADDON_DEFINITIONS"][e.key], `${e.key} reste defini`).toBeDefined();
      expect(e.plansAllowed, `${e.key} non achetable`).toEqual([]);
    }
  });
});

describe("catalogue d'add-ons : coming soon / retire jamais activable ni achetable", () => {
  const blocked = () => inBranch.filter((e) => ["coming_soon", "retired", "removed"].includes(e.status));

  it("le devis (chemin unique de checkout) refuse chacun d'eux", () => {
    expect(blocked().length).toBeGreaterThan(0);
    for (const e of blocked()) {
      expect(
        () => createBillingQuote({ plan: "pro", addons: { [e.key]: true } } as never),
        `${e.key} (${e.status}) ne doit pas etre facturable`,
      ).toThrow(/ADDON_(COMING_SOON|VALIDATION_REQUIRED|RETIRED|REMOVED)/);
    }
  });

  it("aucun plan n'est vendeur de l'un d'eux (getAddonPurchasablePlans / purchaseStatus)", () => {
    for (const e of blocked()) {
      if (typeof P["getAddonPurchasablePlans"] === "function") {
        expect(P["getAddonPurchasablePlans"](e.key), `${e.key} plans vendeurs`).toEqual([]);
      }
      if (typeof P["getAddonPurchaseStatus"] === "function") {
        expect(P["getAddonPurchaseStatus"](e.key), `${e.key} purchaseStatus`).not.toBe("purchasable");
      }
    }
  });

  it("/api/plans/catalog publie exactement les cles non retirees, avec le statut de la reference", async () => {
    const app = express();
    app.use(plansRouter);
    const res = await request(app).get("/plans/catalog").expect(200);
    const addons = res.body.addons as Array<{
      key: string;
      status: string;
      comingSoon: boolean;
      priceMinor: number;
      allowedPlans: string[];
      purchaseStatus?: string;
    }>;
    const published = addons.map((a) => a.key).sort();
    const expected = inBranch
      .filter((e) => e.status !== "removed" && e.status !== "retired")
      .map((e) => e.key)
      .sort();
    expect(published).toEqual(expected);
    expect(new Set(published).size).toBe(published.length);
    for (const a of addons) {
      const ref = refByKey.get(a.key) as RefEntry;
      expect(a.status, `${a.key} statut catalogue`).toBe(ref.status);
      expect(a.priceMinor, `${a.key} prix catalogue`).toBe(ref.price.amountMinor);
      expect(a.comingSoon, `${a.key} comingSoon`).toBe(ref.status === "coming_soon");
      if (ref.status === "coming_soon") {
        expect(a.allowedPlans, `${a.key} coming soon sans plan vendeur`).toEqual([]);
        if (a.purchaseStatus !== undefined) expect(a.purchaseStatus).not.toBe("purchasable");
      }
    }
  });
});

describe("catalogue d'add-ons : listes du front (Billing / pricing)", () => {
  it("les cartes add-on du dashboard Billing n'ont ni cle ni libelle en double et sont incluses dans la reference", () => {
    for (const { name, text } of dashboardSources) {
      const match = text.match(/const allAddons = \[([\s\S]*?)\n\s*\];/);
      expect(match, `${name} : liste allAddons introuvable`).not.toBeNull();
      const block = match?.[1] ?? "";
      const keys = [...block.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1] as string);
      const names = [...block.matchAll(/\{\s*key:\s*'[^']+'[^}]*?\bname:\s*'([^']+)'/g)].map((m) =>
        (m[1] as string).trim().toLowerCase(),
      );
      expect(keys.length, `${name} : cartes trouvees`).toBeGreaterThan(20);
      expect(new Set(keys).size, `${name} : cle en double`).toBe(keys.length);
      expect(new Set(names).size, `${name} : libelle en double`).toBe(names.length);
      const unknown = keys.filter((k) => !refByKey.has(k) || !refByKey.get(k)?.inBranch);
      expect(unknown, `${name} : cles du front absentes de la reference`).toEqual([]);
      const hidden = keys.filter((k) => ["removed", "retired"].includes(refByKey.get(k)?.status ?? ""));
      expect(hidden, `${name} : add-ons retires affiches comme cartes vendables`).toEqual([]);
    }
  });

  it("le front ne contient aucune classification locale coming soon / beta (le serveur fait foi)", () => {
    for (const { name, text } of dashboardSources) {
      expect(text, `${name} : _COMING_SOON_KEYS code en dur`).not.toMatch(/_COMING_SOON_KEYS\s*=\s*new Set/);
      expect(text, `${name} : _BETA_KEYS code en dur`).not.toMatch(/_BETA_KEYS\s*=\s*new Set/);
    }
  });

  it("pricing.html ne reference que des cles de la reference", () => {
    const keys = [...pricingHtml.matchAll(/<button[^>]*onclick="addToCart\(this,\s*'([A-Za-z0-9]+)'/g)].map((m) => m[1] as string);
    expect(keys.length).toBeGreaterThan(10);
    const unknown = keys.filter((k) => !refByKey.has(k) || !refByKey.get(k)?.inBranch);
    expect(unknown, "cles de pricing.html absentes de la reference").toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cartes REELLEMENT affichees (Billing > Add-ons) : verrou du nombre et des etats
// ─────────────────────────────────────────────────────────────────────────────
function cardsOf(text: string): Array<{ key: string; gated: boolean }> {
  const match = text.match(/const allAddons = \[([\s\S]*?)\n\s*\];/);
  const block = match?.[1] ?? "";
  return [...block.matchAll(/\{\s*key:\s*'([^']+)'([^\n]*?)(?:,\s*cat:)/g)].map((m) => ({
    key: m[1] as string,
    gated: /gated:\s*true/.test(m[2] as string),
  }));
}

type CardState = "included" | "soon" | "enable" | "planUnavailable";

/** Etat d'une carte pour un plan, derive UNIQUEMENT de la reference (jamais d'une liste locale). */
function cardState(e: RefEntry, plan: string): CardState {
  if (e.status === "coming_soon") return "soon";
  if (e.plansIncluded.includes(plan)) return "included";
  if (e.plansAllowed.includes(plan)) return "enable";
  return "planUnavailable";
}

describe("catalogue d'add-ons : cartes Billing reellement affichees", () => {
  const gatedKeys = new Set(Object.keys((P["PRICE_GATED_ADDONS"] as Record<string, unknown>) ?? {}));

  it("les deux dashboards affichent exactement les memes cartes, dans le meme ordre", () => {
    const [a, b] = dashboardSources.map((d) => cardsOf(d.text).map((c) => c.key));
    expect(a).toEqual(b);
  });

  it("nombre de cartes attendu (garde prix fermee / ouverte) = reference ui.expectedCards", () => {
    for (const { name, text } of dashboardSources) {
      const cards = cardsOf(text);
      expect(cards.length, `${name} : cartes (garde prix ouverte)`).toBe(reference.ui.expectedCards.priceGateOpen);
      expect(cards.filter((c) => !c.gated).length, `${name} : cartes (garde prix fermee)`).toBe(
        reference.ui.expectedCards.priceGateClosed,
      );
      // Seules les cles « garde prix » peuvent disparaitre de la grille.
      for (const c of cards.filter((x) => x.gated)) expect(gatedKeys.has(c.key), `${name} : ${c.key} gated`).toBe(true);
      for (const k of gatedKeys) expect(cards.find((c) => c.key === k)?.gated, `${name} : ${k} doit etre marque gated`).toBe(true);
    }
  });

  it("tout add-on achetable a une carte ; seules les exceptions documentees n'en ont pas", () => {
    const cardKeys = new Set(cardsOf(dashboardSources[1]!.text).map((c) => c.key));
    const buyable = inBranch.filter(
      (e) => (e.status === "available" || e.status === "beta") && e.plansAllowed.length > 0,
    );
    const exempt = reference.ui.noBillingCard;
    for (const e of buyable) {
      if (cardKeys.has(e.key)) continue;
      expect(e.key in exempt, `${e.key} est achetable mais n'a AUCUNE carte Billing (ni exception documentee)`).toBe(true);
      expect(e.type, `${e.key} : exception reservee aux packs de credits IA`).toBe("ai-credits");
      expect(pricingHtml, `${e.key} doit etre achetable depuis pricing.html`).toContain(`'${e.key}'`);
    }
    for (const [k, why] of Object.entries(exempt)) {
      expect(cardKeys.has(k), `${k} a finalement une carte : retirer l'exception`).toBe(false);
      expect(why.length).toBeGreaterThan(30);
    }
    // Les cles validees mais non portees n'ont evidemment pas de carte.
    const notPorted = reference.addons.filter((e) => !e.inBranch).map((e) => e.key).sort();
    expect([...reference.ui.notCardsBecauseNotInBranch].sort()).toEqual(notPorted);
    for (const k of notPorted) expect(cardKeys.has(k), `${k} non porte : pas de carte`).toBe(false);
    // Les cles retirees n'ont pas de carte.
    for (const e of inBranch.filter((x) => x.status === "removed" || x.status === "retired")) {
      expect(cardKeys.has(e.key), `${e.key} (${e.status}) ne doit pas avoir de carte`).toBe(false);
    }
  });

  it("repartition par plan (inclus / bientot / activable / indisponible) = reference ui.expectedByPlan", () => {
    const all = cardsOf(dashboardSources[1]!.text);
    for (const [gateMode, cards] of [
      ["priceGateOpen", all],
      ["priceGateClosed", all.filter((c) => !c.gated)],
    ] as const) {
      for (const plan of PLANS) {
        const counts = { included: 0, soon: 0, enable: 0, planUnavailable: 0 };
        for (const c of cards) counts[cardState(refByKey.get(c.key) as RefEntry, plan)]++;
        expect(counts, `${gateMode} / ${plan}`).toEqual(reference.ui.expectedByPlan[gateMode][plan]);
        expect(counts.included + counts.soon + counts.enable + counts.planUnavailable).toBe(cards.length);
      }
    }
  });

  it("aucune carte « coming soon » n'est activable : coming soon prime sur tout bouton (Activer, Lancer)", () => {
    for (const { name, text } of dashboardSources) {
      const section = text.slice(text.indexOf("SUB: ADD-ONS MARKETPLACE"));
      const card = section.slice(section.indexOf("ADD-ONS GRID"), section.indexOf("SUB: FACTURES"));
      const iSoon = card.indexOf("a.availability === 'coming_soon'\n                    ? `<button");
      const iWizard = card.indexOf("a.wizardFn\n                        ?");
      expect(iSoon, `${name} : branche coming soon de la carte`).toBeGreaterThan(-1);
      expect(iWizard, `${name} : branche wizard de la carte`).toBeGreaterThan(iSoon);
      expect(card, `${name} : un plan non autorise ne doit pas avoir de bouton Activer`).toContain("isPlanBlocked(a)");
      // L'index passe a fpShowAddonDetail / fpActivateAddon est celui de la liste complete.
      expect(card, `${name} : index de liste filtree`).not.toContain("fpShowAddonDetail(${_i})");
    }
  });

  it("le front ne force plus aucun droit local : pas d'exception retention90d, allowedPlans issu du catalogue", () => {
    for (const { name, text } of dashboardSources) {
      expect(text, `${name} : retention90d masque sur Ultra`).not.toMatch(/a\.key === 'retention90d' && planLevel >= 2/);
      expect(text, `${name} : allowedPlans du catalogue`).toContain("a.allowedPlans   = d && Array.isArray(d.allowedPlans)");
    }
  });
});

describe("catalogue d'add-ons : matrice officielle des inclusions et droits acquis", () => {
  it("Standard 1 / Pro 6 / Ultra 10 ; Ultra herite des six inclusions Pro", () => {
    const inc = (plan: string) => [...(P["PLAN_INCLUDED_ADDONS"][plan] as Set<string>)].sort();
    expect(inc("standard")).toHaveLength(1);
    expect(inc("pro")).toHaveLength(6);
    expect(inc("ultra")).toHaveLength(10);
    for (const k of inc("pro")) expect(inc("ultra"), `Ultra doit heriter de ${k}`).toContain(k);
    expect(inc("ultra")).toContain("retention90d");
    expect(inc("ultra")).not.toContain("keywordDomination");
    expect(inc("pro")).not.toContain("keywordDomination");
  });

  it("keywordDomination : achat separe Pro/Ultra uniquement, jamais inclus ; droit Ultra historique preserve", () => {
    const kd = refByKey.get("keywordDomination") as RefEntry;
    expect(kd.plansAllowed).toEqual(["pro", "ultra"]);
    expect(kd.plansIncluded).toEqual([]);
    expect(kd.grandfatheredIncluded).toEqual(["ultra"]);
    expect([...(P["GRANDFATHERED_INCLUDED_ADDONS"]["ultra"] as Set<string>)]).toEqual(["keywordDomination"]);
    // Organisation anterieure a la bascule : conserve ; posterieure ou date inconnue : matrice.
    expect(P["getIncludedAddonsForOrg"]("ultra", "2026-10-01T00:00:00Z").has("keywordDomination")).toBe(true);
    expect(P["getIncludedAddonsForOrg"]("ultra", new Date("2026-11-24T10:00:00Z")).has("keywordDomination")).toBe(true);
    expect(P["getIncludedAddonsForOrg"]("ultra", "2026-11-25T00:00:00Z").has("keywordDomination")).toBe(false);
    expect(P["getIncludedAddonsForOrg"]("ultra", null).has("keywordDomination")).toBe(false);
    expect(P["getIncludedAddonsForOrg"]("pro", "2026-01-01T00:00:00Z").has("keywordDomination")).toBe(false);
    expect(P["getIncludedAddonsForOrg"]("standard", "2026-01-01T00:00:00Z").has("keywordDomination")).toBe(false);
    // Jamais de droit retire : toute inclusion du plan reste incluse pour une organisation ancienne.
    for (const plan of PLANS) {
      const grand = P["getIncludedAddonsForOrg"](plan, "2026-01-01T00:00:00Z") as Set<string>;
      for (const k of P["PLAN_INCLUDED_ADDONS"][plan] as Set<string>) expect(grand.has(k)).toBe(true);
    }
  });

  it("retention90d : incluse Pro, heritee par Ultra, achetable Standard", () => {
    const r = refByKey.get("retention90d") as RefEntry;
    expect(r.plansIncluded).toEqual(["pro", "ultra"]);
    expect(r.plansAllowed).toEqual(["standard", "pro", "ultra"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// aiWorkspaceLaunch : RETIRE DEFINITIVEMENT (arbitrage du proprietaire, 24/11/2026)
// TEST BLOQUANT : l'add-on ne doit JAMAIS reapparaitre dans l'offre commerciale.
// Seule trace autorisee : sa definition + l'entree REMOVED_ADDONS dans lib/plans.ts
// (reconnaissance des lignes historiques, activation -> 410 comme prioritySupport).
// ─────────────────────────────────────────────────────────────────────────────
describe("aiWorkspaceLaunch : retire definitivement de l'offre commerciale (BLOQUANT)", () => {
  const KEY = "aiWorkspaceLaunch";
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const plansSource = read("./plans.ts");
  const flowpointExport = (name: string) => read(`../../../flowpoint-export/${name}`);

  it("la reference le marque 'removed' (source : arbitrage du proprietaire), sans plan ni prix vendable", () => {
    const e = refByKey.get(KEY) as RefEntry;
    expect(e, "entree de reference conservee (cle reconnue comme retiree)").toBeDefined();
    expect(e.status).toBe("removed");
    expect(e.plansAllowed).toEqual([]);
    expect(e.plansIncluded).toEqual([]);
    expect(e.inBranch).toBe(true);
    expect(e.source).toMatch(/arbitrage du propri[ée]taire 24\/11\/2026/i);
    expect(reference.ui.noBillingCard[KEY]).toBeUndefined();
  });

  it("lib/plans.ts : reconnu comme retire, absent de toute liste commerciale (statuts, plans, inclusions, prix)", () => {
    expect((P["REMOVED_ADDONS"] as Set<string>).has(KEY)).toBe(true);
    expect(statusOf(KEY)).toBe("removed");
    expect((P["COMING_SOON_ADDONS"] as Set<string>).has(KEY), "COMING_SOON_ADDONS").toBe(false);
    expect((P["BETA_ADDONS"] as Set<string>).has(KEY), "BETA_ADDONS").toBe(false);
    expect((P["FLAG_ADDONS"] as Set<string>).has(KEY), "FLAG_ADDONS").toBe(false);
    expect(Object.keys(P["PRICE_GATED_ADDONS"] ?? {}), "PRICE_GATED_ADDONS").not.toContain(KEY);
    expect(Object.keys(P["ADDON_PRICE_IDS"] ?? {}), "ADDON_PRICE_IDS").not.toContain(KEY);
    expect(Object.keys(P["ADDON_PRICE_IDS_TEST"] ?? {}), "ADDON_PRICE_IDS_TEST").not.toContain(KEY);
    for (const plan of [...PLANS, "agency"]) {
      expect((P["PLAN_ALLOWED_ADDONS"][plan] as Set<string> | undefined)?.has(KEY), `${plan} : achat`).toBeFalsy();
      expect((P["PLAN_INCLUDED_ADDONS"][plan] as Set<string> | undefined)?.has(KEY), `${plan} : inclusion`).toBeFalsy();
      expect(P["isPlanAllowedAddon"](plan, KEY), `${plan} : isPlanAllowedAddon`).toBe(false);
    }
    for (const set of Object.values(P["GRANDFATHERED_INCLUDED_ADDONS"] ?? {}) as Array<Set<string>>) {
      expect(set.has(KEY), "droit acquis").toBe(false);
    }
  });

  it("lib/plans.ts (source) : aucune variable d'environnement de prix, aucune autre occurrence que la definition et REMOVED_ADDONS", () => {
    expect(plansSource).not.toMatch(/AI_WORKSPACE_LAUNCH/);
    expect(plansSource).not.toMatch(/ai_workspace_launch/i);
    const code = plansSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
    const lines = code.split("\n").filter((l) => l.includes(KEY));
    const unexpected = lines.filter(
      (l) => !/^\s*aiWorkspaceLaunch:\s*\{\s*name:/.test(l) && !/REMOVED_ADDONS\s*=\s*new Set/.test(l),
    );
    expect(unexpected, "occurrence inattendue de aiWorkspaceLaunch dans lib/plans.ts").toEqual([]);
    expect(lines.length, "definition + REMOVED_ADDONS").toBe(2);
  });

  it("le devis refuse toujours la cle avec ADDON_REMOVED (jamais 'coming soon'), sur chaque plan", () => {
    for (const plan of PLANS) {
      expect(() => createBillingQuote({ plan, addons: { [KEY]: true } } as never)).toThrow("ADDON_REMOVED");
    }
  });

  it("/api/plans/catalog ne le liste pas du tout", async () => {
    const app = express();
    app.use(plansRouter);
    const res = await request(app).get("/plans/catalog").expect(200);
    const keys = (res.body.addons as Array<{ key: string }>).map((a) => a.key);
    expect(keys).not.toContain(KEY);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(JSON.stringify(res.body)).not.toContain("AI Workspace Launch");
  });

  it("Billing (dashboards) : aucune carte, aucune reference a la cle (hors assistant historique)", () => {
    for (const { name, text } of dashboardSources) {
      expect(text, `${name} : cle ${KEY}`).not.toContain(KEY);
      expect(text, `${name} : libelle`).not.toMatch(/name:\s*'AI Workspace Launch'/);
      expect(text, `${name} : wizardFn`).not.toMatch(/wizardFn:\s*'openAIWorkspaceLaunch'/);
      expect(cardsOf(text).map((c) => c.key), `${name} : cartes`).not.toContain(KEY);
    }
  });

  it("pricing.html, success.html, cancel.html et fp-locale.js : plus aucune offre AI Workspace Launch", () => {
    for (const file of ["pricing.html", "success.html", "cancel.html", "fp-locale.js"]) {
      const text = flowpointExport(file);
      expect(text, `${file} : cle ${KEY}`).not.toContain(KEY);
      expect(text, `${file} : libelle`).not.toContain("AI Workspace Launch");
      expect(text, `${file} : texte commercial`).not.toContain("Démarrez en 48h avec un workspace");
    }
  });

  it("le catalogue de certification Stripe (stripe-cert-setup.cjs) ne cree plus de produit pour cette cle", () => {
    expect(read("../../stripe-cert-setup.cjs")).not.toContain(KEY);
  });
});
