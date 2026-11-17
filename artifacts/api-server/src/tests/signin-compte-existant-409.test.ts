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

function texte(language: string | null): string {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/signin.html", runScripts: "outside-only" });
  if (language !== null) dom.window.localStorage.setItem("fp:language", language);
  dom.window.eval(localeSource);
  return dom.window.fpAccessText("accountExists");
}

describe("signin : compte deja existant (409)", () => {
  it("le gestionnaire est cle sur le statut HTTP 409 et passe par fpAccessText (aucun francais dans la page)", () => {
    expect(signin).toMatch(/res\.status === 409/);
    expect(signin).toContain("window.fpAccessText('accountExists')");
    expect(signin).toMatch(/\{ ok: r\.ok, status: r\.status, data: d \}/);
  });
  it("interface anglaise (defaut) : message explicite en anglais", () => {
    expect(texte(null)).toBe(EN);
    expect(texte("en")).toBe(EN);
  });
  it("interface francaise : message en francais", () => {
    expect(texte("fr")).toBe(FR);
  });
  it("la page ne contient aucune phrase francaise ; la paire fr/en vit dans fp-locale.js", () => {
    expect(signin).not.toContain("Un compte existe");
    expect(localeSource).toContain(EN);
    expect(localeSource).toContain("Un compte existe d\\u00e9j\\u00e0 avec cette adresse");
  });
});
