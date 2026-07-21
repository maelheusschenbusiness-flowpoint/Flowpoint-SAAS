import {
  getGA4Campaigns,
  isGA4Connected,
  getStoredProperty,
} from "./ga4-service.js";

function dateRange(days: number): { startDate: string; endDate: string } {
  const end   = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export async function getCampaignStatus(orgId: string) {
  const connected = await isGA4Connected(orgId);
  const property  = connected ? await getStoredProperty(orgId) : null;
  return {
    connected,
    propertyId:   property?.propertyId  ?? null,
    propertyName: property?.displayName ?? null,
    source:       "ga4",
  };
}

export async function getCampaigns(orgId: string, days = 30) {
  const { startDate, endDate } = dateRange(days);
  return getGA4Campaigns(orgId, startDate, endDate);
}
