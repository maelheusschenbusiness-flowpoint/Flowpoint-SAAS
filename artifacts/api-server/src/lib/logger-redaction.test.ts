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

import { OPTIONS_MASQUAGE } from "./logger.js";

/**
 * Fait ecrire un logger portant EXACTEMENT la configuration de production, et
 * rend l'objet journalise. Un test qui reconstruirait sa propre configuration
 * ne prouverait rien sur le journal reel.
 */
function journaliser(charge: unknown, message = "test"): Record<string, unknown> {
  const lignes: string[] = [];
  const flux = new Writable({
    write(morceau, _enc, cb) { lignes.push(String(morceau)); cb(); },
  });
  const l = pino({ level: "debug", ...OPTIONS_MASQUAGE }, flux);
  l.warn(charge as Record<string, unknown>, message);
  return JSON.parse(lignes.join("")) as Record<string, unknown>;
}

/** Le texte complet de la ligne de journal — c'est lui qui ne doit rien contenir. */
function brut(charge: unknown, message = "test"): string {
  return JSON.stringify(journaliser(charge, message));
}

const TRACEUR = "SECRET-TRACEUR-12345";

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

/**
 * Mesure du 17/10/2026 sur dix-huit formes d'appel reelles. La premiere version
 * de la correction (liste de chemins `x` et `*.x`) couvrait les erreurs jusqu'au
 * deuxieme niveau, mais SIX formes fuyaient encore. Chacune a son test.
 */
describe("les six fuites mesurees apres la premiere correction", () => {
  it("fuite 1 — un secret au troisieme niveau et au-dela", () => {
    expect(brut({ ctx: { stripe: { token: TRACEUR } } })).not.toContain(TRACEUR);
    expect(brut({ a: { b: { c: { d: { token: TRACEUR } } } } })).not.toContain(TRACEUR);
  });

  it("fuite 2 — un secret dans un tableau (`*` ne traverse pas un index)", () => {
    expect(brut({ items: [{ token: TRACEUR }] })).not.toContain(TRACEUR);
    expect(brut({ lots: [[{ apiKey: TRACEUR }]] })).not.toContain(TRACEUR);
  });

  it("fuite 3 — une erreur enrichie, style client HTTP", () => {
    const err = Object.assign(new Error("401"), {
      config: { headers: { Authorization: `Bearer ${TRACEUR}` } },
    });
    expect(brut({ err })).not.toContain(TRACEUR);
  });

  it("fuite 4 — une casse differente designe le meme secret", () => {
    for (const cle of ["Token", "TOKEN", "API_KEY", "api-key", "Api_Key", "Client_Secret"]) {
      expect(brut({ [cle]: TRACEUR }), `${cle} n'est pas masque`).not.toContain(TRACEUR);
    }
  });

  it("fuite 5 — un secret reconnaissable interpole dans le message", () => {
    expect(brut({}, `entete recu: Bearer ${TRACEUR}`)).not.toContain(TRACEUR);
    expect(brut({}, "cle sk_live_ABCDEFGH12345678")).not.toContain("sk_live_ABCDEFGH12345678");
  });

  it("fuite 6 — un secret reconnaissable recopie dans err.message", () => {
    const sortie = brut({ err: new Error("echec avec sk_live_ABCDEFGH12345678") });
    expect(sortie).not.toContain("sk_live_ABCDEFGH12345678");
  });
});

describe("les secrets reconnaissables a leur forme, sous une cle anodine", () => {
  it("une chaine de connexion portant un mot de passe", () => {
    const sortie = brut({ cible: `postgresql://admin:${TRACEUR}@db.interne:5432/flowpoint` });
    expect(sortie).not.toContain(TRACEUR);
    // L'hote reste lisible : masquer ne doit pas aveugler le diagnostic.
    expect(sortie).toContain("db.interne");
  });

  it("un jeton JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmno";
    expect(brut({ jeton: jwt })).not.toContain(jwt);
  });

  it("un secret de signature de webhook Stripe", () => {
    expect(brut({ entete: "whsec_ABCDEFGHIJKLMNOP" })).not.toContain("whsec_ABCDEFGHIJKLMNOP");
  });
});

describe("un lien de connexion est une credential, pas une URL", () => {
  const LIEN = "https://flowpoint.pro/login-verify.html?token=" + "a".repeat(64);

  it("la cle `debugLink` est masquee", () => {
    expect(brut({ debugLink: LIEN })).not.toContain("aaaaaaaa");
  });

  it("les autres portes d'entree le sont aussi", () => {
    for (const cle of ["verifyPath", "magicLink", "loginLink", "inviteUrl", "resetLink"]) {
      expect(brut({ [cle]: LIEN }), `${cle} n'est pas masque`).not.toContain("aaaaaaaa");
    }
  });

  it("un lien a jeton sous une cle anodine est masque par sa forme", () => {
    const sortie = brut({ cible: LIEN });
    expect(sortie).not.toContain("aaaaaaaa");
    // Le chemin reste lisible : on doit pouvoir savoir de quel lien il s'agit.
    expect(sortie).toContain("login-verify.html");
  });
});

describe("masquer ne doit jamais casser ni aveugler le journal", () => {
  it("err.type, err.message et err.stack restent presents", () => {
    const sortie = journaliser({ err: new Error("message lisible") });
    const err = sortie["err"] as Record<string, unknown>;
    expect(err["type"]).toBe("Error");
    expect(err["message"]).toBe("message lisible");
    expect(typeof err["stack"]).toBe("string");
  });

  it("la cause d'une erreur reste exploitable, secret masque", () => {
    const cause = Object.assign(new Error("origine"), { token: TRACEUR });
    const sortie = journaliser({ err: new Error("surface", { cause }) });
    const texte = JSON.stringify(sortie);
    expect(texte).not.toContain(TRACEUR);
    expect(texte).toContain("origine");
  });

  it("un objet cyclique ne bloque pas l'appel", () => {
    const o: Record<string, unknown> = { orgId: "org-42" };
    o["self"] = o;
    expect(() => journaliser({ o })).not.toThrow();
    expect(brut({ o })).toContain("org-42");
  });

  it("un objet tres profond ne bloque pas l'appel et ne fuit pas", () => {
    let o: Record<string, unknown> = { token: TRACEUR };
    for (let i = 0; i < 40; i++) o = { n: o };
    expect(brut(o)).not.toContain(TRACEUR);
  });

  it("une erreur dont un accesseur leve ne casse pas le journal", () => {
    const err = new Error("boum");
    Object.defineProperty(err, "detail", { get() { throw new Error("accesseur casse"); }, enumerable: true, configurable: true });
    expect(() => journaliser({ err })).not.toThrow();
  });

  it("les champs de diagnostic restent intacts", () => {
    const sortie = journaliser({ orgId: "org-42", path: "/api/missions", errCode: "23502", duree: 42 });
    expect(sortie["orgId"]).toBe("org-42");
    expect(sortie["path"]).toBe("/api/missions");
    expect(sortie["errCode"]).toBe("23502");
    expect(sortie["duree"]).toBe(42);
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
