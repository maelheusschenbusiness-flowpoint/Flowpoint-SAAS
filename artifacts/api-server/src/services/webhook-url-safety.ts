import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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
  if (version === 4) return isPublicIpv4(address);
  if (version !== 6) return false;
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
