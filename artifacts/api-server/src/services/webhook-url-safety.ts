import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateIpv4Address, isPrivateIpv6Address, pinnedRequest } from "./url-fetcher.js";

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = octets;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  // Double contrôle : liste locale ET classifieur CIDR partagé (url-fetcher),
  // qui couvre aussi IPv6 mappé/compat/NAT64/documentation/6to4.
  if (version === 4) return isPublicIpv4(address) && !isPrivateIpv4Address(address);
  if (version !== 6) return false;
  if (isPrivateIpv6Address(address)) return false;
  // NAT64, documentation, Teredo, 6to4 et discard-only : jamais une destination de webhook publique.
  const v6 = address.toLowerCase();
  if (["64:ff9b:", "2001:db8:", "2001:0:", "2001::", "2002:", "100::"].some(p => v6.startsWith(p))) return false;
  const normalized = address.toLowerCase();
  return normalized !== "::" && normalized !== "::1" &&
    !normalized.startsWith("fc") && !normalized.startsWith("fd") &&
    !normalized.startsWith("fe8") && !normalized.startsWith("fe9") &&
    !normalized.startsWith("fea") && !normalized.startsWith("feb") &&
    !normalized.startsWith("ff") && !normalized.startsWith("::ffff:");
}

export async function validatePublicHttpsWebhook(
  raw: unknown,
  resolve: (hostname: string) => Promise<string[]> = async hostname =>
    (await lookup(hostname, { all: true, verbatim: true })).map(result => result.address),
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (typeof raw !== "string" || raw.length > 2048) return { ok: false, error: "URL invalide" };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, error: "URL invalide" }; }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
    return { ok: false, error: "Une URL HTTPS publique est requise" };
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { ok: false, error: "Les hôtes locaux ou privés sont interdits" };
  }
  try {
    const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
    if (!addresses.length || addresses.some(address => !isPublicAddress(address))) {
      return { ok: false, error: "L’hôte doit résoudre uniquement vers des adresses publiques" };
    }
  } catch {
    return { ok: false, error: "Le nom d’hôte ne peut pas être résolu" };
  }
  return { ok: true, url: url.toString() };
}

export interface WebhookDelivery {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Envoi POST d'un webhook sortant, protégé contre le SSRF et le DNS rebinding :
 *  - l'URL est revalidée À CHAQUE ENVOI (https, pas d'identifiants, port 443, hôte public) ;
 *  - la connexion TCP/TLS est ÉPINGLÉE sur l'IP validée (aucune seconde résolution) ;
 *  - les redirections ne sont JAMAIS suivies (3xx = échec) ;
 *  - le corps de la réponse n'est pas lu (connexion détruite).
 */
export async function postWebhookPinned(
  rawUrl: string,
  opts: {
    headers: Record<string, string>;
    body: string;
    timeoutMs?: number;
    /** Résolveur injectable (tests). */
    resolve?: (hostname: string) => Promise<string[]>;
  },
): Promise<WebhookDelivery> {
  const safe = await validatePublicHttpsWebhook(rawUrl, opts.resolve);
  if (!safe.ok) return { ok: false, error: safe.error };
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    Math.min(Math.max(opts.timeoutMs ?? 10_000, 1_000), 15_000),
  );
  try {
    const custom = opts.resolve;
    const res = await pinnedRequest(safe.url, ctrl.signal, {
      method: "POST",
      headers: opts.headers,
      body: opts.body,
      ...(custom
        ? { resolve: async (h: string) => (await custom(h)).map(address => ({ address, family: isIP(address) })) }
        : {}),
    });
    res.incomingMessage.destroy();
    const status = res.statusCode;
    if (status >= 300 && status < 400) {
      return { ok: false, statusCode: status, error: `Redirection refusée (HTTP ${status})` };
    }
    const ok = status >= 200 && status < 300;
    return { ok, statusCode: status, error: ok ? undefined : `HTTP ${status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Request failed" };
  } finally {
    clearTimeout(timer);
  }
}
