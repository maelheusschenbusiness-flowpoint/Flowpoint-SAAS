/**
 * Certification du contrat SaaS -> AI Lab, sans reseau externe ni secret.
 *
 * Un double local d'AI Lab (meme route, memes statuts, meme validation que
 * `POST /events/conversion` du moteur d'acquisition) recoit les VRAIS appels de
 * l'emetteur de production. Le double est lui-meme verifie contre un fichier de
 * reference produit par le validateur Python reel (`validate_event`), si bien
 * qu'une derive du contrat casse ce test au lieu de se decouvrir en production.
 *
 * Ce que cela prouve : format du corps, matrice etape/source, secret, doublons,
 * panne puis reprise, service endormi (timeout), absence de fuite dans les logs.
 * Ce que cela ne prouve pas : l'instance AI Lab deployee (voir le document de
 * certification, section "Intervention requise").
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SECRET = "conversion-cert-secret-at-least-32-characters";
const FP_LID = "TestLeadFp_0000000001A";
const EMAIL = "visiteur.synthetique@example.test";

const warns: unknown[][] = [];
const debugs: unknown[][] = [];
vi.mock("../lib/logger.js", () => ({
  logger: { warn: (...a: unknown[]) => { warns.push(a); }, debug: (...a: unknown[]) => { debugs.push(a); }, info: () => {}, error: () => {} },
}));

interface Golden { now: string; stages: string[]; cases: { name: string; payload: Record<string, unknown>; accepted: boolean; reason: string | null }[] }
const golden: Golden = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/ai-lab-validate-event.golden.json"), "utf8"));

// ---- Miroir TypeScript de validate_event (moteur d'acquisition, conversion_funnel.py) ----
const STAGE_SOURCES: Record<string, string[]> = {
  click: ["smartlead", "marketing"], visit: ["marketing", "saas"], signup_page: ["saas"],
  signup_started: ["saas"], signup: ["saas"], checkout: ["saas", "stripe"], trial: ["saas", "stripe"], paid: ["stripe"],
};
const SOURCES = ["smartlead", "marketing", "saas", "stripe"];
function validate(p: Record<string, unknown>, now: Date): string | null {
  const stage = String(p["stage"] ?? "").trim().toLowerCase();
  const source = String(p["source"] ?? "").trim().toLowerCase();
  const id = String(p["event_id"] ?? "").trim();
  if (!(stage in STAGE_SOURCES)) return "invalid stage";
  if (!SOURCES.includes(source)) return "invalid source";
  if (!STAGE_SOURCES[stage]!.includes(source)) return "source cannot prove stage";
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(id)) return "invalid event_id";
  if (typeof p["fp_lid"] !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(p["fp_lid"])) return "invalid fp_lid";
  const raw = p["occurred_at"];
  if (typeof raw !== "string" || !raw.trim()) return "occurred_at required";
  if (!/(Z|[+-]\d\d:\d\d)$/.test(raw.trim())) return /^\d{4}-\d\d-\d\d(T|$)/.test(raw.trim()) ? "occurred_at timezone required" : "invalid occurred_at";
  const t = new Date(raw.trim()).getTime();
  if (Number.isNaN(t)) return "invalid occurred_at";
  if (t > now.getTime() + 10 * 60_000) return "occurred_at in the future";
  if (t < now.getTime() - 400 * 86_400_000) return "occurred_at too old";
  return null;
}

// ---- Double d'AI Lab ----
interface Stored { event_id: string; stage: string; source: string; fp_lid: string; occurred_at: string }
let server: http.Server; let port = 0;
let store: Stored[]; let calls: number; let delayMs: number;
const knownLids = new Set([FP_LID]);
const fixedNow = () => new Date(golden.now);

function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  calls++;
  const chunks: Buffer[] = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => setTimeout(() => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method !== "POST" || req.url !== "/events/conversion") return send(404, {});
    if (req.headers["x-flowpoint-event-secret"] !== SECRET) return send(401, { error: "unauthorized" });
    const raw = Buffer.concat(chunks);
    if (raw.length > 4096) return send(413, {});
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw.toString("utf8")); } catch { return send(400, { error: "invalid" }); }
    const reason = validate(body, fixedNow());
    if (reason) return send(400, { error: "invalid" });
    if (!knownLids.has(body["fp_lid"] as string)) return send(400, { error: "unknown_fp_lid" });
    if (store.some(e => e.event_id === body["event_id"])) return send(202, { duplicate: true });
    store.push(body as unknown as Stored);
    return send(202, { accepted: true });
  }, delayMs));
}
const listen = (p = 0) => new Promise<void>(r => { server = http.createServer(handler).listen(p, "127.0.0.1", () => { port = (server.address() as AddressInfo).port; r(); }); });
const close = () => new Promise<void>(r => { server.closeAllConnections?.(); server.close(() => r()); });

type Mod = typeof import("../lib/conversion-events.js");
let mod: Mod;
const ev = (over: Partial<Parameters<Mod["emitConversionEvent"]>[0]> = {}) => ({
  eventId: "cert:0000000000000001", stage: "visit" as const, source: "saas" as const,
  fpLid: FP_LID, occurredAt: new Date(fixedNow().getTime() - 60_000).toISOString(), ...over,
});

beforeAll(async () => { await listen(); });
afterAll(async () => { await close(); });
beforeEach(async () => {
  store = []; calls = 0; delayMs = 0; warns.length = 0; debugs.length = 0;
  vi.resetModules();
  mod = await import("../lib/conversion-events.js");
  process.env["AI_LAB_CONVERSION_URL"] = `http://127.0.0.1:${port}/events/conversion`;
  process.env["CONVERSION_EVENT_SECRET"] = SECRET;
  delete process.env["AI_LAB_CONVERSION_TIMEOUT_MS"];
});
afterEach(() => { for (const k of ["AI_LAB_CONVERSION_URL", "CONVERSION_EVENT_SECRET", "AI_LAB_CONVERSION_TIMEOUT_MS"]) delete process.env[k]; });

describe("contrat : le miroir TypeScript colle au validateur Python reel", () => {
  it("couvre la matrice complete etape x source", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(59);
    expect(golden.cases.filter(c => c.accepted).length).toBe(14);
  });
  for (const c of golden.cases) {
    it(`${c.name} -> ${c.accepted ? "accepte" : "refuse"}`, () => {
      expect(validate(c.payload, new Date(golden.now)) === null).toBe(c.accepted);
    });
  }
});

describe("emetteur de production -> double AI Lab", () => {
  it("chaque etape emise par le SaaS est acceptee et persistee avec son fp_lid", async () => {
    const plan: [string, string][] = [["visit", "saas"], ["signup_page", "saas"], ["signup_started", "saas"],
      ["signup", "saas"], ["checkout", "saas"], ["trial", "stripe"], ["paid", "stripe"]];
    let i = 0;
    for (const [stage, source] of plan) {
      const out = await mod.emitConversionEvent(ev({ stage: stage as never, source: source as never, eventId: `cert:stage-${stage}-${i++}` }));
      expect(out, stage).toBe("sent");
    }
    expect(store.map(e => e.stage)).toEqual(plan.map(p => p[0]));
    expect(store.every(e => e.fp_lid === FP_LID)).toBe(true);
  });

  it("le corps ne contient que 5 champs, aucune donnee personnelle", async () => {
    await mod.emitConversionEvent(ev());
    expect(Object.keys(store[0]!).sort()).toEqual(["event_id", "fp_lid", "occurred_at", "source", "stage"]);
    expect(JSON.stringify(store[0])).not.toContain("@");
  });

  it("un meme evenement rejoue (retry) ne compte qu'une fois", async () => {
    expect(await mod.emitConversionEvent(ev())).toBe("sent");
    expect(await mod.emitConversionEvent(ev())).toBe("duplicate");
    expect(store).toHaveLength(1);
  });

  it("un fp_lid inconnu est refuse 400 : la cause observee sur flowpoint-test", async () => {
    const r = await mod.envoyerJalon(ev({ fpLid: "SyntheticUnknown_0001" + "A" }));
    expect(r).toEqual({ outcome: "rejected", status: 400 });
    expect(store).toHaveLength(0);
  });

  it("un mauvais secret est refuse 401 et n'est jamais journalise", async () => {
    process.env["CONVERSION_EVENT_SECRET"] = "x".repeat(40);
    const r = await mod.envoyerJalon(ev());
    expect(r).toEqual({ outcome: "rejected", status: 401 });
    expect(JSON.stringify(warns)).not.toContain("xxxxxxxx");
  });

  it("un fp_lid invalide ne declenche aucun appel reseau", async () => {
    expect(await mod.emitConversionEvent(ev({ fpLid: "court" }))).toBe("invalid-input");
    expect(calls).toBe(0);
  });

  it("non configure : aucun appel, aucune erreur", async () => {
    delete process.env["AI_LAB_CONVERSION_URL"];
    expect(await mod.emitConversionEvent(ev())).toBe("not-configured");
    expect(calls).toBe(0);
  });

  it("panne d'AI Lab : jamais d'exception, puis reprise avec le meme event_id sans doublon", async () => {
    await close();
    expect(await mod.emitConversionEvent(ev())).toBe("unreachable");
    await listen(port);
    expect(await mod.emitConversionEvent(ev())).toBe("sent");
    expect(await mod.emitConversionEvent(ev())).toBe("duplicate");
    expect(store).toHaveLength(1);
  });

  it("service endormi (cold start) : abandon au timeout, sans bloquer l'appelant", async () => {
    process.env["AI_LAB_CONVERSION_TIMEOUT_MS"] = "150";
    delayMs = 1500;
    const t0 = Date.now();
    expect(await mod.emitConversionEvent(ev())).toBe("unreachable");
    expect(Date.now() - t0).toBeLessThan(1200);
  });

  it("ordre : des jalons arrivant en desordre sont tous conserves avec leur horodatage d'origine", async () => {
    const t = (min: number) => new Date(fixedNow().getTime() - min * 60_000).toISOString();
    await mod.emitConversionEvent(ev({ stage: "trial", source: "stripe", eventId: "cert:order-trial-01", occurredAt: t(1) }));
    await mod.emitConversionEvent(ev({ stage: "signup", eventId: "cert:order-signup-1", occurredAt: t(5) }));
    const sorted = [...store].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map(e => e.stage);
    expect(sorted).toEqual(["signup", "trial"]);
  });

  it("les logs ne contiennent ni fp_lid, ni secret, ni email", async () => {
    await mod.emitConversionEvent(ev({ fpLid: "SyntheticUnknown_0001A" }));
    process.env["CONVERSION_EVENT_SECRET"] = "y".repeat(40);
    await mod.emitConversionEvent(ev());
    await close();
    await mod.emitConversionEvent(ev({ eventId: "cert:0000000000000002" }));
    await listen(port);
    const logs = JSON.stringify([...warns, ...debugs]);
    expect(warns.length).toBeGreaterThan(0);
    for (const forbidden of [FP_LID, "SyntheticUnknown_0001A", SECRET, "yyyyyyyy", EMAIL, "@"]) expect(logs).not.toContain(forbidden);
  });
});
