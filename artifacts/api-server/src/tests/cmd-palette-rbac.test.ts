/**
 * La palette de commandes doit respecter les memes permissions que la navigation.
 *
 * `_cmdBuildIndex()` construisait son index depuis `MENU_ROUTES` et `SUB_NAVS`
 * sans jamais appeler `_fpCanAccess()`. `billing`, `settings`, `team` et toutes
 * leurs sous-pages restaient donc proposees a un `member` ou un `viewer` dont la
 * barre laterale les masque.
 *
 * S'ajoutait un defaut structurel : l'index etait mis en cache une seule fois,
 * avant meme que `STATE.me` soit resolu, et n'etait jamais reconstruit. Un
 * filtrage ajoute sans invalidation serait reste fige sur « aucun role ».
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const COPIES: [string, string][] = [
  ["export", join(root, "artifacts/flowpoint-export/dashboard.js")],
  ["source", join(root, "src/frontend/dashboard.js")],
];

describe.each(COPIES)("palette de commandes (%s)", (_n, path) => {
  const js = readFileSync(path, "utf8");
  const fn = /function _cmdBuildIndex\(\) \{[\s\S]*?\n\}/.exec(js)![0];

  it("l index consulte les permissions", () => {
    expect(fn).toContain("_fpCanAccess");
  });

  it("les sous-pages sont filtrees elles aussi", () => {
    expect(fn).toContain("if (!_fpCanAccess(route)) return;");
  });

  it("le cache est invalide quand le role change", () => {
    expect(js).toContain("_cmdIndexRole");
    expect(fn).toContain("_cmdIndexRole === role");
  });

  it("_fpCanAccess est defini avant d etre utilise", () => {
    expect(js.indexOf("function _fpCanAccess")).toBeLessThan(js.indexOf("function _cmdBuildIndex"));
  });
});

describe("le filtrage se comporte comme attendu", () => {
  const js = readFileSync(COPIES[0][1], "utf8");
  const pick = (re: RegExp) => re.exec(js)![0];
  const table = pick(/const _FP_ROLE_PERMS = \{[\s\S]*?\n\};/);
  const routePerm = pick(/const _FP_ROUTE_PERM = \{[\s\S]*?\n\};/);
  const perms = pick(/function _fpRolePerms\(\) \{[\s\S]*?\n\}/);
  const canAccess = pick(/function _fpCanAccess\(route\) \{[\s\S]*?\n\}/);
  const build = pick(/function _cmdBuildIndex\(\) \{[\s\S]*?\n\}/);

  const run = (role: string | null) =>
    // eslint-disable-next-line no-new-func
    new Function("STATE", "CMD_ITEMS", "MENU_ROUTES", "SUB_NAVS", "PAGE_NAMES", `
      ${table}\n${routePerm}\n${perms}\n${canAccess}
      let _cmdIndexCache = null; let _cmdIndexRole = null;
      ${build}
      return _cmdBuildIndex();`)(
      { me: role ? { role } : null },
      [{ route: "billing", label: "Facturation" }, { route: "audits", label: "Audits" },
       { route: "settings", label: "Reglages" }, { label: "Sans route" }],
      new Set(["billing", "audits", "settings"]),
      { billing: [{ id: "plans", label: "Plans" }], audits: [{ id: "list", label: "Liste" }] },
      { billing: "Facturation", audits: "Audits" },
    ) as { route?: string; label: string }[];

  const routes = (r: string | null) => run(r).map((i) => i.route).filter(Boolean).sort();

  it("un owner voit la facturation et les reglages", () => {
    expect(routes("owner")).toContain("billing");
    expect(routes("owner")).toContain("settings");
  });

  it("un member ne voit NI facturation NI reglages", () => {
    expect(routes("member")).not.toContain("billing");
    expect(routes("member")).not.toContain("settings");
  });

  it("un viewer ne voit aucune des trois routes protegees", () => {
    expect(routes("viewer")).toEqual([]);
  });

  it("la palette propose EXACTEMENT ce que la navigation autorise", () => {
    // C'est l'invariant de ce correctif, et il ne depend pas du repli choisi
    // pour un profil non resolu — ce point-la releve de H4, sur sa propre
    // branche. Ici on verifie que palette et garde de route disent la meme
    // chose, quel que soit le role.
    // eslint-disable-next-line no-new-func
    const can = new Function("STATE", "route", `
      ${table}\n${routePerm}\n${perms}\n${canAccess}
      return _fpCanAccess(route);`) as (s: unknown, r: string) => boolean;
    for (const role of ["owner", "admin", "member", "viewer", null]) {
      const state = { me: role ? { role } : null };
      const proposees = new Set(routes(role));
      for (const r of ["billing", "audits", "settings"]) {
        expect(proposees.has(r), `${role ?? "non resolu"} / ${r}`).toBe(can(state, r));
      }
    }
  });

  it("une entree sans route reste proposee a tous", () => {
    expect(run("viewer").some((i) => i.label === "Sans route")).toBe(true);
  });

  it("les sous-pages suivent la meme regle que leur page", () => {
    const subs = (r: string) => run(r).filter((i) => (i as { cat?: string }).cat === "Sous-pages").map((i) => i.route);
    expect(subs("owner")).toContain("billing");
    expect(subs("member")).not.toContain("billing");
  });
});
