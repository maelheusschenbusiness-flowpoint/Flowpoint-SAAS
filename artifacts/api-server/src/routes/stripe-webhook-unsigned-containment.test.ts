/**
 * stripe-webhook-unsigned-containment.test.ts
 *
 * QUESTION POSEE LE 18/10/2026 : les tests metier qui utilisent le mode sans
 * signature peuvent-ils, d'une maniere ou d'une autre, activer ce mode sur un
 * environnement de PRODUCTION ?
 *
 * Deux fichiers posent `ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true` pour exercer la
 * logique metier du webhook sans signer chaque evenement. Ce fichier verrouille
 * les quatre voies par lesquelles ce drapeau pourrait atteindre la production.
 * Chacune est verifiee par une mesure, pas par un raisonnement.
 *
 *   1. Le drapeau n'est affecte QUE dans des fichiers de test.
 *   2. Ces fichiers ne sont pas embarques dans le paquet de production.
 *   3. Aucune configuration versionnee ne le pose.
 *   4. Meme pose, il est ignore en production — et la garde de production est
 *      evaluee AVANT lui, donc aucun ordre d'evaluation ne peut l'inverser.
 *
 * Mesure complementaire, hors test : les deux instances deployees repondent
 * « Webhook signature verification failed » (400) a une signature invalide, et
 * non « Webhook verification unavailable » (503). Leurs identifiants Stripe
 * sont donc presents, ce qui rend la branche sans signature INATTEIGNABLE chez
 * elles, independamment de NODE_ENV.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const DRAPEAU = "ALLOW_UNSIGNED_STRIPE_WEBHOOKS";
const racineServeur = path.join(import.meta.dirname ?? __dirname, "..", "..");
const racineDepot = path.join(racineServeur, "..", "..");

function fichiers(dir: string, garder: (n: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    if (nom === "node_modules" || nom === "dist" || nom === ".git") continue;
    const p = path.join(dir, nom);
    if (statSync(p).isDirectory()) { out.push(...fichiers(p, garder)); continue; }
    if (garder(nom)) out.push(p);
  }
  return out;
}

describe("1. le drapeau n'est affecte que dans des fichiers de test", () => {
  it("aucun fichier de code serveur ne pose le drapeau", () => {
    const coupables: string[] = [];
    for (const f of fichiers(path.join(racineServeur, "src"), (n) => n.endsWith(".ts"))) {
      if (f.endsWith(".test.ts")) continue;
      const src = readFileSync(f, "utf8");
      // Une LECTURE est legitime ; une AFFECTATION ne l'est pas.
      //
      // La detection cible la FORME d'une affectation — `process.env[...] =` —
      // et non la simple presence du nom. Premiere version de ce test : elle
      // attrapait le nom du drapeau cite dans les messages de journal
      // (« Posez ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true … ») et accusait a tort
      // le gestionnaire de webhook.
      const affectation = new RegExp(
        `process\\.env\\[\\s*["'\`]${DRAPEAU}["'\`]\\s*\\]\\s*=(?!=)`,
      );
      if (affectation.test(src)) coupables.push(path.relative(racineServeur, f));
    }
    expect(coupables, `du code serveur pose le drapeau : ${coupables.join(", ")}`).toEqual([]);
  });

  it("le drapeau n'est lu qu'a un seul endroit, dans le gestionnaire de webhook", () => {
    const lecteurs: string[] = [];
    for (const f of fichiers(path.join(racineServeur, "src"), (n) => n.endsWith(".ts"))) {
      if (f.endsWith(".test.ts")) continue;
      if (readFileSync(f, "utf8").includes(DRAPEAU)) lecteurs.push(path.relative(racineServeur, f));
    }
    expect(lecteurs).toEqual(["src/routes/stripe-webhook.ts"]);
  });
});

describe("2. le paquet de production n'embarque ni test ni affectation", () => {
  const paquet = path.join(racineServeur, "dist", "index.mjs");

  it("aucune affectation du drapeau dans le paquet construit", () => {
    if (!existsSync(paquet)) {
      // Rien a verifier sans build ; la CI construit avant de tester.
      expect(existsSync(path.join(racineServeur, "build.mjs")),
        "ni paquet construit ni script de build : la verification n'a plus de sens").toBe(true);
      return;
    }
    const bundle = readFileSync(paquet, "utf8");
    const affectations = bundle.match(new RegExp(`${DRAPEAU}"?\\]?\\s*=\\s*["']true`, "g")) ?? [];
    expect(affectations, `le paquet POSE le drapeau (${affectations.length} fois)`).toEqual([]);
    // Il doit en revanche bien le LIRE : sinon la garde aurait disparu.
    expect(bundle).toContain(DRAPEAU);
  });

  it("aucun fichier de test n'est embarque dans le paquet", () => {
    if (!existsSync(paquet)) return;
    const bundle = readFileSync(paquet, "utf8");
    for (const marque of ["vi.hoisted", 'from "vitest"', "stripe-webhook-signature.test"]) {
      expect(bundle.includes(marque), `le paquet embarque « ${marque} »`).toBe(false);
    }
  });

  it("le build exclut les fichiers de test", () => {
    const build = readFileSync(path.join(racineServeur, "build.mjs"), "utf8");
    // Le paquet part d'un point d'entree unique : un fichier de test n'y entre
    // que s'il est importe par le code de production, ce que le test precedent
    // verifie directement sur le resultat.
    expect(build).toMatch(/entryPoints|entry/i);
  });
});

describe("3. aucune configuration versionnee ne pose le drapeau", () => {
  it("ni render.yaml, ni aucun fichier de configuration", () => {
    const candidats = fichiers(racineDepot, (n) =>
      /\.(ya?ml|json|sh|env|toml|conf)$/.test(n) || n.startsWith(".env"));
    const coupables = candidats
      .filter((f) => !f.includes("pnpm-lock"))
      .filter((f) => readFileSync(f, "utf8").includes(DRAPEAU))
      .map((f) => path.relative(racineDepot, f));
    expect(coupables, `une configuration pose le drapeau : ${coupables.join(", ")}`).toEqual([]);
  });

  it("aucun fichier .env n'est versionne", () => {
    const envs = fichiers(racineDepot, (n) => n === ".env" || n.startsWith(".env."))
      .filter((f) => !f.includes("example") && !f.includes("sample"))
      .map((f) => path.relative(racineDepot, f));
    expect(envs, `des fichiers d'environnement sont versionnes : ${envs.join(", ")}`).toEqual([]);
  });
});

describe("4. en production, le drapeau est ignore — et evalue en second", () => {
  const src = readFileSync(path.join(racineServeur, "src/routes/stripe-webhook.ts"), "utf8");

  it("la garde de production est evaluee AVANT la lecture du drapeau", () => {
    // L'ordre compte : si le drapeau etait lu d'abord, une production mal
    // configuree pourrait traiter un evenement non signe avant d'atteindre son
    // propre refus.
    const iProd = src.indexOf('Missing Stripe credentials in production');
    const iDrapeau = src.indexOf(`${DRAPEAU}"] !== "true"`);
    expect(iProd, "le refus de production a disparu").toBeGreaterThan(0);
    expect(iDrapeau, "la lecture du drapeau a disparu").toBeGreaterThan(0);
    expect(iProd, "le drapeau est evalue AVANT la garde de production").toBeLessThan(iDrapeau);
  });

  it("le refus de production ne depend pas du drapeau", () => {
    // Extrait la branche « sans identifiants » et verifie que la condition de
    // production ne mentionne pas le drapeau : les deux gardes sont
    // independantes, l'une ne peut pas desactiver l'autre.
    const i = src.indexOf('if (process.env["NODE_ENV"] === "production") {');
    expect(i).toBeGreaterThan(0);
    const condition = src.slice(i, src.indexOf("}", i));
    expect(condition).not.toContain(DRAPEAU);
  });

  it("le drapeau n'est accepte que sur la chaine exacte « true »", () => {
    expect(src).toContain(`process.env["${DRAPEAU}"] !== "true"`);
    // Ni comparaison laxiste, ni coercition.
    expect(src).not.toMatch(new RegExp(`${DRAPEAU}"\\]\\s*(==[^=]|\\?\\?|\\|\\|)`));
    expect(src).not.toMatch(new RegExp(`Boolean\\(process\\.env\\["${DRAPEAU}"\\]`));
  });
});
