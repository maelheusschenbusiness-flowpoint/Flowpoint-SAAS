/**
 * site-crawler.test.ts — Task #608 fix 4 : crawl multi-pages borné.
 *
 * Tests purs (aucun réseau) :
 *  - extractInternalLinks : même domaine, résolution relative, filtres, dédup, plafond
 *  - parseRobotsDisallows / isPathAllowedByRobots : parsing minimal, UA ciblés
 *  - pickCrawlTargets : dédup, exclusion de l'URL de départ, robots, priorité
 *    aux pages de premier niveau, plafond maxPages
 */

import { describe, it, expect } from "vitest";
import { extractInternalLinks } from "./url-fetcher.js";
import {
  parseRobotsDisallows,
  isPathAllowedByRobots,
  pickCrawlTargets,
  MAX_CRAWL_PAGES,
} from "./site-crawler.js";

const BASE = "https://exemple.com/";

describe("extractInternalLinks", () => {
  it("résout les liens relatifs et garde uniquement le même hostname", () => {
    const html = `
      <a href="/services">Services</a>
      <a href="contact.html">Contact</a>
      <a href="https://exemple.com/tarifs">Tarifs</a>
      <a href="https://autre-site.com/page">Externe</a>
      <a href="https://sous.exemple.com/x">Sous-domaine</a>`;
    const links = extractInternalLinks(html, BASE);
    expect(links).toContain("https://exemple.com/services");
    expect(links).toContain("https://exemple.com/contact.html");
    expect(links).toContain("https://exemple.com/tarifs");
    expect(links.some(l => l.includes("autre-site.com"))).toBe(false);
    expect(links.some(l => l.includes("sous.exemple.com"))).toBe(false);
  });

  it("ignore fragments, mailto, tel, javascript et fichiers non-HTML", () => {
    const html = `
      <a href="#section">Ancre</a>
      <a href="mailto:x@y.com">Mail</a>
      <a href="tel:+3212345678">Tel</a>
      <a href="javascript:void(0)">JS</a>
      <a href="/brochure.pdf">PDF</a>
      <a href="/logo.png">Image</a>
      <a href="/page-valide">OK</a>`;
    const links = extractInternalLinks(html, BASE);
    expect(links).toEqual(["https://exemple.com/page-valide"]);
  });

  it("déduplique (y compris slash final vs sans slash) et retire le fragment", () => {
    const html = `
      <a href="/services">A</a>
      <a href="/services/">B</a>
      <a href="/services#haut">C</a>
      <a href="/autre">D</a>`;
    const links = extractInternalLinks(html, BASE);
    expect(links.filter(l => l.includes("/services")).length).toBe(1);
    expect(links.length).toBe(2);
  });

  it("plafonne à 40 liens", () => {
    const html = Array.from({ length: 100 }, (_, i) => `<a href="/page-${i}">p${i}</a>`).join("");
    expect(extractInternalLinks(html, BASE).length).toBeLessThanOrEqual(40);
  });

  it("baseUrl invalide → tableau vide, pas de crash", () => {
    expect(extractInternalLinks('<a href="/x">x</a>', "pas-une-url")).toEqual([]);
  });
});

describe("parseRobotsDisallows / isPathAllowedByRobots", () => {
  it("applique les règles du User-agent * uniquement", () => {
    const robots = `
User-agent: googlebot
Disallow: /google-only
User-agent: *
Disallow: /admin
Disallow: /prive
# commentaire
Disallow:
`;
    const d = parseRobotsDisallows(robots);
    expect(d).toEqual(["/admin", "/prive"]);
    expect(isPathAllowedByRobots("/admin/login", d)).toBe(false);
    expect(isPathAllowedByRobots("/services", d)).toBe(true);
    expect(isPathAllowedByRobots("/google-only", d)).toBe(true);
  });

  it("conserve une règle applicable lorsque le groupe comporte plusieurs User-agent", () => {
    const d = parseRobotsDisallows(`
      User-agent: *
      User-agent: OtherBot
      Disallow: /interdit
    `);
    expect(d).toEqual(["/interdit"]);
    expect(isPathAllowedByRobots("/interdit/page", d)).toBe(false);
  });

  it("ignore les règles avec wildcards (non supportées) sans bloquer le reste", () => {
    const d = parseRobotsDisallows("User-agent: *\nDisallow: /*.json$\nDisallow: /secret");
    expect(d).toEqual(["/secret"]);
  });

  it("robots vide → tout autorisé", () => {
    expect(parseRobotsDisallows("")).toEqual([]);
    expect(isPathAllowedByRobots("/nimporte", [])).toBe(true);
  });
});

describe("pickCrawlTargets", () => {
  const links = [
    "https://exemple.com/services",
    "https://exemple.com/services/detail/sous-page",
    "https://exemple.com/contact",
    "https://exemple.com/admin/panel",
    "https://exemple.com/blog",
    "https://exemple.com", // URL de départ — doit être exclue
  ];

  it("exclut l'URL de départ, respecte robots.txt et le plafond", () => {
    const { targets, blockedByRobots } = pickCrawlTargets(links, "https://exemple.com/", ["/admin"], 3);
    expect(targets.length).toBe(3);
    expect(targets).not.toContain("https://exemple.com");
    expect(targets.every(t => !t.includes("/admin"))).toBe(true);
    expect(blockedByRobots).toBe(1);
  });

  it("priorise les pages de premier niveau (navigation) avant les pages profondes", () => {
    const { targets } = pickCrawlTargets(links, "https://exemple.com/", [], 10);
    const deepIdx = targets.indexOf("https://exemple.com/services/detail/sous-page");
    const shallowIdx = targets.indexOf("https://exemple.com/services");
    expect(shallowIdx).toBeGreaterThanOrEqual(0);
    expect(deepIdx).toBeGreaterThan(shallowIdx);
  });

  it("déduplique les variantes du même chemin", () => {
    const { targets } = pickCrawlTargets(
      ["https://exemple.com/a", "https://exemple.com/a/", "https://exemple.com/A"],
      "https://exemple.com/", [], 10,
    );
    expect(targets.length).toBe(1);
  });

  it("MAX_CRAWL_PAGES = 8 (accueil incluse → 7 sous-pages max)", () => {
    expect(MAX_CRAWL_PAGES).toBe(8);
    const many = Array.from({ length: 30 }, (_, i) => `https://exemple.com/p${i}`);
    const { targets } = pickCrawlTargets(many, "https://exemple.com/", [], MAX_CRAWL_PAGES - 1);
    expect(targets.length).toBe(7);
  });
});
