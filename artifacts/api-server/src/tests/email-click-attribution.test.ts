/**
 * Attribution Smartlead — `GET /go`, le clic d'email compte cote serveur.
 *
 *  A  lecture des parametres : fp_lid valide seulement, UTM d'une liste fermee
 *  B  redirection : destination d'une table fixe, jamais une URL de la requete
 *  C  drapeau bot grossier (HEAD, scanners, prefetch), jamais bloquant
 *  D  route : drapeau OFF -> redirection sans ecriture ; ON -> une ecriture,
 *     sans cookie, sans IP / user-agent / fp_lid en clair ; dedoublonnage
 *     fp_lid + jour + categorie ; plafond par adresse sans jamais d'erreur
 *  E  funnel-tracking.js : utm_source=smartlead reconnu, fp_lid de l'URL garde
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";

const query = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const {
  lireClic, urlRedirection, estBotSuspect, cleIdempotenceClic, empreinteLead, campagnesAutorisees,
} = await import("../lib/email-click.js");
const { default: routeur, reinitialiserLimiteClic } = await import("../routes/email-click.js");
const { ETAPES_PUBLIQUES, ETAPES_TUNNEL } = await import("../services/funnel-events.js");

const FP_LID = "AbCdEfGhIjKlMnOpQr_-12";
const CHROME = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "accept-language": "fr-BE,fr;q=0.9",
};
const LIEN = `/go?fp_lid=${FP_LID}&utm_source=smartlead&utm_medium=email&utm_campaign=clients_fr_be`;

function app() {
  const a = express();
  a.set("trust proxy", 1);
  a.use(routeur);
  return a;
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rowCount: 1, rows: [] });
  reinitialiserLimiteClic();
  delete process.env["FP_EMAIL_CLICK_TRACKING"];
  delete process.env["FP_GO_DEFAULT_TARGET"];
  delete process.env["FP_GO_CAMPAIGNS"];
});
afterEach(() => {
  delete process.env["FP_EMAIL_CLICK_TRACKING"];
});

describe("A — lecture des parametres du clic", () => {
  it("garde un fp_lid valide et les UTM autorises", () => {
    expect(lireClic({ fp_lid: FP_LID, utm_source: "smartlead", utm_medium: "email",
      utm_campaign: "clients_fr_be", utm_content: "relance_2" })).toEqual({
      fpLid: FP_LID, utmSource: "smartlead", utmMedium: "email",
      utmCampaign: "clients_fr_be", utmContent: "relance_2", cible: "signup",
    });
  });

  it("ignore un fp_lid mal forme, un tableau, ou une valeur qui ressemble a un email", () => {
    const c = lireClic({ fp_lid: "lead@exemple.fr", utm_source: ["smartlead", "x"],
      utm_content: "jean.dupont@exemple.fr", utm_campaign: "jean_dupont_perso" });
    expect(c).toMatchObject({ fpLid: null, utmSource: null, utmContent: null, utmCampaign: null });
  });

  it("une campagne n'est reconnue que si elle est dans FP_GO_CAMPAIGNS (ou la liste par defaut)", () => {
    expect(campagnesAutorisees({})).toEqual(new Set(["clients_fr_be"]));
    const env = { FP_GO_CAMPAIGNS: "clients_fr_be, agences_fr ,Bad Value!" } as NodeJS.ProcessEnv;
    expect(campagnesAutorisees(env)).toEqual(new Set(["clients_fr_be", "agences_fr"]));
    expect(lireClic({ utm_campaign: "agences_fr" }, env).utmCampaign).toBe("agences_fr");
    expect(lireClic({ utm_campaign: "agences_fr" }, {}).utmCampaign).toBeNull();
  });
});

describe("B — jamais de redirection ouverte", () => {
  it("par defaut : la page d'inscription, avec fp_lid et UTM reconstruits", () => {
    expect(urlRedirection(lireClic({ fp_lid: FP_LID, utm_source: "smartlead", utm_medium: "email",
      utm_campaign: "clients_fr_be" }))).toBe(
      `/signin.html?fp_lid=${FP_LID}&utm_source=smartlead&fp_source=smartlead&utm_medium=email&utm_campaign=clients_fr_be`);
  });

  it("une destination est une cle de la table fixe, jamais une URL", () => {
    for (const to of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "constructor", "__proto__"]) {
      expect(urlRedirection(lireClic({ to }))).toBe("/signin.html");
    }
    expect(urlRedirection(lireClic({ to: "site", fp_lid: FP_LID }))).toBe(`https://flowpoint.pro/?fp_lid=${FP_LID}`);
    expect(urlRedirection(lireClic({ to: "pricing" }))).toBe("/pricing.html");
  });

  it("FP_GO_DEFAULT_TARGET choisit la destination par defaut, parmi les cles seulement", () => {
    expect(lireClic({}, { FP_GO_DEFAULT_TARGET: "site" } as NodeJS.ProcessEnv).cible).toBe("site");
    expect(lireClic({}, { FP_GO_DEFAULT_TARGET: "https://evil.example" } as NodeJS.ProcessEnv).cible).toBe("signup");
  });

  it("aucun autre parametre de la requete n'est reporte", () => {
    const url = urlRedirection(lireClic({ fp_lid: FP_LID, email: "lead@exemple.fr", next: "https://evil.example" }));
    expect(url).toBe(`/signin.html?fp_lid=${FP_LID}`);
  });
});

describe("C — drapeau bot grossier", () => {
  it("un navigateur humain n'est pas suspect", () => {
    expect(estBotSuspect({ method: "GET", headers: CHROME })).toBe(false);
  });
  it("HEAD, user-agent absent, scanners et clients de script sont suspects", () => {
    expect(estBotSuspect({ method: "HEAD", headers: CHROME })).toBe(true);
    expect(estBotSuspect({ method: "GET", headers: { "accept-language": "fr" } })).toBe(true);
    for (const ua of ["curl/8.4.0", "python-requests/2.31", "Mozilla/5.0 (compatible; Proofpoint URL Defense)",
      "Mozilla/5.0 HeadlessChrome/120.0", "Barracuda Sentinel (EE)", "Go-http-client/1.1"]) {
      expect(estBotSuspect({ method: "GET", headers: { ...CHROME, "user-agent": ua } })).toBe(true);
    }
  });
  it("un prefetch / apercu, ou l'absence de langue, est suspect", () => {
    expect(estBotSuspect({ method: "GET", headers: { ...CHROME, "sec-purpose": "prefetch" } })).toBe(true);
    expect(estBotSuspect({ method: "GET", headers: { ...CHROME, purpose: "prefetch" } })).toBe(true);
    expect(estBotSuspect({ method: "GET", headers: { "user-agent": CHROME["user-agent"] } })).toBe(true);
  });
});

describe("D — la route GET /go", () => {
  it("l'etape email_clic est serveur seulement : jamais declarable par un navigateur", () => {
    expect(ETAPES_TUNNEL).toContain("email_clic");
    expect(ETAPES_PUBLIQUES.has("email_clic")).toBe(false);
  });

  it("drapeau OFF (defaut) : redirige, sans aucune ecriture ni cookie", async () => {
    const r = await request(app()).get(LIEN).set(CHROME);
    expect(r.status).toBe(302);
    expect(r.headers["location"]).toBe(
      `/signin.html?fp_lid=${FP_LID}&utm_source=smartlead&fp_source=smartlead&utm_medium=email&utm_campaign=clients_fr_be`);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("drapeau ON : une ecriture email_clic smartlead, sans IP, user-agent ni fp_lid en clair", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    const r = await request(app()).get(LIEN + "&utm_content=v1").set(CHROME).set("X-Forwarded-For", "203.0.113.7");
    expect(r.status).toBe(302);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO funnel_events/);
    expect(sql).toMatch(/'email_clic'/);
    expect(sql).toMatch(/'smartlead'/);
    expect(sql).toMatch(/ON CONFLICT \(cle_idempotence\)/);
    const jour = new Date().toISOString().slice(0, 10);
    expect(params).toEqual([`lid-${empreinteLead(FP_LID)}`, "clients_fr_be", "v1", false,
      `email_clic:${empreinteLead(FP_LID)}:${jour}:humain`]);
    const brut = JSON.stringify(params);
    expect(brut).not.toContain(FP_LID);
    expect(brut).not.toContain("203.0.113.7");
    expect(brut).not.toContain("Chrome");
  });

  it("une verification HEAD est comptee a part, comme bot suspect", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    const r = await request(app()).head(LIEN).set(CHROME);
    expect(r.status).toBe(302);
    const params = query.mock.calls[0]![1] as unknown[];
    expect(params[3]).toBe(true);
    expect(String(params[4])).toMatch(/:bot$/);
  });

  it("dedoublonnage : un lead, un jour, une categorie ; le bot ne masque pas l'humain", () => {
    const j = "2026-10-27";
    expect(cleIdempotenceClic(FP_LID, false, j)).toBe(cleIdempotenceClic(FP_LID, false, j));
    expect(cleIdempotenceClic(FP_LID, true, j)).not.toBe(cleIdempotenceClic(FP_LID, false, j));
    expect(cleIdempotenceClic(FP_LID, false, j)).not.toBe(cleIdempotenceClic(FP_LID, false, "2026-10-28"));
    expect(cleIdempotenceClic(FP_LID, false, j)).not.toContain(FP_LID);
  });

  it("sans fp_lid valide ou hors Smartlead : redirection, rien n'est compte", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    const a = await request(app()).get("/go?fp_lid=lead@exemple.fr&utm_source=smartlead").set(CHROME);
    expect(a.status).toBe(302);
    expect(a.headers["location"]).toBe("/signin.html?utm_source=smartlead&fp_source=smartlead");
    await request(app()).get(`/go?fp_lid=${FP_LID}&utm_source=google`).set(CHROME);
    expect(query).not.toHaveBeenCalled();
  });

  it("une redirection ouverte demandee est ignoree", async () => {
    const r = await request(app()).get(`/go?fp_lid=${FP_LID}&to=https://evil.example/&url=https://evil.example/`).set(CHROME);
    expect(r.headers["location"]).toBe(`/signin.html?fp_lid=${FP_LID}`);
  });

  it("au-dela du plafond par adresse : toujours redirige, plus compte", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    const a = app();
    for (let i = 0; i < 25; i++) {
      const r = await request(a).get(LIEN).set(CHROME).set("X-Forwarded-For", "198.51.100.9");
      expect(r.status).toBe(302);
    }
    expect(query).toHaveBeenCalledTimes(20);
  });

  it("une base indisponible ne bloque jamais la redirection", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    query.mockRejectedValue(new Error("column \"bot_suspect\" does not exist"));
    const r = await request(app()).get(LIEN).set(CHROME);
    expect(r.status).toBe(302);
  });
});

describe("E — funnel-tracking.js reconnait le trafic Smartlead", () => {
  const SCRIPT = readFileSync(join(process.cwd(), "../flowpoint-export/funnel-tracking.js"), "utf8");

  function executer(search: string, session = new Map<string, string>()) {
    const envois: Record<string, unknown>[] = [];
    const cookies = new Map<string, string>([["fp_analytics_consent", "accepted"]]);
    const local = new Map<string, string>();
    const contexte: Record<string, unknown> = {
      URL, URLSearchParams, JSON, Set, Element: class {}, HTMLAnchorElement: class {},
      crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
      location: { pathname: "/signin.html", search, hostname: "app.flowpoint.pro", href: `https://app.flowpoint.pro/signin.html${search}` },
      document: {
        get cookie() { return [...cookies].map(([k, v]) => `${k}=${v}`).join("; "); },
        set cookie(v: string) { const [p] = v.split(";"); const i = p!.indexOf("="); cookies.set(p!.slice(0, i), p!.slice(i + 1)); },
        addEventListener: () => undefined,
        getElementById: () => null,
      },
      localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v) },
      sessionStorage: { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => session.set(k, v) },
      window: { fetch: (_u: string, init: { body: string }) => { envois.push(JSON.parse(init.body)); return { catch: () => undefined }; } },
    };
    new Script(SCRIPT).runInNewContext(contexte);
    return { envois, session };
  }

  it("utm_source=smartlead (ou fp_source) donne la source smartlead, pas direct", () => {
    expect(executer("?utm_source=smartlead").envois[0]).toMatchObject({ source: "smartlead" });
    expect(executer("?fp_source=smartlead").envois[0]).toMatchObject({ source: "smartlead" });
    expect(executer("").envois[0]).toMatchObject({ source: "direct" });
  });

  it("le fp_lid de l'URL est garde et joint, le premier contact gagnant", () => {
    const { envois, session } = executer(`?fp_lid=${FP_LID}&utm_source=smartlead`);
    expect(envois[0]).toMatchObject({ fp_lid: FP_LID });
    expect(session.get("fp_lid")).toBe(FP_LID);
    const premier = "ZzYyXxWwVvUuTtSsRr0123";
    const garde = executer(`?fp_lid=${FP_LID}`, new Map([["fp_lid", premier]]));
    expect(garde.envois[0]).toMatchObject({ fp_lid: premier });
  });

  it("un fp_lid d'URL mal forme n'est ni garde ni joint", () => {
    const { envois, session } = executer("?fp_lid=lead@exemple.fr");
    expect(envois[0]).not.toHaveProperty("fp_lid");
    expect(session.has("fp_lid")).toBe(false);
  });
});
