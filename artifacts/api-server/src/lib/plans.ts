export interface PlanLimits {
  audits: number;
  monitors: number;
  reports: number;
  exports: number;
  teamMembers: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  standard: { audits: 30,   monitors: 3,   reports: 30,   exports: 30,   teamMembers: 1 },
  pro:      { audits: 300,  monitors: 50,  reports: 300,  exports: 300,  teamMembers: 5 },
  ultra:    { audits: 2000, monitors: 300, reports: 2000, exports: 2000, teamMembers: 10 },
};

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
  // +10 Monitors 9€/pack  |  +50 Monitors 29€/pack  |  Global 49€  |  SLA 19€
  monitorsPack10:       process.env["STRIPE_PRICE_ID_10MONITORS"]               ?? "price_1TYolz9eqtbj6iPBpcIOUuhn",
  monitorsPack50:       process.env["STRIPE_PRICE_ID_50MONITORS"]               ?? "price_1TYonA9eqtbj6iPB4t0y0qzn",
  globalMonitoring:     process.env["STRIPE_PRICE_ID_GLOBAL_MONITORING"]        ?? "price_1TYoo69eqtbj6iPBPJR4JfSY",
  slaMonitoring:        process.env["STRIPE_PRICE_ID_SLA_MONITORING_ADVANCED"]  ?? "price_1TYop19eqtbj6iPBK45u2xVZ",

  // ── SEO ────────────────────────────────────────────────────────────────────
  // Advanced SEO Lab 29€  |  Keyword Dom. 39€  |  Backlink 49€  |  AI Content 34€
  advancedSeoLab:       process.env["STRIPE_PRICE_ID_ADVANCED_SEO_LAB"]         ?? "price_1TYopx9eqtbj6iPBkW2CZHf0",
  keywordDomination:    process.env["STRIPE_PRICE_ID_KEYBORD_DOMINATION_ENGINE"] ?? "price_1TYor69eqtbj6iPBWqq0GAK0",
  backlinkIntelligence: process.env["STRIPE_PRICE_ID_BACKLINK_INTELLIGENCE"]    ?? "price_1TYos19eqtbj6iPBTDIY2ROG",
  aiContentStrategist:  process.env["STRIPE_PRICE_ID_AI_CONTENT_STRATEGIST"]    ?? "price_1TYotM9eqtbj6iPBPxxtdisN",

  // ── Local SEO ─────────────────────────────────────────────────────────────
  // +10 GBP 19€/pack  |  AI GBP Posting 29€  |  Review Intel. 19€  |  Local Maps 24€
  gbpSlots10:           process.env["STRIPE_PRICE_ID_10GBPLOCATIONS"]           ?? "price_1TYouI9eqtbj6iPBAykG6DyI",
  aiGbpPosting:         process.env["STRIPE_PRICE_ID_AI_GBP_POSTING"]           ?? "price_1TYovC9eqtbj6iPBw0C7qgjS",
  reviewIntelligence:   process.env["STRIPE_PRICE_ID_REVIEW_INTELLIGENCE"]      ?? "price_1TYow19eqtbj6iPB1HLzhN1U",
  localDominationMaps:  process.env["STRIPE_PRICE_ID_LOCAL_DOMINATION_MAPS"]    ?? "price_1TYowh9eqtbj6iPBqI7YxqYu",

  // ── Conversion / AI ────────────────────────────────────────────────────────
  // AI CRO 34€  |  Behavioral AI 34€  |  Revenue Leak 29€  |  AB Testing 24€
  aiCro:                process.env["STRIPE_PRICE_ID_AI_CRO_STRATEGIST"]        ?? "price_1TYpDs9eqtbj6iPBGyjqL3mu",
  behavioralAI:         process.env["STRIPE_PRICE_ID_BEHAVORIAL_AI"]            ?? "price_1TYpEc9eqtbj6iPBxC4zlNeN",
  revenueLeak:          process.env["STRIPE_PRICE_ID_REVENUE_LEAK_AI"]          ?? "price_1TYpFR9eqtbj6iPBvVtyBkWo",
  abTestingAI:          process.env["STRIPE_PRICE_ID_AB_TESTING_AI"]            ?? "price_1TYpVd9eqtbj6iPB1kbXUas2",

  // ── Reporting ─────────────────────────────────────────────────────────────
  // White-Label 17€  |  Agency Packs 49€  |  AI Executive 24€  |  AI Forecasting 39€
  whiteLabel:           process.env["STRIPE_PRICE_ID_WHITE_LABEL_EXPORTS"]      ?? "price_1TYpGu9eqtbj6iPBI38CmZ5H",
  agencyPacks:          process.env["STRIPE_PRICE_ID_AGENCY_REPORTING_PACKS"]   ?? "price_1TYpHj9eqtbj6iPBq3PXuoin",
  aiExecutiveReport:    process.env["STRIPE_PRICE_ID_AI_EXECUTIVE_REPORTING"]   ?? "price_1TYpIN9eqtbj6iPBSwY4sKax",
  aiForecasting:        process.env["STRIPE_PRICE_ID_AI_FORECASTING_ENGINE"]    ?? "price_1TYpJ39eqtbj6iPBTvx8Rrxi",

  // ── Intelligence ──────────────────────────────────────────────────────────
  // Market Intelligence 49€  |  AI Automation Workflows 34€
  marketIntelligence:   process.env["STRIPE_PRICE_ID_AI_MARKET_INTELLIGENCE"]   ?? "price_1TYpJl9eqtbj6iPBHhR5XF3L",
  aiWorkflows:          process.env["STRIPE_PRICE_ID_AI_AUTOMATION_WORKFLOWS"]  ?? "price_1TYpKP9eqtbj6iPBUZRTBNhx",

  // ── Team ──────────────────────────────────────────────────────────────────
  // +5 Seats 35€/pack  |  Enterprise Permissions 19€
  extraSeats:            process.env["STRIPE_PRICE_ID_5SEATS"]                  ?? "price_1TYpLB9eqtbj6iPBQ9R46jSC",
  enterprisePermissions: process.env["STRIPE_PRICE_ID_ENTERPRISE_PERMISSIONS"]  ?? "price_1TYpLn9eqtbj6iPBKKZEcSSU",

  // ── Data retention ────────────────────────────────────────────────────────
  // Retention 90j 9€  |  Retention 365j 19€
  retention90d:         process.env["STRIPE_PRICE_ID_RETENTION90D"]             ?? "price_1T6AFo9eqtbj6iPBz8eEQaWu",
  retention365d:        process.env["STRIPE_PRICE_ID_RETENTION365D"]            ?? "price_1T6AIu9eqtbj6iPBKFWQBxXz",

  // ── Integrations ──────────────────────────────────────────────────────────
  // Webhooks Avancés 14€  |  Zapier/Make 19€  |  CRM 29€
  advancedWebhooks:     process.env["STRIPE_PRICE_ID_ADVANCED_WEBHOOKS"]        ?? "price_1TYpOa9eqtbj6iPBxgGvaQwc",
  zapierIntegration:    process.env["STRIPE_PRICE_ID_ZAPIER_MAKE_INTEGRATION"]  ?? "price_1TYpPJ9eqtbj6iPBXgpbTxwr",
  crmIntegration:       process.env["STRIPE_PRICE_ID_CRM_INTEGRATIONS"]         ?? "price_1TYpQ79eqtbj6iPBxlJOYVMN",

  // ── Enterprise ─────────────────────────────────────────────────────────────
  // Custom Domain 9€  |  SSO Enterprise 79€  |  AI Workspace Launch 49€
  customDomain:         process.env["STRIPE_PRICE_ID_CUSTOM_DOMAIN"]            ?? "price_1T6AZ39eqtbj6iPB93TgRJvI",
  ssoEnterprise:        process.env["STRIPE_PRICE_ID_SSO_ENTERPRISE"]           ?? "price_1TYpSc9eqtbj6iPBm2SuIBkS",
  aiWorkspaceLaunch:    process.env["STRIPE_PRICE_ID_AI_WORKSPACE_LAUNCH"]      ?? "price_1TYpUj9eqtbj6iPBhXpzUjTH",

  // ── Support ────────────────────────────────────────────────────────────────
  // Priority Support 29€
  prioritySupport:      process.env["STRIPE_PRICE_ID_PRIORITY_SUPPORT"]         ?? "price_1T6AXP9eqtbj6iPBVSbenAbR",

  // ── Legacy packs ───────────────────────────────────────────────────────────
  // Audits Pack +200 9€  |  +1000 29€  |  PDF Pack 9€  |  Exports Pack 19€
  auditsPack200:        process.env["STRIPE_PRICE_ID_AUDITS_PACK200"]  ?? process.env["auditsPack200"]  ?? "price_1T6AMF9eqtbj6iPB03qrHCdP",
  auditsPack1000:       process.env["STRIPE_PRICE_ID_AUDITS_PACK1000"] ?? process.env["auditsPack1000"] ?? "price_1T6AOu9eqtbj6iPBxmABnPUs",
  pdfPack200:           process.env["STRIPE_PRICE_ID_PDF_PACK200"]              ?? "price_1T6ARC9eqtbj6iPBHu7KoqLn",
  exportsPack1000:      process.env["STRIPE_PRICE_ID_EXPORTS_PACK1000"]         ?? "price_1T6ATb9eqtbj6iPBTc6dCm5q",

  // ── AI Credit packs (one-time) ─────────────────────────────────────────────
  // 50K crédits 4€  |  200K crédits 9€  |  500K crédits 19€
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
  "monitorsPack10","monitorsPack50","gbpSlots10","extraSeats",
  "auditsPack200","auditsPack1000","pdfPack200","exportsPack1000",
  "aiCreditsPack50k","aiCreditsPack200k","aiCreditsPack500k",
]);

export const PLAN_AI_CREDITS: Record<string, number> = {
  standard: 30000,
  pro:      100000,
  ultra:    500000,
};

export const PLAN_AI_TOKENS: Record<string, number> = {
  standard:  50_000,
  pro:      150_000,
  ultra:    750_000,
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
