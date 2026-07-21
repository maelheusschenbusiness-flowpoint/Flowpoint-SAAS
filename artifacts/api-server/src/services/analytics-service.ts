import {
  getGA4Overview,
  getGA4Realtime,
  getGA4Pages,
  getGA4Conversions,
  getGA4Audience,
  isGA4Connected,
  getStoredProperty,
} from "./ga4-service.js";

function dateRange(days: number): { startDate: string; endDate: string } {
  const end   = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export async function getAnalyticsStatus(orgId: string) {
  const connected  = await isGA4Connected(orgId);
  const property   = connected ? await getStoredProperty(orgId) : null;
  return {
    connected,
    propertyId:   property?.propertyId   ?? null,
    propertyName: property?.displayName  ?? null,
    source:       "ga4",
  };
}

export async function getAnalyticsOverview(orgId: string, days = 30) {
  const { startDate, endDate } = dateRange(days);
  return getGA4Overview(orgId, startDate, endDate);
}

export async function getAnalyticsRealtime(orgId: string) {
  return getGA4Realtime(orgId);
}

export async function getAnalyticsPages(orgId: string, days = 30) {
  const { startDate, endDate } = dateRange(days);
  return getGA4Pages(orgId, startDate, endDate);
}

export async function getAnalyticsConversions(orgId: string, days = 30) {
  const { startDate, endDate } = dateRange(days);
  return getGA4Conversions(orgId, startDate, endDate);
}

export async function getAnalyticsAudience(orgId: string, days = 30) {
  const { startDate, endDate } = dateRange(days);
  return getGA4Audience(orgId, startDate, endDate);
}
