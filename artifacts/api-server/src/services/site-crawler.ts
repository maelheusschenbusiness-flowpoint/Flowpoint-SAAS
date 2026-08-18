/**
 * site-crawler.ts — Crawl multi-pages borné pour l'outil IA analyze_site.
 *
 * Objectif : quand l'utilisateur demande une « analyse poussée de mon site »,
 * récupérer la page d'accueil PUIS jusqu'à 7 pages internes du même domaine
 * (max 8 pages au total), en parallèle, avec timeout court par page.
 *
 * Garanties :
 *  - Même domaine uniquement (les liens externes sont filtrés en amont par
 *    extractInternalLinks, et re-vérifiés ici).
 *  - robots.txt respecté (règles Disallow du User-agent « * » et « FlowpointBot »).
 *  - Déduplication des URLs (normalisées sans fragment ni slash final).
 *  - Timeout 5 s par page interne (12 s pour la page d'accueil, comme analyze_url).
 *  - Toute la sécurité SSRF de fetchUrlContent s'applique à chaque page.
 */

import { fetchUrlContent, type FetchUrlResult } from "./url-fetcher.js";
import { logger } from "../lib/logger.js";

/** Nombre maximum de pages récupérées par crawl (accueil incluse). */
export const MAX_CRAWL_PAGES = 8;
/** Timeout par page interne (la page d'accueil garde le timeout standard 12 s). */
const SUBPAGE_TIMEOUT_MS = 5_000;
/** Timeout de récupération du robots.txt. */
const ROBOTS_TIMEOUT_MS = 4_000;

export interface CrawlSiteResult {
  ok: boolean;
  startUrl: string;
  /** Pages récupérées avec succès (la page d'accueil en premier si ok). */
  pages: FetchUrlResult[];
  /** Nombre d'URLs internes candidates découvertes sur la page d'accueil. */
  linksDiscovered: number;
  /** Nombre de pages tentées (accueil incluse). */
  pagesAttempted: number;
  /** Nombre de pages réellement récupérées (accueil incluse). */
  pagesFetched: number;
  /** URLs bloquées par robots.txt. */
  blockedByRobots: number;
  error?: string;
}

/**
 * Parse un robots.txt et retourne les préfixes de chemin interdits pour notre
 * user-agent (« * » ou « flowpointbot »). Parser volontairement minimal :
 * pas de wildcards `*`/`$` (les règles avec wildcard sont ignorées — fail-open
 * sur la sophistication, fail-closed sur les préfixes simples).
 * Exporté pour tests unitaires.
 */
export function parseRobotsDisallows(robotsTxt: string): string[] {
  const disallows: string[] = [];
  let applies = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = (m[2] ?? "").trim();
    if (field === "user-agent") {
      const ua = value.toLowerCase();
      applies = ua === "*" || ua.includes("flowpointbot");
    } else if (field === "disallow" && applies) {
      if (!value) continue;               // "Disallow:" vide = tout autorisé
      if (/[*$]/.test(value)) continue;   // wildcards non supportés — ignorés
      disallows.push(value);
    }
  }
  return disallows;
}

/** Vrai si le chemin est autorisé (aucun préfixe Disallow ne correspond). Exporté pour tests. */
export function isPathAllowedByRobots(pathname: string, disallows: string[]): boolean {
  return !disallows.some((d) => pathname.startsWith(d));
}

/**
 * Sélectionne les liens internes à crawler : même hostname, hors robots.txt,
 * hors URL de départ, priorité aux chemins courts (pages de premier niveau —
 * navigation principale) et dédupliqués. Exporté pour tests unitaires.
 */
export function pickCrawlTargets(
  links: string[],
  startUrl: string,
  disallows: string[],
  max: number,
): { targets: string[]; blockedByRobots: number } {
  let start: URL;
  try { start = new URL(startUrl); } catch { return { targets: [], blockedByRobots: 0 }; }
  const startNorm = normalizeForDedup(startUrl);
  const seen = new Set<string>([startNorm]);
  let blocked = 0;

  const candidates: { url: string; depth: number; len: number }[] = [];
  for (const link of links) {
    let u: URL;
    try { u = new URL(link); } catch { continue; }
    if (u.hostname.toLowerCase() !== start.hostname.toLowerCase()) continue;
    const norm = normalizeForDedup(link);
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (!isPathAllowedByRobots(u.pathname, disallows)) { blocked++; continue; }
    const depth = u.pathname.split("/").filter(Boolean).length;
    candidates.push({ url: link, depth, len: link.length });
  }
  // Priorité : chemins peu profonds d'abord (navigation principale), puis courts
  candidates.sort((a, b) => a.depth - b.depth || a.len - b.len);
  return { targets: candidates.slice(0, max).map((c) => c.url), blockedByRobots: blocked };
}

function normalizeForDedup(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Crawl borné d'un site : page d'accueil + jusqu'à (maxPages - 1) pages internes
 * du même domaine, récupérées en parallèle avec timeout individuel de 5 s.
 * Ne lève jamais — retourne { ok:false, error } si la page d'accueil échoue.
 */
export async function crawlSite(
  startUrl: string,
  maxPages: number = MAX_CRAWL_PAGES,
): Promise<CrawlSiteResult> {
  const cappedMax = Math.max(1, Math.min(maxPages, MAX_CRAWL_PAGES));

  // 1. Page d'accueil (timeout standard — c'est la page pivot)
  const home = await fetchUrlContent(startUrl);
  if (!home.ok) {
    return {
      ok: false, startUrl, pages: [], linksDiscovered: 0,
      pagesAttempted: 1, pagesFetched: 0, blockedByRobots: 0,
      error: home.error ?? "Page d'accueil inaccessible",
    };
  }

  const links = home.links ?? [];

  // 2. robots.txt (best-effort : absent/inaccessible = tout autorisé)
  let disallows: string[] = [];
  try {
    const origin = new URL(home.url).origin;
    const robots = await fetchUrlContent(`${origin}/robots.txt`, { timeoutMs: ROBOTS_TIMEOUT_MS });
    if (robots.ok && robots.bodyText) {
      disallows = parseRobotsDisallows(robots.bodyText);
    }
  } catch (err) {
    logger.debug({ err, startUrl }, "[site-crawler] robots.txt fetch failed — proceeding without");
  }

  // 3. Sélection des pages internes à récupérer
  const { targets, blockedByRobots } = pickCrawlTargets(links, home.url, disallows, cappedMax - 1);

  // 4. Récupération parallèle, timeout 5 s par page — un échec de page n'annule pas le crawl
  const subResults = await Promise.all(
    targets.map((t) =>
      fetchUrlContent(t, { timeoutMs: SUBPAGE_TIMEOUT_MS }).catch(
        (err): FetchUrlResult => ({ ok: false, url: t, error: err instanceof Error ? err.message : String(err) }),
      ),
    ),
  );
  const fetchedSubPages = subResults.filter((r) => r.ok);

  logger.info(
    { startUrl, linksDiscovered: links.length, attempted: 1 + targets.length, fetched: 1 + fetchedSubPages.length, blockedByRobots },
    "[site-crawler] crawl complete",
  );

  return {
    ok: true,
    startUrl,
    pages: [home, ...fetchedSubPages],
    linksDiscovered: links.length,
    pagesAttempted: 1 + targets.length,
    pagesFetched: 1 + fetchedSubPages.length,
    blockedByRobots,
  };
}
