/**
 * conversion-service.ts
 * GA4 data for the Conversion page.
 * Never returns synthetic/fake data — returns empty shapes + connected:false on GA4 failure.
 *
 * All conversion rates are calculated deterministically:
 *   conversionRate = conversions / sessions × 100
 *   avgRevenuePerConversion = revenue / conversions
 *   avgTransactionValue = revenue / transactions
 * Division-by-zero always returns null.
 */
import {
  isGA4Connected,
  getGA4Overview,
  getGA4Conversions,
  getGA4Sources,
  getGA4ConversionPages,
  getGA4ConversionDevices,
  getGA4ConversionGeo,
} from "./ga4-service.js";

function safe(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 10000) / 10000 : null;
}

function pct(n: number, d: number): number | null {
  const r = safe(n, d);
  return r !== null ? Math.round(r * 10000) / 100 : null;
}

export async function getConversionStatus(orgId: string) {
  const connected = await isGA4Connected(orgId).catch(() => false);
  return { connected, source: "ga4" as const };
}

export async function getConversionOverview(
  orgId: string,
  startDate: string,
  endDate: string,
) {
  const connected = await isGA4Connected(orgId).catch(() => false);
  if (!connected) return { connected: false, source: "ga4" as const, data: null };

  const ov = await getGA4Overview(orgId, startDate, endDate).catch(() => null);
  if (!ov || !ov.totals?.length) {
    return { connected: true, source: "ga4" as const, data: null };
  }

  // Metric order in getGA4Overview:
  //  0=sessions, 1=totalUsers, 2=newUsers, 3=bounceRate,
  //  4=engagementRate, 5=avgSessionDuration, 6=screenPageViews, 7=conversions
  const cur  = ov.totals[0]?.metricValues ?? [];
  const prev = ov.totals[1]?.metricValues ?? [];

  const mv = (arr: { value?: string }[], i: number) => parseFloat(arr[i]?.value ?? "0") || 0;

  const sessions     = mv(cur, 0);
  const users        = mv(cur, 1);
  const conversions  = mv(cur, 7);
  const prevConv     = mv(prev, 7);
  const prevSess     = mv(prev, 0);

  const convRate     = pct(conversions, sessions);
  const prevConvRate = pct(prevConv, prevSess);
  const convRateDiff = convRate !== null && prevConvRate !== null
    ? Math.round((convRate - prevConvRate) * 100) / 100
    : null;

  return {
    connected: true,
    source:    "ga4" as const,
    data: {
      sessions,
      users,
      conversions:           Math.round(conversions),
      conversionRate:        convRate,
      conversionRateDiff:    convRateDiff,
      prevConversions:       Math.round(prevConv),
      prevConversionRate:    prevConvRate,
      revenue:               null as null, // enriched by events endpoint
      avgRevenuePerConversion: null as null,
    },
  };
}

export async function getConversionEvents(
  orgId: string,
  startDate: string,
  endDate: string,
) {
  const connected = await isGA4Connected(orgId).catch(() => false);
  if (!connected) return { connected: false, source: "ga4" as const, data: null };

  const raw = await getGA4Conversions(orgId, startDate, endDate).catch(() => ({ rows: [] }));

  // getGA4Conversions: dim[0]=eventName, met[0]=eventCount, met[1]=totalRevenue
  const events = (raw.rows ?? []).map(r => {
    const name       = r.dimensionValues?.[0]?.value ?? "unknown";
    const count      = parseFloat(r.metricValues?.[0]?.value ?? "0") || 0;
    const revenue    = parseFloat(r.metricValues?.[1]?.value ?? "0") || 0;
    const avgRevenue = safe(revenue, count);
    return { name, count: Math.round(count), revenue, avgRevenuePerConversion: avgRevenue };
  });

  const totalConversions = events.reduce((s, e) => s + e.count, 0);
  const totalRevenue     = events.reduce((s, e) => s + e.revenue, 0);

  return {
    connected:             true,
    source:                "ga4" as const,
    data: {
      events,
      totalConversions,
      totalRevenue,
      avgRevenuePerConversion: safe(totalRevenue, totalConversions),
    },
  };
}

export async function getConversionLandingPages(
  orgId: string,
  startDate: string,
  endDate: string,
) {
  const connected = await isGA4Connected(orgId).catch(() => false);
  if (!connected) return { connected: false, source: "ga4" as const, data: null };

  const raw = await getGA4ConversionPages(orgId, startDate, endDate).catch(() => ({ rows: [] }));

  // dim[0]=landingPage, met[0]=sessions, met[1]=totalUsers, met[2]=conversions, met[3]=totalRevenue
  const pages = (raw.rows ?? []).map(r => {
    const path        = r.dimensionValues?.[0]?.value ?? "/";
    const sessions    = parseFloat(r.metricValues?.[0]?.value ?? "0") || 0;
    const users       = parseFloat(r.metricValues?.[1]?.value ?? "0") || 0;
    const conversions = parseFloat(r.metricValues?.[2]?.value ?? "0") || 0;
    const revenue     = parseFloat(r.metricValues?.[3]?.value ?? "0") || 0;
    return {
      path,
      sessions: Math.round(sessions),
      users:    Math.round(users),
      conversions: Math.round(conversions),
      conversionRate: pct(conversions, sessions),
      revenue,
    };
  });

  return { connected: true, source: "ga4" as const, data: { pages } };
}

export async function getConversionSources(
  orgId: string,
  startDate: string,
  endDate: string,
) {
  const connected = await isGA4Connected(orgId).catch(() => false);
  if (!connected) return { connected: false, source: "ga4" as const, data: null };

  const raw = await getGA4Sources(orgId, startDate, endDate).catch(() => ({ rows: [] }));

  // getGA4Sources: dim[0]=channelGrouping, dim[1]=sourceMedium
  // met[0]=sessions, met[1]=totalUsers, met[2]=bounceRate, met[3]=conversions, met[4]=engagementRate
  const sources = (raw.rows ?? []).map(r => {
    const channel     = r.dimensionValues?.[0]?.value ?? "(Other)";
    const sourceMedium= r.dimensionValues?.[1]?.value ?? "unknown";
    const sessions    = parseFloat(r.metricValues?.[0]?.value ?? "0") || 0;
    const users       = parseFloat(r.metricValues?.[1]?.value ?? "0") || 0;
    const conversions = parseFloat(r.metricValues?.[3]?.value ?? "0") || 0;
    return {
      channel,
      sourceMedium,
      sessions:    Math.round(sessions),
      users:       Math.round(users),
      conversions: Math.round(conversions),
      conversionRate: pct(conversions, sessions),
    };
  }).filter(s => s.conversions > 0 || s.sessions > 0);

  return { connected: true, source: "ga4" as const, data: { sources } };
}

export async function getConversionDevices(
  orgId: string,
  startDate: string,
  endDate: string,
) {
  const connected = await isGA4Connected(orgId).catch(() => false);
  if (!connected) return { connected: false, source: "ga4" as const, data: null };

  const raw = await getGA4ConversionDevices(orgId, startDate, endDate).catch(() => ({ rows: [] }));

  // dim[0]=deviceCategory, met[0]=sessions, met[1]=conversions, met[2]=totalRevenue, met[3]=sessionConversionRate
  const devices = (raw.rows ?? []).map(r => {
    const device      = r.dimensionValues?.[0]?.value ?? "unknown";
    const sessions    = parseFloat(r.metricValues?.[0]?.value ?? "0") || 0;
    const conversions = parseFloat(r.metricValues?.[1]?.value ?? "0") || 0;
    const revenue     = parseFloat(r.metricValues?.[2]?.value ?? "0") || 0;
    return {
      device,
      sessions:    Math.round(sessions),
      conversions: Math.round(conversions),
      revenue,
      conversionRate: pct(conversions, sessions),
    };
  });

  return { connected: true, source: "ga4" as const, data: { devices } };
}

export async function getConversionGeo(
  orgId: string,
  startDate: string,
  endDate: string,
) {
  const connected = await isGA4Connected(orgId).catch(() => false);
  if (!connected) return { connected: false, source: "ga4" as const, data: null };

  const raw = await getGA4ConversionGeo(orgId, startDate, endDate).catch(() => ({ rows: [] }));

  // dim[0]=country, dim[1]=city, met[0]=sessions, met[1]=conversions, met[2]=totalRevenue
  const geo = (raw.rows ?? []).map(r => {
    const country     = r.dimensionValues?.[0]?.value ?? "Unknown";
    const city        = r.dimensionValues?.[1]?.value ?? "(not set)";
    const sessions    = parseFloat(r.metricValues?.[0]?.value ?? "0") || 0;
    const conversions = parseFloat(r.metricValues?.[1]?.value ?? "0") || 0;
    const revenue     = parseFloat(r.metricValues?.[2]?.value ?? "0") || 0;
    return {
      country,
      city,
      sessions:    Math.round(sessions),
      conversions: Math.round(conversions),
      revenue,
      conversionRate: pct(conversions, sessions),
    };
  });

  return { connected: true, source: "ga4" as const, data: { geo } };
}
