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
      "Local SEO basique", "Export CSV", "Support email 48h",
    ],
    locked: [
      "IA Insights", "White-label", "API Access",
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
      "1 000 exports/mois", "10 membres d'équipe", "10 000 000 crédits IA/mois",
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

// ── Add-on price IDs (live Stripe — confirmed 23/06/2026) ────────────────────
export const ADDON_PRICE_IDS: Record<string, string> = {
  // ── Monitoring ──────────────────────────────────────────────────────────────
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
  aiGbpPosting:         process.env["STRIPE_PRICE_ID_AI_GBP_POSTING"]           ?? "price_1TYovC9eqtbj6iPBw0C7qgjS",
  reviewIntelligence:   process.env["STRIPE_PRICE_ID_REVIEW_INTELLIGENCE"]      ?? "price_1TYow19eqtbj6iPB1HLzhN1U",
  localDominationMaps:  process.env["STRIPE_PRICE_ID_LOCAL_DOMINATION_MAPS"]    ?? "price_1TYowh9eqtbj6iPBqI7YxqYu",

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

export const FLAG_ADDONS = new Set([
  "globalMonitoring","slaMonitoring",
  "advancedSeoLab","keywordDomination","backlinkIntelligence","aiContentStrategist",
  "aiGbpPosting","reviewIntelligence","localDominationMaps",
  "aiCro","behavioralAI","revenueLeak","abTestingAI",
  "whiteLabel","agencyPacks","aiExecutiveReport","aiForecasting",
  "marketIntelligence","aiWorkflows",
  "enterprisePermissions",
  "retention90d","retention365d",
  "advancedWebhooks","zapierIntegration","crmIntegration",
  "customDomain","ssoEnterprise","aiWorkspaceLaunch","prioritySupport",
]);

export const QTY_ADDONS = new Set([
  "monitorsPack50","gbpSlots10","extraSeats",
  "auditsPack200","auditsPack1000","pdfPack200","exportsPack1000",
  "aiCreditsPack50k","aiCreditsPack200k","aiCreditsPack500k",
]);

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
 * Standard plan: white-label is in the "locked" feature list → NOT included.
 * Pro plan: white-label is a listed feature; customDomain is NOT (ultra only).
 * Ultra plan: adds customDomain + retention365d + advanced AI add-ons.
 */
export const PLAN_INCLUDED_ADDONS: Record<string, ReadonlySet<string>> = {
  standard: new Set<string>([]),
  pro: new Set<string>([
    "whiteLabel",
    "advancedWebhooks",
    "retention90d",
    "advancedSeoLab",
    "backlinkIntelligence",
    "prioritySupport",
  ]),
  ultra: new Set<string>([
    "whiteLabel",
    "customDomain",
    "advancedWebhooks",
    "retention90d",
    "advancedSeoLab",
    "backlinkIntelligence",
    "prioritySupport",
    "retention365d",
    "keywordDomination",
    "behavioralAI",
    "aiForecasting",
  ]),
};

export function getPlanForPriceId(priceId: string): string | null {
  for (const [plan, id] of Object.entries(PLAN_PRICE_IDS)) {
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
