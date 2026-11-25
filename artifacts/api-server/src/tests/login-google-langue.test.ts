/**
 * login-google-langue.test.ts
 *
 * Continuite de langue : le bouton « Continue with Google » de login.html
 * partait vers /api/auth/google/login SANS `language`. Le serveur
 * (normalizeSignupLanguage) retombait alors sur l'anglais : un visiteur qui avait
 * choisi le francais et ouvrait Google depuis la page de connexion voyait son
 * inscription Google enregistree en anglais (e-mails inclus).
 *
 * Le lien doit porter la langue de l'interface publique (fp-locale.js, defaut
 * « en », jamais le navigateur) et le fp_lid deja valide, comme signin.html.
 * Aucun plan n'est envoye depuis cette page : rien ne touche prix ni eligibilite.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const LOGIN = readFileSync(join(process.cwd(), "../flowpoint-export/login.html"), "utf8");
const LID = "AbCdEfGhIjKlMnOpQrStUv";

function loadBuilder(opts: { language?: string | (() => string); lid?: string; resolver?: boolean }) {
  const start = LOGIN.indexOf("function fpGoogleLoginUrl(");
  expect(start, "login.html doit definir fpGoogleLoginUrl()").toBeGreaterThan(-1);
  const end = LOGIN.indexOf("\n    }\n", start);
  const src = LOGIN.slice(start, end + 6);
  const win: Record<string, unknown> = {};
  if (opts.resolver !== false) {
    win["fpResolveLanguage"] = typeof opts.language === "function" ? opts.language : () => opts.language ?? "en";
  }
  const ctx = {
    window: win, encodeURIComponent,
    sessionStorage: { getItem: (k: string) => (k === "fp_lid" ? (opts.lid ?? null) : null) },
  };
  return runInNewContext(`${src}; fpGoogleLoginUrl`, ctx) as (base: string) => string;
}

describe("login.html — le lien Google porte la langue choisie", () => {
  it("transmet la langue de l'interface publique", () => {
    expect(loadBuilder({ language: "fr" })("/api/auth/google/login")).toBe("/api/auth/google/login?language=fr");
  });

  it("anglais par defaut quand rien n'est resolu (jamais deduit du navigateur)", () => {
    expect(loadBuilder({ language: "en" })("/api/auth/google/login")).toBe("/api/auth/google/login?language=en");
    expect(loadBuilder({ resolver: false })("/api/auth/google/login")).toBe("/api/auth/google/login?language=en");
    expect(loadBuilder({ language: () => { throw new Error("boom"); } })("/api/auth/google/login")).toBe("/api/auth/google/login?language=en");
  });

  it("transmet un fp_lid valide, ignore un fp_lid invalide", () => {
    expect(loadBuilder({ language: "fr", lid: LID })("/api/auth/google/login")).toBe(`/api/auth/google/login?fp_lid=${LID}&language=fr`);
    expect(loadBuilder({ language: "fr", lid: "x<script>" })("/api/auth/google/login")).toBe("/api/auth/google/login?language=fr");
  });

  it("n'envoie aucun plan ni montant depuis la page de connexion", () => {
    const url = loadBuilder({ language: "fr", lid: LID })("/api/auth/google/login");
    expect(url).not.toMatch(/plan=|price|amount|trial/i);
  });

  it("le gestionnaire de clic utilise ce constructeur", () => {
    expect(LOGIN).toMatch(/window\.location\.href\s*=\s*fpGoogleLoginUrl\(url\)/);
  });
});
