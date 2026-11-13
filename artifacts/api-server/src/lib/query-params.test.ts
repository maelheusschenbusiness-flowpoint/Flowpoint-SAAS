/**
 * query-params.test.ts
 *
 * Le defaut d'origine : `GET /audits?limit=-5` repondait 500. La limite etait
 * lue par `Math.min(parseInt(...) || 20, 50)`, qui laisse passer un nombre
 * negatif ; ce -5 partait dans un `LIMIT` que PostgreSQL refuse. Une chaine de
 * requete est une saisie du client, jamais un nombre.
 *
 * Ces tests fixent donc deux choses : ce qui est lu (une suite de chiffres
 * decimaux, rien d'autre — pas « 30abc », pas « 7.9 », pas « 1e3 »), et ce qui
 * arrive a une valeur hors bornes selon le besoin de l'appelant.
 */
import { describe, it, expect } from "vitest";
import { queryInt } from "./query-params.js";

/** Les bornes exactes de GET /audits (routes/client-mode.ts). */
const limiteAudits = (v: unknown): number =>
  queryInt(v, { defaut: 20, min: 1, max: 50, horsBornes: "borner" });

/** Les bornes exactes de parseDays (routes/analytics, campaigns, traffic). */
const parseDays = (v: unknown, def = 30): number =>
  queryInt(v, { defaut: def, min: 1, max: 365, horsBornes: "defaut" });

const BORNER = { defaut: 20, min: 1, max: 50, horsBornes: "borner" } as const;
const DEFAUT = { defaut: 30, min: 1, max: 365, horsBornes: "defaut" } as const;

describe("queryInt — ce qui est lu", () => {
  it("lit une valeur bien formee dans les bornes", () => {
    expect(queryInt("25", BORNER)).toBe(25);
    expect(queryInt("1", BORNER)).toBe(1);
    expect(queryInt("50", BORNER)).toBe(50);
  });

  it("rend la valeur par defaut quand le parametre est absent", () => {
    expect(queryInt(undefined, BORNER)).toBe(20);
    expect(queryInt(null, BORNER)).toBe(20);
  });

  it("ne lit pas un prefixe numerique : « 30abc » n'est pas 30", () => {
    expect(queryInt("30abc", DEFAUT)).toBe(30);
    expect(queryInt("30abc", { ...DEFAUT, defaut: 7 })).toBe(7);
    expect(queryInt("12px", BORNER)).toBe(20);
  });

  it("ne tronque pas un decimal : « 7.9 » n'est pas 7", () => {
    expect(queryInt("7.9", { ...BORNER, defaut: 20 })).toBe(20);
    expect(queryInt("7.0", BORNER)).toBe(20);
  });

  it("refuse les notations que parseInt accepterait : « 1e3 », « 0x10 »", () => {
    expect(queryInt("1e3", BORNER)).toBe(20);
    expect(queryInt("0x10", BORNER)).toBe(20);
    expect(queryInt("+5", BORNER)).toBe(20);
  });

  it("refuse une chaine vide ou faite d'espaces", () => {
    expect(queryInt("", BORNER)).toBe(20);
    expect(queryInt("   ", BORNER)).toBe(20);
    expect(queryInt(" 25 ", BORNER)).toBe(20);
  });

  it("refuse un tableau, que produit un parametre repete", () => {
    // ?limit=1&limit=2 arrive comme ["1", "2"].
    expect(queryInt(["1", "2"], BORNER)).toBe(20);
    expect(queryInt([], BORNER)).toBe(20);
    expect(queryInt(["25"], BORNER)).toBe(20);
  });

  it("refuse ce qui n'est pas une chaine, meme un nombre deja propre", () => {
    expect(queryInt(25, BORNER)).toBe(20);
    expect(queryInt(true, BORNER)).toBe(20);
    expect(queryInt({ limit: "25" }, BORNER)).toBe(20);
  });

  it("refuse un nombre que JavaScript ne represente pas fidelement", () => {
    expect(queryInt("9007199254740993", { ...BORNER, max: Number.MAX_SAFE_INTEGER })).toBe(20);
    expect(queryInt("99999999999999999999", { ...BORNER, max: Number.MAX_SAFE_INTEGER })).toBe(20);
  });
});

describe("queryInt — une valeur hors bornes", () => {
  it("en mode borner, « -5 » devient le minimum", () => {
    expect(queryInt("-5", BORNER)).toBe(1);
    expect(queryInt("-5", { ...BORNER, min: 10 })).toBe(10);
  });

  it("en mode borner, « 0 » devient le minimum", () => {
    expect(queryInt("0", BORNER)).toBe(1);
    expect(queryInt("-0", BORNER)).toBe(1);
  });

  it("en mode defaut, « -5 » et « 0 » rendent la valeur par defaut", () => {
    expect(queryInt("-5", DEFAUT)).toBe(30);
    expect(queryInt("0", DEFAUT)).toBe(30);
  });

  it("au-dessus du max : borner rend le max, defaut rend la valeur par defaut", () => {
    expect(queryInt("1000", BORNER)).toBe(50);
    expect(queryInt("51", BORNER)).toBe(50);
    expect(queryInt("1000", DEFAUT)).toBe(30);
    expect(queryInt("366", DEFAUT)).toBe(30);
  });

  it("les bornes elles-memes restent acceptees", () => {
    expect(queryInt("1", DEFAUT)).toBe(1);
    expect(queryInt("365", DEFAUT)).toBe(365);
  });
});

describe("GET /audits : la limite ne peut plus faire tomber la requete", () => {
  it("« -5 » devient 1 au lieu de partir dans LIMIT et de rendre un 500", () => {
    const limite = limiteAudits("-5");
    expect(limite).toBe(1);
    expect(limite).toBeGreaterThanOrEqual(1);
  });

  it("« 1000 » est ramene au plafond de 50", () => {
    expect(limiteAudits("1000")).toBe(50);
  });

  it("sans parametre, la limite reste celle d'avant : 20", () => {
    expect(limiteAudits(undefined)).toBe(20);
  });

  it("une limite exploitable est respectee", () => {
    expect(limiteAudits("10")).toBe(10);
  });
});

describe("parseDays : meme defaut qu'avant, sans lecture partielle", () => {
  it("« 400 » depasse l'annee et retombe sur 30", () => {
    expect(parseDays("400")).toBe(30);
  });

  it("« 30abc » n'est plus lu comme 30 par accident, mais par defaut", () => {
    expect(parseDays("30abc")).toBe(30);
    expect(parseDays("30abc", 28)).toBe(28);
  });

  it("sans parametre, la fenetre par defaut de l'appelant est conservee", () => {
    expect(parseDays(undefined)).toBe(30);
    expect(parseDays(undefined, 28)).toBe(28);
  });

  it("une fenetre demandee dans l'annee est respectee", () => {
    expect(parseDays("7")).toBe(7);
    expect(parseDays("365")).toBe(365);
  });
});
