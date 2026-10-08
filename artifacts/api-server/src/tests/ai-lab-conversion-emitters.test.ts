/**
 * Les jalons de conversion AI Lab, et surtout ce qu'ils ne doivent jamais casser.
 *
 * L'exigence qui gouverne ce module n'est pas d'emettre : c'est de ne jamais
 * nuire. Une indisponibilite d'AI Lab ne peut pas faire echouer une inscription,
 * une activation, un checkout, un webhook Stripe ni un paiement. La moitie de ces
 * tests verifie donc une ABSENCE d'effet — pas une emission reussie.
 *
 * Le second risque est la fuite. Le journal ne doit contenir ni `fp_lid`, ni
 * secret, ni email, ni charge utile : un module de mesure qui divulgue
 * l'identifiant qu'on a pris soin de garder opaque partout ailleurs annulerait
 * tout le travail de Conversion B.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SECRET = "conversion-test-secret-at-least-32-characters";
const URL_OK = "https://ai-lab.internal/events/conversion";
const FP_LID = "TestLeadFp_0000000001A";

const warns: unknown[][] = [];
const debugs: unknown[][] = [];
vi.mock("../lib/logger.js", () => ({
  logger: {
    warn: (...a: unknown[]) => { warns.push(a); },
    debug: (...a: unknown[]) => { debugs.push(a); },
    info: () => {}, error: () => {},
  },
}));

let emitConversionEvent: typeof import("../lib/conversion-events.js").emitConversionEvent;
let stableEventId: typeof import("../lib/conversion-events.js").stableEventId;

beforeEach(async () => {
  warns.length = 0; debugs.length = 0;
  vi.resetModules();
  const mod = await import("../lib/conversion-events.js");
  emitConversionEvent = mod.emitConversionEvent;
  stableEventId = mod.stableEventId;
  process.env["AI_LAB_CONVERSION_URL"] = URL_OK;
  process.env["CONVERSION_EVENT_SECRET"] = SECRET;
  delete process.env["AI_LAB_CONVERSION_TIMEOUT_MS"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["AI_LAB_CONVERSION_URL"];
  delete process.env["CONVERSION_EVENT_SECRET"];
  delete process.env["AI_LAB_CONVERSION_TIMEOUT_MS"];
});

const event = () => ({
  eventId: "stripe:evt_test_0001", stage: "paid" as const, source: "stripe" as const,
  fpLid: FP_LID, occurredAt: "2026-10-06T18:30:00.000Z",
});

describe("1 — emission reussie", () => {
  it("poste le contrat attendu, avec le secret en en-tete et jamais dans l URL", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ recorded: true, duplicate: false }), { status: 202 });
    });

    expect(await emitConversionEvent(event())).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(URL_OK);
    expect(calls[0]!.url).not.toContain(SECRET);
    expect((calls[0]!.init.headers as Record<string, string>)["X-Flowpoint-Event-Secret"]).toBe(SECRET);

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({
      event_id: "stripe:evt_test_0001", stage: "paid", source: "stripe",
      fp_lid: FP_LID, occurred_at: "2026-10-06T18:30:00.000Z",
    });
  });

  it("un doublon annonce par AI Lab reste un succes", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ recorded: false, duplicate: true }), { status: 202 }));
    // Un meme jalon ne compte qu'une fois par prospect : le doublon est le
    // comportement attendu d'un rejeu, pas une anomalie a signaler.
    expect(await emitConversionEvent(event())).toBe("duplicate");
    expect(warns).toHaveLength(0);
  });
});

describe("2 — secret absent : aucun appel", () => {
  it("sans secret, rien n est emis", async () => {
    delete process.env["CONVERSION_EVENT_SECRET"];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await emitConversionEvent(event())).toBe("not-configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sans URL, rien n est emis", async () => {
    delete process.env["AI_LAB_CONVERSION_URL"];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await emitConversionEvent(event())).toBe("not-configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("un secret trop court est traite comme absent", async () => {
    // AI Lab refuse en dessous de 32 caracteres : appeler serait un aller-retour
    // garanti perdu, et un 503 dans les journaux sans rien a corriger.
    process.env["CONVERSION_EVENT_SECRET"] = "trop-court";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await emitConversionEvent(event())).toBe("not-configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("une URL qui n est pas http(s) est refusee sans appel", async () => {
    process.env["AI_LAB_CONVERSION_URL"] = "file:///etc/passwd";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await emitConversionEvent(event())).toBe("not-configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("3 — AI Lab indisponible : le parcours SaaS est inchange", () => {
  it("un refus HTTP ne leve pas", async () => {
    vi.stubGlobal("fetch", async () => new Response("unauthorized", { status: 401 }));
    await expect(emitConversionEvent(event())).resolves.toBe("rejected");
  });

  it("un 500 ne leve pas", async () => {
    vi.stubGlobal("fetch", async () => new Response("error", { status: 500 }));
    await expect(emitConversionEvent(event())).resolves.toBe("rejected");
  });

  it("une panne reseau ne leve pas", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    await expect(emitConversionEvent(event())).resolves.toBe("unreachable");
  });

  it("un corps illisible ne leve pas et reste un succes", async () => {
    // Le jalon EST enregistre : la reponse 202 le dit. Un corps qu on n arrive
    // pas a lire ne doit pas transformer un succes en echec.
    vi.stubGlobal("fetch", async () => new Response("pas du json", { status: 202 }));
    await expect(emitConversionEvent(event())).resolves.toBe("sent");
  });
});

describe("4 — timeout : le parcours SaaS est inchange", () => {
  it("un depassement de delai ne leve pas", async () => {
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      // Ce que fait le vrai `fetch` quand le signal expire.
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      void init;
      throw err;
    });
    await expect(emitConversionEvent(event())).resolves.toBe("unreachable");
  });

  it("un signal d interruption est bien passe a fetch", async () => {
    let signal: AbortSignal | null = null;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      signal = (init.signal as AbortSignal) ?? null;
      return new Response("{}", { status: 202 });
    });
    await emitConversionEvent(event());
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("un delai configure hors bornes retombe sur le defaut", async () => {
    process.env["AI_LAB_CONVERSION_TIMEOUT_MS"] = "999999";
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 202 }));
    // Le but n'est pas la valeur mais l'absence de blocage : une valeur absurde
    // lue d'un environnement ne doit pas pouvoir suspendre un encaissement.
    await expect(emitConversionEvent(event())).resolves.toBe("sent");
  });
});

describe("5 — rejeu : meme event_id et meme occurred_at", () => {
  it("deux emissions du meme jalon envoient exactement le meme corps", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ duplicate: bodies.length > 1 }), { status: 202 });
    });
    const e = event();
    await emitConversionEvent(e);
    await emitConversionEvent(e);
    expect(bodies[0]).toBe(bodies[1]);
    // C'est la condition qu'AI Lab impose : un meme `event_id` doit decrire un
    // evenement immuable, horodatage compris. Un horodatage regenere par
    // l'emetteur serait refuse comme collision d'identifiant, et renvoye en 400.
    expect(JSON.parse(bodies[0]!).occurred_at).toBe(JSON.parse(bodies[1]!).occurred_at);
  });

  it("l identifiant derive d un jeton est stable et ne contient pas le jeton", async () => {
    const token = "pre-registration-token-secret-value";
    const a = stableEventId("signup", token);
    const b = stableEventId("signup", token);
    expect(a).toBe(b);
    expect(a).not.toContain(token);
    expect(a.startsWith("signup:")).toBe(true);
    // AI Lab contraint la longueur entre 8 et 128 caracteres.
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(stableEventId("signup", token + "x")).not.toBe(a);
  });
});

describe("6 — aucun secret ni fp_lid dans les journaux", () => {
  const sansFuite = (lignes: unknown[][]) => {
    const texte = JSON.stringify(lignes);
    expect(texte).not.toContain(SECRET);
    expect(texte).not.toContain(FP_LID);
    expect(texte).not.toContain("occurred_at");
  };

  it("sur un refus", async () => {
    vi.stubGlobal("fetch", async () => new Response(`refuse pour ${FP_LID}`, { status: 400 }));
    await emitConversionEvent(event());
    expect(warns.length).toBeGreaterThan(0);
    sansFuite(warns);
  });

  it("sur une panne", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error(`echec avec ${SECRET}`); });
    await emitConversionEvent(event());
    expect(warns.length).toBeGreaterThan(0);
    // Le message d'une exception peut citer ce qu on venait d envoyer : seul le
    // NOM de l erreur est journalise, jamais son message ni la charge utile.
    sansFuite(warns);
  });

  it("sur un succes", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ recorded: true }), { status: 202 }));
    await emitConversionEvent(event());
    sansFuite(debugs);
  });

  it("un fp_lid malforme n est jamais poste", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await emitConversionEvent({ ...event(), fpLid: "trop-court" })).toBe("invalid-input");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
