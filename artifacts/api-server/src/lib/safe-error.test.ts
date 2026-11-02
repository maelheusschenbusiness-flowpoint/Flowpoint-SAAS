/**
 * safe-error.test.ts
 *
 * safeErrMsg / safeErrDetail decident ce qu'une reponse HTTP laisse voir d'une
 * erreur interne. Le contrat est asymetrique et c'est tout l'interet :
 *   - en production, rien ne sort (message generique, aucun detail) ;
 *   - hors production, le message reel et une pile TRONQUEE a 4 lignes.
 * Ces tests verrouillent les deux versants, et la coupe de la pile, pour que
 * personne ne transforme par inadvertance une fuite en commodite de debogage.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

import { safeErrMsg, safeErrDetail } from "./safe-error.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safeErrMsg", () => {
  it("en production, rend un message generique pour une Error", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(safeErrMsg(new Error("connexion postgres refusee sur 10.0.0.4:5432")))
      .toBe("Internal server error");
  });

  it("en production, rend un message generique pour une chaine", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(safeErrMsg("secret sk_live_abcdef")).toBe("Internal server error");
  });

  it("hors production, rend le message de l'Error", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(safeErrMsg(new Error("table absente"))).toBe("table absente");
  });

  it("hors production, rend String(valeur) pour ce qui n'est pas une Error", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(safeErrMsg("echec brut")).toBe("echec brut");
    expect(safeErrMsg(42)).toBe("42");
    expect(safeErrMsg(null)).toBe("null");
    expect(safeErrMsg(undefined)).toBe("undefined");
  });
});

describe("safeErrDetail", () => {
  it("en production, ne rend aucun detail", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(safeErrDetail(new Error("connexion postgres refusee"))).toBeUndefined();
    expect(safeErrDetail("chaine quelconque")).toBeUndefined();
  });

  it("hors production, rend detail et une pile limitee a 4 lignes", () => {
    vi.stubEnv("NODE_ENV", "development");

    const err = new Error("table absente");
    err.stack = ["Error: table absente", "  at a", "  at b", "  at c", "  at d", "  at e"]
      .join("\n");

    const detail = safeErrDetail(err);

    expect(detail).toEqual({
      detail: "table absente",
      stack: ["Error: table absente", "  at a", "  at b", "  at c"],
    });
  });

  it("hors production, une Error sans pile ne rend que detail", () => {
    vi.stubEnv("NODE_ENV", "development");

    const err = new Error("sans pile");
    err.stack = undefined;

    const detail = safeErrDetail(err);

    expect(detail).toEqual({ detail: "sans pile" });
    expect(detail).not.toHaveProperty("stack");
  });

  it("hors production, une valeur qui n'est pas une Error rend detail sans pile", () => {
    vi.stubEnv("NODE_ENV", "development");

    const detail = safeErrDetail("echec brut");

    expect(detail).toEqual({ detail: "echec brut" });
    expect(detail).not.toHaveProperty("stack");
  });
});
