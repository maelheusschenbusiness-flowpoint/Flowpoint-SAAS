/**
 * C-04 — garde-fou CI : inventaire des routes d'ECRITURE.
 *
 * Parcourt routes/index.ts et chaque fichier de routes monte APRES requireAuth,
 * releve toutes les routes non-GET (post / put / patch / delete) et echoue si :
 *   1. la garde par defaut n'est plus montee entre requireAuth et les routeurs ;
 *   2. une route declaree n'a pas une forme analysable (chemin non litteral) ;
 *   3. une exception de writeRoleGuard.ts ne correspond plus a aucune route
 *      (regle morte : l'exception a survecu a la route qu'elle justifiait) ;
 *   4. l'ensemble des routes ouvertes a TOUT role differe de la liste figee
 *      ci-dessous : ajouter une exception exige de modifier ce fichier ET
 *      writeRoleGuard.ts, donc une relecture de securite explicite.
 *
 * Une NOUVELLE route non-GET sans exception tombe sous la garde par defaut
 * (owner/admin/member) : elle est donc toujours gardee.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WRITE_ADMIN_ONLY, WRITE_ANY_ROLE_EXCEPTIONS, WRITE_OWNER_ONLY,
  classifyWriteRoute, routePatternMatches, normalizeRoutePath,
  type WriteRouteRule,
} from "../middlewares/writeRoleGuard.js";

const routesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "routes");
const indexSrc = readFileSync(join(routesDir, "index.ts"), "utf8");

// ── index.ts : fichiers montes apres requireAuth, avec leur prefixe ───────────
const authIdx = indexSrc.indexOf("router.use(requireAuth);");
const guardIdx = indexSrc.indexOf("router.use(writeRoleGuard);");
const firstProtectedIdx = indexSrc.indexOf("router.use(meRouter);");

const importToFile = new Map<string, string>();
for (const m of indexSrc.matchAll(/^import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+"\.\/([\w-]+)\.js";/gm)) {
  importToFile.set(m[1]!, m[2]!);
}

interface Mounted { file: string; prefix: string }
const mounted: Mounted[] = [];
for (const m of indexSrc.slice(authIdx).matchAll(/router\.use\(\s*(?:"([^"]+)"\s*,\s*)?(\w+)\s*\)/g)) {
  const file = importToFile.get(m[2]!);
  if (file) mounted.push({ file, prefix: m[1] ?? "" });
}

interface Declared { file: string; method: string; path: string; full: string }

function scan(): { routes: Declared[]; unparseable: string[] } {
  const routes: Declared[] = [];
  const unparseable: string[] = [];
  for (const { file, prefix } of mounted) {
    const src = readFileSync(join(routesDir, `${file}.ts`), "utf8");
    // `xxxRouter.post(` ; les routeurs « public* » sont montes avant requireAuth.
    for (const m of src.matchAll(/\b(\w*[rR]outer)\.(post|put|patch|delete)\(\s*([^\n]{0,80})/g)) {
      if (/public/i.test(m[1]!)) continue;
      const lit = /^(["'`])([^"'`]+)\1/.exec(m[3]!.trimStart());
      if (!lit) { unparseable.push(`${file}.ts: ${m[0].slice(0, 90)}`); continue; }
      const path = lit[2]!;
      routes.push({ file, method: m[2]!.toUpperCase(), path, full: normalizeRoutePath(prefix + path) });
    }
  }
  return { routes, unparseable };
}

const { routes, unparseable } = scan();
const key = (r: { method: string; full: string }) => `${r.method} ${r.full}`;

describe("inventaire des routes d'ecriture (C-04)", () => {
  it("le parcours trouve un nombre credible de routes", () => {
    expect(mounted.length).toBeGreaterThan(60);
    expect(routes.length).toBeGreaterThan(250);
  });

  it("la garde par defaut est montee apres requireAuth et avant tout routeur protege", () => {
    expect(authIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(authIdx);
    expect(guardIdx).toBeLessThan(firstProtectedIdx);
    expect(indexSrc).toMatch(/import \{ writeRoleGuard \} from "\.\.\/middlewares\/writeRoleGuard\.js"/);
  });

  it("toutes les routes non-GET ont un chemin litteral analysable", () => {
    expect(unparseable, `routes non analysables : ${unparseable.join(" | ")}`).toEqual([]);
  });

  it("aucune route protegee n'est classee « read » (toute ecriture est couverte)", () => {
    for (const r of routes) expect(classifyWriteRoute(r.method, r.full), key(r)).not.toBe("read");
  });

  const allRules: [string, WriteRouteRule][] = [
    ...WRITE_ANY_ROLE_EXCEPTIONS.map((r) => ["exception tout role", r] as [string, WriteRouteRule]),
    ...WRITE_ADMIN_ONLY.map((r) => ["admin", r] as [string, WriteRouteRule]),
    ...WRITE_OWNER_ONLY.map((r) => ["owner", r] as [string, WriteRouteRule]),
  ];

  it.each(allRules)("%s : %j correspond a au moins une route declaree", (_kind, rule) => {
    const hit = routes.some((r) => (rule.method === "*" || rule.method === r.method) && routePatternMatches(rule.path, r.full));
    expect(hit, `regle morte : ${rule.method} ${rule.path}`).toBe(true);
  });

  it("chaque regle porte une raison explicite", () => {
    for (const [, rule] of allRules) expect(rule.reason.trim().length, rule.path).toBeGreaterThan(15);
  });

  it("l'ensemble des routes ouvertes a tout role est EXACTEMENT la liste figee", () => {
    const open = [...new Set(routes.filter((r) => classifyWriteRoute(r.method, r.full) === "any-role").map(key))].sort();
    expect(open).toEqual([...EXPECTED_ANY_ROLE_ROUTES].sort());
  });

  it("les routes d'integrations, marque blanche, securite, CRM sont admin ou plus (hors jetons / 2FA)", () => {
    const sensitive = routes.filter((r) => /^\/(integrations|white-label|security|sso|crm)(\/|$)/.test(r.full));
    expect(sensitive.length).toBeGreaterThan(15);
    for (const r of sensitive) {
      const c = classifyWriteRoute(r.method, r.full);
      const allowed = c === "admin" || c === "owner" ||
        (c === "any-role" && /\/(webhook\/incoming|2fa\/)/.test(r.full));
      expect(allowed, `${key(r)} -> ${c}`).toBe(true);
    }
  });

  it("toutes les autres routes non-GET sont au moins « member » (aucun viewer par defaut)", () => {
    const open = new Set(EXPECTED_ANY_ROLE_ROUTES);
    for (const r of routes) {
      if (open.has(key(r))) continue;
      expect(["member", "admin", "owner"], key(r)).toContain(classifyWriteRoute(r.method, r.full));
    }
  });
});

/**
 * Liste FIGEE des routes d'ecriture ouvertes a tout role authentifie.
 * Toute modification ici doit etre accompagnee d'une raison dans writeRoleGuard.ts.
 */
const EXPECTED_ANY_ROLE_ROUTES: string[] = [
  "POST /ai/chat",
  "POST /ai/conversations/:id/cancel",
  "POST /ai/conversations/:id/confirm",
  "POST /ai/audit",
  "POST /ai/seo",
  "POST /ai/conversion",
  "POST /ai/local",
  "POST /ai/competitors",
  "POST /ai/reports",
  "POST /ai/summary",
  "POST /ai/missions",
  "POST /ai/pagespeed-insights",
  "POST /ai/generate",
  "POST /ai-credits/consume",
  "POST /pagespeed/analyze",
  "POST /pagespeed/compare",
  "POST /maps/geocode",
  "POST /maps/distance",
  "POST /org/geocode",
  "POST /github/analysis/:owner/:repo",
  "POST /market-intelligence/competitor-movement",
  "POST /behavioral/funnels/analyze",
  "POST /google/ai-reply-preview",
  "PATCH /notifications/:id/read",
  "PATCH /notifications/read-all",
  "PUT /overview/checklist",
  "POST /onboarding/complete",
  "PATCH /me/prefs",
  "POST /organizations/:id/switch",
  "POST /auth/sessions/:id/revoke",
  "POST /security/2fa/setup",
  "POST /security/2fa/verify",
  "POST /integrations/webhook/incoming/:token",
  "POST /integrations/webhook/incoming",
];
