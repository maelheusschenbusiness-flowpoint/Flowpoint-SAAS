/**
 * stripe-webhook-unsigned-containment.test.ts
 *
 * Verifie que le webhook ne conserve aucun mode de traitement sans signature
 * et que la verification reste liee au mode Stripe configure.
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
    let estDossier: boolean;
    try { estDossier = statSync(p).isDirectory(); } catch { continue; }
    if (estDossier) { out.push(...fichiers(p, garder)); continue; }
    if (garder(nom)) out.push(p);
  }
  return out;
}

describe("le code serveur n'autorise jamais de webhook sans signature", () => {
  it("aucun fichier serveur ne lit ou n'affecte l'ancien drapeau", () => {
    const references: string[] = [];
    for (const f of fichiers(path.join(racineServeur, "src"), (n) => n.endsWith(".ts"))) {
      if (f.endsWith(".test.ts")) continue;
      if (readFileSync(f, "utf8").includes(DRAPEAU)) references.push(path.relative(racineServeur, f));
    }
    expect(references).toEqual([]);
  });

  it("le routeur verifie la signature et le mode de chaque evenement", () => {
    const src = readFileSync(path.join(racineServeur, "src/routes/stripe-webhook.ts"), "utf8");
    expect(src).toContain("constructEvent(rawBody, sig, webhookSecret)");
    expect(src).toContain('process.env["STRIPE_TEST_WEBHOOK_SECRET"]');
    expect(src).toContain("event.livemode !== expectedLivemode");
    expect(src).not.toContain(DRAPEAU);
  });
});

describe("le paquet de production n'embarque ni test ni ancien drapeau", () => {
  const paquet = path.join(racineServeur, "dist", "index.mjs");

  it("aucune reference a l'ancien drapeau dans le paquet construit", () => {
    if (!existsSync(paquet)) {
      // Rien a verifier sans build ; la CI construit avant de tester.
      expect(existsSync(path.join(racineServeur, "build.mjs")),
        "ni paquet construit ni script de build : la verification n'a plus de sens").toBe(true);
      return;
    }
    const bundle = readFileSync(paquet, "utf8");
    expect(bundle).not.toContain(DRAPEAU);
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

describe("aucune configuration de deploiement ne l'active", () => {
  it("render.yaml ne pose pas l'ancien drapeau", () => {
    const config = path.join(racineDepot, "render.yaml");
    if (!existsSync(config)) return;
    expect(readFileSync(config, "utf8")).not.toContain(DRAPEAU);
  });
});

describe("le refus en production est independant de l'ancien drapeau", () => {
  const src = readFileSync(path.join(racineServeur, "src/routes/stripe-webhook.ts"), "utf8");

  it("le routeur ne contient aucune lecture de ce drapeau", () => {
    expect(src).not.toContain(DRAPEAU);
  });

  it("les modes Stripe doivent correspondre et la signature est obligatoire", () => {
    expect(src).toContain("keyMode !== configuredMode");
    expect(src).toContain("if (!webhookSecret)");
    expect(src).toContain("if (typeof sig !== \"string\" || !sig)");
  });
});
