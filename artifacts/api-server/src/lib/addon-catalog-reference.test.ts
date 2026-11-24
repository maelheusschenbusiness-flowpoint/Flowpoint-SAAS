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
  deviationReason?: string;
}

const reference = JSON.parse(
  readFileSync(fileURLToPath(new URL("./addon-catalog.reference.json", import.meta.url)), "utf8"),
) as { version: number; addons: RefEntry[] };

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
      const block = text.match(/const allAddons = \[([\s\S]*?)\n\s*\];/)?.[1] ?? "";
      const cardKeys = [...block.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1]);
      expect(cardKeys, `${name} : cartes`).not.toContain(KEY);
    }
  });

  it("pricing.html, success.html et cancel.html : plus aucune offre AI Workspace Launch", () => {
    for (const file of ["pricing.html", "success.html", "cancel.html"]) {
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
