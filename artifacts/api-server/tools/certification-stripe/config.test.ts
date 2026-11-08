import { describe, it, expect } from "vitest";
import { resoudreConfigStripeReel, emailDeTest, motifEmailCampagne, verifierBaseUrl } from "./config.ts";
import { CleRefusee } from "./garde-cles.ts";

const SK = "sk_test_" + "a".repeat(30);
const COMPLET_L = { CERT_STRIPE_REEL: "1", CERT_STRIPE_BASE_URL: "http://127.0.0.1:8080", CERT_STRIPE_EMAIL_BASE: "moi@exemple.fr", STRIPE_TEST_SECRET_KEY: SK, STRIPE_TEST_PUBLISHABLE_KEY: "pk_test_" + "p".repeat(20), STRIPE_TEST_WEBHOOK_SECRET: "whsec_" + "w".repeat(20), TEST_MAIL_DIR: "/tmp/m", ENABLE_TEST_MAILER: "true" };

describe("configuration de la suite Stripe reel : saut explicite", () => {
  it("environnement vide : non pret, raisons explicites (jamais pret par defaut)", () => {
    const c = resoudreConfigStripeReel({});
    expect(c.pret).toBe(false);
    expect(c.raisons.join(" ")).toMatch(/CERT_STRIPE_REEL=1/);
    expect(c.raisons.join(" ")).toMatch(/CERT_STRIPE_BASE_URL/);
    expect(c.raisons.join(" ")).toMatch(/CERT_STRIPE_EMAIL_BASE/);
    expect(c.raisons.join(" ")).toMatch(/STRIPE_TEST_SECRET_KEY/);
  });
  it("Mode L complet : pret", () => { const c = resoudreConfigStripeReel(COMPLET_L); expect(c.raisons).toEqual([]); expect(c.pret).toBe(true); expect(c.mode).toBe("L"); });
  it("Mode R : les variables du serveur local ne sont pas exigees", () => {
    const c = resoudreConfigStripeReel({ CERT_STRIPE_REEL: "1", CERT_STRIPE_BASE_URL: "https://flowpoint-test.onrender.com", CERT_STRIPE_EMAIL_BASE: "moi@exemple.fr", STRIPE_TEST_SECRET_KEY: SK });
    expect(c.pret).toBe(true); expect(c.mode).toBe("R");
  });
  it("cle live : non pret, sans reveler la cle", () => {
    const live = "sk_live_" + "z".repeat(30);
    const c = resoudreConfigStripeReel({ ...COMPLET_L, STRIPE_TEST_SECRET_KEY: live });
    expect(c.pret).toBe(false); expect(c.raisons.join(" ")).not.toContain(live);
    const c2 = resoudreConfigStripeReel({ ...COMPLET_L, STRIPE_LIVE_API_KEY: live });
    expect(c2.pret).toBe(false);
  });
  it("production refusee comme cible", () => {
    for (const u of ["https://app.flowpoint.pro", "https://flowpoint.pro", "https://www.flowpoint.pro", "https://exemple.com"]) {
      expect(() => verifierBaseUrl(u)).toThrow(CleRefusee);
      expect(resoudreConfigStripeReel({ ...COMPLET_L, CERT_STRIPE_BASE_URL: u }).pret).toBe(false);
    }
  });
  it("Mode L sans courrier capture ou sans whsec : non pret", () => {
    expect(resoudreConfigStripeReel({ ...COMPLET_L, ENABLE_TEST_MAILER: "" }).pret).toBe(false);
    expect(resoudreConfigStripeReel({ ...COMPLET_L, STRIPE_TEST_WEBHOOK_SECRET: "" }).pret).toBe(false);
  });
});

describe("adresses d'essai par adressage +", () => {
  it("construit et reconnait les adresses de campagne, et seulement elles", () => {
    const e = emailDeTest("moi@exemple.fr", "abc", "nominal-1");
    expect(e).toBe("moi+fp-cert-abc-nominal-1@exemple.fr");
    const re = motifEmailCampagne("moi@exemple.fr");
    expect(re.test(e)).toBe(true);
    expect(re.test("moi@exemple.fr")).toBe(false);
    expect(re.test("autre+fp-cert-abc-x@exemple.fr")).toBe(false);
    expect(re.test("moi+client-reel@exemple.fr")).toBe(false);
  });
  it("refuse une base qui contient deja un +", () => { expect(() => emailDeTest("moi+x@exemple.fr", "a", "b")).toThrow(CleRefusee); });
});
