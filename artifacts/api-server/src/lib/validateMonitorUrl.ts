import dns from "node:dns/promises";

const PRIVATE_CIDR = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0/,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "broadcasthost",
  "metadata.google.internal",
  "169.254.169.254",
  "100.100.100.200",
]);

export function isPrivateHost(host: string): boolean {
  if (BLOCKED_HOSTS.has(host.toLowerCase())) return true;
  return PRIVATE_CIDR.some((re) => re.test(host));
}

export async function checkDnsResolution(host: string): Promise<boolean> {
  try {
    await dns.lookup(host);
    return true;
  } catch {
    return false;
  }
}

export async function validateMonitorUrl(urlStr: string): Promise<string | null> {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "Only http and https URLs are supported";
    }
    const { hostname } = parsed;
    if (isPrivateHost(hostname)) {
      return "Private, loopback, and metadata IP ranges are not allowed";
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && isPrivateHost(hostname)) {
      return "Private IP addresses are not allowed";
    }
    return null;
  } catch {
    return "Invalid URL format";
  }
}
