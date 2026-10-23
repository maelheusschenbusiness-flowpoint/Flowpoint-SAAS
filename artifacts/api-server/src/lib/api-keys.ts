/**
 * Organization API keys (fp_pub_ / fp_sec_) — centralized rules.
 *
 *   1. keys are written by regeneration only; key fields sent by clients are ignored;
 *   2. key values are never returned through settings; a new secret is shown once;
 *   3. legacy default public keys are no longer issued or accepted.
 *
 * Key scope: fp_pub_ = read-only (viewer role), fp_sec_ = admin. No key may reach
 * `API_KEY_DENIED_ROUTES`.
 */
import type { Request } from "express";

/** Settings fields reserved for keys: never written by a client, values never returned. */
export const API_KEY_VALUE_FIELDS = ["publicApiKey", "secretApiKey"] as const;
export const API_KEY_FIELDS = [...API_KEY_VALUE_FIELDS, "publicApiKeyCreatedAt", "secretApiKeyCreatedAt"] as const;

export const PUBLIC_KEY_ROLE = "viewer";
export const SECRET_KEY_ROLE = "admin";

/**
 * Routes refused to any API key, whatever the method: key management, billing and payment
 * methods, and side-effecting GETs (tracking-token rotation, starting a Google OAuth link on
 * behalf of the organization).
 */
export const API_KEY_DENIED_ROUTES: RegExp[] = [
  /^\/settings\/api-keys(\/|$)/,
  /^\/billing(\/|$)/,
  /^\/behavioral\/snippet$/,
  /^\/google\/(connect|oauth\/start)$/,
];

/**
 * Emergency switch: API_KEYS_DISABLED=true refuses every fp_* key (sessions are unaffected).
 * Lets an operator stop key access instantly without rolling back to an older build.
 */
export function apiKeysDisabled(): boolean {
  return process.env["API_KEYS_DISABLED"] === "true";
}

/** Legacy "default" public key format, no longer accepted. */
export function deterministicPublicKey(orgId: string): string {
  return `fp_pub_${Buffer.from(orgId).toString("base64").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 22)}`;
}

export function isDeterministicPublicKey(key: string, orgId: string): boolean {
  return key === deterministicPublicKey(orgId);
}

/** True when the request is authenticated by an API key rather than a session. */
export function isApiKeyPrincipal(req: Request): boolean {
  return (req.orgContext?.userId ?? "").startsWith("apikey:");
}

/** Copy of settings without key values (creation dates stay visible). */
export function redactApiKeys<T>(settings: T): T {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return settings;
  const copy = { ...(settings as Record<string, unknown>) };
  for (const field of API_KEY_VALUE_FIELDS) delete copy[field];
  return copy as T;
}

/** Client-supplied settings with every key field removed. */
export function stripApiKeyFields<T>(settings: T): T {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return settings;
  const copy = { ...(settings as Record<string, unknown>) };
  for (const field of API_KEY_FIELDS) delete copy[field];
  return copy as T;
}

/** Public key to display: only a persisted random key, never the legacy computed one. */
export function displayablePublicKey(settings: Record<string, unknown> | null | undefined, orgId: string): string | null {
  const key = settings?.["publicApiKey"];
  return typeof key === "string" && key.startsWith("fp_pub_") && !isDeterministicPublicKey(key, orgId) ? key : null;
}
