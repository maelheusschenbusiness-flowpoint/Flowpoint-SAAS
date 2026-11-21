import type { Request } from "express";

const ALLOWED_ORIGINS = new Set([
  "https://flowpoint.pro",
  "https://www.flowpoint.pro",
  "https://app.flowpoint.pro",
]);

export function isAllowedMarketingOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) return false;

  try {
    const candidate = new URL(origin ?? referer!).origin;
    const requestHost = req.get("host");
    if (!requestHost) return false;

    const requestOrigin = `${req.protocol}://${requestHost}`;
    return candidate === requestOrigin || ALLOWED_ORIGINS.has(candidate);
  } catch {
    return false;
  }
}
