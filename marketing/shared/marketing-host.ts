export const FLOWPOINT_PRODUCTION_HOST = "flowpoint.pro";
export const FLOWPOINT_MARKETING_STAGING_HOST =
  "flowpoint-marketing-staging.onrender.com";

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function isProductionMarketingHostname(hostname: string): boolean {
  return normalizeHostname(hostname) === FLOWPOINT_PRODUCTION_HOST;
}
