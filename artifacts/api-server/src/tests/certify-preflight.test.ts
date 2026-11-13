import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPT = pathToFileURL(resolve(process.cwd(), "../../scripts/certify-preflight.mjs")).href;
const { evaluer } = (await import(/* @vite-ignore */ SCRIPT)) as { evaluer: (p: string, e: Record<string, string>) => { dangers: string[]; items: { id: string; etat: string }[] } };

const complet = {
  STRIPE_TEST_MODE: "true", STRIPE_TEST_SECRET_KEY: "sk_test_abc", STRIPE_TEST_PUBLISHABLE_KEY: "pk_test_abc", STRIPE_TEST_WEBHOOK_SECRET: "whsec_abc",
  AI_LAB_CONVERSION_URL: "https://ailab-test.example/api", CONVERSION_EVENT_SECRET: "x".repeat(32), TEST_MAIL_DIR: "/tmp/mails",
  ADMIN_KEY: "k".repeat(20), BASE_URL: "http://127.0.0.1:8791",
};
const etat = (r: ReturnType<typeof evaluer>, fragment: string) => r.items.find((i) => i.id.includes(fragment))?.etat;

describe("pre-controle des certifications reelles", () => {
  it("conversion : tout est READY avec un environnement complet de TEST", () => {
    const r = evaluer("conversion", complet);
    expect(r.dangers).toEqual([]);
    expect(r.items.every((i) => i.etat === "READY")).toBe(true);
  });
  it("conversion : sans rien, tous les prerequis sont signales MISSING", () => {
    const r = evaluer("conversion", {});
    expect(r.items.every((i) => i.etat === "MISSING")).toBe(true);
  });
  it("refuse (danger) toute cle LIVE, meme dans une variable inattendue", () => {
    expect(evaluer("conversion", { ...complet, AUTRE: "sk_live_abc" }).dangers.length).toBe(1);
    expect(evaluer("conversion", { ...complet, STRIPE_WEBHOOK_SECRET: "whsec_live_x" }).dangers.length).toBe(1);
  });
  it("refuse la production et les cibles hors liste", () => {
    expect(evaluer("conversion", { ...complet, NODE_ENV: "production" }).dangers.length).toBe(1);
    expect(etat(evaluer("conversion", { ...complet, BASE_URL: "https://app.flowpoint.pro" }), "BASE_URL")).toBe("REFUSED");
    expect(etat(evaluer("conversion", { ...complet, STRIPE_TEST_SECRET_KEY: "sk_foo" }), "secrete")).toBe("REFUSED");
  });
  it("ne divulgue jamais une valeur", () => {
    const r = JSON.stringify(evaluer("conversion", complet));
    expect(r).not.toMatch(/sk_test_abc|whsec_abc|kkkkkkkk|xxxxxxxx/);
  });
  it("hubspot : complet / incomplet / surcharge de fausse API refusee", () => {
    const ok = { HUBSPOT_CLIENT_ID: "id", HUBSPOT_CLIENT_SECRET: "s".repeat(20), CRM_TOKEN_ENCRYPTION_KEY: "ab".repeat(32), PUBLIC_URL: "https://flowpoint-test.onrender.com" };
    expect(evaluer("hubspot", ok).items.filter((i) => i.etat === "MISSING" || i.etat === "REFUSED")).toEqual([]);
    expect(evaluer("hubspot", {}).items.filter((i) => i.etat === "MISSING").length).toBe(4);
    expect(etat(evaluer("hubspot", { ...ok, HUBSPOT_API_BASE: "http://127.0.0.1:1" }), "absents")).toBe("REFUSED");
  });
  it("profil inconnu : erreur explicite", () => {
    expect(() => evaluer("autre", {})).toThrow(/profil inconnu/);
  });
});
