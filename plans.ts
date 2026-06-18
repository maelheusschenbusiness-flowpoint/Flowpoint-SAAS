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

export const PLAN_PRICE_IDS: Record<string, string> = {
  standard: process.env["STRIPE_PRICE_STANDARD"] ?? "",
  pro:      process.env["STRIPE_PRICE_PRO"]      ?? "",
  ultra:    process.env["STRIPE_PRICE_ULTRA"]     ?? "",
};

export const ADDON_PRICE_IDS: Record<string, string> = {
  // ── Legacy / core add-ons (with hardcoded fallback Stripe IDs) ──────────────
  monitorsPack50:      process.env["STRIPE_ADDON_MONITORS_PACK50"]  ?? "price_1T6A839eqtbj6iPBTXCaiv0W",
  extraSeats:          process.env["STRIPE_ADDON_EXTRA_SEATS"]      ?? "price_1T6AB29eqtbj6iPBYcWdWqXZ",
  auditsPack200:       process.env["STRIPE_ADDON_AUDITS_PACK200"]   ?? "price_1T6AHh9eqtbj6iPBb8rj1l1P",
  auditsPack1000:      process.env["STRIPE_ADDON_AUDITS_PACK1000"]  ?? "price_1T6AIt9eqtbj6iPBxqy7CduM",
  pdfPack200:          process.env["STRIPE_ADDON_PDF_PACK200"]      ?? "price_1T6AJL9eqtbj6iPBbIpRPzVf",
  exportsPack1000:     process.env["STRIPE_ADDON_EXPORTS_PACK1000"] ?? "price_1T6AKW9eqtbj6iPBGJdJ96TQ",
  customDomain:        process.env["STRIPE_ADDON_CUSTOM_DOMAIN"]    ?? "price_1T6ANQ9eqtbj6iPB4OVhPmh3",
  prioritySupport:     process.env["STRIPE_ADDON_PRIORITY_SUPPORT"] ?? "price_1T6AOd9eqtbj6iPBz7CUiIge",
  retention90d:        process.env["STRIPE_ADDON_RETENTION_90D"]    ?? "price_1T6APj9eqtbj6iPBXxYeJDzH",
  retention365d:       process.env["STRIPE_ADDON_RETENTION_365D"]   ?? "price_1T6AQc9eqtbj6iPBEGxIWH2I",

  // ── White-label ────────────────────────────────────────────────────────────
  whiteLabel:          process.env["STRIPE_ADDON_WHITE_LABEL"]          ?? "",

  // ── AI features ────────────────────────────────────────────────────────────
  aiExecutiveReport:   process.env["STRIPE_ADDON_AI_EXECUTIVE_REPORT"]  ?? "",
  aiForecasting:       process.env["STRIPE_ADDON_AI_FORECASTING"]       ?? "",
  aiCro:               process.env["STRIPE_ADDON_AI_CRO"]               ?? "",
  behavioralAI:        process.env["STRIPE_ADDON_BEHAVIORAL_AI"]        ?? "",
  aiWorkflows:         process.env["STRIPE_ADDON_AI_WORKFLOWS"]         ?? "",
  marketIntelligence:  process.env["STRIPE_ADDON_MARKET_INTELLIGENCE"]  ?? "",

  // ── Conversion ─────────────────────────────────────────────────────────────
  revenueLeak:         process.env["STRIPE_ADDON_REVENUE_LEAK"]         ?? "",

  // ── Local SEO ─────────────────────────────────────────────────────────────
  reviewIntelligence:  process.env["STRIPE_ADDON_REVIEW_INTELLIGENCE"]  ?? "",

  // ── Reporting ─────────────────────────────────────────────────────────────
  agencyPacks:         process.env["STRIPE_ADDON_AGENCY_PACKS"]         ?? "",

  // ── Integrations ──────────────────────────────────────────────────────────
  zapierIntegration:   process.env["STRIPE_ADDON_ZAPIER"]               ?? "",
  advancedWebhooks:    process.env["STRIPE_ADDON_WEBHOOKS"]             ?? "",
  crmIntegration:      process.env["STRIPE_ADDON_CRM"]                  ?? "",

  // ── Enterprise ─────────────────────────────────────────────────────────────
  ssoEnterprise:       process.env["STRIPE_ADDON_SSO"]                  ?? "",

  // ── AI Credit packs (one-time purchases) ──────────────────────────────────
  aiCreditsPack50k:    process.env["STRIPE_ADDON_AI_CREDITS_50K"]       ?? "",
  aiCreditsPack200k:   process.env["STRIPE_ADDON_AI_CREDITS_200K"]      ?? "",
  aiCreditsPack500k:   process.env["STRIPE_ADDON_AI_CREDITS_500K"]      ?? "",
};

export const FLAG_ADDONS = new Set([
  "whiteLabel","customDomain","prioritySupport","retention90d","retention365d",
  "aiExecutiveReport","aiForecasting","revenueLeak","aiCro","behavioralAI",
  "aiWorkflows","marketIntelligence","agencyPacks","reviewIntelligence",
  "ssoEnterprise","zapierIntegration","advancedWebhooks","crmIntegration",
]);
export const QTY_ADDONS  = new Set([
  "monitorsPack50","extraSeats","auditsPack200","auditsPack1000",
  "pdfPack200","exportsPack1000","aiCreditsPack50k","aiCreditsPack200k","aiCreditsPack500k",
]);

export const PLAN_AI_CREDITS: Record<string, number> = {
  standard: 30000,
  pro:      100000,
  ultra:    500000,
};

/** Monthly token quota per plan (prompt_tokens + completion_tokens) */
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
