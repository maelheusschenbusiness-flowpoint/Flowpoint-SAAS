/**
 * Normalisation d'une URL de concurrent saisie par un utilisateur.
 *
 * Premier rideau anti-SSRF (le second est le fetch epingle de url-fetcher.ts :
 * DNS epingle + redirections revalidees). On refuse ici, des la saisie, tout
 * ce qui n'est pas un nom de domaine public : litteraux IP prives/internes,
 * noms locaux (localhost, .local, .internal...), identifiants dans l'URL.
 */
import { isIPv4, isIPv6 } from "node:net";
import { isPrivateIpv4Address, isPrivateIpv6Address } from "./url-fetcher.js";

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain"];

export function normalizeCompetitorUrl(value: string): { url: string; domain: string } | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const bare = host.replace(/^\[|\]$/g, "");
    if (!host.includes(".") && !isIPv6(bare)) return null;
    if (host === "localhost" || INTERNAL_SUFFIXES.some(s => host.endsWith(s))) return null;
    if (isIPv4(bare) && isPrivateIpv4Address(bare)) return null;
    if (isIPv6(bare) && isPrivateIpv6Address(bare)) return null;
    return { url: `https://${host}`, domain: host };
  } catch {
    return null;
  }
}
