/**
 * SSRF-safe URL validation for monitor targets.
 *
 * Two layers of protection:
 * 1. Regex/string checks on the raw hostname (catches IP literals, localhost, etc.)
 * 2. Async DNS resolution to block external hostnames that resolve to private
 *    or internal addresses (DNS rebinding / split-horizon DNS bypass).
 *
 * Blocked ranges:
 *   - RFC 1918: 10/8, 172.16/12, 192.168/16
 *   - Loopback:  127/8, ::1
 *   - Link-local: 169.254/16, fe80::/10
 *   - CGNAT: 100.64/10
 *   - Unique-local IPv6: fc00::/7 (fc::/8, fd::/8)
 *   - IPv4-mapped IPv6: ::ffff:x.x.x.x  (checked by extracting embedded IPv4)
 */

import { promises as dns } from "dns";

const BLOCKED_HOSTNAMES = new Set(["localhost", "broadcasthost"]);

const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1([01]\d|2[0-7]))\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  return PRIVATE_IP_PATTERNS.some((p) => p.test(h));
}

function extractEmbeddedIpv4(addr: string): string | null {
  const m = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  return m ? m[1]! : null;
}

/**
 * Resolves all A/AAAA records for hostname and checks each resolved address
 * against the private-range rules. Returns an error message if any resolved
 * address is private, or null if all are safe.
 *
 * Throws are swallowed — an unresolvable hostname is rejected as unsafe.
 */
export async function checkDnsResolution(hostname: string): Promise<string | null> {
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true }) as Array<{ address: string; family: number }>;
  } catch {
    return `Cannot resolve hostname "${hostname}" — monitor URL rejected`;
  }

  if (!addresses || addresses.length === 0) {
    return `Hostname "${hostname}" returned no DNS records`;
  }

  for (const { address, family } of addresses) {
    let checkAddr = address;
    if (family === 6) {
      const embedded = extractEmbeddedIpv4(address);
      if (embedded) checkAddr = embedded;
    }
    if (isPrivateHost(checkAddr)) {
      return `URL hostname resolves to a private or internal IP address — SSRF protection`;
    }
  }

  return null;
}

/**
 * Full async URL validation: scheme check → string hostname check → DNS check.
 * Returns an error string on failure, or null if the URL is safe to use.
 */
export async function validateMonitorUrl(rawUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Invalid URL format";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http and https URLs are allowed";
  }

  if (isPrivateHost(parsed.hostname)) {
    return "URLs pointing to private, loopback, or internal hosts are not allowed";
  }

  const dnsError = await checkDnsResolution(parsed.hostname);
  if (dnsError) return dnsError;

  return null;
}
