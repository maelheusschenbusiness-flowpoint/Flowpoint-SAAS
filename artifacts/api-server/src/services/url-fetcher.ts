/**
 * url-fetcher.ts — Service de récupération sécurisé côté serveur.
 *
 * SÉCURITÉ : double défense contre SSRF + DNS rebinding.
 *
 *  1. validateMonitorUrl() → regex + DNS initial (bloque IP privées connues)
 *  2. dns.lookup() → résolution propre + re-validation de chaque IP résolue
 *  3. Connexion TCP/TLS vers l'IP résolue (DNS pinned) — jamais via re-résolution
 *     • HTTP  : Host header = hostname original
 *     • HTTPS : Host header + SNI servername = hostname original
 *     Empêche le DNS rebinding : même si le DNS change entre la validation
 *     et la connexion, la connexion va vers l'IP déjà validée.
 *  4. Redirections : chaque saut re-valide l'IP résolue avant de suivre.
 *  5. Timer unique couvrant headers + body complet.
 *  6. Body lu octet par octet avec limite stricte (pas de resp.text() qui bufferise tout).
 */

import { promises as dns } from "node:dns";
import { isIPv4, isIPv6 } from "node:net";
import * as nodeHttps from "node:https";
import * as nodeHttp from "node:http";
import type { IncomingMessage, RequestOptions } from "node:http";
import { logger } from "../lib/logger.js";

// ── Authoritative IPv4 CIDR range classification ─────────────────────────────
//
// The shared `isPrivateHost()` uses regex patterns that miss several dangerous
// non-globally-routable IPv4 ranges:
//   - 0.0.0.0/8 (this network, 0.0.0.x is non-routable)
//   - 224.0.0.0/4 (IPv4 multicast)
//   - 240.0.0.0/4 (IANA reserved/experimental)
//   - 255.255.255.255 (limited broadcast)
//
// We use numeric CIDR matching on the 32-bit address integer instead of regexes
// so that every non-globally-routable range is covered precisely.

function parseIpv4ToU32(addr: string): number | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    // Reject octal/hex notation and out-of-range values
    if (isNaN(v) || v < 0 || v > 255 || String(v) !== p) return null;
    n = ((n << 8) | v) >>> 0;
  }
  return n >>> 0;
}

// [network, mask] — both unsigned 32-bit integers
const IPV4_BLOCKED_CIDRS: [number, number][] = [
  [0x00000000, 0xff000000],  // 0.0.0.0/8       — "this network" (non-routable)
  [0x0a000000, 0xff000000],  // 10.0.0.0/8      — RFC 1918
  [0x64400000, 0xffc00000],  // 100.64.0.0/10   — CGNAT / shared address space
  [0x7f000000, 0xff000000],  // 127.0.0.0/8     — loopback
  [0xa9fe0000, 0xffff0000],  // 169.254.0.0/16  — link-local (AWS metadata: 169.254.169.254)
  [0xac100000, 0xfff00000],  // 172.16.0.0/12   — RFC 1918
  [0xc0000000, 0xffffff00],  // 192.0.0.0/24    — IETF protocol assignments
  [0xc00000aa, 0xfffffffe],  // 192.0.0.170/31  — NAT64/DNS64 discovery
  [0xc0000200, 0xffffff00],  // 192.0.2.0/24    — TEST-NET-1 (documentation)
  [0xc0a80000, 0xffff0000],  // 192.168.0.0/16  — RFC 1918
  [0xc6120000, 0xfffe0000],  // 198.18.0.0/15   — benchmarking (RFC 2544)
  [0xc6336400, 0xffffff00],  // 198.51.100.0/24 — TEST-NET-2
  [0xcb007100, 0xffffff00],  // 203.0.113.0/24  — TEST-NET-3
  [0xe0000000, 0xf0000000],  // 224.0.0.0/4     — IPv4 multicast
  [0xf0000000, 0xf0000000],  // 240.0.0.0/4     — IANA reserved/experimental
  [0xffffffff, 0xffffffff],  // 255.255.255.255  — limited broadcast
];

/**
 * Authoritative numeric CIDR classification for IPv4 addresses.
 * Returns true (blocked) for any address that is not globally routable.
 * Fails closed on malformed input.
 */
export function isPrivateIpv4Address(addr: string): boolean {
  const n = parseIpv4ToU32(addr);
  if (n === null) return true; // fail-closed: can't parse → block
  return IPV4_BLOCKED_CIDRS.some(([net, mask]) => (n & mask) >>> 0 === (net >>> 0));
}

// ── Authoritative IPv6 range classification ───────────────────────────────────
//
// The shared `isPrivateHost` uses regex patterns that miss many IPv6 edge cases:
//  - fe80::/10  requires bit-level check (not just "starts with fe80:")
//    e.g. fe81::1 is link-local but its prefix is fe81, not fe80
//  - fc00::/7   covers fc:: through fd:: (compressed forms miss regex)
//  - Multicast, unspecified (::), loopback (::1), and IPv4-compatible are tricky
//
// We add a proper bit-based IPv6 validator and use it in parallel with the
// IPv4 classifier above for all IPv6 addresses resolved by DNS.

/**
 * Expand a full or compressed IPv6 address into 16 bytes.
 * Returns null for IPv4-mapped forms (caller should extract and check the v4 part)
 * or if parsing fails.
 */
function expandIpv6(raw: string): Uint8Array | null {
  try {
    const h = raw.toLowerCase().trim().replace(/^\[/, "").replace(/\]$/, "");

    // IPv4-mapped ::ffff:x.x.x.x — signal caller to check embedded IPv4 part
    if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(h)) return null;

    const halves = h.split("::");
    if (halves.length > 2) return null; // more than one :: → invalid

    const parseGroup = (s: string) => parseInt(s || "0", 16);
    const left  = halves[0] ? halves[0].split(":").map(parseGroup) : [];
    const right = halves[1] ? halves[1].split(":").map(parseGroup) : [];

    if (halves.length === 2) {
      const fill = 8 - left.length - right.length;
      if (fill < 0) return null;
      const expanded = [...left, ...Array<number>(fill).fill(0), ...right];
      if (expanded.length !== 8) return null;
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 8; i++) {
        const v = expanded[i]!;
        if (isNaN(v) || v > 0xffff) return null;
        bytes[i * 2]     = (v >> 8) & 0xff;
        bytes[i * 2 + 1] = v & 0xff;
      }
      return bytes;
    }

    // No :: — must be exactly 8 groups
    if (left.length !== 8) return null;
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 8; i++) {
      const v = left[i]!;
      if (isNaN(v) || v > 0xffff) return null;
      bytes[i * 2]     = (v >> 8) & 0xff;
      bytes[i * 2 + 1] = v & 0xff;
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Authoritative bit-level IPv6 private/internal range check.
 * Handles all compressed/canonical forms DNS lookup can return.
 * Returns true (blocked) for any address that falls into a reserved range.
 * Exported for unit testing — treat as @internal.
 */
export function isPrivateIpv6Address(addr: string): boolean {
  // IPv4-mapped ::ffff:x.x.x.x — extract and check the embedded IPv4 address
  const v4mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (v4mapped) return isPrivateIpv4Address(v4mapped[1]!);

  // IPv4-compatible (deprecated) ::x.x.x.x
  const v4compat = addr.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (v4compat) return isPrivateIpv4Address(v4compat[1]!);

  const bytes = expandIpv6(addr);
  // Fail-closed: any address our parser cannot expand is treated as private.
  // An SSRF attacker should never benefit from a parse failure.
  if (!bytes) return true;

  const b0 = bytes[0]!;
  const b1 = bytes[1]!;

  // Unspecified: ::/128 (all zeros)
  if (bytes.every((b) => b === 0)) return true;

  // Loopback: ::1/128
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true;

  // Link-local: fe80::/10 — first 10 bits = 1111 1110 10
  // byte0=0xfe, high 2 bits of byte1 = 10 → (byte1 & 0xC0) === 0x80
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true;

  // Site-local (deprecated but can reach intranet services): fec0::/10
  // first 10 bits = 1111 1110 11 → byte0=0xfe, (byte1 & 0xC0) === 0xC0
  // Fail-closed: block even though fec0::/10 is deprecated.
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return true;

  // Unique-local (ULA): fc00::/7 — first 7 bits = 1111 110
  // byte0 & 0xFE === 0xFC covers fc00::/8 (fc) AND fd00::/8 (fd)
  if ((b0 & 0xfe) === 0xfc) return true;

  // Multicast: ff00::/8
  if (b0 === 0xff) return true;

  // ── IPv4-mapped: ::ffff:0:0/96 ───────────────────────────────────────────
  // Matches BOTH dotted (::ffff:127.0.0.1) AND hexadecimal (::ffff:7f00:1)
  // forms that dns.lookup() may return.
  // Byte layout: [0,0,0,0,0,0,0,0,0,0, 0xFF,0xFF, ipv4[0],ipv4[1],ipv4[2],ipv4[3]]
  if (
    bytes[0]===0 && bytes[1]===0 && bytes[2]===0 && bytes[3]===0 &&
    bytes[4]===0 && bytes[5]===0 && bytes[6]===0 && bytes[7]===0 &&
    bytes[8]===0 && bytes[9]===0 && bytes[10]===0xFF && bytes[11]===0xFF
  ) {
    const ipv4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isPrivateIpv4Address(ipv4);
  }

  // IPv4-compatible (deprecated): ::x.x.x.x — all-zeros 12-byte prefix
  // (bytes[0-11] = 0; differs from mapped in that bytes[10-11] are also 0)
  if (bytes.slice(0, 12).every((b) => b === 0)) {
    const ipv4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isPrivateIpv4Address(ipv4);
  }

  return false;
}

export interface FetchUrlResult {
  ok: boolean;
  url: string;
  statusCode?: number;
  title?: string;
  metaDescription?: string;
  headings?: { level: number; text: string }[];
  bodyText?: string;
  wordCount?: number;
  loadTimeMs?: number;
  error?: string;
  /** Liens internes (même domaine) découverts sur la page — pour le crawl multi-pages. */
  links?: string[];
}

/**
 * Optional per-hop policy used by bounded crawlers. It runs immediately before
 * every outbound request, including each redirect target, so callers can apply
 * destination-specific rules such as robots.txt without weakening the pinned
 * DNS/SSRF protections in this module.
 */
export interface FetchUrlOptions {
  timeoutMs?: number;
  beforeRequest?: (url: string) => Promise<{ allowed: boolean; error?: string }>;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; FlowpointBot/1.0; +https://flowpoint.pro/bot) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Max redirect hops before giving up. */
const MAX_HOPS = 5;
/** Max bytes buffered from the response body (hard limit — stream is cancelled after this). */
const MAX_BODY_BYTES = 400_000;
/** Max characters of body text forwarded to the LLM (≈ 8 000 tokens). */
const MAX_BODY_CHARS = 32_000;
/** Single wall-clock timeout covering DNS resolution, connection, headers AND body streaming. */
const TOTAL_TIMEOUT_MS = 12_000;

// ── DNS pinned request ────────────────────────────────────────────────────────

interface PinnedResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  incomingMessage: IncomingMessage;
}

/**
 * Resolve `hostname`, validate every returned IP against SSRF rules, then open
 * a connection to the *first validated IP* (DNS pinned) while preserving the
 * original hostname as the Host header and HTTPS SNI.
 *
 * This eliminates the TOCTOU gap present when `fetch()` re-resolves the hostname
 * at connection time — the connected IP is always the one that passed validation.
 */
async function pinnedRequest(
  rawUrl: string,
  signal: AbortSignal,
): Promise<PinnedResponse> {
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname;
  const isHttps = parsed.protocol === "https:";
  const port = parsed.port
    ? parseInt(parsed.port, 10)
    : isHttps ? 443 : 80;
  const path = (parsed.pathname || "/") + (parsed.search || "");

  // 0. Fail fast if the overall deadline has already elapsed before DNS starts
  if (signal.aborted) {
    throw new Error("Opération annulée (timeout global) — avant DNS");
  }

  // 1. DNS resolve, raced against the caller's AbortSignal so slow DNS cannot
  //    exceed the overall wall-clock timeout.
  //    NOTE: dns.lookup() itself is not natively abortable; we race it against a
  //    promise that rejects as soon as signal fires. The DNS request may still
  //    complete in the OS but we no longer block on it past the deadline.
  let addresses: Array<{ address: string; family: number }>;
  try {
    const dnsPromise = dns.lookup(hostname, { all: true }) as Promise<Array<{ address: string; family: number }>>;
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new Error("DNS annulé (timeout global)"));
        return;
      }
      const onAbort = () => reject(new Error("DNS annulé (timeout global)"));
      signal.addEventListener("abort", onAbort, { once: true });
      // Remove listener once DNS finishes (avoids a memory leak on fast responses)
      dnsPromise.finally(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
    });
    addresses = await Promise.race([dnsPromise, abortPromise]);
  } catch (dnsErr) {
    const msg = dnsErr instanceof Error ? dnsErr.message : String(dnsErr);
    throw new Error(
      msg.includes("annul") || msg.includes("timeout")
        ? msg
        : `Impossible de résoudre "${hostname}" — domaine introuvable`
    );
  }
  if (!addresses || addresses.length === 0) {
    throw new Error(`"${hostname}" n'a retourné aucun enregistrement DNS`);
  }

  // 1b. Second abort check: timer may have fired during DNS resolution
  if (signal.aborted) {
    throw new Error("Opération annulée (timeout global) — après DNS");
  }

  // 2. Validate ALL resolved IPs — reject if ANY resolves to private/internal.
  //    IPv4 addresses: isPrivateIpv4Address() covers all non-globally-routable ranges
  //    (0/8, 10/8, CGNAT, 127/8, link-local, RFC-1918, multicast, reserved, broadcast).
  //    IPv6 addresses: isPrivateIpv6Address() performs bit-level CIDR checks
  //    (fe80::/10, fc00::/7, ff00::/8, loopback, unspecified, IPv4-mapped/compat).
  //    This prevents bypass via e.g. fe81::1 (link-local but not caught by /^fe80:/)
  //    or 0.0.0.1 (this-network range, missed by the shared isPrivateHost regex).
  for (const { address, family } of addresses) {
    const isPrivate = family === 6
      ? isPrivateIpv6Address(address)
      : isPrivateIpv4Address(address);
    if (isPrivate) {
      throw new Error(
        `SSRF bloqué : "${hostname}" résout vers une adresse interne/privée (${address})`
      );
    }
  }

  // 3. Use the first validated IP for the connection (DNS pinned)
  const pinnedIp = addresses[0]!.address;

  const reqOptions: RequestOptions & { servername?: string } = {
    hostname: pinnedIp,         // TCP/TLS connects here — fixed, validated IP
    port,
    path,
    method: "GET",
    headers: {
      Host: hostname,           // HTTP Host header → original hostname
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8",
    },
    timeout: TOTAL_TIMEOUT_MS,
  };
  if (isHttps) {
    // SNI servername must be the original hostname for TLS certificate validation
    (reqOptions as { servername?: string }).servername = hostname;
  }

  return new Promise<PinnedResponse>((resolve, reject) => {
    const mod = isHttps ? nodeHttps : nodeHttp;
    const req = mod.request(reqOptions, (res: IncomingMessage) => {
      resolve({
        statusCode: res.statusCode ?? 0,
        headers: res.headers as Record<string, string | string[] | undefined>,
        incomingMessage: res,
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Timeout — le serveur n'a pas répondu dans les délais"));
    });
    req.on("error", (err: Error) => reject(err));

    // Wire AbortSignal so the caller's abort (e.g. overall timer) also destroys the req
    const onAbort = () => req.destroy(new Error("Opération annulée (timeout global)"));
    signal.addEventListener("abort", onAbort, { once: true });
    // Clean up listener when the response arrives (to avoid a memory leak)
    req.once("response", () => signal.removeEventListener("abort", onAbort));

    req.end();
  });
}

// ── Streamed body reader ──────────────────────────────────────────────────────

/**
 * Read the IncomingMessage body, capping at MAX_BODY_BYTES to avoid OOM.
 * The AbortSignal controls an outer wall-clock timer that covers both headers
 * and body streaming — we do NOT clear it before reading is complete.
 *
 * Any read error is re-thrown so the caller can surface it instead of returning
 * partial content silently.
 */
async function readBodyBounded(
  msg: IncomingMessage,
  signal: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let done = false;

    const onAbort = () => {
      if (!done) { done = true; msg.destroy(); reject(new Error("Body read annulé (timeout global)")); }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    msg.on("data", (chunk: Buffer) => {
      if (done) return;
      bytesRead += chunk.byteLength;
      chunks.push(chunk);
      if (bytesRead >= MAX_BODY_BYTES) {
        done = true;
        msg.destroy(); // stop the stream; partial content is enough
        signal.removeEventListener("abort", onAbort);
        resolve(Buffer.concat(chunks).toString("utf8", 0, MAX_BODY_BYTES));
      }
    });

    msg.on("end", () => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", onAbort);
      resolve(Buffer.concat(chunks).toString("utf8", 0, MAX_BODY_BYTES));
    });

    msg.on("error", (err: Error) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch une URL externe de façon SSRF-safe (DNS pinned, redirects validés),
 * extrait le contenu textuel et retourne le résultat structuré.
 *
 * Ne lève jamais d'exception — retourne { ok: false, error } en cas d'échec.
 */
export async function fetchUrlContent(
  rawUrl: string,
  opts?: FetchUrlOptions,
): Promise<FetchUrlResult> {
  // Pre-validate URL format and protocol (fast path before DNS)
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch {
    return { ok: false, url: rawUrl, error: "URL invalide — vérifiez le format" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, url: rawUrl, error: "Seules les URLs http:// et https:// sont autorisées" };
  }
  // For IP literals, apply authoritative classifiers BEFORE DNS.
  // new URL() strips brackets from IPv6 literals: http://[::1]/ → parsed.hostname = "::1"
  // Use node:net isIPv4/isIPv6 to distinguish literals from DNS names.
  if (isIPv4(parsed.hostname)) {
    if (isPrivateIpv4Address(parsed.hostname)) {
      return { ok: false, url: rawUrl, error: "URL refusée (hôte IPv4 privé/interne) — protection SSRF" };
    }
  } else if (isIPv6(parsed.hostname)) {
    if (isPrivateIpv6Address(parsed.hostname)) {
      return { ok: false, url: rawUrl, error: "URL refusée (hôte IPv6 interne/privé) — protection SSRF" };
    }
  }
  // DNS names fall through to pinnedRequest() which resolves + re-validates each IP

  // Single AbortController covers the entire request lifecycle (DNS + connection + headers + body)
  const effectiveTimeoutMs = Math.min(opts?.timeoutMs ?? TOTAL_TIMEOUT_MS, TOTAL_TIMEOUT_MS);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), effectiveTimeoutMs);

  const t0 = Date.now();
  let currentUrl = rawUrl;

  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (opts?.beforeRequest) {
        try {
          const permission = await opts.beforeRequest(currentUrl);
          if (!permission.allowed) {
            clearTimeout(timer);
            return {
              ok: false,
              url: currentUrl,
              error: permission.error ?? "Requête bloquée par la politique du crawler",
            };
          }
        } catch (policyErr) {
          clearTimeout(timer);
          const msg = policyErr instanceof Error ? policyErr.message : String(policyErr);
          return { ok: false, url: currentUrl, error: `Contrôle avant requête impossible : ${msg.slice(0, 200)}` };
        }
      }
      let pinnedResp: PinnedResponse;
      try {
        pinnedResp = await pinnedRequest(currentUrl, ctrl.signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const lo = msg.toLowerCase();
        let friendly: string;
        if (lo.includes("annul") || lo.includes("abort")) {
          friendly = "Timeout — la page n'a pas répondu dans les 12 secondes";
        } else if (lo.includes("ssrf")) {
          friendly = msg;
        } else if (lo.includes("impossible") || lo.includes("introuvable") || lo.includes("enotfound")) {
          friendly = msg;
        } else if (lo.includes("econnrefused")) {
          friendly = "Connexion refusée — le serveur n'est pas accessible";
        } else if (lo.includes("cert") || lo.includes("ssl") || lo.includes("tls")) {
          friendly = "Erreur de certificat SSL — connexion sécurisée impossible";
        } else {
          friendly = `Erreur réseau : ${msg.slice(0, 200)}`;
        }
        return { ok: false, url: rawUrl, error: friendly };
      }

      const { statusCode, headers, incomingMessage } = pinnedResp;

      // Handle redirects — validate each target before following
      if (statusCode >= 300 && statusCode < 400) {
        const location = (headers["location"] as string | undefined)?.trim();
        if (!location || hop === MAX_HOPS) {
          incomingMessage.destroy();
          return { ok: false, url: rawUrl, error: "Trop de redirections (limite 5 hops)" };
        }
        let target: URL;
        try { target = new URL(location, currentUrl); } catch {
          incomingMessage.destroy();
          return { ok: false, url: rawUrl, error: "URL de redirection invalide" };
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          incomingMessage.destroy();
          return { ok: false, url: rawUrl, error: "Redirection vers un protocole non supporté bloquée (SSRF)" };
        }
        // For IP-literal redirect targets, validate before following.
        // DNS names are re-validated via pinnedRequest() on the next hop.
        if (isIPv4(target.hostname)) {
          if (isPrivateIpv4Address(target.hostname)) {
            incomingMessage.destroy();
            return { ok: false, url: rawUrl, error: "Redirection vers une adresse IPv4 privée/interne bloquée (SSRF)" };
          }
        } else if (isIPv6(target.hostname)) {
          if (isPrivateIpv6Address(target.hostname)) {
            incomingMessage.destroy();
            return { ok: false, url: rawUrl, error: "Redirection vers une adresse IPv6 privée/interne bloquée (SSRF)" };
          }
        }
        // DNS names: re-validated in pinnedRequest() next hop
        incomingMessage.destroy();
        currentUrl = target.toString();
        continue;
      }

      // Non-redirect response
      const loadTimeMs = Date.now() - t0;

      if (statusCode < 200 || statusCode >= 400) {
        incomingMessage.destroy();
        clearTimeout(timer);
        return {
          ok: false, url: rawUrl, statusCode, loadTimeMs,
          error: `Le serveur a répondu avec HTTP ${statusCode}${
            statusCode === 403 ? " — accès refusé (bot-protection)" :
            statusCode === 404 ? " — page introuvable" :
            statusCode === 429 ? " — trop de requêtes (rate-limit)" : ""
          }`,
        };
      }

      const contentType = ((headers["content-type"] as string | undefined) ?? "").toLowerCase();
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("text/plain") &&
        !contentType.includes("application/xhtml")
      ) {
        incomingMessage.destroy();
        clearTimeout(timer);
        return {
          ok: false, url: rawUrl, statusCode, loadTimeMs,
          error: `Type de contenu non supporté : ${contentType.split(";")[0]?.trim() || "inconnu"}`,
        };
      }

      // Read body (timer still active — covers the entire body streaming phase)
      let rawHtml: string;
      try {
        rawHtml = await readBodyBounded(incomingMessage, ctrl.signal);
      } catch (bodyErr) {
        clearTimeout(timer);
        const msg = bodyErr instanceof Error ? bodyErr.message : String(bodyErr);
        return {
          ok: false, url: rawUrl, statusCode, loadTimeMs,
          error: `Erreur lors de la lecture du contenu : ${msg.slice(0, 200)}`,
        };
      }

      // Timer cleared only AFTER full body read is complete
      clearTimeout(timer);
      const extracted = extractContent(rawHtml);
      const links = extractInternalLinks(rawHtml, currentUrl);
      return { ok: true, url: currentUrl, statusCode, loadTimeMs, ...extracted, links };
    }

    clearTimeout(timer);
    return { ok: false, url: rawUrl, error: "Trop de redirections (limite 5 hops)" };
  } catch (unexpectedErr) {
    clearTimeout(timer);
    const msg = unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr);
    logger.warn({ err: unexpectedErr, url: rawUrl }, "[url-fetcher] unexpected error");
    return { ok: false, url: rawUrl, error: `Erreur inattendue : ${msg.slice(0, 200)}` };
  }
}

// ── HTML content extraction ───────────────────────────────────────────────────

function extractContent(html: string): {
  title?: string;
  metaDescription?: string;
  headings: { level: number; text: string }[];
  bodyText: string;
  wordCount: number;
} {
  // title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? decodeHtmlEntities(stripTags(titleMatch[1] ?? "")).trim().slice(0, 300)
    : undefined;

  // meta description (handles both attribute orderings + og:description fallback)
  let metaDescription: string | undefined;
  const metaRe1 = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i;
  const metaRe2 = /<meta[^>]+content=["']([^"']*)[^>]+name=["']description["']/i;
  const metaRe3 = /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i;
  const metaMatch = html.match(metaRe1) ?? html.match(metaRe2) ?? html.match(metaRe3);
  if (metaMatch) metaDescription = decodeHtmlEntities(metaMatch[1] ?? "").trim().slice(0, 500);

  // headings H1-H3
  const headings: { level: number; text: string }[] = [];
  const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(html)) !== null && headings.length < 20) {
    const text = decodeHtmlEntities(stripTags(hm[2] ?? "")).trim().slice(0, 200);
    if (text) headings.push({ level: parseInt(hm[1] ?? "1", 10), text });
  }

  // body text: strip noise, extract main content
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Prefer <main> or <article> if present
  const mainMatch =
    body.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ??
    body.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ??
    body.match(/<div[^>]+(?:class|id)=["'][^"']*(?:content|main|article|post)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (mainMatch?.[1]) body = mainMatch[1];

  const rawText = decodeHtmlEntities(stripTags(body)).replace(/\s+/g, " ").trim();
  const bodyText = rawText.slice(0, MAX_BODY_CHARS);
  const wordCount = rawText.split(/\s+/).filter(Boolean).length;

  return { title, metaDescription, headings, bodyText, wordCount };
}

/**
 * Extrait les liens internes (même hostname) d'une page HTML.
 * - Résout les liens relatifs contre baseUrl
 * - Ignore fragments, mailto:, tel:, javascript:, fichiers non-HTML évidents
 * - Normalise (retire fragment, garde query) et déduplique
 * - Plafonné à 40 liens pour borner mémoire/CPU
 * Exporté pour tests unitaires.
 */
export function extractInternalLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }
  const seen = new Set<string>();
  const out: string[] = [];
  const NON_HTML_EXT = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|css|js|mjs|json|xml|zip|gz|rar|mp[34]|webm|avi|mov|woff2?|ttf|eot|docx?|xlsx?|pptx?|csv)(?:[?#]|$)/i;
  const hrefRe = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < 40) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (!raw || raw.startsWith("#")) continue;
    if (/^(?:mailto:|tel:|javascript:|data:|ftp:)/i.test(raw)) continue;
    let resolved: URL;
    try { resolved = new URL(raw, base); } catch { continue; }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    if (resolved.hostname.toLowerCase() !== base.hostname.toLowerCase()) continue;
    if (NON_HTML_EXT.test(resolved.pathname)) continue;
    resolved.hash = "";
    // Normalisation : retirer le slash final (sauf racine) pour dédupliquer /a/ et /a
    let norm = resolved.toString();
    if (norm.endsWith("/") && resolved.pathname !== "/") norm = norm.slice(0, -1);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)));
}
