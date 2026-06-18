import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface OrgSettings {
  orgId: string;
  plan: string;
  email: string | null;
  name: string | null;
  logoUrl: string | null;
  timezone: string;
  language: string;
  currency: string;
  monthlyBudget: number | null;
  primarySite: string | null;
  industry: string | null;
  companySize: string | null;
  billingEmail: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function loadOrgSettings(orgId = "default"): Promise<OrgSettings | null> {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT * FROM org_settings WHERE org_id = $1 LIMIT 1`,
        [orgId]
      );
      if (!res.rows[0]) return null;
      const r = res.rows[0];
      return {
        orgId: r.org_id,
        plan: r.plan ?? "pro",
        email: r.email ?? null,
        name: r.name ?? null,
        logoUrl: r.logo_url ?? null,
        timezone: r.timezone ?? "Europe/Paris",
        language: r.language ?? "fr",
        currency: r.currency ?? "EUR",
        monthlyBudget: r.monthly_budget ?? null,
        primarySite: r.primary_site ?? null,
        industry: r.industry ?? null,
        companySize: r.company_size ?? null,
        billingEmail: r.billing_email ?? null,
        trialEndsAt: r.trial_ends_at ?? null,
        createdAt: r.created_at ?? new Date().toISOString(),
        updatedAt: r.updated_at ?? new Date().toISOString(),
      };
    } finally {
      client.release();
    }
  } catch (err) {
    logger.debug({ err }, "[org-settings] loadOrgSettings failed");
    return null;
  }
}

export async function upsertOrgSettings(orgId: string, data: Partial<Omit<OrgSettings, "orgId" | "createdAt" | "updatedAt">>): Promise<OrgSettings> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO org_settings (org_id, plan, email, name, logo_url, timezone, language, currency, monthly_budget, primary_site, industry, company_size, billing_email, trial_ends_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         plan           = COALESCE(EXCLUDED.plan, org_settings.plan),
         email          = COALESCE(EXCLUDED.email, org_settings.email),
         name           = COALESCE(EXCLUDED.name, org_settings.name),
         logo_url       = COALESCE(EXCLUDED.logo_url, org_settings.logo_url),
         timezone       = COALESCE(EXCLUDED.timezone, org_settings.timezone),
         language       = COALESCE(EXCLUDED.language, org_settings.language),
         currency       = COALESCE(EXCLUDED.currency, org_settings.currency),
         monthly_budget = COALESCE(EXCLUDED.monthly_budget, org_settings.monthly_budget),
         primary_site   = COALESCE(EXCLUDED.primary_site, org_settings.primary_site),
         industry       = COALESCE(EXCLUDED.industry, org_settings.industry),
         company_size   = COALESCE(EXCLUDED.company_size, org_settings.company_size),
         billing_email  = COALESCE(EXCLUDED.billing_email, org_settings.billing_email),
         updated_at     = NOW()`,
      [
        orgId,
        data.plan ?? null,
        data.email ?? null,
        data.name ?? null,
        data.logoUrl ?? null,
        data.timezone ?? null,
        data.language ?? null,
        data.currency ?? null,
        data.monthlyBudget ?? null,
        data.primarySite ?? null,
        data.industry ?? null,
        data.companySize ?? null,
        data.billingEmail ?? null,
        data.trialEndsAt ?? null,
      ]
    );
    return (await loadOrgSettings(orgId))!;
  } finally {
    client.release();
  }
}
