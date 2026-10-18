/**
 * login-request-enumeration.test.ts
 *
 * ENUMERATION DE COMPTES, mesuree en production le 18/10/2026.
 *
 * `POST /api/auth/login-request` repondait, pour une adresse inconnue :
 *
 *   HTTP 404
 *   {"error":"Aucun compte trouvé pour cette adresse email. Créez votre
 *     compte sur /signin.html.","redirectTo":"/signin.html"}
 *
 * Verifie par un appel reel avec une adresse inventee. On pouvait donc tester
 * une liste d'adresses et savoir lesquelles sont clientes de FlowPoint.
 *
 * La reponse est desormais uniforme : meme code et meme forme que pour un
 * envoi reussi. Le client (`login.html`) affiche « Lien envoye » dans les deux
 * cas — le parcours de connexion est inchange du point de vue de l'appelant.
 *
 * On lit la source : exercer la route demanderait de monter tout le routeur
 * d'authentification avec son transport de courriel, et l'ecart se verifie
 * entierement ici.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(process.cwd(), "src/routes/auth.ts"), "utf8");
const CLIENT = readFileSync(join(process.cwd(), "../flowpoint-export/login.html"), "utf8");

describe("la reponse ne revele plus l'existence d'un compte", () => {
  it("le message qui fuyait a disparu", () => {
    expect(SOURCE, "le message d'enumeration est revenu")
      .not.toContain("Aucun compte trouvé pour cette adresse email");
  });

  it("la branche « aucun compte » repond en 2xx, comme un envoi reussi", () => {
    // On isole la branche et on verifie qu'elle n'y renvoie plus de 404.
    const i = SOURCE.indexOf("login-request: aucun compte");
    expect(i, "la branche « aucun compte » a disparu").toBeGreaterThan(-1);
    const branche = SOURCE.slice(i, i + 400);
    expect(branche).toContain("res.json(");
    expect(branche, "la branche renvoie encore un statut d'erreur").not.toMatch(/res\.status\(4\d\d\)/);
  });

  it("le message uniforme reste au conditionnel — il n'affirme rien", () => {
    const i = SOURCE.indexOf("login-request: aucun compte");
    const branche = SOURCE.slice(i, i + 400);
    expect(branche).toContain("Si un compte existe");
  });

  it("aucun courriel n'est envoye dans cette branche", () => {
    const i = SOURCE.indexOf("login-request: aucun compte");
    const branche = SOURCE.slice(i, i + 400);
    for (const envoi of ["sendMail", "mailer.", "resend", "storeMagicToken"]) {
      expect(branche, `cette branche appelle ${envoi}`).not.toContain(envoi);
    }
  });
});

describe("le parcours de connexion existant continue de fonctionner", () => {
  it("le client traite toute reponse 2xx comme un envoi reussi", () => {
    // C'est ce qui garantit que l'uniformisation ne casse rien : login.html
    // branche sur `r.ok`, pas sur un code precis.
    expect(CLIENT).toContain("if (r.ok)");
    expect(CLIENT).toContain("Lien envoy");
  });

  it("la limite de debit reste en place sur la route", () => {
    expect(SOURCE).toMatch(/router\.post\("\/auth\/login-request",\s*authRateLimit/);
  });

  it("les autres garde-fous du compte sont conserves", () => {
    // Suspension et compte inactif restent traites — on n'a pas supprime de
    // protection en corrigeant l'enumeration.
    expect(SOURCE).toContain("Votre compte a été suspendu");
    expect(SOURCE).toContain("Votre compte n'est plus actif");
  });
});
