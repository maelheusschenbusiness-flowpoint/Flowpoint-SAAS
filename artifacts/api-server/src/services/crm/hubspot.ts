import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CrmProviderError,
  type CrmContact, type CrmContactPage, type CrmProviderAdapter, type CrmTokenSet, type CrmWebhookCheck,
} from "./adapter.js";

const HUBSPOT_SCOPES = ["oauth", "crm.objects.contacts.read"] as const;
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Les URLs HubSpot ne sont surchargeables (fournisseur OAuth simule pour les tests) que HORS
 * production : en production elles sont figees sur les domaines officiels.
 */
function bases(): { auth: string; api: string } {
  const prod = process.env["NODE_ENV"] === "production";
  const auth = (!prod && process.env["HUBSPOT_AUTH_BASE"]) || "https://app.hubspot.com";
  const api = (!prod && process.env["HUBSPOT_API_BASE"]) || "https://api.hubapi.com";
  return { auth: auth.replace(/\/+$/, ""), api: api.replace(/\/+$/, "") };
}

function credentials(): { id: string; secret: string } {
  const id = process.env["HUBSPOT_CLIENT_ID"] ?? "";
  const secret = process.env["HUBSPOT_CLIENT_SECRET"] ?? "";
  if (!id || !secret) throw new CrmProviderError("CRM_PROVIDER_NOT_CONFIGURED", "HubSpot OAuth is not configured");
  return { id, secret };
}

async function tokenRequest(form: Record<string, string>): Promise<CrmTokenSet> {
  const { id, secret } = credentials();
  const response = await fetch(`${bases().api}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, client_id: id, client_secret: secret }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new CrmProviderError("CRM_TOKEN_REQUEST_FAILED", `HubSpot token request failed: ${response.status}`, response.status);
  const data = await response.json() as Record<string, unknown>;
  const accessToken = String(data["access_token"] ?? "");
  const refreshToken = String(data["refresh_token"] ?? "");
  if (!accessToken || !refreshToken) throw new CrmProviderError("CRM_TOKEN_INCOMPLETE", "HubSpot did not return both tokens");
  return { accessToken, refreshToken, expiresInSeconds: Number(data["expires_in"] ?? 1800) };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const CONTACT_PROPERTIES = "firstname,lastname,email,phone,lifecyclestage,hs_lastmodifieddate";

function toContact(row: { id?: string; properties?: Record<string, unknown> }): CrmContact | null {
  if (!row.id) return null;
  const p = row.properties ?? {};
  const name = [str(p["firstname"]), str(p["lastname"])].filter(Boolean).join(" ") || str(p["email"]) || `Contact ${row.id}`;
  return {
    externalId: String(row.id), name, email: str(p["email"]), phone: str(p["phone"]),
    status: str(p["lifecyclestage"]), updatedAt: str(p["hs_lastmodifieddate"]),
  };
}

function header(headers: CrmWebhookCheck["headers"], name: string): string {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export const hubspotAdapter: CrmProviderAdapter = {
  id: "hubspot",
  scopes: HUBSPOT_SCOPES,

  isConfigured: () => Boolean(process.env["HUBSPOT_CLIENT_ID"] && process.env["HUBSPOT_CLIENT_SECRET"]),

  buildAuthUrl(state, redirectUri) {
    const { id } = credentials();
    const query = new URLSearchParams({
      client_id: id, redirect_uri: redirectUri, scope: HUBSPOT_SCOPES.join(" "), state,
    });
    return `${bases().auth}/oauth/authorize?${query}`;
  },

  async exchangeCode(code, redirectUri) {
    const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    // Identifiant du portail : necessaire pour rattacher les webhooks a la bonne organisation.
    try {
      const info = await fetch(`${bases().api}/oauth/v1/access-tokens/${encodeURIComponent(tokens.accessToken)}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (info.ok) {
        const body = await info.json() as Record<string, unknown>;
        if (body["hub_id"] !== undefined) tokens.accountId = String(body["hub_id"]);
        if (Array.isArray(body["scopes"])) tokens.scope = (body["scopes"] as string[]).join(" ");
      }
    } catch { /* l'identifiant du portail reste optionnel : seuls les webhooks en dependent */ }
    return tokens;
  },

  refresh: (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }),

  async fetchContacts(accessToken, cursor, limit): Promise<CrmContactPage> {
    const query = new URLSearchParams({ limit: String(limit), properties: CONTACT_PROPERTIES });
    if (cursor) query.set("after", cursor);
    const response = await fetch(`${bases().api}/crm/v3/objects/contacts?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) throw new CrmProviderError("CRM_UNAUTHORIZED", "HubSpot rejected the access token", 401);
    if (response.status === 429) throw new CrmProviderError("CRM_RATE_LIMITED", "HubSpot rate limit reached", 429);
    if (!response.ok) throw new CrmProviderError("CRM_FETCH_FAILED", `HubSpot contacts request failed: ${response.status}`, response.status);
    const data = await response.json() as {
      results?: { id?: string; properties?: Record<string, unknown> }[];
      paging?: { next?: { after?: string } };
    };
    const contacts = (data.results ?? []).flatMap((row) => {
      const c = toContact(row);
      return c ? [c] : [];
    });
    return { contacts, nextCursor: data.paging?.next?.after ?? null };
  },

  async fetchContact(accessToken, externalId): Promise<CrmContact | null> {
    if (!/^\d{1,20}$/.test(externalId)) return null;
    const response = await fetch(`${bases().api}/crm/v3/objects/contacts/${externalId}?properties=${CONTACT_PROPERTIES}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return null;
    if (response.status === 401) throw new CrmProviderError("CRM_UNAUTHORIZED", "HubSpot rejected the access token", 401);
    if (!response.ok) throw new CrmProviderError("CRM_FETCH_FAILED", `HubSpot contact request failed: ${response.status}`, response.status);
    return toContact(await response.json() as { id?: string; properties?: Record<string, unknown> });
  },

  /** Signature v3 : HMAC-SHA256(secret, METHOD + URL + body + timestamp), base64. Tolerance 5 min. */
  verifyWebhook({ rawBody, method, url, headers, now = Date.now() }) {
    const secret = process.env["HUBSPOT_CLIENT_SECRET"] ?? "";
    const signature = header(headers, "x-hubspot-signature-v3");
    const timestamp = header(headers, "x-hubspot-request-timestamp");
    if (!secret || !signature || !/^\d{10,16}$/.test(timestamp)) return false;
    if (Math.abs(now - Number(timestamp)) > WEBHOOK_MAX_AGE_MS) return false;
    const expected = createHmac("sha256", secret)
      .update(method.toUpperCase() + url + rawBody.toString("utf8") + timestamp)
      .digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(rawBody) {
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody.toString("utf8")); } catch { return []; }
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((event) => {
      const e = event as Record<string, unknown>;
      const eventId = e["eventId"] ?? e["subscriptionId"];
      if (eventId === undefined || eventId === null) return [];
      return [{
        eventId: String(eventId),
        contactExternalId: e["objectId"] !== undefined ? String(e["objectId"]) : null,
        portalId: e["portalId"] !== undefined ? String(e["portalId"]) : null,
      }];
    });
  },
};
