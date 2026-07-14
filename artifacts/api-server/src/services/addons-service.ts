import { db, orgAddonsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { store } from "./store.js";

export const ADDON_DEFINITIONS: Record<string, {
  name: string;
  category: string;
  description: string;
  price: string;
  isFlagAddon: boolean;
}> = {
  whiteLabel:          { name: "White-Label Exports",        category: "Reporting",    description: "PDF 100% white-label",                    price: "17€/mois",  isFlagAddon: true  },
  customDomain:        { name: "Custom Domain",              category: "Enterprise",   description: "Domaine personnalisé pour le portail",     price: "29€/mois",  isFlagAddon: true  },
  prioritySupport:     { name: "Support Prioritaire",        category: "Support",      description: "Réponse < 4h, canal dédié",                price: "Inclus Pro", isFlagAddon: true  },
  retention90d:        { name: "Rétention +90 jours",        category: "Storage",      description: "90 jours de données historiques",          price: "9€/mois",   isFlagAddon: true  },
  retention365d:       { name: "Rétention +365 jours",       category: "Storage",      description: "365 jours de données historiques",         price: "19€/mois",  isFlagAddon: true  },
  extraSeats:          { name: "+5 Sièges",                  category: "Team",         description: "+5 membres supplémentaires",               price: "14€/mois",  isFlagAddon: false },
  monitorsPack50:      { name: "+50 Monitors",               category: "Monitoring",   description: "+50 monitors actifs",                      price: "19€/mois",  isFlagAddon: false },
  auditsPack200:       { name: "+200 Audits",                category: "SEO",          description: "+200 audits mensuels",                     price: "9€/mois",   isFlagAddon: false },
  aiExecutiveReport:   { name: "AI Executive Reporting",     category: "IA",           description: "Résumés exécutifs IA automatiques",        price: "29€/mois",  isFlagAddon: true  },
  aiForecasting:       { name: "AI Forecasting Engine",      category: "IA",           description: "Prévisions SEO/trafic/conversion 90j",     price: "39€/mois",  isFlagAddon: true  },
  revenueLeak:         { name: "Revenue Leak AI",            category: "Conversion",   description: "Détection pertes revenus automatique",     price: "24€/mois",  isFlagAddon: true  },
  aiCro:               { name: "AI CRO Strategist",          category: "Conversion",   description: "Recommandations CRO et A/B tests IA",      price: "29€/mois",  isFlagAddon: true  },
  behavioralAI:        { name: "Behavioral AI",              category: "UX",           description: "Tracking comportemental + insights IA",    price: "19€/mois",  isFlagAddon: true  },
  aiWorkflows:         { name: "AI Automation Workflows",    category: "Automation",   description: "Workflows IA multi-étapes",                price: "24€/mois",  isFlagAddon: true  },
  marketIntelligence:  { name: "AI Market Intelligence",     category: "IA",           description: "Veille concurrentielle IA interne",        price: "49€/mois",  isFlagAddon: true  },
  agencyPacks:         { name: "Agency Reporting Packs",     category: "Reporting",    description: "Templates rapports multi-clients",         price: "19€/mois",  isFlagAddon: true  },
  reviewIntelligence:  { name: "Review Intelligence",        category: "Local SEO",    description: "Analyse avis et réponses IA",              price: "19€/mois",  isFlagAddon: true  },
  ssoEnterprise:       { name: "SSO Enterprise",             category: "Enterprise",   description: "OAuth/JWT SSO interne",                    price: "49€/mois",  isFlagAddon: true  },
  zapierIntegration:   { name: "Zapier/Make Integration",    category: "Integrations", description: "Webhooks Zapier et Make.com",              price: "14€/mois",  isFlagAddon: true  },
  advancedWebhooks:    { name: "Advanced Webhooks",          category: "Integrations", description: "Webhooks configurables multi-events",      price: "9€/mois",   isFlagAddon: true  },
  crmIntegration:      { name: "CRM Integrations",          category: "Integrations", description: "Sync CRM via webhooks internes",           price: "19€/mois",  isFlagAddon: true  },
  aiCreditsPack50k:    { name: "+50k AI Credits",            category: "IA",           description: "Pack crédits IA supplémentaires",          price: "4€",        isFlagAddon: false },
  aiCreditsPack200k:   { name: "+200k AI Credits",           category: "IA",           description: "Pack crédits IA best value",               price: "9€",        isFlagAddon: false },
  aiCreditsPack500k:   { name: "+500k AI Credits",           category: "IA",           description: "Pack crédits IA Pro+",                     price: "19€",       isFlagAddon: false },
};

export async function activateAddon(addonKey: string, orgId = "default"): Promise<boolean> {
  if (!ADDON_DEFINITIONS[addonKey]) {
    logger.warn({ addonKey }, "[Addons] Unknown addon key");
    return false;
  }
  try {
    const id = `oa_${orgId}_${addonKey}`;
    await db.insert(orgAddonsTable).values({
      id,
      orgId,
      addonKey,
      active: true,
      activatedAt: new Date(),
      metadata: { source: "manual" },
    }).onConflictDoNothing();

    const client = await (await import("@workspace/db")).pool.connect();
    try {
      await client.query(
        `UPDATE org_addons SET active = true, activated_at = NOW(), updated_at = NOW() WHERE org_id = $1 AND addon_key = $2`,
        [orgId, addonKey]
      );
    } finally {
      client.release();
    }

    applyAddonToStore(addonKey, true);
    store.broadcast({ type: "addon:activated", addonKey }, orgId);
    store.logActivity({ type: "team", label: `Add-on activé : ${ADDON_DEFINITIONS[addonKey]?.name ?? addonKey}`, metadata: { addonKey } }).catch(err => logger.warn("logActivity failed", { err: err?.message }));

    logger.info({ addonKey, orgId }, "[Addons] Addon activated");
    return true;
  } catch (err) {
    logger.error({ err, addonKey }, "[Addons] Failed to activate addon");
    return false;
  }
}

export async function deactivateAddon(addonKey: string, orgId = "default"): Promise<boolean> {
  try {
    const client = await (await import("@workspace/db")).pool.connect();
    try {
      await client.query(
        `UPDATE org_addons SET active = false, updated_at = NOW() WHERE org_id = $1 AND addon_key = $2`,
        [orgId, addonKey]
      );
    } finally {
      client.release();
    }
    applyAddonToStore(addonKey, false);
    store.broadcast({ type: "addon:deactivated", addonKey }, orgId);
    return true;
  } catch (err) {
    logger.error({ err, addonKey }, "[Addons] Failed to deactivate addon");
    return false;
  }
}

export async function getOrgAddons(orgId = "default"): Promise<Record<string, boolean | number>> {
  try {
    const rows = await db.select().from(orgAddonsTable).where(eq(orgAddonsTable.orgId, orgId));
    const result: Record<string, boolean | number> = {};
    for (const row of rows) {
      result[row.addonKey] = row.active ?? false;
    }
    return result;
  } catch {
    return { ...store.me.addons };
  }
}

export function applyAddonToStore(addonKey: string, active: boolean | number): void {
  const addons = store.me.addons as Record<string, boolean | number>;
  addons[addonKey] = active;
}

export async function addExtraAICredits(pack: "50k" | "200k" | "500k", orgId = "default"): Promise<number> {
  const packMap = { "50k": 50000, "200k": 200000, "500k": 500000 };
  const credits = packMap[pack];
  // NOTE: extra credits are recorded in ai_credit_purchases (Stripe webhook handles that).
  // ai_monthly_usage no longer stores credits_extra — limit comes exclusively from plans.ts.
  store.broadcast({ type: "ai:credits_added", credits, pack }, orgId);
  return credits;
}

export function getQuotaLimits(plan: string, addons: Record<string, boolean | number>): {
  audits: number; monitors: number; reports: number; seats: number; retention: number;
} {
  const base: Record<string, { audits: number; monitors: number; reports: number; seats: number; retention: number }> = {
    standard: { audits: 30,   monitors: 10,  reports: 30,   seats: 1,  retention: 30  },
    pro:      { audits: 300,  monitors: 50,  reports: 300,  seats: 5,  retention: 90  },
    ultra:    { audits: 1000, monitors: 300, reports: 1000, seats: 10, retention: 365 },
  };
  const limits = { ...(base[plan.toLowerCase()] ?? base.standard) };

  if (addons.monitorsPack50) limits.monitors += Number(addons.monitorsPack50) * 50;
  if (addons.auditsPack200)  limits.audits   += 200;
  if (addons.auditsPack1000) limits.audits   += 1000;
  if (addons.extraSeats)     limits.seats    += Number(addons.extraSeats) * 5;
  if (addons.retention365d)  limits.retention = 365;
  else if (addons.retention90d) limits.retention = 90;

  return limits;
}
