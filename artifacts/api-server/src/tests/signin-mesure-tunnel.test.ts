/**
 * signin-mesure-tunnel.test.ts
 *
 * `signin.html` est la premiere etape du tunnel qu'on puisse mesurer cote
 * prospect : `/` et `/index.html` y redirigent (app.ts), et le formulaire y
 * vit. Le site vitrine `flowpoint.pro`, lui, n'est dans AUCUN depot de ce
 * compte — verifie le 18/10/2026 : trois depots existent, aucun ne le
 * contient. Son instrumentation reste donc a faire ailleurs.
 *
 * Ce que ces tests verrouillent :
 *   - `signup_started` est bien emis ;
 *   - `signup_form_completed` porte le MEME identifiant de visiteur, sans quoi
 *     les deux etapes ne se joignent pas et le taux d'abandon du formulaire
 *     reste incalculable ;
 *   - aucune donnee personnelle ne part vers le point de mesure ;
 *   - la mesure ne peut jamais bloquer une inscription ;
 *   - et le formulaire n'a pas ete modifie : memes champs, memes validations.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";

const PAGE = readFileSync(join(process.cwd(), "../flowpoint-export/signin.html"), "utf8");

/** Les blocs de script en ligne, pour en verifier la syntaxe. */
function blocsEnLigne(): string[] {
  return [...PAGE.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
}

describe("la mesure est posee et exploitable", () => {
  it("signup_started est emis au chargement", () => {
    expect(PAGE).toContain("fpEtape('signup_started')");
  });

  it("le formulaire transmet le MEME identifiant de visiteur", () => {
    // C'est ce lien qui rend le tunnel joignable : sans lui, on sait combien de
    // formulaires ont ete envoyes, mais pas combien ont ete commences.
    expect(PAGE).toContain("visiteurId: fpVid()");
    const i = PAGE.indexOf("/api/auth/pre-register");
    const j = PAGE.indexOf("visiteurId: fpVid()");
    expect(j, "visiteurId n'est pas dans le corps du POST pre-register").toBeGreaterThan(i);
  });

  it("l'identifiant est aleatoire et persistant, jamais derive d'une donnee personnelle", () => {
    const i = PAGE.indexOf("function fpVid()");
    expect(i).toBeGreaterThan(-1);
    const fn = PAGE.slice(i, i + 700);
    expect(fn).toContain("randomUUID");
    expect(fn).toContain("localStorage");
    for (const interdit of ["email", "firstName", "lastName", "companyName", "postalCode", "address"]) {
      expect(fn, `fpVid() derive l'identifiant de ${interdit}`).not.toContain(interdit);
    }
  });

  it("AUCUNE DONNEE PERSONNELLE ne part vers le point de mesure", () => {
    const i = PAGE.indexOf("function fpEtape(");
    expect(i).toBeGreaterThan(-1);
    const fn = PAGE.slice(i, i + 700);
    expect(fn).toContain("/api/public/funnel-event");
    for (const interdit of ["email", "firstName", "lastName", "companyName",
                            "postalCode", "address", "city", "phone", "vat"]) {
      expect(fn, `la mesure transmet ${interdit}`).not.toContain(interdit);
    }
  });
});

describe("la mesure ne peut pas nuire", () => {
  it("l'emission n'est jamais attendue, et ses erreurs sont avalees", () => {
    const i = PAGE.indexOf("function fpEtape(");
    const fn = PAGE.slice(i, i + 700);
    expect(fn, "l'emission est attendue — elle pourrait retarder la page").not.toContain("await ");
    expect(fn, "une erreur reseau remonterait a l'utilisateur").toContain(".catch(");
    expect(fn).toContain("try");
  });

  it("chaque helper tolere un stockage indisponible (navigation privee)", () => {
    for (const nom of ["fpVid", "fpSource", "fpEtape"]) {
      const i = PAGE.indexOf(`function ${nom}(`);
      expect(i, `${nom} a disparu`).toBeGreaterThan(-1);
      expect(PAGE.slice(i, i + 700), `${nom} ne protege pas son acces`).toContain("catch");
    }
  });

  it("tous les scripts en ligne restent syntaxiquement valides", () => {
    const blocs = blocsEnLigne();
    expect(blocs.length).toBeGreaterThan(0);
    for (const [i, b] of blocs.entries()) {
      expect(() => new Script(b), `le bloc ${i} ne compile plus`).not.toThrow();
    }
  });
});

describe("LE FORMULAIRE N'A PAS ETE MODIFIE", () => {
  it("les sept champs obligatoires et leurs validations sont intacts", () => {
    // Contrainte explicite : ne pas toucher au formulaire. La mesure est
    // purement additive, ce test l'atteste.
    for (const champ of ["firstName", "lastName", "email", "companyName",
                         "address", "city", "postalCode"]) {
      expect(PAGE, `le champ ${champ} a disparu`).toContain(`val('${champ}')`);
    }
    for (const message of ["Le prénom est requis.", "Le nom est requis.",
                           "Adresse email invalide.", "Le pays est requis.",
                           "L'adresse est requise.", "La ville est requise.",
                           "Le code postal est requis."]) {
      expect(PAGE, `la validation « ${message} » a disparu`).toContain(message);
    }
  });

  it("la carte bancaire reste exigee : le parcours passe toujours par Checkout", () => {
    expect(PAGE).toContain("/api/auth/pre-register");
    expect(PAGE, "un chemin d'essai sans Checkout est apparu").not.toContain("skip_checkout");
  });
});
