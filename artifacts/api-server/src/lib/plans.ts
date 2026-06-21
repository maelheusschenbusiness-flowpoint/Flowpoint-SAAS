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
  standard: process.env["STRIPE_PRICE_ID_STANDARD"] ?? "",
  pro:      process.env["STRIPE_PRICE_ID_PRO"]      ?? "",
  ultra:    process.env["STRIPE_PRICE_ID_ULTRA"]     ?? "",
};

export const ADDON_PRICE_IDS: Record<string, string> = {
  // ── Monitoring ──────────────────────────────────────────────────────────────
  monitorsPack10:       process.env["STRIPE_PRICE_ID_10MONITORS"]               ?? "",
  monitorsPack50:       process.env["STRIPE_PRICE_ID_50MONITORS"]               ?? "",
  globalMonitoring:     process.env["STRIPE_PRICE_ID_GLOBAL_MONITORING"]        ?? "",
  slaMonitoring:        process.env["STRIPE_PRICE_ID_SLA_MONITORING_ADVANCED"]  ?? "",

  // ── SEO ────────────────────────────────────────────────────────────────────
  advancedSeoLab:       process.env["STRIPE_PRICE_ID_ADVANCED_SEO_LAB"]         ?? "",
  keywordDomination:    process.env["STRIPE_PRICE_ID_KEYBORD_DOMINATION_ENGINE"] ?? "",
  backlinkIntelligence: process.env["STRIPE_PRICE_ID_BACKLINK_INTELLIGENCE"]    ?? "",
  aiContentStrategist:  process.env["STRIPE_PRICE_ID_AI_CONTENT_STRATEGIST"]    ?? "",

  // ── Local SEO ─────────────────────────────────────────────────────────────
  gbpSlots10:           process.env["STRIPE_PRICE_ID_10GBPLOCATIONS"]           ?? "",
  aiGbpPosting:         process.env["STRIPE_PRICE_ID_AI_GBP_POSTING"]           ?? "",
  reviewIntelligence:   process.env["STRIPE_PRICE_ID_REVIEW_INTELLIGENCE"]      ?? "",
  localDominationMaps:  process.env["STRIPE_PRICE_ID_LOCAL_DOMINATION_MAPS"]    ?? "",

  // ── Conversion / AI ────────────────────────────────────────────────────────
  aiCro:                process.env["STRIPE_PRICE_ID_AI_CRO_STRATEGIST"]        ?? "",
  behavioralAI:         process.env["STRIPE_PRICE_ID_BEHAVORIAL_AI"]            ?? "",
  revenueLeak:          process.env["STRIPE_PRICE_ID_REVENUE_LEAK_AI"]          ?? "",
  abTestingAI:          process.env["STRIPE_PRICE_ID_AB_TESTING_AI"]            ?? "",

  // ── Reporting ─────────────────────────────────────────────────────────────
  whiteLabel:           process.env["STRIPE_PRICE_ID_WHITE_LABEL_EXPORTS"]      ?? "",
  agencyPacks:          process.env["STRIPE_PRICE_ID_AGENCY_REPORTING_PACKS"]   ?? "",
  aiExecutiveReport:    process.env["STRIPE_PRICE_ID_AI_EXECUTIVE_REPORTING"]   ?? "",
  aiForecasting:        process.env["STRIPE_PRICE_ID_AI_FORECASTING_ENGINE"]    ?? "",

  // ── Intelligence ──────────────────────────────────────────────────────────
  marketIntelligence:   process.env["STRIPE_PRICE_ID_AI_MARKET_INTELLIGENCE"]   ?? "",
  aiWorkflows:          process.env["STRIPE_PRICE_ID_AI_AUTOMATION_WORKFLOWS"]  ?? "",

  // ── Team ──────────────────────────────────────────────────────────────────
  extraSeats:           process.env["STRIPE_PRICE_ID_5SEATS"]                   ?? "",
  enterprisePermissions:process.env["STRIPE_PRICE_ID_ENTERPRISE_PERMISSIONS"]   ?? "",

  // ── Data retention ────────────────────────────────────────────────────────
  retention90d:         process.env["STRIPE_PRICE_ID_RETENTION90D"]             ?? "",
  retention365d:        process.env["STRIPE_PRICE_ID_RETENTION365D"]            ?? "",

  // ── Integrations ──────────────────────────────────────────────────────────
  advancedWebhooks:     process.env["STRIPE_PRICE_ID_ADVANCED_WEBHOOKS"]        ?? "",
  zapierIntegration:    process.env["STRIPE_PRICE_ID_ZAPIER_MAKE_INTEGRATION"]  ?? "",
  crmIntegration:       process.env["STRIPE_PRICE_ID_CRM_INTEGRATIONS"]         ?? "",

  // ── Enterprise ─────────────────────────────────────────────────────────────
  customDomain:         process.env["STRIPE_PRICE_ID_CUSTOM_DOMAIN"]            ?? "",
  ssoEnterprise:        process.env["STRIPE_PRICE_ID_SSO_ENTERPRISE"]           ?? "",
  aiWorkspaceLaunch:    process.env["STRIPE_PRICE_ID_AI_WORKSPACE_LAUNCH"]      ?? "",

  // ── Support ────────────────────────────────────────────────────────────────
  prioritySupport:      process.env["STRIPE_PRICE_ID_PRIORITY_SUPPORT"]         ?? "",

  // ── Legacy packs (still redeemable via API) ────────────────────────────────
  auditsPack200:        process.env["STRIPE_PRICE_ID_AUDITS_PACK200"]           ?? "",
  auditsPack1000:       process.env["STRIPE_PRICE_ID_AUDITS_PACK1000"]          ?? "",
  pdfPack200:           process.env["STRIPE_PRICE_ID_PDF_PACK200"]              ?? "",
  exportsPack1000:      process.env["STRIPE_PRICE_ID_EXPORTS_PACK1000"]         ?? "",

  // ── AI Credit packs (one-time purchases) ──────────────────────────────────
  aiCreditsPack50k:     process.env["STRIPE_PRICE_AI_50K"]  ?? process.env["STRIPE_PRICE_ID_AI_CREDITS_50K"]  ?? "",
  aiCreditsPack200k:    process.env["STRIPE_PRICE_AI_200K"] ?? process.env["STRIPE_PRICE_ID_AI_CREDITS_200K"] ?? "",
  aiCreditsPack500k:    process.env["STRIPE_PRICE_AI_500K"] ?? process.env["STRIPE_PRICE_ID_AI_CREDITS_500K"] ?? "",
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
