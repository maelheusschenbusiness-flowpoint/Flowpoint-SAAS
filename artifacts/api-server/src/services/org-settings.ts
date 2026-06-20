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
  // Extended fields (migration 005)
  firstName: string | null;
  lastName: string | null;
  orgName: string | null;
  website: string | null;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  addons: Record<string, unknown>;
  usage: Record<string, unknown>;
  // Location fields (migration 006)
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  serviceArea: string[];
  locationConfigured: boolean;
  locationSource: string | null;
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
        firstName: r.first_name ?? null,
        lastName: r.last_name ?? null,
        orgName: r.org_name ?? r.name ?? null,
        website: r.website ?? null,
        subscriptionStatus: r.subscription_status ?? null,
        stripeCustomerId: r.stripe_customer_id ?? null,
        addons: r.addons ?? {},
        usage: r.usage ?? {},
        address: r.address ?? null,
        city: r.city ?? null,
        postalCode: r.postal_code ?? null,
        country: r.country ?? null,
        latitude: r.latitude != null ? parseFloat(r.latitude) : null,
        longitude: r.longitude != null ? parseFloat(r.longitude) : null,
        serviceArea: Array.isArray(r.service_area) ? r.service_area : (r.service_area ? JSON.parse(r.service_area) : []),
        locationConfigured: r.location_configured ?? false,
        locationSource: r.location_source ?? null,
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
      `INSERT INTO org_settings (
         org_id, plan, email, name, logo_url, timezone, language, currency,
         monthly_budget, primary_site, industry, company_size, billing_email, trial_ends_at,
         first_name, last_name, org_name, website, subscription_status, stripe_customer_id,
         addons, usage,
         address, city, postal_code, country, latitude, longitude,
         service_area, location_configured, location_source,
         created_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,NOW(),NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         plan                = COALESCE(EXCLUDED.plan,              org_settings.plan),
         email               = COALESCE(EXCLUDED.email,             org_settings.email),
         name                = COALESCE(EXCLUDED.name,              org_settings.name),
         logo_url            = COALESCE(EXCLUDED.logo_url,          org_settings.logo_url),
         timezone            = COALESCE(EXCLUDED.timezone,          org_settings.timezone),
         language            = COALESCE(EXCLUDED.language,          org_settings.language),
         currency            = COALESCE(EXCLUDED.currency,          org_settings.currency),
         monthly_budget      = COALESCE(EXCLUDED.monthly_budget,    org_settings.monthly_budget),
         primary_site        = COALESCE(EXCLUDED.primary_site,      org_settings.primary_site),
         industry            = COALESCE(EXCLUDED.industry,          org_settings.industry),
         company_size        = COALESCE(EXCLUDED.company_size,      org_settings.company_size),
         billing_email       = COALESCE(EXCLUDED.billing_email,     org_settings.billing_email),
         trial_ends_at       = COALESCE(EXCLUDED.trial_ends_at,     org_settings.trial_ends_at),
         first_name          = COALESCE(EXCLUDED.first_name,        org_settings.first_name),
         last_name           = COALESCE(EXCLUDED.last_name,         org_settings.last_name),
         org_name            = COALESCE(EXCLUDED.org_name,          org_settings.org_name),
         website             = COALESCE(EXCLUDED.website,           org_settings.website),
         subscription_status = COALESCE(EXCLUDED.subscription_status, org_settings.subscription_status),
         stripe_customer_id  = COALESCE(EXCLUDED.stripe_customer_id, org_settings.stripe_customer_id),
         addons              = COALESCE(EXCLUDED.addons,            org_settings.addons),
         usage               = COALESCE(EXCLUDED.usage,             org_settings.usage),
         address             = COALESCE(EXCLUDED.address,           org_settings.address),
         city                = COALESCE(EXCLUDED.city,              org_settings.city),
         postal_code         = COALESCE(EXCLUDED.postal_code,       org_settings.postal_code),
         country             = COALESCE(EXCLUDED.country,           org_settings.country),
         latitude            = COALESCE(EXCLUDED.latitude,          org_settings.latitude),
         longitude           = COALESCE(EXCLUDED.longitude,         org_settings.longitude),
         service_area        = COALESCE(EXCLUDED.service_area,      org_settings.service_area),
         location_configured = COALESCE(EXCLUDED.location_configured, org_settings.location_configured),
         location_source     = COALESCE(EXCLUDED.location_source,   org_settings.location_source),
         updated_at          = NOW()`,
      [
        orgId,
        data.plan             ?? null,
        data.email            ?? null,
        data.name             ?? null,
        data.logoUrl          ?? null,
        data.timezone         ?? null,
        data.language         ?? null,
        data.currency         ?? null,
        data.monthlyBudget    ?? null,
        data.primarySite      ?? null,
        data.industry         ?? null,
        data.companySize      ?? null,
        data.billingEmail     ?? null,
        data.trialEndsAt      ?? null,
        data.firstName        ?? null,
        data.lastName         ?? null,
        data.orgName          ?? null,
        data.website          ?? null,
        data.subscriptionStatus ?? null,
        data.stripeCustomerId ?? null,
        data.addons           ? JSON.stringify(data.addons)  : null,
        data.usage            ? JSON.stringify(data.usage)   : null,
        data.address          ?? null,
        data.city             ?? null,
        data.postalCode       ?? null,
        data.country          ?? null,
        data.latitude         ?? null,
        data.longitude        ?? null,
        data.serviceArea      ? JSON.stringify(data.serviceArea) : null,
        data.locationConfigured ?? null,
        data.locationSource   ?? null,
      ]
    );
    return (await loadOrgSettings(orgId))!;
  } finally {
    client.release();
  }
}
