/**
 * logger-pii.test.ts — constat C-14 de l'audit du 08/11/2026.
 *
 * Une centaine de journaux portaient une adresse e-mail en clair, et le
 * masquage ne couvrait ni les e-mails ni les telephones. Comme le test
 * logger-redaction, celui-ci fait ecrire pino avec la configuration reelle.
 */
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { OPTIONS_MASQUAGE, masquerEmail } from "./logger.js";

function brut(charge: Record<string, unknown>, message = "test"): string {
  const lignes: string[] = [];
  const flux = new Writable({ write(m, _e, cb) { lignes.push(String(m)); cb(); } });
  pino({ level: "debug", ...OPTIONS_MASQUAGE }, flux).warn(charge, message);
  return lignes.join("");
}

describe("C-14 : donnees personnelles dans les journaux", () => {
  it("masque une adresse e-mail dans un champ, un objet imbrique, un tableau et le message", () => {
    const mail = "marie.curie@laboratoire-exemple.fr";
    const sortie = brut(
      { email: mail, ctx: { user: { email: mail } }, liste: [{ to: mail }], err: new Error(`echec pour ${mail}`) },
      `login ${mail}`,
    );
    expect(sortie).not.toContain("marie.curie");
    expect(sortie).toContain("ma***@laboratoire-exemple.fr");
  });

  it("masque les numeros de telephone par cle", () => {
    const sortie = brut({ phone: "+33612345678", ctx: { telephone: "0612345678" } });
    expect(sortie).not.toContain("612345678");
  });

  it("masque les en-tetes d'authentification de service", () => {
    const sortie = brut({ req: { headers: { "x-api-key": "CLE-A-NE-PAS-VOIR", "x-admin-key": "ADMIN-A-NE-PAS-VOIR", authorization: "Bearer ABCDEF0123456789" } } });
    expect(sortie).not.toContain("CLE-A-NE-PAS-VOIR");
    expect(sortie).not.toContain("ADMIN-A-NE-PAS-VOIR");
    expect(sortie).not.toContain("ABCDEF0123456789");
  });

  it("ne casse pas le diagnostic : chaine de connexion traitee, identifiants lisibles", () => {
    const sortie = brut({ orgId: "org-42", url: "postgres://u:motdepasse@db.exemple.fr:5432/x" });
    expect(sortie).toContain("org-42");
    expect(sortie).not.toContain("motdepasse");
  });

  it("masquerEmail garde deux caracteres et le domaine", () => {
    expect(masquerEmail("a@b.co")).toBe("a***@b.co");
    expect(masquerEmail("jean@exemple.fr")).toBe("je***@exemple.fr");
  });
});
