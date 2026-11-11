/**
 * Langue d'inscription — tests purs et statiques (sans base).
 * Les comportements SQL sont couverts par signup-language-db.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeSignupLanguage, parseSignupLanguage, SUPPORTED_SIGNUP_LANGUAGES,
  applySignupLanguage, getRecipientLanguage,
} from "./signup-language.js";

const root = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("normalizeSignupLanguage", () => {
  it("garde les codes de la whitelist fp-locale.js", () => {
    for (const l of SUPPORTED_SIGNUP_LANGUAGES) expect(normalizeSignupLanguage(l)).toBe(l);
    expect(normalizeSignupLanguage("FR")).toBe("fr");
    expect(normalizeSignupLanguage("pt_BR")).toBe("pt-br");
    expect(normalizeSignupLanguage("de-AT")).toBe("de");
  });
  it("tout le reste (absent, invalide, injection) -> en", () => {
    for (const v of [undefined, null, "", "  ", "xx", "ja", "fr'; DROP TABLE x", 42, {}, "a".repeat(100)]) {
      expect(normalizeSignupLanguage(v)).toBe("en");
    }
    expect(parseSignupLanguage("xx")).toBeNull();
    expect(parseSignupLanguage("en-GB")).toBe("en");
  });
  it("la whitelist est identique a LOCALE_BY_LANGUAGE de fp-locale.js", () => {
    const src = read("../flowpoint-export/fp-locale.js");
    const block = src.slice(src.indexOf("LOCALE_BY_LANGUAGE = {"), src.indexOf("};", src.indexOf("LOCALE_BY_LANGUAGE = {")));
    const keys = [...block.matchAll(/^\s*'?([a-z-]+)'?\s*:/gm)].map(m => m[1]);
    expect([...keys].sort()).toEqual([...SUPPORTED_SIGNUP_LANGUAGES].sort());
  });
});

describe("applySignupLanguage (client simule)", () => {
  it("n'ecrase pas un choix existant (SQL CASE) et ne touche l'org que si vide", async () => {
    const calls: string[] = [];
    const client = { query: vi.fn(async (sql: string) => { calls.push(sql); return { rows: [] }; }) };
    await applySignupLanguage(client, { orgId: "o1", language: "de" });
    const sql = calls.join("\n");
    expect(sql).toContain("COALESCE(user_prefs.settings->>'language', '') = ''");
    expect(sql).toContain("COALESCE(language, '') = ''");
    expect(sql).toContain("RELEASE SAVEPOINT");
  });
  it("une erreur SQL n'interrompt pas l'activation (rollback au savepoint)", async () => {
    const client = { query: vi.fn(async (sql: string) => { if (sql.includes("user_prefs")) throw new Error("boom"); return { rows: [] }; }) };
    await expect(applySignupLanguage(client, { orgId: "o1", language: "fr" })).resolves.toBeUndefined();
    expect(client.query.mock.calls.some(c => String(c[0]).includes("ROLLBACK TO SAVEPOINT"))).toBe(true);
  });
  it("ligne historique sans langue (NULL) : aucune ecriture", async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    await applySignupLanguage(client, { orgId: "o1", language: null });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("getRecipientLanguage (client simule)", () => {
  const db = (pref: unknown, org: unknown) => ({ query: vi.fn(async () => ({ rows: [{ pref, org }] })) });
  it("utilisateur > organisation > en ; defaut francais historique ignore", async () => {
    expect(await getRecipientLanguage({ orgId: "o" }, db("de", "es"))).toBe("de");
    expect(await getRecipientLanguage({ orgId: "o" }, db(null, "es"))).toBe("es");
    expect(await getRecipientLanguage({ orgId: "o" }, db(null, "fr"))).toBe("en");
    expect(await getRecipientLanguage({ orgId: "o" }, db(null, null))).toBe("en");
    expect(await getRecipientLanguage({}, db("de", null))).toBe("en");
  });
});

describe("cablage statique", () => {
  it("signin.html envoie la langue au pre-register et au depart Google", () => {
    const html = read("../flowpoint-export/signin.html");
    expect(html).toMatch(/language:\s*fpSignupLanguage\(\)/);
    expect(html).toContain("qs.push('language=' + encodeURIComponent(fpSignupLanguage()))");
    expect(html).toContain("window.fpResolveLanguage");
  });
  it("la colonne est assuree au demarrage (Render ne lance pas migrate.mjs)", () => {
    expect(read("src/services/init-data-tables.ts")).toContain(
      "ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS language TEXT");
  });
  it("pre-register et Google stockent la langue whitelistee", () => {
    const auth = read("src/routes/auth.ts");
    expect(auth).toContain("normalizeSignupLanguage(_rawLanguage)");
    expect(auth).toMatch(/seller_id, fp_lid, language, created_at, expires_at\)\s+VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13,\$14/);
    expect(auth).toContain("signupLanguageFromCookie]");
  });
  it("les deux chemins d'activation recopient la langue", () => {
    expect(read("src/routes/stripe-webhook.ts")).toContain("applySignupLanguage(activateClient, { orgId: newOrgId, language: signupRow[\"language\"] })");
    expect(read("src/routes/public-billing.ts")).toContain("applySignupLanguage(_fcActTxC, { orgId: _fcAOrgId, language: _fcSignup[\"language\"] })");
  });
  it("GET /api/me lit user_prefs.settings.language (survit a la reconnexion)", () => {
    const me = read("src/routes/me.ts");
    expect(me).toContain("SELECT settings FROM user_prefs WHERE org_id=$1");
    expect(me).toContain("resolveDashboardLanguage(settingsLanguage");
  });
});
