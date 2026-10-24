import { getStripeKey } from "../services/stripe-factory.js";
export interface PlanLimits {
  audits: number;
  monitors: number;
  reports: number;
  exports: number;
  teamMembers: number;
  workspaces: number;
  retention: number;
}

export interface PlanDefinition {
  id: string;
  name: string;
  priceEur: number;
  badge: string;
  tagline: string;
  limits: PlanLimits;
  aiCredits: number;
  aiTokens: number;
  features: string[];
  locked: string[];
}

/* ════════════════════════════════════════════════════════════════════════════
   PLAN_DEFINITIONS — Single source of truth for all plan data.
   Every surface (dashboard, pricing.html, backend, /api/me) reads from here.
   Do NOT duplicate these numbers anywhere else.
   ════════════════════════════════════════════════════════════════════════════ */
export const PLAN_DEFINITIONS: Record<string, PlanDefinition> = {
  standard: {
    id: "standard",
    name: "Standard",
    priceEur: 29,
    badge: "Démarrage",
    tagline: "Pour les indépendants et PME",
    limits: {
      audits: 30,
      monitors: 10,
      reports: 30,
      exports: 30,
      teamMembers: 1,
      workspaces: 1,
      retention: 30,
    },
    aiCredits: 100_000,
    aiTokens: 50_000,
    features: [
      "30 audits/mois", "10 monitors", "30 rapports PDF/mois",
      "30 exports/mois", "1 membre d'équipe", "100 000 crédits IA/mois",
      "Local SEO basique", "Export CSV", "Support email 48h", "White-label",
    ],
    locked: [
      "IA Insights", "API Access",
      "Analytics concurrents", "Multi-workspace",
      "SSO SAML", "Onboarding dédié", "Facturation client",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceEur: 79,
    badge: "Recommandé",
    tagline: "Pour les agences et équipes growth",
    limits: {
      audits: 300,
      monitors: 50,
      reports: 300,
      exports: 300,
      teamMembers: 5,
      workspaces: 5,
      retention: 90,
    },
    aiCredits: 500_000,
    aiTokens: 150_000,
    features: [
      "300 audits/mois", "50 monitors", "300 rapports PDF/mois",
      "300 exports/mois", "5 membres d'équipe", "500 000 crédits IA/mois",
      "IA Insights Pro", "Local SEO avancé", "White-label rapports",
      "API Access", "Support prioritaire 4h", "Analytics concurrents",
    ],
    locked: [
      "Multi-workspace", "SSO SAML",
      "Onboarding dédié", "SLA garanti 99.9%",
    ],
  },
  ultra: {
    id: "ultra",
    name: "Ultra",
    priceEur: 149,
    badge: "Ultra",
    tagline: "Pour les grandes agences et entreprises",
    limits: {
      audits: 1_000,
      monitors: 300,
      reports: 1_000,
      exports: 1_000,
      teamMembers: 10,
      workspaces: 10,
      retention: 365,
    },
    aiCredits: 10_000_000,
    aiTokens: 750_000,
    features: [
      "1 000 audits/mois", "300 monitors", "1 000 rapports PDF/mois",
      "1 000 exports/mois", "10 membres d'équipe", "∞ crédits IA/mois",
      "Multi-workspace", "IA Stratégiste complet", "White-label portail",
      "SSO SAML", "API illimitée", "Custom domain",
      "SLA 99.9% garanti", "Support dédié < 1h", "Rétention 365 jours",
      "Onboarding dédié", "Agency Lab complet", "Facturation client",
    ],
    locked: [],
  },
};

/* ── Derived exports — NEVER hardcode these values elsewhere ── */
export const PLAN_LIMITS: Record<string, PlanLimits> = Object.fromEntries(
  Object.entries(PLAN_DEFINITIONS).map(([k, v]) => [k, v.limits])
);

export const PLAN_AI_CREDITS: Record<string, number> = Object.fromEntries(
  Object.entries(PLAN_DEFINITIONS).map(([k, v]) => [k, v.aiCredits])
);

export const PLAN_AI_TOKENS: Record<string, number> = Object.fromEntries(
  Object.entries(PLAN_DEFINITIONS).map(([k, v]) => [k, v.aiTokens])
);

// ── Plan price IDs (live Stripe — confirmed 23/06/2026) ───────────────────────
// Abonnement Standard 29€/mois | Abonnement Pro 79€/mois | Abonnement Ultra 149€/mois
export const PLAN_PRICE_IDS: Record<string, string> = {
  standard: process.env["STRIPE_PRICE_ID_STANDARD"] ?? "price_1StVzQ9eqtbj6iPBNOLjgwHm",
  pro:      process.env["STRIPE_PRICE_ID_PRO"]      ?? "price_1StW0A9eqtbj6iPB8GcUCuwQ",
  ultra:    process.env["STRIPE_PRICE_ID_ULTRA"]    ?? "price_1StW109eqtbj6iPBgiD1uRtP",
};

// ── Test-mode plan price IDs (Stripe CLI / test dashboard) ───────────────────
// Set these env vars when running webhook tests in Stripe test mode so that
// getPlanForPriceId() can resolve the plan even when metadata.plan is absent.
// In production all FlowPoint checkouts set metadata.plan so this is a safety net only.
export const PLAN_PRICE_IDS_TEST: Record<string, string> = Object.fromEntries(
  Object.entries({
    standard: process.env["STRIPE_TEST_PRICE_ID_STANDARD"] ?? "",
    pro:      process.env["STRIPE_TEST_PRICE_ID_PRO"]      ?? "",
    ultra:    process.env["STRIPE_TEST_PRICE_ID_ULTRA"]    ?? "",
  }).filter(([, v]) => v !== "")
);

// ── Add-on price IDs — test-mode overrides (Stripe CLI / test dashboard) ─────
// Set STRIPE_TEST_PRICE_ID_ADDON_<KEY> to override any addon price in test mode.
// These are resolved at call-time in getAddonPriceId() below.
export const ADDON_PRICE_IDS_TEST: Record<string, string> = Object.fromEntries(
  Object.entries({
    // Keys follow existing Replit secret naming conventions for backward compat.
    monitorsPack10:       process.env["STRIPE_TEST_PRICE_ID_ADDON_MONITORS10"]  // set via Replit secret
                       ?? process.env["STRIPE_TEST_PRICE_ID_10MONITORS"]        ?? "",
    monitorsPack50:       process.env["STRIPE_TEST_PRICE_ID_ADDON_MONITORS50"]
                       ?? process.env["STRIPE_TEST_PRICE_ID_50MONITORS"]        ?? "",
    conversionOpportunityEngine: process.env["STRIPE_TEST_PRICE_ID_ADDON_CONVERSION_OPPORTUNITY"] ?? "",
    seoChangeImpact: "",
    agencyPortfolioPriorities: process.env["STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PORTFOLIO_PRIORITIES"] ?? "",
    technicalSeoFixVerification: "",
    localPresenceOptimizer: process.env["STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE"] ?? "",
    advancedSeoLab:       process.env["STRIPE_TEST_PRICE_ID_ADDON_SEOLA"]       ?? "",
    keywordDomination:    process.env["STRIPE_TEST_PRICE_ID_ADDON_KDE"]         ?? "",
    backlinkIntelligence: process.env["STRIPE_TEST_PRICE_ID_ADDON_BACKLINK"]    ?? "",
    behavioralAI:         process.env["STRIPE_TEST_PRICE_ID_ADDON_BEHAVAI"]     ?? "",
    aiForecasting:        process.env["STRIPE_TEST_PRICE_ID_ADDON_FORECAST"]    ?? "",
    enterprisePermissions:process.env["STRIPE_TEST_PRICE_ID_ADDON_ENT"]         ?? "",
    advancedWebhooks:     process.env["STRIPE_TEST_PRICE_ID_ADDON_WEBHOOKS"]    ?? "",
    retention365d:        process.env["STRIPE_TEST_PRICE_ID_ADDON_RET365"]      ?? "",
    whiteLabel:           process.env["STRIPE_TEST_PRICE_ID_ADDON_WL"]          ?? "",
    customDomain:         process.env["STRIPE_TEST_PRICE_ID_ADDON_CD"]          ?? "",
    extraSeats:           process.env["STRIPE_TEST_PRICE_ID_ADDON_SEATS"]       ?? "",
    gbpSlots10:           process.env["STRIPE_TEST_PRICE_ID_ADDON_GBP10"]       ?? "",
    gbpPerformanceLeads:  process.env["STRIPE_TEST_PRICE_ID_ADDON_GBP_PERFORMANCE"] ?? "",
    localLandingOpportunities: process.env["STRIPE_TEST_PRICE_ID_ADDON_LOCAL_LANDING"] ?? "",
    aiCreditsPack50k:     process.env["STRIPE_TEST_PRICE_AI_50K"]               ?? "",
    aiCreditsPack200k:    process.env["STRIPE_TEST_PRICE_AI_200K"]              ?? "",
    aiCreditsPack500k:    process.env["STRIPE_TEST_PRICE_AI_500K"]              ?? "",
  }).filter(([, v]) => v !== "")
);

/**
 * Returns the correct Stripe price ID for an add-on, respecting test-mode overrides.
 * In test mode (sk_test_ key active) → prefer ADDON_PRICE_IDS_TEST[key].
 * In live mode or when no test override exists → fall back to ADDON_PRICE_IDS[key].
 */
/**
 * Identifiant de prix Stripe du PLAN, conscient du mode.
 *
 * Symetrique de getAddonPriceId() pour les add-ons. Il manquait : tous les
 * appelants lisaient PLAN_PRICE_IDS directement, c'est-a-dire les prix LIVE.
 * En mode test, Stripe refusait donc la creation d'abonnement :
 *   No such price: 'price_1StW0A9…'; a similar object exists in live mode,
 *   but a test mode key was used to make this request.  (resource_missing)
 * PLAN_PRICE_IDS_TEST existait mais n'etait utilise que par la resolution
 * inverse getPlanForPriceId(). Consequence : le parcours payant etait
 * impossible a certifier en mode test.
 *
 * Le mode est resolu par getStripeKey(), le selecteur canonique, sauf si
 * l'appelant fournit explicitement la cle qu'il utilise pour son appel Stripe.
 */
export function getPlanPriceId(plan: string, stripeKey?: string): string | undefined {
  const key = String(plan ?? "").toLowerCase();
  const activeKey = stripeKey ?? getStripeKey();
  const isTestMode = activeKey.startsWith("sk_test_");
  if (isTestMode && PLAN_PRICE_IDS_TEST[key]) return PLAN_PRICE_IDS_TEST[key];
  return PLAN_PRICE_IDS[key] || undefined;
}

/**
 * Les plans dont le prix, en mode test, retombe sur l'identifiant LIVE.
 *
 * MESURE DU 18/10/2026 sur `flowpoint-test`, qui tourne en mode test :
 * `GET /api/billing/plans` renvoyait pour `pro` et `ultra` exactement les
 * identifiants live de `PLAN_PRICE_IDS`. Stripe refuse ces prix avec une cle
 * `sk_test_` — « No such price … a similar object exists in live mode » — donc
 * la creation d'une session Checkout echoue pour ces deux plans, et seul
 * `standard` fonctionne.
 *
 * Le repli sur le prix live est un choix assume (voir `getPlanPriceId` et
 * `plan-price-mode.test.ts`) : mieux vaut un prix que Stripe refuse qu'un
 * `undefined` silencieux. Mais rien ne le signalait avant l'echec cote Stripe.
 * Cette fonction le rend visible, et nomme la variable a poser.
 */
export interface PlanAuPrixLive {
  plan: string;
  priceIdLive: string;
  variableAttendue: string;
}

export function plansRepliantSurPrixLive(stripeKey?: string): PlanAuPrixLive[] {
  const activeKey = stripeKey ?? getStripeKey();
  if (!activeKey.startsWith("sk_test_")) return [];   // hors mode test : rien a dire
  const manquants: PlanAuPrixLive[] = [];
  for (const plan of Object.keys(PLAN_PRICE_IDS)) {
    const prixLive = PLAN_PRICE_IDS[plan];
    if (!prixLive) continue;
    if (PLAN_PRICE_IDS_TEST[plan]) continue;          // un prix de test est pose
    manquants.push({
      plan,
      priceIdLive: prixLive,
      variableAttendue: `STRIPE_TEST_PRICE_ID_${plan.toUpperCase()}`,
    });
  }
  return manquants;
}

export function getAddonPriceId(key: string, stripeKey?: string): string | undefined {
  const isTestMode = stripeKey ? stripeKey.startsWith("sk_test_") : false;
  if (isTestMode && ADDON_PRICE_IDS_TEST[key]) return ADDON_PRICE_IDS_TEST[key];
  return ADDON_PRICE_IDS[key] || undefined;
}

// ── Add-on price IDs (live Stripe — confirmed 23/06/2026) ────────────────────
export const ADDON_PRICE_IDS: Record<string, string> = {
  // ── Monitoring ──────────────────────────────────────────────────────────────
  monitorsPack10:       process.env["STRIPE_PRICE_ID_10MONITORS"]               ?? "price_1TYolz9eqtbj6iPBpcIOUuhn",
  monitorsPack50:       process.env["STRIPE_PRICE_ID_50MONITORS"]               ?? "price_1TYonA9eqtbj6iPB4t0y0qzn",
  globalMonitoring:     process.env["STRIPE_PRICE_ID_GLOBAL_MONITORING"]        ?? "price_1TYoo69eqtbj6iPBPJR4JfSY",
  slaMonitoring:        process.env["STRIPE_PRICE_ID_SLA_MONITORING_ADVANCED"]  ?? "price_1TYop19eqtbj6iPBK45u2xVZ",

  // ── SEO ────────────────────────────────────────────────────────────────────
  advancedSeoLab:       process.env["STRIPE_PRICE_ID_ADVANCED_SEO_LAB"]         ?? "price_1TYopx9eqtbj6iPBkW2CZHf0",
  keywordDomination:    process.env["STRIPE_PRICE_ID_KEYBORD_DOMINATION_ENGINE"] ?? "price_1TYor69eqtbj6iPBWqq0GAK0",
  backlinkIntelligence: process.env["STRIPE_PRICE_ID_BACKLINK_INTELLIGENCE"]    ?? "price_1TYos19eqtbj6iPBTDIY2ROG",
  aiContentStrategist:  process.env["STRIPE_PRICE_ID_AI_CONTENT_STRATEGIST"]    ?? "price_1TYotM9eqtbj6iPBPxxtdisN",

  // ── Local SEO ─────────────────────────────────────────────────────────────
  gbpSlots10:           process.env["STRIPE_PRICE_ID_10GBPLOCATIONS"]           ?? "price_1TYouI9eqtbj6iPBAykG6DyI",
  // Intentionally unassigned in LIVE during the Test-Replit rollout.
  gbpPerformanceLeads:  "",
  aiGbpPosting:         process.env["STRIPE_PRICE_ID_AI_GBP_POSTING"]           ?? "price_1TYovC9eqtbj6iPBw0C7qgjS",
  reviewIntelligence:   process.env["STRIPE_PRICE_ID_REVIEW_INTELLIGENCE"]      ?? "price_1TYow19eqtbj6iPB1HLzhN1U",
  localDominationMaps:  process.env["STRIPE_PRICE_ID_LOCAL_DOMINATION_MAPS"]    ?? "price_1TYowh9eqtbj6iPBqI7YxqYu",
  localPresenceOptimizer: process.env["STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER"] ?? "",
  localLandingOpportunities: "",
  conversionOpportunityEngine: "",
  seoChangeImpact: "",
  agencyPortfolioPriorities: "",
  technicalSeoFixVerification: "",

  // ── Conversion / AI ────────────────────────────────────────────────────────
  aiCro:                process.env["STRIPE_PRICE_ID_AI_CRO_STRATEGIST"]        ?? "price_1TYpDs9eqtbj6iPBGyjqL3mu",
  behavioralAI:         process.env["STRIPE_PRICE_ID_BEHAVORIAL_AI"]            ?? "price_1TYpEc9eqtbj6iPBxC4zlNeN",
  revenueLeak:          process.env["STRIPE_PRICE_ID_REVENUE_LEAK_AI"]          ?? "price_1TYpFR9eqtbj6iPBvVtyBkWo",
  abTestingAI:          process.env["STRIPE_PRICE_ID_AB_TESTING_AI"]            ?? "price_1TYpVd9eqtbj6iPB1kbXUas2",

  // ── Reporting ─────────────────────────────────────────────────────────────
  whiteLabel:           process.env["STRIPE_PRICE_ID_WHITE_LABEL_EXPORTS"]      ?? "price_1TYpGu9eqtbj6iPBI38CmZ5H",
  agencyPacks:          process.env["STRIPE_PRICE_ID_AGENCY_REPORTING_PACKS"]   ?? "price_1TYpHj9eqtbj6iPBq3PXuoin",
  aiExecutiveReport:    process.env["STRIPE_PRICE_ID_AI_EXECUTIVE_REPORTING"]   ?? "price_1TYpIN9eqtbj6iPBSwY4sKax",
  aiForecasting:        process.env["STRIPE_PRICE_ID_AI_FORECASTING_ENGINE"]    ?? "price_1TYpJ39eqtbj6iPBTvx8Rrxi",

  // ── Intelligence ──────────────────────────────────────────────────────────
  marketIntelligence:   process.env["STRIPE_PRICE_ID_AI_MARKET_INTELLIGENCE"]   ?? "price_1TYpJl9eqtbj6iPBHhR5XF3L",
  aiWorkflows:          process.env["STRIPE_PRICE_ID_AI_AUTOMATION_WORKFLOWS"]  ?? "price_1TYpKP9eqtbj6iPBUZRTBNhx",

  // ── Team ──────────────────────────────────────────────────────────────────
  extraSeats:            process.env["STRIPE_PRICE_ID_5SEATS"]                  ?? "price_1TYpLB9eqtbj6iPBQ9R46jSC",
  enterprisePermissions: process.env["STRIPE_PRICE_ID_ENTERPRISE_PERMISSIONS"]  ?? "price_1TYpLn9eqtbj6iPBKKZEcSSU",

  // ── Data retention ────────────────────────────────────────────────────────
  retention90d:         process.env["STRIPE_PRICE_ID_RETENTION90D"]             ?? "price_1T6AFo9eqtbj6iPBz8eEQaWu",
  retention365d:        process.env["STRIPE_PRICE_ID_RETENTION365D"]            ?? "price_1T6AIu9eqtbj6iPBKFWQBxXz",

  // ── Integrations ──────────────────────────────────────────────────────────
  advancedWebhooks:     process.env["STRIPE_PRICE_ID_ADVANCED_WEBHOOKS"]        ?? "price_1TYpOa9eqtbj6iPBxgGvaQwc",
  zapierIntegration:    process.env["STRIPE_PRICE_ID_ZAPIER_MAKE_INTEGRATION"]  ?? "price_1TYpPJ9eqtbj6iPBXgpbTxwr",
  crmIntegration:       process.env["STRIPE_PRICE_ID_CRM_INTEGRATIONS"]         ?? "price_1TYpQ79eqtbj6iPBxlJOYVMN",

  // ── Enterprise ─────────────────────────────────────────────────────────────
  customDomain:         process.env["STRIPE_PRICE_ID_CUSTOM_DOMAIN"]            ?? "price_1T6AZ39eqtbj6iPB93TgRJvI",
  ssoEnterprise:        process.env["STRIPE_PRICE_ID_SSO_ENTERPRISE"]           ?? "price_1TYpSc9eqtbj6iPBm2SuIBkS",
  aiWorkspaceLaunch:    process.env["STRIPE_PRICE_ID_AI_WORKSPACE_LAUNCH"]      ?? "price_1TYpUj9eqtbj6iPBhXpzUjTH",

  // ── Support ────────────────────────────────────────────────────────────────
  prioritySupport:      process.env["STRIPE_PRICE_ID_PRIORITY_SUPPORT"]         ?? "price_1T6AXP9eqtbj6iPBVSbenAbR",

  // ── Legacy packs ───────────────────────────────────────────────────────────
  auditsPack200:        process.env["STRIPE_PRICE_ID_AUDITS_PACK200"]  ?? process.env["auditsPack200"]  ?? "price_1T6AMF9eqtbj6iPB03qrHCdP",
  auditsPack1000:       process.env["STRIPE_PRICE_ID_AUDITS_PACK1000"] ?? process.env["auditsPack1000"] ?? "price_1T6AOu9eqtbj6iPBxmABnPUs",
  pdfPack200:           process.env["STRIPE_PRICE_ID_PDF_PACK200"]              ?? "price_1T6ARC9eqtbj6iPBHu7KoqLn",
  exportsPack1000:      process.env["STRIPE_PRICE_ID_EXPORTS_PACK1000"]         ?? "price_1T6ATb9eqtbj6iPBTc6dCm5q",

  // ── AI Credit packs (one-time) ─────────────────────────────────────────────
  aiCreditsPack50k:     process.env["STRIPE_PRICE_AI_50K"]  ?? process.env["STRIPE_PRICE_ID_AI_CREDITS_50K"]  ?? "price_1TknW49eqtbj6iPB2zvBynz9",
  aiCreditsPack200k:    process.env["STRIPE_PRICE_AI_200K"] ?? process.env["STRIPE_PRICE_ID_AI_CREDITS_200K"] ?? "price_1TknXo9eqtbj6iPBsYW4F6Tu",
  aiCreditsPack500k:    process.env["STRIPE_PRICE_AI_500K"] ?? process.env["STRIPE_PRICE_ID_AI_CREDITS_500K"] ?? "price_1TknZP9eqtbj6iPBFLPnUbQ0",
};

export interface AddonDefinition {
  name: string;
  category: string;
  description: string;
  priceEur: number;
  oneTime: boolean;
  quantity: boolean;
}

/**
 * Public lifecycle/entitlement state used by every add-on catalogue surface.
 * The first three values describe an organisation's entitlement; the final
 * three describe the product lifecycle when there is no entitlement.
 */
export type AddonStatus = "included" | "active" | "beta" | "coming_soon" | "available";
export type AddonAvailability = "beta" | "coming_soon" | "available";

/**
 * Canonical public add-on catalogue.
 * Stripe price IDs above control collection; this metadata controls every
 * customer-facing label and amount. Frontends must obtain it from the API.
 */
export const ADDON_DEFINITIONS: Record<string, AddonDefinition> = {
  monitorsPack10:       { name: "+10 Monitors",             category: "Monitoring",   description: "+10 monitors actifs", priceEur: 9, oneTime: false, quantity: true },
  monitorsPack50:       { name: "+50 Monitors",             category: "Monitoring",   description: "+50 monitors actifs", priceEur: 19, oneTime: false, quantity: true },
  globalMonitoring:     { name: "Global Monitoring",        category: "Monitoring",   description: "Synthèse des régions de contrôle Better Stack configurées", priceEur: 15, oneTime: false, quantity: false },
  slaMonitoring:        { name: "SLA Monitoring Avancé",    category: "Monitoring",   description: "Suivi SLA et rapports de disponibilité", priceEur: 19, oneTime: false, quantity: false },
  advancedSeoLab:       { name: "Advanced SEO Lab",         category: "SEO",          description: "Audit SEO avancé et recommandations IA", priceEur: 29, oneTime: false, quantity: false },
  keywordDomination:    { name: "Keyword Domination Engine",category: "SEO",          description: "Suivi et stratégie mots-clés avancée", priceEur: 39, oneTime: false, quantity: false },
  backlinkIntelligence: { name: "Backlink Intelligence",    category: "SEO",          description: "Analyse de backlinks", priceEur: 24, oneTime: false, quantity: false },
  aiContentStrategist:  { name: "SEO Content Decay Radar",   category: "SEO",          description: "Repère les baisses de clics, de position et les CTR faibles par rapport aux pages GSC comparables.", priceEur: 12, oneTime: false, quantity: false },
  seoChangeImpact:      { name: "SEO Change Impact",          category: "SEO",          description: "Comparez les variations réellement mesurées entre audits SEO terminés.", priceEur: 0, oneTime: false, quantity: false },
  agencyPortfolioPriorities: { name: "Agency Portfolio Priorities", category: "Reporting", description: "Priorisez les sites clients selon les audits SEO et les clics organiques réellement mesurés.", priceEur: 19, oneTime: false, quantity: false },
  technicalSeoFixVerification: { name: "Technical SEO Fix Verification", category: "SEO", description: "Comparez le nombre de problèmes signalés entre deux audits de la même URL.", priceEur: 19, oneTime: false, quantity: false },
  gbpSlots10:           { name: "+10 Emplacements GBP",     category: "Local SEO",    description: "+10 fiches Google Business Profile", priceEur: 19, oneTime: false, quantity: true },
  gbpPerformanceLeads:  { name: "GBP Performance & Leads", category: "Local SEO", description: "Performances GBP réelles, objectifs configurables et alertes de baisse des actions locales.", priceEur: 15, oneTime: false, quantity: false },
  localLandingOpportunities: { name: "Local Landing Opportunities", category: "Local SEO", description: "Repérez les recherches locales réelles qui justifient une page de service ou de zone.", priceEur: 15, oneTime: false, quantity: false },
  aiGbpPosting:         { name: "AI GBP Posting",           category: "Local SEO",    description: "Publication GBP assistée par IA", priceEur: 12, oneTime: false, quantity: false },
  reviewIntelligence:   { name: "Review Intelligence",      category: "Local SEO",    description: "Analyse des avis et réponses IA", priceEur: 9, oneTime: false, quantity: false },
  localDominationMaps:  { name: "Local Domination Maps",    category: "Local SEO",    description: "Cartographie de visibilité locale", priceEur: 15, oneTime: false, quantity: false },
  localPresenceOptimizer: { name: "Local Presence Optimizer", category: "Local SEO", description: "Priorisation des informations manquantes sur vos fiches GBP", priceEur: 9, oneTime: false, quantity: false },
  aiCro:                { name: "AI CRO Strategist",        category: "Conversion",   description: "Recommandations CRO fondées sur les événements observés", priceEur: 34, oneTime: false, quantity: false },
  conversionOpportunityEngine: { name: "Conversion Opportunity Engine", category: "Conversion", description: "Repérez les pages à optimiser à partir des sessions et conversions GA4 mesurées.", priceEur: 12, oneTime: false, quantity: false },
  behavioralAI:         { name: "Behavioral AI",            category: "Conversion",   description: "Analyse comportementale et insights IA", priceEur: 44, oneTime: false, quantity: false },
  revenueLeak:          { name: "Revenue Leak AI",          category: "Conversion",   description: "Opportunités de conversion observées; pertes financières uniquement si mesurées", priceEur: 29, oneTime: false, quantity: false },
  abTestingAI:          { name: "AB Testing IA",            category: "Conversion",   description: "Variantes servies et résultats statistiques fondés sur des expositions réelles", priceEur: 24, oneTime: false, quantity: false },
  whiteLabel:           { name: "White-Label Exports",      category: "Reporting",    description: "Exports PDF à votre marque", priceEur: 17, oneTime: false, quantity: false },
  agencyPacks:          { name: "Agency Reporting Packs",   category: "Reporting",    description: "Packs de rapports clients réutilisables", priceEur: 12, oneTime: false, quantity: false },
  aiExecutiveReport:    { name: "AI Executive Reporting",   category: "Reporting",    description: "Résumés exécutifs IA", priceEur: 24, oneTime: false, quantity: false },
  aiForecasting:        { name: "AI Forecasting Engine",    category: "IA",           description: "Prévisions SEO, trafic et conversion", priceEur: 39, oneTime: false, quantity: false },
  marketIntelligence:   { name: "AI Market Intelligence",   category: "IA",           description: "Veille concurrentielle IA", priceEur: 49, oneTime: false, quantity: false },
  aiWorkflows:          { name: "AI Automation Workflows",  category: "IA",           description: "Workflows IA multi-étapes", priceEur: 34, oneTime: false, quantity: false },
  extraSeats:           { name: "+5 Sièges",                category: "Équipe",       description: "+5 membres supplémentaires", priceEur: 35, oneTime: false, quantity: true },
  enterprisePermissions:{ name: "Enterprise Permissions",   category: "Équipe",       description: "Permissions avancées", priceEur: 19, oneTime: false, quantity: false },
  retention90d:         { name: "Rétention 90 jours",       category: "Storage",      description: "90 jours de données historiques", priceEur: 9, oneTime: false, quantity: false },
  retention365d:        { name: "Rétention 365 jours",      category: "Storage",      description: "365 jours de données historiques", priceEur: 19, oneTime: false, quantity: false },
  advancedWebhooks:     { name: "Webhooks Avancés",          category: "API",          description: "Webhooks configurables", priceEur: 14, oneTime: false, quantity: false },
  zapierIntegration:    { name: "Zapier / Make",             category: "API",          description: "Intégration Zapier et Make", priceEur: 19, oneTime: false, quantity: false },
  crmIntegration:       { name: "Intégration CRM",           category: "API",          description: "Synchronisation CRM", priceEur: 29, oneTime: false, quantity: false },
  customDomain:         { name: "Custom Domain",             category: "Enterprise",   description: "Domaine personnalisé pour le portail", priceEur: 9, oneTime: false, quantity: false },
  ssoEnterprise:        { name: "SSO Enterprise",            category: "Enterprise",   description: "SSO SAML et OIDC", priceEur: 49, oneTime: false, quantity: false },
  aiWorkspaceLaunch:    { name: "AI Workspace Launch",       category: "Enterprise",   description: "Roadmap et missions IA personnalisées à partir du profil renseigné", priceEur: 15, oneTime: false, quantity: false },
  prioritySupport:      { name: "Support Prioritaire",       category: "Support",      description: "Canal prioritaire", priceEur: 29, oneTime: false, quantity: false },
  auditsPack200:        { name: "Pack audits +200",          category: "SEO",          description: "+200 audits mensuels", priceEur: 12, oneTime: false, quantity: true },
  auditsPack1000:       { name: "Pack audits +1 000",        category: "SEO",          description: "+1 000 audits mensuels", priceEur: 39, oneTime: false, quantity: true },
  pdfPack200:           { name: "Pack PDF +200",             category: "Reporting",    description: "+200 exports PDF", priceEur: 12, oneTime: false, quantity: true },
  exportsPack1000:      { name: "Pack exports +1 000",       category: "Reporting",    description: "+1 000 exports", priceEur: 14, oneTime: false, quantity: true },
  aiCreditsPack50k:     { name: "+50 000 crédits IA",        category: "IA",           description: "Pack de crédits IA", priceEur: 4, oneTime: true, quantity: true },
  aiCreditsPack200k:    { name: "+200 000 crédits IA",       category: "IA",           description: "Pack de crédits IA", priceEur: 9, oneTime: true, quantity: true },
  aiCreditsPack500k:    { name: "+500 000 crédits IA",       category: "IA",           description: "Pack de crédits IA", priceEur: 19, oneTime: true, quantity: true },
};

/** Development-only catalogue labels; billing quotes continue using canonical prices. */
export const DEVELOPMENT_ADDON_DISPLAY_PRICES: Readonly<Record<string, number>> = {
  marketIntelligence: 12,
  aiCro: 12,
  revenueLeak: 12,
  aiForecasting: 15,
};

export function getAddonDisplayPrice(addonKey: string, nodeEnv = process.env["NODE_ENV"]): number | undefined {
  const canonicalPrice = ADDON_DEFINITIONS[addonKey]?.priceEur;
  if (canonicalPrice === undefined) return undefined;
  if (nodeEnv === "production") return canonicalPrice;
  return DEVELOPMENT_ADDON_DISPLAY_PRICES[addonKey] ?? canonicalPrice;
}

export const FLAG_ADDONS = new Set([
  "globalMonitoring","slaMonitoring",
  "advancedSeoLab","keywordDomination","backlinkIntelligence","aiContentStrategist","seoChangeImpact","agencyPortfolioPriorities","technicalSeoFixVerification",
  "aiGbpPosting","reviewIntelligence","localDominationMaps","gbpPerformanceLeads","localPresenceOptimizer","localLandingOpportunities",
  "aiCro","behavioralAI","revenueLeak","abTestingAI",
  "whiteLabel","agencyPacks","aiExecutiveReport","aiForecasting",
  "marketIntelligence","aiWorkflows",
  "enterprisePermissions",
  "retention90d","retention365d",
  "advancedWebhooks","zapierIntegration","crmIntegration",
  "customDomain","ssoEnterprise","aiWorkspaceLaunch",
  // NOTE: "prioritySupport" removed — feature not implemented, no commercial exposure
]);

/** Legacy keys retained only for historical Stripe/DB reconciliation. */
export const REMOVED_ADDONS = new Set<string>(["prioritySupport"]);

/**
 * Retired products cannot be newly purchased, but remain recognized by the
 * entitlement and Stripe reconciliation paths for customers who already own
 * them. A replacement always receives a different commercial key.
 */
export const RETIRED_ADDONS = new Set<string>(["localDominationMaps"]);

/**
 * COMING_SOON_ADDONS — add-ons visible in the UI (roadmap) but NOT yet
 * available for purchase.  Activation is blocked at every layer:
 *   1. API  — POST /api/addons/:key/activate returns 503
 *   2. Checkout — public-billing.ts must reject these keys
 *   3. Frontend — UI renders disabled "Bientôt disponible" badge/button
 *
 * When an add-on ships, remove it from this set and add a Stripe price.
 */
export const COMING_SOON_ADDONS = new Set<string>([
  // Test mode only opens this after a dedicated test price is configured below.
  "gbpPerformanceLeads",
  "localLandingOpportunities",
  "conversionOpportunityEngine",
  "seoChangeImpact",
  "agencyPortfolioPriorities",
  "technicalSeoFixVerification",
  // The Better Stack SLA endpoint exists and enforces requireAddon; the add-on
  // remains unavailable for purchase pending real QA certification.
  "slaMonitoring",
  // /betterstack/global-overview summarizes configured Better Stack monitor
  // regions only; it does not perform independent regional checks.
  "globalMonitoring",
  // aiContentStrategist: SEO Content Decay Radar route exists for test/simulation,
  // but the add-on remains unavailable for purchase until validated.
  // abTestingAI stays non-purchasable until the experiment delivery and
  // commercial model have been validated.
  // backlinkIntelligence: moved to BETA_ADDONS — route /seo/backlinks exists with
  // requireAddon gate. DFS integration partial (backlinks endpoint live, citation
  // health fallback). Included in Pro & Ultra plans.
  "aiContentStrategist",
  "abTestingAI",
  "agencyPacks",
  "aiExecutiveReport",
  "aiWorkflows",

  // ── Routes exist but not commercially released ─────────────────────────────
  // crmIntegration: crm.ts routes are complete but addon not yet sold.
  // Route exists and works, blocked by this set (POST /api/addons/crmIntegration/activate → 503).
  "crmIntegration",

  // ssoEnterprise: sso.ts line 82 TODO, SAML_ROADMAP_PROVIDERS → 501.
  // Only Google Workspace OIDC works today (plan feature, not this addon).
  "ssoEnterprise",

  // aiWorkspaceLaunch: POST + GET routes enforce requireAddon; AI output is
  // validated and the route refuses to persist generic fallback content.
  // Still not commercially released pending functional certification.
  "aiWorkspaceLaunch",

  // customDomain: route exists but feature is not commercially available yet for
  // Standard/Pro. Included in Ultra but still "coming soon" functionally.
  // getAddonStatus returns "included" first for Ultra users so this is safe.
  "customDomain",
]);

// A test price makes the feature purchasable only when the active Stripe key is
// explicitly test-mode. Without a live price, production remains fail-closed.
if (
  ADDON_PRICE_IDS_TEST.gbpPerformanceLeads &&
  getStripeKey().startsWith("sk_test_")
) {
  COMING_SOON_ADDONS.delete("gbpPerformanceLeads");
}
if (
  ADDON_PRICE_IDS_TEST.localLandingOpportunities &&
  getStripeKey().startsWith("sk_test_")
) {
  COMING_SOON_ADDONS.delete("localLandingOpportunities");
}
if (
  ADDON_PRICE_IDS_TEST.conversionOpportunityEngine &&
  getStripeKey().startsWith("sk_test_")
) {
  COMING_SOON_ADDONS.delete("conversionOpportunityEngine");
}

/** Local SEO add-ons remain visible at proposed prices but cannot be sold before approval. */
export const VALIDATION_REQUIRED_ADDONS = new Set<string>([
  "aiGbpPosting",
  "reviewIntelligence",
  "localDominationMaps",
  "localPresenceOptimizer",
]);

/**
 * Audit fonctionnel (2026-08-24) — critère BETA :
 * "route réelle, activable, mais partielle ou dépendante d'une intégration externe."
 *
 *   behavioralAI      → behavioral.ts:377 gate réelle. Mais dépend du snippet JS
 *                        installé côté client (intégration externe). Sans snippet,
 *                        les insights sont vides. → BETA
 *
 *   aiForecasting     → forecast.ts:11 gate réelle. Memory documente "fabricated
 *                        past curves" pour les pages forecast. Couverture données
 *                        limitée. → BETA
 *
 *   marketIntelligence → market-intelligence.ts:12 gate réelle. Task PROPOSÉE
 *                        "Remplacer données concurrentes hardcodées par vraies DFS"
 *                        non terminée. Données partiellement mockées. → BETA
 *
 *   revenueLeak       → revenue-leak.ts:15 gate réelle. Dépend de behavioral data
 *                        (snippet onsite requis). Sans snippet = détection vide. → BETA
 *
 *   aiCro             → cro.ts:17 gate réelle. Dépend de behavioral data (snippet).
 *                        Recommandations génériques sans données visiteurs. → BETA
 *
 *   reviewIntelligence → review-intelligence.ts:23 gate réelle. Analyse DFS/GBP
 *                        reviews — intégration DFS partielle. → BETA
 *
 *   aiGbpPosting      → gbp-posts.ts:86 gate réelle sur génération IA. Dépend
 *                        d'une connexion OAuth GBP active (intégration externe). → BETA
 *
 *   zapierIntegration → integrations.ts:131/158 gate réelle. Dépend OAuth
 *                        Zapier/Make (connexion externe non bundlée). → BETA
 */
export const BETA_ADDONS = new Set<string>([
  // Beta describes feature maturity, NOT commercial mode.
  // A beta add-on CAN be included in a plan (e.g. Ultra) — it then shows as
  // "🧪 Beta — Inclus dans votre plan" and cannot be re-purchased.
  // BETA_ADDONS ∩ PLAN_INCLUDED_ADDONS is a valid non-empty set by design.
  //
  // Dépendance snippet onsite
  "behavioralAI",
  "revenueLeak",
  "aiCro",
  // Couverture données partielle / DFS non complète
  "aiForecasting",
  "marketIntelligence",
  "reviewIntelligence",
  // Dépendance OAuth externe
  "aiGbpPosting",
  "zapierIntegration",
  // Route /seo/backlinks réelle + requireAddon gate. DFS backlink integration
  // partielle (endpoint live, couverture données limitée). Inclus Pro & Ultra.
  "backlinkIntelligence",
]);

/** Product lifecycle independent of an organisation's current entitlements. */
export function getAddonAvailability(addonKey: string): AddonAvailability {
  // COMING_SOON is authoritative even if a key is accidentally classified
  // elsewhere while catalogue metadata is being updated.
  if (COMING_SOON_ADDONS.has(addonKey)) return "coming_soon";
  if (VALIDATION_REQUIRED_ADDONS.has(addonKey)) return "coming_soon";
  if (BETA_ADDONS.has(addonKey)) return "beta";
  return "available";
}

/**
 * Resolve the single display state for an add-on in an organisation catalogue.
 * Roadmap state has highest precedence, followed by bundled and paid
 * entitlements; beta is only shown when neither entitlement applies.
 */
export function getAddonStatus(
  addonKey: string,
  options: { included?: boolean; active?: boolean | number } = {},
): AddonStatus {
  const availability = getAddonAvailability(addonKey);
  if (VALIDATION_REQUIRED_ADDONS.has(addonKey)) {
    if (options.included) return "included";
    if (options.active === true || (typeof options.active === "number" && options.active > 0)) return "active";
    return "coming_soon";
  }
  if (availability === "coming_soon") return "coming_soon";
  if (options.included) return "included";
  if (options.active === true || (typeof options.active === "number" && options.active > 0)) return "active";
  return availability;
}

export const QTY_ADDONS = new Set([
  "monitorsPack10","monitorsPack50","gbpSlots10","extraSeats",
  "auditsPack200","auditsPack1000","pdfPack200","exportsPack1000",
  "aiCreditsPack50k","aiCreditsPack200k","aiCreditsPack500k",
]);

/**
 * QTY_ADDON_GRANTS — canonical per-pack quota grants for recurring quantity
 * add-ons.  SINGLE SOURCE OF TRUTH: every entitlement surface (getQuotaLimits,
 * checkQuota, getUsageSummary, /billing/usage-details) MUST derive pack
 * expansion from this map — never hardcode per-addon branches locally.
 *
 * `resource` names match PlanLimits keys.  One-time AI credit packs are NOT
 * here: they are consumed via ai_credit_purchases, not a recurring limit.
 * gbpSlots10 expands GBP location slots (tracked outside PlanLimits — consumers
 * that don't track GBP simply ignore the key).
 */
export const QTY_ADDON_GRANTS: Record<string, { resource: "monitors" | "audits" | "reports" | "exports" | "teamMembers" | "gbpLocations"; perPack: number }> = {
  monitorsPack10:  { resource: "monitors",     perPack: 10 },
  monitorsPack50:  { resource: "monitors",     perPack: 50 },
  auditsPack200:   { resource: "audits",       perPack: 200 },
  auditsPack1000:  { resource: "audits",       perPack: 1000 },
  pdfPack200:      { resource: "reports",      perPack: 200 },
  exportsPack1000: { resource: "exports",      perPack: 1000 },
  extraSeats:      { resource: "teamMembers",  perPack: 5 },
  gbpSlots10:      { resource: "gbpLocations", perPack: 10 },
};

/**
 * computeQtyAddonExtras — expands an addons map (key → boolean|packCount) into
 * per-resource extra capacity using QTY_ADDON_GRANTS.  `true` counts as 1 pack;
 * numeric values count as pack counts; falsy/0 grants nothing.
 */
export function computeQtyAddonExtras(addons: Record<string, boolean | number>): Record<string, number> {
  const extras: Record<string, number> = {};
  for (const [key, grant] of Object.entries(QTY_ADDON_GRANTS)) {
    const raw = addons[key];
    const packs = raw === true ? 1 : Math.max(0, Math.floor(Number(raw) || 0));
    if (packs > 0) extras[grant.resource] = (extras[grant.resource] ?? 0) + packs * grant.perPack;
  }
  return extras;
}

/**
 * PLAN_INCLUDED_ADDONS — single source of truth for which add-ons are bundled
 * into each plan at no extra charge.  All consumers (billing.ts, public-billing.ts,
 * addon-stripe-sync.ts) MUST import from here; never duplicate this map locally.
 *
 * Invariants:
 *   • ultra ⊇ pro ⊇ standard (cumulative sets)
 *   • No key here unless it also has a price ID in ADDON_PRICE_IDS
 *   • One-time credit packs must never appear here
 *
 * Standard plan: white-label is included (unlocked for Standard and above).
 * Pro plan: white-label is a listed feature; customDomain is NOT (ultra only).
 * Ultra includes all six Pro add-ons plus four Ultra-only additions:
 * customDomain, behavioralAI, aiForecasting, and retention365d.
 * keywordDomination remains purchasable on Pro/Ultra but is not bundled.
 */
export const PLAN_INCLUDED_ADDONS: Record<string, ReadonlySet<string>> = {
  standard: new Set<string>(["whiteLabel"]),
  pro: new Set<string>([
    "whiteLabel",
    "advancedWebhooks",
    "retention90d",
    "advancedSeoLab",
    // BETA + included: status=beta, commercial mode=included. Renders as "🧪 Bêta — Inclus".
    "backlinkIntelligence",
    // Granular RBAC (custom roles, workspace permissions, SSO compat). Live price ID.
    // Pro-purchasable already (_PRO_EXCLUSIVE); no Ultra-only backend guard.
    "enterprisePermissions",
  ]),
  ultra: new Set<string>([
    "whiteLabel",
    "advancedWebhooks",
    "retention90d",
    "advancedSeoLab",
    // BETA + included: status=beta, commercial mode=included. Renders as "🧪 Bêta — Inclus".
    "backlinkIntelligence",
    "enterprisePermissions",
    "customDomain",
    // behavioralAI: BETA + included in Ultra → shows as "🧪 Beta — Inclus dans votre plan"
    "behavioralAI",
    // aiForecasting: BETA + included in Ultra → same "🧪 Beta — Inclus" rendering
    "aiForecasting",
    "retention365d",
  ]),
};

/**
 * PLAN_ALLOWED_ADDONS — which add-ons can be PURCHASED (paid) per plan tier.
 * Distinct from PLAN_INCLUDED_ADDONS (bundled for free).
 * An add-on absent from this set for the user's plan is BLOCKED at:
 *   1. API level   — POST /api/addons/:key/activate returns 403
 *   2. Checkout    — public-billing.ts strips incompatible add-on keys
 *   3. Frontend    — UI should grey-out/hide (enforced by /api/addons response)
 *
 * Hierarchy: standard ⊂ pro ⊂ ultra.
 */
const _STANDARD_PURCHASABLE = new Set<string>([
  // Capacity packs — available on all plans
  "monitorsPack10", "monitorsPack50",
  "gbpSlots10",
  "extraSeats",
  "auditsPack200", "auditsPack1000",
  "pdfPack200", "exportsPack1000",
  "aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k",
  "retention90d",
  // NOTE: "prioritySupport" removed — feature not implemented
]);

const _PRO_EXCLUSIVE = new Set<string>([
  // NOTE: COMING_SOON_ADDONS must never appear here — they are not purchasable.
  // Removed: globalMonitoring, slaMonitoring, aiContentStrategist, abTestingAI,
  //          crmIntegration, aiExecutiveReport, aiWorkflows (all COMING_SOON)
  "keywordDomination",
  "aiGbpPosting", "reviewIntelligence", "localDominationMaps", "localPresenceOptimizer",
  "aiCro", "behavioralAI", "revenueLeak",
  "zapierIntegration",
  "aiForecasting", "marketIntelligence",
  "enterprisePermissions",
]);

const _ULTRA_EXCLUSIVE = new Set<string>([
  // NOTE: agencyPacks, ssoEnterprise, aiWorkspaceLaunch are COMING_SOON — not purchasable.
  "retention365d",
]);

export const PLAN_ALLOWED_ADDONS: Record<string, ReadonlySet<string>> = {
  standard: _STANDARD_PURCHASABLE,
  pro:      new Set<string>([..._STANDARD_PURCHASABLE, ..._PRO_EXCLUSIVE]),
  ultra:    new Set<string>([..._STANDARD_PURCHASABLE, ..._PRO_EXCLUSIVE, ..._ULTRA_EXCLUSIVE]),
  agency:   new Set<string>([..._STANDARD_PURCHASABLE, ..._PRO_EXCLUSIVE, ..._ULTRA_EXCLUSIVE]),
};

/**
 * The six protected bundled add-ons keep their existing plan-purchase matrix.
 * Every other sellable add-on (available or beta) can be purchased on Standard,
 * Pro, and Ultra. Plan tier controls bundling, not purchase eligibility.
 * Roadmap/validation-required and removed entries retain their lifecycle gates.
 */
export const PROTECTED_ADDON_KEYS = new Set<string>([
  "whiteLabel",
  "advancedWebhooks",
  "retention90d",
  "advancedSeoLab",
  "backlinkIntelligence",
  "enterprisePermissions",
]);

const SELLABLE_ADDON_AVAILABILITIES = new Set<AddonAvailability>(["available", "beta"]);
const SELLABLE_ADDONS_ANY_PLAN = Object.keys(ADDON_DEFINITIONS).filter(key =>
  !PROTECTED_ADDON_KEYS.has(key) &&
  !REMOVED_ADDONS.has(key) &&
  !RETIRED_ADDONS.has(key) &&
  SELLABLE_ADDON_AVAILABILITIES.has(getAddonAvailability(key))
);

for (const plan of ["standard", "pro", "ultra"] as const) {
  for (const addonKey of SELLABLE_ADDONS_ANY_PLAN) {
    (PLAN_ALLOWED_ADDONS[plan] as Set<string>).add(addonKey);
  }
}

/** Returns true when a plan is allowed to purchase the given add-on key. */
export function isPlanAllowedAddon(plan: string, addonKey: string): boolean {
  if (RETIRED_ADDONS.has(addonKey)) return false;
  const planNorm = plan.toLowerCase();
  const allowed = PLAN_ALLOWED_ADDONS[planNorm];
  if (!allowed) {
    // Unknown/free plan: only capacity packs
    return _STANDARD_PURCHASABLE.has(addonKey);
  }
  return allowed.has(addonKey);
}

export function getPlanForPriceId(priceId: string): string | null {
  // Check live-mode price IDs first
  for (const [plan, id] of Object.entries(PLAN_PRICE_IDS)) {
    if (id && id === priceId) return plan;
  }
  // Fallback: check test-mode price IDs (populated via STRIPE_TEST_PRICE_ID_* env vars)
  for (const [plan, id] of Object.entries(PLAN_PRICE_IDS_TEST)) {
    if (id && id === priceId) return plan;
  }
  return null;
}

export function getAddonForPriceId(priceId: string): string | null {
  for (const [addon, id] of Object.entries(ADDON_PRICE_IDS)) {
    if (id && id === priceId) return addon;
  }
  return null;
}
