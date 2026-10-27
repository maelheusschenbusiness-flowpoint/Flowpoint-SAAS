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
const journal = vi.hoisted(() => ({ lignes: [] as unknown[][] }));
vi.mock("../lib/logger.js", () => {
  const capter = (...a: unknown[]) => { journal.lignes.push(a); };
  return { logger: { info: capter, warn: capter, error: capter, debug: capter, fatal: capter } };
});
vi.mock("../middlewares/rateLimiter.js", async (orig) => {
  const vrai = await orig<typeof import("../middlewares/rateLimiter.js")>();
  return { ...vrai, createIpRateLimit: () => (_q: unknown, _r: unknown, n: () => void) => n() };
});

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
  a.use(express.json());
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
  delete process.env["FP_EMAIL_VISIT_BEACON"];
  journal.lignes = [];
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
    const url = urlRedirection(lireClic({ fp_lid: FP_LID, next: "https://evil.example", nom: "Dupont" }));
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
    // Un `@` dans un parametre : refus complet, aucun parametre reporte.
    expect(a.headers["location"]).toBe("/signin.html");
    const b = await request(app()).get("/go?fp_lid=trop-court&utm_source=smartlead").set(CHROME);
    expect(b.headers["location"]).toBe("/signin.html?utm_source=smartlead&fp_source=smartlead");
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

// ── Durcissement securite (revue du 27/10/2026) ──────────────────────────────

const { contientDonneePersonnelle } = await import("../lib/email-click.js");
const { serialiserRequeteHttp } = await import("../lib/http-log.js");
const { purgerAttributionEmail, statistiquesClicsEmail } = await import("../services/funnel-events.js");

/** La destination finale, resolue comme un navigateur, est-elle l'une des trois cles ? */
function destinationAutorisee(location: string, hote = "https://app.flowpoint.pro"): boolean {
  const u = new URL(location, hote);
  return [`${hote}/signin.html`, `${hote}/pricing.html`, "https://flowpoint.pro/"].includes(u.origin + u.pathname);
}

describe("F — redirections ouvertes : entrees adverses", () => {
  const TO_ADVERSES = [
    "https://evil.example/", "//evil.example", "%2F%2Fevil.example", "%252F%252Fevil.example",
    "/\\evil.example", "\\\\evil.example", "/%5Cevil.example", "https:evil.example",
    "\tsite", "site\n", "si%0Ate", " site", "site ", "SITE", "Site", "sIgNuP", "Pricing",
    "ѕite", "xn--site-xyz", "sitе", "https://flowpoint.pro.evil.example/",
    "https://evil.example@flowpoint.pro/", "javascript:alert(1)", "data:text/html,x",
    "__proto__", "constructor", "toString", "hasOwnProperty",
  ];

  for (const to of TO_ADVERSES) it(`to=${JSON.stringify(to)} -> une destination fixe`, async () => {
    const r = await request(app()).get(`/go?fp_lid=${FP_LID}&to=${encodeURIComponent(to)}`).set(CHROME);
    expect(r.status).toBe(302);
    const loc = String(r.headers["location"]);
    expect(destinationAutorisee(loc)).toBe(true);
    expect(loc.startsWith("/signin.html") || loc.startsWith("/pricing.html") || loc.startsWith("https://flowpoint.pro/")).toBe(true);
    expect(loc).not.toMatch(/^\/\/|^\/\\|evil/i);
  });

  it("parametres repetes : ambigus, donc ignores", async () => {
    const r = await request(app()).get(`/go?to=site&to=https://evil.example&fp_lid=${FP_LID}&fp_lid=ZzYyXxWwVvUuTtSsRr0123`).set(CHROME);
    expect(r.headers["location"]).toBe("/signin.html");
  });

  it("tabulation, retour a la ligne ou espace dans fp_lid / UTM : valeur rejetee, jamais nettoyee", async () => {
    for (const v of [`%09${FP_LID}`, `${FP_LID}%0A`, `${FP_LID}%0D%0ALocation:%20https://evil.example`, ` ${FP_LID}`]) {
      const r = await request(app()).get(`/go?fp_lid=${v}&utm_campaign=clients_fr_be%0A`).set(CHROME);
      expect(r.headers["location"]).toBe("/signin.html");
    }
  });

  it("Host, X-Forwarded-Host, Origin et Referer falsifies n'influencent pas la destination", async () => {
    for (const to of ["", "&to=site", "&to=pricing"]) {
      const sain = (await request(app()).get(`/go?fp_lid=${FP_LID}${to}`).set(CHROME)).headers["location"];
      const r = await request(app()).get(`/go?fp_lid=${FP_LID}${to}`).set(CHROME)
        .set("Host", "evil.example").set("X-Forwarded-Host", "evil.example")
        .set("X-Forwarded-Proto", "http").set("Origin", "https://evil.example").set("Referer", "https://evil.example/");
      expect(r.headers["location"]).toBe(sain);
      expect(String(r.headers["location"])).not.toContain("evil");
    }
  });

  it("la redirection est construite depuis les bases codees en dur", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/email-click.ts"), "utf8")
      + readFileSync(join(process.cwd(), "src/lib/email-click.ts"), "utf8");
    expect(src).not.toMatch(/req\.(get\(|header\(|hostname|host\b|protocol|originalUrl|baseUrl)|headers\[["'](host|origin|referer|x-forwarded-host)/i);
  });
});

describe("G — aucune donnee personnelle ne transite par /go", () => {
  it("un `@` dans n'importe quel parametre, nom compris, ou encode, est detecte", () => {
    for (const q of [{ utm_content: "jean@exemple.fr" }, { utm_campaign: "a@b" }, { x: "lead%40exemple.fr" },
      { "lead@exemple.fr": "" }, { to: "site@evil" }, { utm_content: "jean＠exemple.fr" }, { a: ["x", "y@z"] }]) {
      expect(contientDonneePersonnelle(q as Record<string, unknown>)).toBe(true);
    }
    expect(contientDonneePersonnelle({ fp_lid: FP_LID, utm_source: "smartlead" })).toBe(false);
  });

  it("refus : redirection nue, rien de reporte, rien de compte (drapeau ON)", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    for (const extra of ["&email=lead%40exemple.fr", "&utm_content=jean%40exemple.fr", "&utm_content=jean%2540exemple.fr", "&lead%40exemple.fr=1"]) {
      const r = await request(app()).get(LIEN + extra).set(CHROME);
      expect(r.status).toBe(302);
      expect(r.headers["location"]).toBe("/signin.html");
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("un nom ou un prenom ne peut pas passer par les UTM : seules des valeurs fermees sont reportees", () => {
    const c = lireClic({ fp_lid: FP_LID, utm_source: "jean_dupont", utm_medium: "dupont", utm_campaign: "jean_dupont" });
    expect(urlRedirection(c)).toBe(`/signin.html?fp_lid=${FP_LID}`);
  });
});

describe("H — rien n'est journalise en clair", () => {
  it("le journal HTTP ne garde que le chemin, jamais la query string", () => {
    expect(serialiserRequeteHttp({ id: "r1", method: "GET", url: `/go?fp_lid=${FP_LID}&email=lead@exemple.fr` }))
      .toEqual({ id: "r1", method: "GET", url: "/go" });
    const app_ts = readFileSync(join(process.cwd(), "src/app.ts"), "utf8");
    expect(app_ts).toMatch(/req: serialiserRequeteHttp/);
    expect(app_ts).toMatch(/res: \(res: \{ statusCode\?: number \}\) => \(\{ statusCode: res\.statusCode \}\)/);
  });

  it("une requete /go, reussie ou en echec base, ne journalise ni fp_lid, ni IP, ni user-agent, ni email", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    process.env["FP_EMAIL_VISIT_BEACON"] = "on";
    const err = Object.assign(new Error(`Failing row contains (${FP_LID}, lead@exemple.fr)`), { code: "23514" });
    query.mockRejectedValue(err);
    await request(app()).get(LIEN).set(CHROME).set("X-Forwarded-For", "203.0.113.7");
    await request(app()).get(LIEN + "&email=lead%40exemple.fr").set(CHROME);
    await request(app()).post("/api/public/email-visit").set(CHROME).send({ fp_lid: FP_LID });
    await purgerAttributionEmail();
    expect(journal.lignes.length).toBeGreaterThan(0); // les echecs sont bien journalises…
    const brut = JSON.stringify(journal.lignes);
    for (const interdit of [FP_LID, "203.0.113.7", "Chrome", "lead@exemple.fr", "Failing row"]) {
      expect(brut).not.toContain(interdit); // …mais sans aucune valeur
    }
    expect(brut).toContain("23514");
  });
});

describe("I — second signal : visite navigateur (serveur)", () => {
  it("drapeau visite OFF : 204, rien n'est ecrit, et /go ne pose pas fp_v", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    const r = await request(app()).post("/api/public/email-visit").send({ fp_lid: FP_LID });
    expect(r.status).toBe(204);
    const go = await request(app()).get(LIEN).set(CHROME);
    expect(String(go.headers["location"])).not.toContain("fp_v=");
    expect(query).toHaveBeenCalledTimes(1); // le clic seulement
    expect(String(query.mock.calls[0]![0])).toMatch(/'email_clic'/);
  });

  it("le drapeau visite seul ne suffit pas : il exige le suivi des clics", async () => {
    process.env["FP_EMAIL_VISIT_BEACON"] = "on";
    await request(app()).post("/api/public/email-visit").send({ fp_lid: FP_LID });
    expect(query).not.toHaveBeenCalled();
  });

  it("drapeaux ON : /go pose fp_v=1 (pas vers le site vitrine), la visite est ecrite pseudonymisee", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    process.env["FP_EMAIL_VISIT_BEACON"] = "on";
    expect(String((await request(app()).get(LIEN).set(CHROME)).headers["location"])).toMatch(/&fp_v=1$/);
    expect(String((await request(app()).get(LIEN + "&to=site").set(CHROME)).headers["location"])).not.toContain("fp_v");
    query.mockClear();
    const r = await request(app()).post("/api/public/email-visit").send({ fp_lid: FP_LID });
    expect(r.status).toBe(204);
    expect(r.headers["set-cookie"]).toBeUndefined();
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/'email_visite'/);
    const jour = new Date().toISOString().slice(0, 10);
    expect(params).toEqual([`lid-${empreinteLead(FP_LID)}`, `email_visite:${empreinteLead(FP_LID)}:${jour}`]);
    expect(JSON.stringify(params)).not.toContain(FP_LID);
  });

  it("fp_lid absent, mal forme, ou corps avec un email : 204 et rien", async () => {
    process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
    process.env["FP_EMAIL_VISIT_BEACON"] = "on";
    for (const body of [{}, { fp_lid: "court" }, { fp_lid: FP_LID, email: "lead@exemple.fr" }, { fp_lid: [FP_LID] }]) {
      expect((await request(app()).post("/api/public/email-visit").send(body)).status).toBe(204);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("email_visite est une etape serveur : POST /api/public/funnel-event la refuse", () => {
    expect(ETAPES_TUNNEL).toContain("email_visite");
    expect(ETAPES_PUBLIQUES.has("email_visite")).toBe(false);
  });
});

describe("I' — comptage et conservation (SQL)", () => {
  it("humain probable = non suspect ET visite navigateur du meme lead dans les 24 h", async () => {
    query.mockResolvedValue({ rows: [{ clics: 10, clics_bot_suspect: 7, clics_non_suspects: 3, humains_probables: 2, visites: 2 }] });
    const s = await statistiquesClicsEmail(new Date("2026-10-01"), new Date("2026-11-01"), "clients_fr_be");
    expect(s).toEqual({ clics: 10, clics_bot_suspect: 7, clics_non_suspects: 3, humains_probables: 2, visites: 2 });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/bot_suspect IS FALSE AND EXISTS/);
    expect(sql).toMatch(/v\.etape = 'email_visite' AND v\.visiteur_id = clics\.visiteur_id/);
    expect(sql).toMatch(/interval '24 hours'/);
    expect(params[2]).toBe("clients_fr_be");
  });

  it("la purge ne supprime que l'attribution email de plus de 13 mois", async () => {
    query.mockResolvedValue({ rowCount: 4, rows: [] });
    expect(await purgerAttributionEmail()).toBe(4);
    const sql = String(query.mock.calls[0]![0]).replace(/\s+/g, " ");
    expect(sql).toMatch(/DELETE FROM funnel_events WHERE etape IN \('email_clic', 'email_visite'\) AND created_at < now\(\) - interval '13 months'/);
  });

  it("la purge est demarree avec le serveur", () => {
    expect(readFileSync(join(process.cwd(), "src/index.ts"), "utf8")).toMatch(/demarrerPurgeAttributionEmail\(\)/);
  });
});

describe("J — second signal : visite navigateur (page d'arrivee)", () => {
  const SCRIPT = readFileSync(join(process.cwd(), "../flowpoint-export/funnel-tracking.js"), "utf8");

  function page(o: { path?: string; search: string; consent?: boolean; ready?: string; visible?: string }) {
    const appels: { url: string; init: Record<string, unknown> }[] = [];
    const surCharge: Array<() => void> = [];
    const cookies = new Map<string, string>();
    if (o.consent) cookies.set("fp_analytics_consent", "accepted");
    const session = new Map<string, string>();
    const lus: string[] = [];
    const contexte: Record<string, unknown> = {
      URL, URLSearchParams, JSON, Set, Element: class {}, HTMLAnchorElement: class {},
      crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
      location: { pathname: o.path ?? "/signin.html", search: o.search, hostname: "app.flowpoint.pro", href: "https://app.flowpoint.pro/signin.html" + o.search },
      document: {
        readyState: o.ready ?? "interactive",
        visibilityState: o.visible ?? "visible",
        get cookie() { return [...cookies].map(([k, v]) => `${k}=${v}`).join("; "); },
        set cookie(v: string) { const [p] = v.split(";"); const i = p!.indexOf("="); cookies.set(p!.slice(0, i), p!.slice(i + 1)); },
        addEventListener: () => undefined,
        getElementById: () => null,
      },
      localStorage: { getItem: () => null, setItem: () => undefined },
      sessionStorage: { getItem: (k: string) => { lus.push(k); return session.get(k) ?? null; }, setItem: (k: string, v: string) => session.set(k, v) },
      window: {
        fetch: (url: string, init: Record<string, unknown>) => { appels.push({ url, init }); return { catch: () => undefined }; },
        addEventListener: (type: string, fn: () => void) => { if (type === "load") surCharge.push(fn); },
      },
    };
    new Script(SCRIPT).runInNewContext(contexte);
    const charger = () => surCharge.forEach((fn) => fn());
    const visites = () => appels.filter((a) => a.url === "/api/public/email-visit");
    return { visites, charger, lus };
  }
  const AVEC = `?fp_lid=${FP_LID}&utm_source=smartlead&fp_source=smartlead&fp_v=1`;

  it("apres le chargement, une seule visite, sans cookie, sans consentement marketing", () => {
    const p = page({ search: AVEC });
    expect(p.visites()).toHaveLength(0); // rien avant `load`
    p.charger(); p.charger();
    expect(p.visites()).toHaveLength(1);
    expect(p.visites()[0]!.init).toMatchObject({ method: "POST", credentials: "omit", keepalive: true });
    expect(JSON.parse(String(p.visites()[0]!.init["body"]))).toEqual({ fp_lid: FP_LID });
    expect(p.lus).not.toContain("fp_lid"); // l'URL suffit : aucun stockage lu sans consentement
  });

  it("aussi sur pricing.html, et tout de suite si la page est deja chargee", () => {
    const p = page({ path: "/pricing.html", search: AVEC, ready: "complete" });
    expect(p.visites()).toHaveLength(1);
  });

  it("rien sans fp_v=1 (drapeau serveur OFF), sans Smartlead, avec un fp_lid invalide, ou page cachee (prerendu)", () => {
    for (const search of [`?fp_lid=${FP_LID}&utm_source=smartlead`, `?fp_lid=${FP_LID}&fp_v=1`,
      "?fp_lid=court&utm_source=smartlead&fp_v=1", "?fp_lid=lead%40exemple.fr&utm_source=smartlead&fp_v=1"]) {
      const p = page({ search }); p.charger();
      expect(p.visites()).toHaveLength(0);
    }
    const cachee = page({ search: AVEC, visible: "hidden" }); cachee.charger();
    expect(cachee.visites()).toHaveLength(0);
  });

  it("les autres pages n'envoient jamais ce signal", () => {
    for (const path of ["/", "/checkout.html", "/dashboard.html"]) {
      const p = page({ path, search: AVEC }); p.charger();
      expect(p.visites()).toHaveLength(0);
    }
  });
});
