/**
 * POST /api/public/funnel-event — le site vitrine, sans cookie.
 *
 * `flowpoint.pro` appelle `app.flowpoint.pro` en cross-origin et sans cookie
 * (`credentials: "omit"`) : il ne peut que DECLARER le consentement qu'il a
 * recueilli, dans le corps. Avant ce correctif, la production ne lisait que le
 * cookie et repondait 204 sans rien enregistrer : toutes les etapes du site
 * etaient perdues.
 *
 * Ce qui est verrouille ici, sur le vrai routeur :
 *   - `consentement: "accepted"` dans le corps suffit quand il n'y a pas de cookie ;
 *   - refuse, absent ou n'importe quelle autre valeur : rien n'est ecrit ;
 *   - un cookie present l'emporte toujours, un refus compris ;
 *   - `fp_lid` valide (22 caracteres) : un jalon AI Lab pour les seules etapes
 *     prevues, une fois par visiteur et par jour ; invalide : aucun jalon, mais
 *     l'etape est enregistree comme sans `fp_lid`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const inserts: unknown[][] = [];
const cles = new Set<string>();

function fakeQuery(sql: string, p?: unknown[]): { rows: unknown[]; rowCount: number } {
  const q = sql.replace(/\s+/g, " ").trim();
  if (/INSERT INTO funnel_events/i.test(q)) {
    const cle = String((p ?? [])[5] ?? "");
    if (cle && cles.has(cle)) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
    cles.add(cle);
    inserts.push(p ?? []);
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("@workspace/db", () => {
  const client = { query: vi.fn(async (s: string, p?: unknown[]) => fakeQuery(s, p)), release: vi.fn() };
  return {
    pool: { connect: vi.fn(async () => client), query: vi.fn(async (s: string, p?: unknown[]) => fakeQuery(s, p)) },
    db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn(),
  };
});
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const emitted: Record<string, unknown>[] = [];
vi.mock("../lib/conversion-events.js", async () => {
  const actual = await import("../lib/conversion-events.js");
  return {
    ...actual,
    emitConversionEvent: vi.fn(async (e: Record<string, unknown>) => {
      emitted.push(e);
      return "sent";
    }),
  };
});

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const FP_LID = "AbCdEfGhIjKlMnOpQrSt_-";
let app: express.Express;
let n = 0;

beforeAll(async () => {
  const { default: routeur } = await import("../routes/public-billing.js");
  app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", routeur);
});

beforeEach(() => {
  inserts.length = 0;
  emitted.length = 0;
  cles.clear();
});

/** Un visiteur neuf a chaque appel : la cle d'idempotence ne masque rien. */
function visiteur(): string {
  n += 1;
  return `fp-test${n}-site${n}`;
}

function envoyer(body: Record<string, unknown>, cookie?: string) {
  const r = request(app).post("/api/public/funnel-event").set("Origin", "https://flowpoint.pro");
  return (cookie ? r.set("Cookie", cookie) : r).send(body);
}

describe("POST /api/public/funnel-event — consentement declare par le site", () => {
  it("sans cookie, consentement accepted dans le corps : l'etape est enregistree", async () => {
    const r = await envoyer({ etape: "landing_vue", visiteurId: visiteur(), source: "smartlead",
      consentement: "accepted" });
    expect(r.status).toBe(204);
    expect(r.text).toBe("");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[0]).toBe("landing_vue");
    expect(inserts[0]?.[4]).toBe("smartlead");
  });

  it("sans cookie, consentement refuse : rien n'est ecrit ni emis", async () => {
    const r = await envoyer({ etape: "landing_vue", visiteurId: visiteur(), consentement: "rejected",
      fp_lid: FP_LID });
    expect(r.status).toBe(204);
    expect(inserts).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it("sans cookie ni consentement : rien n'est ecrit ni emis", async () => {
    const r = await envoyer({ etape: "landing_vue", visiteurId: visiteur(), fp_lid: FP_LID });
    expect(r.status).toBe(204);
    expect(inserts).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it("toute autre valeur que accepted est un refus", async () => {
    for (const consentement of [true, "true", "ACCEPTED", " accepted", 1, {}, ["accepted"]]) {
      await envoyer({ etape: "landing_vue", visiteurId: visiteur(), consentement });
    }
    expect(inserts).toHaveLength(0);
  });

  it("un cookie de refus l'emporte sur un consentement declare dans le corps", async () => {
    const r = await envoyer({ etape: "landing_vue", visiteurId: visiteur(), consentement: "accepted",
      fp_lid: FP_LID }, "fp_analytics_consent=rejected");
    expect(r.status).toBe(204);
    expect(inserts).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it("le cookie accepted de l'application fonctionne toujours, sans corps", async () => {
    await envoyer({ etape: "tarifs_vus", visiteurId: visiteur() }, "fp_analytics_consent=accepted");
    expect(inserts).toHaveLength(1);
  });

  it("les protections existantes restent : etape serveur refusee, visiteur requis", async () => {
    const serveur = await envoyer({ etape: "subscription_activated", visiteurId: visiteur(),
      consentement: "accepted" });
    expect(serveur.status).toBe(400);
    const sansVisiteur = await envoyer({ etape: "landing_vue", consentement: "accepted" });
    expect(sansVisiteur.status).toBe(400);
    const visiteurForge = await envoyer({ etape: "landing_vue", visiteurId: "x<script>",
      consentement: "accepted" });
    expect(visiteurForge.status).toBe(204);
    expect(inserts).toHaveLength(0);
  });
});

describe("POST /api/public/funnel-event — fp_lid", () => {
  it("fp_lid valide sur la visite : un jalon visit/marketing, sans le token dans l'identifiant", async () => {
    const v = visiteur();
    await envoyer({ etape: "landing_vue", visiteurId: v, consentement: "accepted", fp_lid: FP_LID });
    expect(inserts).toHaveLength(1);
    expect(emitted).toHaveLength(1);
    const e = emitted[0]!;
    expect(e).toMatchObject({ stage: "visit", source: "marketing", fpLid: FP_LID });
    expect(String(e.eventId)).toMatch(/^marketing:visit:[0-9a-f]{32}$/);
    expect(String(e.eventId)).not.toContain(FP_LID);
    expect(Number.isNaN(Date.parse(String(e.occurredAt)))).toBe(false);
  });

  it("fp_lid valide sur signup_started : un jalon signup_page/saas", async () => {
    await envoyer({ etape: "signup_started", visiteurId: visiteur(), consentement: "accepted",
      fp_lid: FP_LID });
    expect(emitted).toMatchObject([{ stage: "signup_page", source: "saas" }]);
  });

  it("une etape sans jalon prevu n'emet rien, meme avec fp_lid", async () => {
    await envoyer({ etape: "tarifs_vus", visiteurId: visiteur(), consentement: "accepted", fp_lid: FP_LID });
    await envoyer({ etape: "cta_clique", visiteurId: visiteur(), consentement: "accepted", fp_lid: FP_LID });
    expect(inserts).toHaveLength(2);
    expect(emitted).toHaveLength(0);
  });

  it("fp_lid invalide : l'etape est enregistree, aucun jalon", async () => {
    for (const fp_lid of ["court", FP_LID + "x", "AbCdEfGhIjKlMnOpQrSt!!", "", 12345, null, [FP_LID]]) {
      await envoyer({ etape: "landing_vue", visiteurId: visiteur(), consentement: "accepted", fp_lid });
    }
    expect(inserts).toHaveLength(7);
    expect(emitted).toHaveLength(0);
  });

  it("un rechargement le meme jour n'ecrit ni n'emet une seconde fois", async () => {
    const v = visiteur();
    await envoyer({ etape: "landing_vue", visiteurId: v, consentement: "accepted", fp_lid: FP_LID });
    await envoyer({ etape: "landing_vue", visiteurId: v, consentement: "accepted", fp_lid: FP_LID });
    expect(inserts).toHaveLength(1);
    expect(emitted).toHaveLength(1);
  });

  it("sans consentement, un fp_lid valide ne produit ni ecriture ni jalon", async () => {
    await envoyer({ etape: "landing_vue", visiteurId: visiteur(), fp_lid: FP_LID });
    await envoyer({ etape: "signup_started", visiteurId: visiteur(), consentement: "denied", fp_lid: FP_LID });
    expect(inserts).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });
});
