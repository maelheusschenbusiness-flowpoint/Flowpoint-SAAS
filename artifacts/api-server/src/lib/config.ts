/**
 * FlowPoint — Master centralized configuration
 * Single source of truth for plan limits, feature flags, quotas, rate limits, AI limits.
 * Import this anywhere instead of scattering constants across services.
 */

// ── Plan tiers ────────────────────────────────────────────────────────────────
export type PlanTier = 'standard' | 'pro' | 'ultra' | 'agency';

export const PLAN_TIERS: PlanTier[] = ['standard', 'pro', 'ultra', 'agency'];

export function normalizePlan(plan: string): PlanTier {
  const p = plan.toLowerCase();
  if (p === 'agency' || p === 'ultra') return p as PlanTier;
  if (p === 'pro') return 'pro';
  return 'standard';
}

export function planIndex(plan: PlanTier): number {
  return { standard: 0, pro: 1, ultra: 2, agency: 3 }[plan] ?? 0;
}

export function planAtLeast(current: string, required: PlanTier): boolean {
  return planIndex(normalizePlan(current)) >= planIndex(required);
}

// ── Core resource quotas ──────────────────────────────────────────────────────
export interface CoreQuotas {
  audits:          number;
  monitors:        number;
  reports:         number;
  exports:         number;
  teamMembers:     number;
  keywords:        number;
  competitors:     number;
  heatmaps:        number;
  automations:     number;
  missions:        number;
  gbpPosts:        number;
  crmIntegrations: number;
}

export const CORE_QUOTAS: Record<PlanTier, CoreQuotas> = {
  standard: { audits:30,    monitors:3,   reports:30,   exports:30,   teamMembers:1,  keywords:50,   competitors:5,   heatmaps:2,   automations:3,  missions:20,  gbpPosts:10,  crmIntegrations:1 },
  pro:      { audits:300,   monitors:50,  reports:300,  exports:300,  teamMembers:5,  keywords:500,  competitors:25,  heatmaps:10,  automations:20, missions:200, gbpPosts:100, crmIntegrations:3 },
  ultra:    { audits:2000,  monitors:300, reports:2000, exports:2000, teamMembers:10, keywords:5000, competitors:100, heatmaps:50,  automations:100,missions:999, gbpPosts:999, crmIntegrations:10 },
  agency:   { audits:10000, monitors:999, reports:9999, exports:9999, teamMembers:50, keywords:9999, competitors:500, heatmaps:200, automations:999,missions:9999,gbpPosts:9999,crmIntegrations:50 },
};

// ── AI limits ─────────────────────────────────────────────────────────────────
export interface AILimits {
  creditsMonthly:     number;  // token budget per month
  reportsPerMonth:    number;
  summariesPerDay:    number;
  imageGenPerMonth:   number;
  maxPromptTokens:    number;
  model:              string;
}

export const AI_LIMITS: Record<PlanTier, AILimits> = {
  standard: { creditsMonthly:30000,  reportsPerMonth:5,   summariesPerDay:10,  imageGenPerMonth:0,   maxPromptTokens:2000,  model:'gpt-4o-mini' },
  pro:      { creditsMonthly:100000, reportsPerMonth:50,  summariesPerDay:100, imageGenPerMonth:20,  maxPromptTokens:8000,  model:'gpt-4o-mini' },
  ultra:    { creditsMonthly:500000, reportsPerMonth:500, summariesPerDay:999, imageGenPerMonth:200, maxPromptTokens:32000, model:'gpt-4o' },
  agency:   { creditsMonthly:999999, reportsPerMonth:999, summariesPerDay:999, imageGenPerMonth:999, maxPromptTokens:32000, model:'gpt-4o' },
};

// ── Rate limits (requests per window) ─────────────────────────────────────────
export interface RateLimits {
  globalPerMinute:   number;  // total requests per minute per org
  aiPerMinute:       number;  // AI endpoint calls per minute
  reportsPerHour:    number;
  exportsPerHour:    number;
  webhooksPerMinute: number;
}

export const RATE_LIMITS: Record<PlanTier, RateLimits> = {
  standard: { globalPerMinute:120,  aiPerMinute:5,  reportsPerHour:10,  exportsPerHour:10,  webhooksPerMinute:10 },
  pro:      { globalPerMinute:2000, aiPerMinute:60, reportsPerHour:120, exportsPerHour:120, webhooksPerMinute:60 },
  ultra:    { globalPerMinute:5000, aiPerMinute:200,reportsPerHour:600, exportsPerHour:600, webhooksPerMinute:300 },
  agency:   { globalPerMinute:9999, aiPerMinute:999,reportsPerHour:999, exportsPerHour:999, webhooksPerMinute:999 },
};

// ── Feature flags ──────────────────────────────────────────────────────────────
export interface FeatureFlags {
  sso:                boolean;
  saml:               boolean;
  whiteLabel:         boolean;
  customDomain:       boolean;
  localDominationMaps:boolean;
  geoGridSize9x9:     boolean;
  competitorIntelAI:  boolean;
  marketIntelligence: boolean;
  reviewIntelAI:      boolean;
  gbpPosting:         boolean;
  crmIntegration:     boolean;
  rbacCustomRoles:    boolean;
  advancedReports:    boolean;
  pdfExport:          boolean;
  apiAccess:          boolean;
  webhooks:           boolean;
  zapierIntegration:  boolean;
  behavioralAI:       boolean;
  forecastingAI:      boolean;
  revenueLeakAI:      boolean;
  cro:                boolean;
  multiLocation:      boolean;
  prioritySupport:    boolean;
}

export const FEATURE_FLAGS: Record<PlanTier, FeatureFlags> = {
  standard: {
    sso:false, saml:false, whiteLabel:false, customDomain:false,
    localDominationMaps:true, geoGridSize9x9:false, competitorIntelAI:false,
    marketIntelligence:false, reviewIntelAI:false, gbpPosting:true,
    crmIntegration:false, rbacCustomRoles:false, advancedReports:false,
    pdfExport:true, apiAccess:false, webhooks:false, zapierIntegration:false,
    behavioralAI:false, forecastingAI:false, revenueLeakAI:false,
    cro:false, multiLocation:false, prioritySupport:false,
  },
  pro: {
    sso:true, saml:false, whiteLabel:false, customDomain:false,
    localDominationMaps:true, geoGridSize9x9:false, competitorIntelAI:true,
    marketIntelligence:true, reviewIntelAI:true, gbpPosting:true,
    crmIntegration:true, rbacCustomRoles:true, advancedReports:true,
    pdfExport:true, apiAccess:true, webhooks:true, zapierIntegration:false,
    behavioralAI:true, forecastingAI:true, revenueLeakAI:true,
    cro:true, multiLocation:false, prioritySupport:false,
  },
  ultra: {
    sso:true, saml:true, whiteLabel:true, customDomain:true,
    localDominationMaps:true, geoGridSize9x9:true, competitorIntelAI:true,
    marketIntelligence:true, reviewIntelAI:true, gbpPosting:true,
    crmIntegration:true, rbacCustomRoles:true, advancedReports:true,
    pdfExport:true, apiAccess:true, webhooks:true, zapierIntegration:true,
    behavioralAI:true, forecastingAI:true, revenueLeakAI:true,
    cro:true, multiLocation:true, prioritySupport:true,
  },
  agency: {
    sso:true, saml:true, whiteLabel:true, customDomain:true,
    localDominationMaps:true, geoGridSize9x9:true, competitorIntelAI:true,
    marketIntelligence:true, reviewIntelAI:true, gbpPosting:true,
    crmIntegration:true, rbacCustomRoles:true, advancedReports:true,
    pdfExport:true, apiAccess:true, webhooks:true, zapierIntegration:true,
    behavioralAI:true, forecastingAI:true, revenueLeakAI:true,
    cro:true, multiLocation:true, prioritySupport:true,
  },
};

// ── Retention limits ──────────────────────────────────────────────────────────
export const DATA_RETENTION_DAYS: Record<PlanTier, number> = {
  standard: 30,
  pro:      90,
  ultra:    365,
  agency:   730,
};

// ── Timeout configuration ─────────────────────────────────────────────────────
export const TIMEOUTS = {
  openai:      30_000,   // ms
  google:      15_000,
  dataforseo:  20_000,
  betterstack: 10_000,
  stripe:      15_000,
  monitor:     10_000,
  webhook:     8_000,
} as const;

// ── Retry configuration ───────────────────────────────────────────────────────
export const RETRY_CONFIG = {
  openai:      { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 8000 },
  dataforseo:  { maxAttempts: 3, baseDelayMs: 500,  maxDelayMs: 5000 },
  webhook:     { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30000 },
  monitor:     { maxAttempts: 2, baseDelayMs: 500,  maxDelayMs: 2000 },
  email:       { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 15000 },
} as const;

// ── Cache TTLs ─────────────────────────────────────────────────────────────────
export const CACHE_TTL = {
  me:              60,     // seconds
  overview:        120,
  keywords:        300,
  competitors:     300,
  marketIntel:     600,
  localMaps:       300,
  reports:         120,
  permissions:     120,
  planLimits:      300,
  aiRecommendations: 3600,
} as const;

// ── Helper accessors ───────────────────────────────────────────────────────────
export function getQuota(plan: string, resource: keyof CoreQuotas): number {
  return CORE_QUOTAS[normalizePlan(plan)][resource] ?? 0;
}

export function getFeature(plan: string, feature: keyof FeatureFlags): boolean {
  return FEATURE_FLAGS[normalizePlan(plan)][feature] ?? false;
}

export function getAILimit(plan: string, limit: keyof AILimits): number | string {
  return AI_LIMITS[normalizePlan(plan)][limit];
}

export function getRateLimit(plan: string, type: keyof RateLimits): number {
  return RATE_LIMITS[normalizePlan(plan)][type] ?? 60;
}

export function getRetentionDays(plan: string): number {
  return DATA_RETENTION_DAYS[normalizePlan(plan)] ?? 30;
}

export function getPlanConfig(plan: string): {
  quotas: CoreQuotas; ai: AILimits; rates: RateLimits;
  features: FeatureFlags; retentionDays: number; tier: PlanTier;
} {
  const tier = normalizePlan(plan);
  return {
    tier,
    quotas:       CORE_QUOTAS[tier],
    ai:           AI_LIMITS[tier],
    rates:        RATE_LIMITS[tier],
    features:     FEATURE_FLAGS[tier],
    retentionDays: DATA_RETENTION_DAYS[tier],
  };
}
