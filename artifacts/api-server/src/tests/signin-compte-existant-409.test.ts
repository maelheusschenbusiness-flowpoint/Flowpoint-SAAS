import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Inscription avec un e-mail deja connu (HTTP 409) : le message affiche doit etre localise
// (en / fr) et cle sur le statut HTTP, jamais sur le texte serveur (qui reste anglais).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: any };
const exportDir = resolve(process.cwd(), "../flowpoint-export");
const localeSource = readFileSync(resolve(exportDir, "fp-locale.js"), "utf8");
const signin = readFileSync(resolve(exportDir, "signin.html"), "utf8");

const FR = "Un compte existe déjà avec cette adresse e-mail. Connectez-vous pour gérer votre abonnement.";
const EN = "An account already exists with this email address. Sign in to manage your subscription.";

function texte(language: string | null, francais: string, anglais: string): string {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/signin.html", runScripts: "outside-only" });
  if (language !== null) dom.window.localStorage.setItem("fp:language", language);
  dom.window.eval(localeSource);
  return dom.window.fpPublicText(francais, anglais);
}

describe("signin : compte deja existant (409)", () => {
  it("le gestionnaire est cle sur le statut HTTP 409 et passe par fpPublicText", () => {
    expect(signin).toMatch(/res\.status === 409/);
    expect(signin).toContain("window.fpPublicText(");
    expect(signin).toMatch(/\{ ok: r\.ok, status: r\.status, data: d \}/);
  });
  it("interface anglaise (defaut) : message explicite en anglais", () => {
    expect(texte(null, FR, EN)).toBe(EN);
    expect(texte("en", FR, EN)).toBe(EN);
  });
  it("interface francaise : message en francais", () => {
    expect(texte("fr", FR, EN)).toBe(FR);
  });
  it("le catalogue fp-locale.js porte la paire fr -> en (anglais sans repli generique)", () => {
    expect(localeSource).toContain(JSON.stringify(FR));
    expect(localeSource).toContain(JSON.stringify(EN));
  });
});
