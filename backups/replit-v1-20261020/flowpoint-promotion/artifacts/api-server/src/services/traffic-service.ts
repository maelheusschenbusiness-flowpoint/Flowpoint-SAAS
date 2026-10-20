import {
  getGA4Sources,
  isGA4Connected,
  getStoredProperty,
} from "./ga4-service.js";
import { getTopKeywords, getTopPages } from "./gsc-service.js";

function dateRange(days: number): { startDate: string; endDate: string } {
  const end   = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export async function getTrafficStatus(orgId: string) {
  const connected = await isGA4Connected(orgId);
  const property  = connected ? await getStoredProperty(orgId) : null;
  return {
    connected,
    propertyId:   property?.propertyId  ?? null,
    propertyName: property?.displayName ?? null,
    source:       "ga4",
  };
}

export async function getTrafficSources(orgId: string, days = 30) {
  const { startDate, endDate } = dateRange(days);
  return getGA4Sources(orgId, startDate, endDate);
}

export async function getTrafficOrganicKeywords(orgId: string, days = 28) {
  return getTopKeywords(orgId, 30, days);
}

export async function getTrafficOrganicPages(orgId: string, days = 28) {
  return getTopPages(orgId, 30, days);
}
