/**
 * login-verify-attribution.test.ts
 *
 * Continuite du tunnel vitrine -> app, retour de connexion (lien magique).
 *
 * login-verify.js purge TOUS les caches `fp_*` avant de valider le lien
 * (securite : aucune fuite entre deux comptes sur un meme navigateur). Cette
 * purge emportait aussi l'identite du visiteur et sa source (`fp_vid`,
 * `fp_source`) ainsi que le `fp_lid` du lien d'outreach (sessionStorage) : au
 * retour de connexion, la conversion n'etait plus rattachee a sa campagne.
 * Ce ne sont ni des donnees de compte ni des secrets : ils doivent survivre,
 * valides, comme la langue (`fp:language`). Tout le reste reste purge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const SRC = readFileSync(join(process.cwd(), "../flowpoint-export/login-verify.js"), "utf8");

const VID = "3f2b8a52-7c1e-4b6d-9a40-5e8f1c2d3b4a";
const LID = "AbCdEfGhIjKlMnOpQrStUv";

class Store {
  private m = new Map<string, string>();
  constructor(init: Record<string, string> = {}) { Object.entries(init).forEach(([k, v]) => this.m.set(k, v)); }
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  keys() { return [...this.m.keys()]; }
}

function run(local: Record<string, string>, session: Record<string, string>) {
  const localStorage = new Store(local);
  const sessionStorage = new Store(session);
  const els: Record<string, { style: Record<string, string>; textContent: string; addEventListener: () => void }> = {};
  const el = (id: string) => (els[id] ??= { style: {}, textContent: "", addEventListener: () => undefined });
  const ctx: Record<string, unknown> = {
    URLSearchParams, JSON, Date, Math, Promise, setTimeout: () => 0,
    localStorage, sessionStorage,
    document: { getElementById: el },
    fetch: () => new Promise(() => undefined),          // la reponse n'importe pas : la purge est synchrone
    window: {
      location: { search: "?token=tok", replace: () => undefined, href: "" },
      fpPublicText: (_fr: string, en: string) => en,
      fpPublicTranslateText: (s: string) => s,
      fpResolveLanguage: () => "en",
    },
  };
  (ctx.window as Record<string, unknown>).window = ctx.window;
  runInNewContext(SRC, ctx);
  return { localStorage, sessionStorage };
}

describe("login-verify.js — la purge de securite conserve l'attribution du visiteur", () => {
  const local = {
    "fp:language": "fr",
    fp_vid: VID,
    fp_source: "smartlead",
    fp_cart: JSON.stringify({ plan: "pro", addons: {}, _v: 1 }),
    fp_dashboard_state: "{\"status\":\"active\"}",
    "fp-user": "autre-compte",
    fp_token: "secret",
  };

  it("conserve fp_vid, fp_source et la langue ; fp_lid (sessionStorage) aussi", () => {
    const { localStorage, sessionStorage } = run(local, { fp_lid: LID, fp_session_token: "ancien", fp_next: "/x" });
    expect(localStorage.getItem("fp_vid")).toBe(VID);
    expect(localStorage.getItem("fp_source")).toBe("smartlead");
    expect(localStorage.getItem("fp:language")).toBe("fr");
    expect(sessionStorage.getItem("fp_lid")).toBe(LID);
  });

  it("purge toujours les caches utilisateur et les jetons", () => {
    const { localStorage, sessionStorage } = run(local, { fp_lid: LID, fp_session_token: "ancien", fp_next: "/x" });
    for (const k of ["fp_cart", "fp_dashboard_state", "fp-user", "fp_token"]) expect(localStorage.getItem(k), k).toBeNull();
    expect(sessionStorage.getItem("fp_session_token")).toBeNull();
    expect(sessionStorage.getItem("fp_next")).toBeNull();
  });

  it("ne restaure que des valeurs valides (rien de forge n'est conserve)", () => {
    const { localStorage, sessionStorage } = run(
      { fp_vid: "<script>", fp_source: "pirate" },
      { fp_lid: "trop-court" },
    );
    expect(localStorage.getItem("fp_vid")).toBeNull();
    expect(localStorage.getItem("fp_source")).toBeNull();
    expect(sessionStorage.getItem("fp_lid")).toBeNull();
  });
});
