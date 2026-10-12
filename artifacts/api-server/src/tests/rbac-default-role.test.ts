/**
 * Un role absent ne doit pas valoir « proprietaire ».
 *
 * `_fpRolePerms()` et `_fpCanAccess()` repliaient sur `'owner'` quand
 * `STATE.me?.role` etait vide — au premier rendu, ou si la requete de profil
 * echouait. L'utilisateur voyait alors toute la navigation et passait la garde de
 * route. Un role INCONNU, lui, retombait deja sur `viewer` : le defaut sur
 * absence etait plus permissif que le defaut sur valeur invalide.
 *
 * Les deux copies du tableau de bord sont verifiees : elles doivent porter la
 * meme politique.
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

describe.each(COPIES)("repli RBAC (%s)", (_n, path) => {
  const js = readFileSync(path, "utf8");

  it("aucun repli sur owner ne subsiste", () => {
    expect(js).not.toContain("role || 'owner'");
  });

  it("les deux points de decision replient sur viewer", () => {
    expect(js).toContain("(STATE.me?.role || 'viewer').toLowerCase()");
    expect(js).toContain("(STATE.me?.role || 'viewer') === 'owner'");
  });

  it("la table suit la politique V1 validee", () => {
    // Le proprietaire garde tout ; un viewer CONSULTE audits, monitors et
    // rapports mais n'atteint ni les membres, ni la facturation, ni les reglages.
    expect(js).toContain("owner:  { audits:true,  monitors:true,  reports:true,  billing:true,  team:true,   settings:true  }");
    expect(js).toContain("viewer: { audits:true,  monitors:true,  reports:true,  billing:false, team:false,  settings:false }");
  });

  it("un role inconnu retombe toujours sur viewer", () => {
    expect(js).toContain("_FP_ROLE_PERMS[role] || _FP_ROLE_PERMS.viewer");
  });
});

describe("le comportement du repli", () => {
  const js = readFileSync(COPIES[0][1], "utf8");
  const table = /const _FP_ROLE_PERMS = \{[\s\S]*?\n\};/.exec(js)![0];
  const fn = /function _fpRolePerms\(\) \{[\s\S]*?\n\}/.exec(js)![0];
  const make = (me: unknown) =>
    // eslint-disable-next-line no-new-func
    new Function("STATE", `${table}\n${fn}\nreturn _fpRolePerms();`)({ me });

  it("profil non resolu : aucun module SENSIBLE n est ouvert", () => {
    // L'enjeu de ce correctif est qu'un profil non resolu ne soit pas traite en
    // PROPRIETAIRE. Il retombe sur `viewer`, qui depuis la politique V1 consulte
    // audits, monitors et rapports — une lecture, deja protegee par la session
    // et par l'isolation d'organisation cote backend. Ce qui doit rester ferme,
    // ce sont les membres, la facturation et les reglages.
    for (const me of [null, undefined, {}, { role: "" }]) {
      const p = make(me);
      expect(p.team, JSON.stringify(me)).toBe(false);
      expect(p.billing, JSON.stringify(me)).toBe(false);
      expect(p.settings, JSON.stringify(me)).toBe(false);
    }
  });

  it("un owner reel garde tous ses droits", () => {
    expect(make({ role: "owner" })).toMatchObject({ audits: true, billing: true, settings: true });
  });

  it("un role inconnu reste viewer", () => {
    expect(make({ role: "pirate" })).toEqual(make({ role: "viewer" }));
  });
});
