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
  // ── Monitoring ──────────────────────────────────────────────────────────────
  monitorsPack10:      process.env["STRIPE_ADDON_MONITORS_PACK10"]  ?? "",
  monitorsPack50:      process.env["STRIPE_ADDON_MONITORS_PACK50"]  ?? "price_1T6A839eqtbj6iPBTXCaiv0W",
  globalMonitoring:    process.env["STRIPE_ADDON_GLOBAL_MONITORING"]?? "",
  slaMonitoring:       process.env["STRIPE_ADDON_SLA_MONITORING"]   ?? "",

  // ── SEO ────────────────────────────────────────────────────────────────────
  advancedSeoLab:      process.env["STRIPE_ADDON_ADVANCED_SEO_LAB"] ?? "",
  keywordDomination:   process.env["STRIPE_ADDON_KEYWORD_DOM"]      ?? "",
  backlinkIntelligence:process.env["STRIPE_ADDON_BACKLINK_INTEL"]   ?? "",
  aiContentStrategist: process.env["STRIPE_ADDON_AI_CONTENT"]       ?? "",

  // ── Local SEO ─────────────────────────────────────────────────────────────
  gbpSlots10:          process.env["STRIPE_ADDON_GBP_SLOTS_10"]     ?? "",
  aiGbpPosting:        process.env["STRIPE_ADDON_AI_GBP_POSTING"]   ?? "",
  reviewIntelligence:  process.env["STRIPE_ADDON_REVIEW_INTELLIGENCE"] ?? "",
  localDominationMaps: process.env["STRIPE_ADDON_LOCAL_DOM_MAPS"]   ?? "",

  // ── Conversion / AI ────────────────────────────────────────────────────────
  aiCro:               process.env["STRIPE_ADDON_AI_CRO"]               ?? "",
  behavioralAI:        process.env["STRIPE_ADDON_BEHAVIORAL_AI"]        ?? "",
  revenueLeak:         process.env["STRIPE_ADDON_REVENUE_LEAK"]         ?? "",
  abTestingAI:         process.env["STRIPE_ADDON_AB_TESTING_AI"]        ?? "",

  // ── Reporting ─────────────────────────────────────────────────────────────
  whiteLabel:          process.env["STRIPE_ADDON_WHITE_LABEL"]          ?? "",
  agencyPacks:         process.env["STRIPE_ADDON_AGENCY_PACKS"]         ?? "",
  aiExecutiveReport:   process.env["STRIPE_ADDON_AI_EXECUTIVE_REPORT"]  ?? "",
  aiForecasting:       process.env["STRIPE_ADDON_AI_FORECASTING"]       ?? "",

  // ── Intelligence ──────────────────────────────────────────────────────────
  marketIntelligence:  process.env["STRIPE_ADDON_MARKET_INTELLIGENCE"]  ?? "",
  aiWorkflows:         process.env["STRIPE_ADDON_AI_WORKFLOWS"]         ?? "",

  // ── Team ──────────────────────────────────────────────────────────────────
  extraSeats:          process.env["STRIPE_ADDON_EXTRA_SEATS"]      ?? "price_1T6AB29eqtbj6iPBYcWdWqXZ",
  enterprisePermissions:process.env["STRIPE_ADDON_ENTERPRISE_PERMS"]?? "",

  // ── Data retention ────────────────────────────────────────────────────────
  retention90d:        process.env["STRIPE_ADDON_RETENTION_90D"]    ?? "price_1T6APj9eqtbj6iPBXxYeJDzH",
  retention365d:       process.env["STRIPE_ADDON_RETENTION_365D"]   ?? "price_1T6AQc9eqtbj6iPBEGxIWH2I",

  // ── Integrations ──────────────────────────────────────────────────────────
  advancedWebhooks:    process.env["STRIPE_ADDON_WEBHOOKS"]         ?? "",
  zapierIntegration:   process.env["STRIPE_ADDON_ZAPIER"]           ?? "",
  crmIntegration:      process.env["STRIPE_ADDON_CRM"]              ?? "",

  // ── Enterprise ─────────────────────────────────────────────────────────────
  customDomain:        process.env["STRIPE_ADDON_CUSTOM_DOMAIN"]    ?? "price_1T6ANQ9eqtbj6iPB4OVhPmh3",
  ssoEnterprise:       process.env["STRIPE_ADDON_SSO"]              ?? "",
  aiWorkspaceLaunch:   process.env["STRIPE_ADDON_AI_WORKSPACE"]     ?? "",

  // ── Support ────────────────────────────────────────────────────────────────
  prioritySupport:     process.env["STRIPE_ADDON_PRIORITY_SUPPORT"] ?? "price_1T6AOd9eqtbj6iPBz7CUiIge",

  // ── Legacy packs (still redeemable via API) ────────────────────────────────
  auditsPack200:       process.env["STRIPE_ADDON_AUDITS_PACK200"]   ?? "price_1T6AHh9eqtbj6iPBb8rj1l1P",
  auditsPack1000:      process.env["STRIPE_ADDON_AUDITS_PACK1000"]  ?? "price_1T6AIt9eqtbj6iPBxqy7CduM",
  pdfPack200:          process.env["STRIPE_ADDON_PDF_PACK200"]      ?? "price_1T6AJL9eqtbj6iPBbIpRPzVf",
  exportsPack1000:     process.env["STRIPE_ADDON_EXPORTS_PACK1000"] ?? "price_1T6AKW9eqtbj6iPBGJdJ96TQ",

  // ── AI Credit packs (one-time purchases) ──────────────────────────────────
  aiCreditsPack50k:    process.env["STRIPE_ADDON_AI_CREDITS_50K"]   ?? "",
  aiCreditsPack200k:   process.env["STRIPE_ADDON_AI_CREDITS_200K"]  ?? "",
  aiCreditsPack500k:   process.env["STRIPE_ADDON_AI_CREDITS_500K"]  ?? "",
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
export const QTY_ADDONS  = new Set([
  "monitorsPack10","monitorsPack50","gbpSlots10","extraSeats",
  "auditsPack200","auditsPack1000","pdfPack200","exportsPack1000",
  "aiCreditsPack50k","aiCreditsPack200k","aiCreditsPack500k",
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
