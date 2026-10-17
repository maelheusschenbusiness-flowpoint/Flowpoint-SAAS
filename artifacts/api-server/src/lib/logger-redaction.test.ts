/**
 * logger-redaction.test.ts
 *
 * Un journal qui porte un jeton est une credential rejouable par quiconque lit
 * les journaux. La liste de rédaction du logger ne couvrait que trois en-tetes :
 * mesure du 17/10/2026, `logger.warn({ err, token }, …)` dans
 * services/seller-attribution.ts ecrivait en clair le jeton de `pending_signups`,
 * celui qui autorise une inscription.
 *
 * Ces tests ne verifient pas qu'une liste existe — ils font ecrire pino dans un
 * flux et lisent ce qui en sort. C'est la seule maniere de prouver qu'un champ
 * est reellement masque.
 */
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { readFileSync } from "node:fs";
import path from "node:path";

import { REDACTED_PATHS } from "./logger.js";

/** Fait ecrire un logger configure comme le notre, et rend l'objet journalise. */
function journaliser(charge: Record<string, unknown>): Record<string, unknown> {
  const lignes: string[] = [];
  const flux = new Writable({
    write(morceau, _enc, cb) { lignes.push(String(morceau)); cb(); },
  });
  const l = pino({ redact: { paths: [...REDACTED_PATHS], censor: "[masque]" } }, flux);
  l.warn(charge, "test");
  return JSON.parse(lignes.join("")) as Record<string, unknown>;
}

describe("le journal ne laisse pas passer de secret", () => {
  it("un jeton au premier niveau est masque", () => {
    const sortie = journaliser({ token: "tok_secret_abcdef0123456789" });
    expect(sortie["token"]).toBe("[masque]");
    expect(JSON.stringify(sortie)).not.toContain("tok_secret_abcdef0123456789");
  });

  it("un jeton au deuxieme niveau est masque — c'est la ou arrivent les objets de contexte", () => {
    const sortie = journaliser({ ctx: { token: "tok_imbrique_987654321" } });
    expect(JSON.stringify(sortie)).not.toContain("tok_imbrique_987654321");
  });

  it("le corps d'une requete n'est jamais journalise", () => {
    const sortie = journaliser({ body: { password: "p4ssw0rd", email: "client@exemple.fr" } });
    const brut = JSON.stringify(sortie);
    expect(brut).not.toContain("p4ssw0rd");
    expect(brut).not.toContain("client@exemple.fr");
  });

  it("les autres familles de secrets sont couvertes", () => {
    for (const champ of ["password", "secret", "apiKey", "adminKey", "accessToken", "refreshToken", "client_secret"]) {
      const sortie = journaliser({ [champ]: "VALEUR-SENSIBLE-A-NE-PAS-VOIR" });
      expect(JSON.stringify(sortie), `${champ} n'est pas masque`).not.toContain("VALEUR-SENSIBLE-A-NE-PAS-VOIR");
    }
  });

  it("ce qui sert au diagnostic reste lisible — masquer ne doit pas aveugler", () => {
    const sortie = journaliser({ orgId: "org-42", path: "/api/missions", errCode: "23502" });
    expect(sortie["orgId"]).toBe("org-42");
    expect(sortie["path"]).toBe("/api/missions");
    expect(sortie["errCode"]).toBe("23502");
  });
});

describe("les deux sites d'appel corriges ne transmettent plus le secret", () => {
  const lire = (p: string) => readFileSync(path.join(import.meta.dirname ?? __dirname, p), "utf8");

  it("seller-attribution ne passe plus le jeton au journal", () => {
    const src = lire("../services/seller-attribution.ts");
    expect(src).not.toMatch(/logger\.\w+\(\s*\{\s*err,\s*token\s*\}/);
    expect(src).toContain("tokenLen: token.length");
  });

  it("missions ne deverse plus le corps de la requete", () => {
    const src = lire("../routes/missions.ts");
    expect(src).not.toMatch(/^\s*body:\s*req\.body,\s*$/m);
    expect(src).toContain("bodyKeys: Object.keys(");
  });
});
