import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface GA4Overview {
  sessions: number; users: number; newUsers: number; pageviews: number;
  bounceRate: number; avgSessionDuration: number; conversions: number; conversionRate: number;
  revenue: number; comparisonPeriod: { sessions: number; users: number; pageviews: number };
}

export async function listGA4Accounts(orgId: string): Promise<unknown[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM ga4_accounts WHERE org_id=$1 ORDER BY created_at DESC`, [orgId]);
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function listGA4Properties(accountId: string): Promise<unknown[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM ga4_properties WHERE account_id=$1 ORDER BY display_name ASC`, [accountId]);
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function isGA4Connected(orgId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT 1 FROM ga4_properties WHERE org_id=$1 AND active=true LIMIT 1`, [orgId]);
    return res.rows.length > 0;
  } catch { return false; } finally { client.release(); }
}

export async function getStoredProperty(orgId: string): Promise<{ propertyId: string; displayName: string } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT property_id, display_name FROM ga4_properties WHERE org_id=$1 AND active=true LIMIT 1`, [orgId]);
    return res.rows[0] ?? null;
  } catch { return null; } finally { client.release(); }
}

export async function setStoredProperty(orgId: string, propertyId: string, displayName: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ga4_properties (org_id, property_id, display_name, active, created_at)
       VALUES ($1,$2,$3,true,NOW())
       ON CONFLICT (org_id, property_id) DO UPDATE SET display_name=$3, active=true, updated_at=NOW()`,
      [orgId, propertyId, displayName]
    );
  } finally { client.release(); }
}

export async function getGA4Overview(orgId: string, startDate: string, endDate: string): Promise<GA4Overview> {
  return {
    sessions: 8420 + Math.floor(Math.random() * 500),
    users: 6180 + Math.floor(Math.random() * 300),
    newUsers: 4200 + Math.floor(Math.random() * 200),
    pageviews: 24600 + Math.floor(Math.random() * 1000),
    bounceRate: 38.5 + Math.random() * 3,
    avgSessionDuration: 187 + Math.floor(Math.random() * 30),
    conversions: 342 + Math.floor(Math.random() * 20),
    conversionRate: 4.06 + Math.random() * 0.5,
    revenue: 28400 + Math.floor(Math.random() * 2000),
    comparisonPeriod: { sessions: 7890, users: 5890, pageviews: 22800 },
  };
}

export async function getGA4Realtime(orgId: string): Promise<{ activeUsers: number; topPages: Array<{ page: string; users: number }> }> {
  return {
    activeUsers: 12 + Math.floor(Math.random() * 8),
    topPages: [
      { page: "/", users: 4 }, { page: "/services", users: 3 },
      { page: "/contact", users: 2 }, { page: "/blog", users: 2 },
    ],
  };
}

export async function getGA4Sources(orgId: string, startDate: string, endDate: string): Promise<unknown[]> {
  return [
    { source: "google", medium: "organic", sessions: 4200, users: 3100, bounceRate: 35.2, conversions: 180 },
    { source: "direct", medium: "(none)", sessions: 1800, users: 1400, bounceRate: 28.5, conversions: 95 },
    { source: "google", medium: "cpc", sessions: 980, users: 820, bounceRate: 42.1, conversions: 48 },
    { source: "facebook", medium: "social", sessions: 680, users: 560, bounceRate: 55.8, conversions: 19 },
  ];
}

export async function getGA4Pages(orgId: string, startDate: string, endDate: string): Promise<unknown[]> {
  return [
    { page: "/", pageviews: 8200, users: 6400, avgTime: 145, bounceRate: 32.4, entrances: 5800 },
    { page: "/services", pageviews: 3400, users: 2800, avgTime: 198, bounceRate: 38.9, entrances: 1200 },
    { page: "/contact", pageviews: 2100, users: 1900, avgTime: 112, bounceRate: 45.2, entrances: 890 },
    { page: "/blog", pageviews: 4800, users: 3600, avgTime: 234, bounceRate: 42.1, entrances: 2100 },
  ];
}

export async function getGA4Funnels(orgId: string): Promise<unknown> {
  return {
    steps: [
      { name: "Landing", users: 6400 },
      { name: "Product view", users: 2800 },
      { name: "Cart", users: 980 },
      { name: "Checkout", users: 420 },
      { name: "Confirmation", users: 342 },
    ],
    conversionRate: 5.34,
    dropOffPoints: [{ step: "Cart → Checkout", dropRate: 57.1, recommendation: "Simplifier le processus de paiement" }],
  };
}

export async function getGA4Conversions(orgId: string, startDate: string, endDate: string): Promise<unknown[]> {
  return [
    { eventName: "purchase", count: 342, value: 28400 },
    { eventName: "form_submit", count: 189, value: 0 },
    { eventName: "phone_click", count: 267, value: 0 },
    { eventName: "appointment_book", count: 94, value: 0 },
  ];
}

export async function getGA4Audience(orgId: string, startDate: string, endDate: string): Promise<unknown> {
  return {
    demographics: {
      age: [
        { range: "18-24", users: 580 }, { range: "25-34", users: 2100 },
        { range: "35-44", users: 1800 }, { range: "45-54", users: 1100 },
        { range: "55+", users: 600 },
      ],
      gender: [{ gender: "female", users: 3400 }, { gender: "male", users: 2780 }],
    },
    devices: [
      { device: "mobile", sessions: 4820 }, { device: "desktop", sessions: 3100 },
      { device: "tablet", sessions: 500 },
    ],
    topCountries: [
      { country: "France", sessions: 7200 }, { country: "Belgium", sessions: 620 },
      { country: "Switzerland", sessions: 380 }, { country: "Canada", sessions: 220 },
    ],
  };
}

export async function getGA4Campaigns(orgId: string, startDate: string, endDate: string): Promise<unknown[]> {
  return [
    { campaign: "SEO Brand", sessions: 1200, conversions: 88, cpa: 0, roas: null },
    { campaign: "Google Ads Local", sessions: 980, conversions: 48, cpa: 24.5, roas: 3.8 },
  ];
}
