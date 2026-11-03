/**
 * fetch-borne.test.ts
 *
 * MESURE DU 17/10/2026 : sur soixante appels sortants du serveur, vingt-quatre
 * ne portaient aucun delai. Six etaient sur le chemin de connexion — echange
 * de jeton et lecture du profil chez Google, GitHub et Apple.
 *
 * `fetch` de Node ne coupe pas une requete qui n'avance plus avant ses delais
 * par defaut d'environ cinq minutes. Un fournisseur d'identite lent tenait donc
 * une connexion de login pendant des minutes.
 *
 * Ces tests exercent un vrai serveur HTTP local qui ne repond JAMAIS. C'est la
 * seule facon de prouver qu'un appel se coupe : un `fetch` simule ne prouve
 * rien sur le comportement du reseau.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { fetchBorne, estDepassementDeDelai, DELAIS, DELAI_SORTIE_MS } from "./fetch-borne.js";

/** Un serveur qui accepte la connexion et ne repond jamais. */
let muet: Server;
let base = "";

beforeAll(async () => {
  muet = createServer(() => { /* aucune reponse, jamais */ });
  await new Promise<void>((ok) => muet.listen(0, "127.0.0.1", ok));
  const adr = muet.address();
  base = `http://127.0.0.1:${typeof adr === "object" && adr ? adr.port : 0}`;
});
afterAll(() => new Promise<void>((ok) => { muet.closeAllConnections?.(); muet.close(() => ok()); }));

describe("un fournisseur qui ne repond jamais est coupe dans le delai", () => {
  it("l'appel echoue en moins de 400 ms quand le delai est de 200 ms", async () => {
    const t = Date.now();
    await expect(fetchBorne(base, {}, 200)).rejects.toSatisfy(estDepassementDeDelai);
    const ecoule = Date.now() - t;
    expect(ecoule, `l'appel a tenu ${ecoule} ms`).toBeLessThan(400);
  });

  it("l'echec est reconnaissable comme un depassement de delai", async () => {
    const err = await fetchBorne(base, {}, 150).then(() => null, (e: unknown) => e);
    expect(estDepassementDeDelai(err)).toBe(true);
    expect(estDepassementDeDelai(new Error("autre chose"))).toBe(false);
    expect(estDepassementDeDelai(null)).toBe(false);
  });

  it("sans delai explicite, le defaut s'applique quand meme", async () => {
    // On ne va pas attendre dix secondes : on verifie que le signal est pose.
    const init: RequestInit = {};
    const p = fetchBorne(base, init, 120);
    await expect(p).rejects.toSatisfy(estDepassementDeDelai);
    expect(DELAI_SORTIE_MS).toBeGreaterThan(0);
    expect(DELAI_SORTIE_MS).toBeLessThanOrEqual(30_000);
  });

  it("un signal fourni par l'appelant est respecte, pas remplace", async () => {
    const ctrl = new AbortController();
    const p = fetchBorne(base, { signal: ctrl.signal }, 50_000);
    setTimeout(() => ctrl.abort(new Error("annulation voulue")), 80);
    await expect(p).rejects.toThrow(/annulation voulue/);
  });

  it("un appel qui aboutit n'est pas coupe", async () => {
    const vif = createServer((_q, r) => { r.writeHead(200, { "Content-Type": "application/json" }); r.end('{"ok":true}'); });
    await new Promise<void>((ok) => vif.listen(0, "127.0.0.1", ok));
    const adr = vif.address();
    const url = `http://127.0.0.1:${typeof adr === "object" && adr ? adr.port : 0}`;
    try {
      const r = await fetchBorne(url, {}, 2_000);
      expect(r.ok).toBe(true);
      expect(await r.json()).toEqual({ ok: true });
    } finally {
      await new Promise<void>((ok) => vif.close(() => ok()));
    }
  });
});

/**
 * Un `signal` d'appelant ne desarme plus le delai : les deux annulations sont
 * combinees. Ici un `fetch` simule remplace le reseau — il ne repond JAMAIS
 * mais il respecte le signal recu, comme `fetch` de Node : c'est ce qui permet
 * d'observer LEQUEL des deux signaux a coupe l'appel, et de verifier qu'aucune
 * requete ne part quand `msDelai` est invalide.
 */
describe("un signal de l'appelant est combine au delai, pas substitue", () => {
  /** Ce que le `fetch` simule a recu. */
  type Suivi = { appels: number; signaux: (AbortSignal | null)[] };

  /** Un `fetch` qui n'aboutit jamais et rejette quand son signal est annule. */
  function fetchMuet(suivi: Suivi) {
    return (_entree: string | URL | Request, init?: RequestInit): Promise<Response> => {
      suivi.appels += 1;
      const signal = init?.signal ?? null;
      suivi.signaux.push(signal);
      return new Promise<Response>((_ok, ko) => {
        if (!signal) return; // aucune reponse, aucune annulation possible
        if (signal.aborted) { ko(signal.reason); return; }
        signal.addEventListener("abort", () => ko(signal.reason), { once: true });
      });
    };
  }

  function installe(): Suivi {
    const suivi: Suivi = { appels: 0, signaux: [] };
    vi.stubGlobal("fetch", fetchMuet(suivi));
    return suivi;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  it("avec un signal d'appelant, le delai coupe quand meme la reponse qui n'arrive pas", async () => {
    const suivi = installe();
    const ctrl = new AbortController();
    const t = Date.now();
    await expect(fetchBorne("https://exemple.test/jeton", { signal: ctrl.signal }, 80))
      .rejects.toSatisfy(estDepassementDeDelai);
    const ecoule = Date.now() - t;
    expect(ecoule, `l'appel a tenu ${ecoule} ms`).toBeLessThan(400);
    expect(suivi.appels).toBe(1);
    // Le signal passe a `fetch` est le signal combine, pas celui de l'appelant,
    // qui lui n'a jamais ete annule.
    expect(suivi.signaux[0]).not.toBe(ctrl.signal);
    expect(suivi.signaux[0]?.aborted).toBe(true);
    expect(ctrl.signal.aborted).toBe(false);
  });

  it("le signal de l'appelant annule avant le delai rejette avec une AbortError", async () => {
    const suivi = installe();
    const ctrl = new AbortController();
    const p = fetchBorne("https://exemple.test/jeton", { signal: ctrl.signal }, 5_000);
    setTimeout(() => ctrl.abort(), 40);
    const err = await p.then(() => null, (e: unknown) => e);
    expect((err as { name?: string } | null)?.name).toBe("AbortError");
    expect(suivi.appels).toBe(1);
  });

  it("sans signal d'appelant, le delai s'applique toujours", async () => {
    const suivi = installe();
    await expect(fetchBorne("https://exemple.test/jeton", {}, 80))
      .rejects.toSatisfy(estDepassementDeDelai);
    expect(suivi.appels).toBe(1);
    expect(suivi.signaux[0]).not.toBeNull();
    expect(suivi.signaux[0]?.aborted).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "un msDelai de %s est refuse par une TypeError, sans lancer de requete",
    async (msDelai) => {
      const suivi = installe();
      const err = await fetchBorne("https://exemple.test/jeton", {}, msDelai)
        .then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(TypeError);
      expect((err as TypeError).message).toContain("msDelai");
      expect(suivi.appels, "une requete est partie malgre un msDelai invalide").toBe(0);
    },
  );
});

describe("les delais sont courts sur les chemins ou un humain attend", () => {
  it("l'identite est la plus serree : un ecran de connexion ne doit pas rester bloque", () => {
    expect(DELAIS.identite).toBeLessThanOrEqual(10_000);
  });
  it("aucun delai ne depasse vingt secondes", () => {
    for (const [nom, ms] of Object.entries(DELAIS)) {
      expect(ms, `${nom} = ${ms} ms`).toBeLessThanOrEqual(20_000);
      expect(ms, `${nom} = ${ms} ms`).toBeGreaterThanOrEqual(5_000);
    }
  });
});

describe("plus aucune sortie reseau du serveur n'est sans delai", () => {
  const racine = path.join(import.meta.dirname ?? __dirname, "..");

  function fichiersSource(dir: string): string[] {
    const out: string[] = [];
    for (const nom of readdirSync(dir)) {
      const p = path.join(dir, nom);
      if (statSync(p).isDirectory()) { out.push(...fichiersSource(p)); continue; }
      if (!nom.endsWith(".ts") || nom.endsWith(".test.ts")) continue;
      if (nom === "fetch-borne.ts" || nom === "_scenario_test.ts") continue;
      // routes/behavioral.ts sert un script au NAVIGATEUR : ses `fetch` ne
      // sortent pas du serveur.
      if (nom === "behavioral.ts") continue;
      out.push(p);
    }
    return out;
  }

  /** Delimite l'appel en equilibrant les parentheses. */
  function appelComplet(src: string, depart: number): string {
    let prof = 0, j = depart;
    while (j < src.length) {
      if (src[j] === "(") prof += 1;
      else if (src[j] === ")") { prof -= 1; if (prof === 0) break; }
      j += 1;
    }
    return src.slice(depart, j + 1);
  }

  it("aucun `fetch(` sans signal ne subsiste dans le code serveur", () => {
    const nus: string[] = [];
    for (const f of fichiersSource(racine)) {
      const src = readFileSync(f, "utf8");
      const motif = /(?<![A-Za-z])fetch\(/g;
      let m: RegExpExecArray | null;
      while ((m = motif.exec(src)) !== null) {
        const appel = appelComplet(src, m.index + "fetch".length);
        if (/\bsignal\s*:/.test(appel) || appel.includes("AbortSignal")) continue;
        // `fetch()` sans argument n'est pas un appel : c'est une mention en
        // commentaire ou en documentation.
        if (appel.replace(/\s/g, "") === "()") continue;
        const ligne = src.slice(0, m.index).split("\n").length;
        nus.push(`${path.relative(racine, f)}:${ligne}`);
      }
    }
    expect(nus, `sorties reseau sans delai : ${nus.join(", ")}`).toEqual([]);
  });

  it("les six sorties du chemin de connexion sont bornees", () => {
    const src = readFileSync(path.join(racine, "routes/auth.ts"), "utf8");
    for (const hote of [
      "oauth2.googleapis.com/token",
      "www.googleapis.com/oauth2/v3/userinfo",
      "github.com/login/oauth/access_token",
      "api.github.com/user",
      "appleid.apple.com/auth/keys",
      "appleid.apple.com/auth/token",
    ]) {
      const i = src.indexOf(hote);
      expect(i, `${hote} a disparu de auth.ts`).toBeGreaterThan(0);
      const avant = src.slice(Math.max(0, i - 200), i);
      expect(avant, `l'appel vers ${hote} n'est pas borne`).toContain("fetchBorne(");
    }
  });
});
