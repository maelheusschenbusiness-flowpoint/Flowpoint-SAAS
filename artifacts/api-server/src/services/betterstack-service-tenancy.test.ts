import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 10/11 — isolation des routes Better Stack sur un compte PARTAGE et
 * honnetete des statistiques. Aucun appel reseau : `fetchBorne` et la base sont
 * simules ; les donnees sont synthetiques.
 */
const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  fetchBorne: vi.fn(),
}));

vi.hoisted(() => { process.env["BETTERSTACK_API_TOKEN"] = "test-token-not-real"; });

vi.mock("@workspace/db", () => ({ pool: { query: mocks.poolQuery, connect: mocks.poolConnect } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/fetch-borne.js", () => ({ fetchBorne: mocks.fetchBorne, DELAIS: { supervision: 1000 } }));
vi.mock("./billing-service.js", () => ({ checkQuota: vi.fn() }));

import {
  acknowledgeIncident,
  getIncident,
  getMonitoringStats,
  getResponseTimes,
  incidentBelongsToOrg,
  listIncidents,
  listMonitors,
  exigerAppartenance,
  type BSIncident,
  type BSMonitor,
} from "./betterstack-service.js";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function monitor(id: string, url: string, extra: Partial<BSMonitor["attributes"]> = {}): BSMonitor {
  return {
    id, type: "monitor",
    attributes: {
      url, name: url, monitor_type: "status", status: "up", request_timeout: 15, verify_ssl: true,
      check_frequency: 180, regions: ["eu"], paused: false, recovery_period: 180, follow_redirects: true,
      remember_cookies: false, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
      ...extra,
    },
  };
}

function incident(id: string, url: string, link?: string): BSIncident {
  return {
    id, type: "incident",
    ...(link ? { relationships: { monitor: { data: { id: link } } } } : {}),
    attributes: { name: `inc-${id}`, url, cause: "Status 500", status: "started", started_at: "2026-11-10T10:00:00Z" },
  };
}

/** Registre d'appartenance simule : org -> identifiants. */
function ownership(map: Record<string, string[]>) {
  mocks.poolQuery.mockImplementation(async (sql: string, values: unknown[]) => {
    if (String(sql).includes("bs_id")) {
      return { rows: (map[String(values[0])] ?? []).map(bs_id => ({ bs_id })) };
    }
    return { rows: [] };
  });
}

/** Repond selon le chemin appele chez Better Stack. */
function provider(routes: Record<string, unknown>) {
  mocks.fetchBorne.mockImplementation(async (url: string) => {
    const path = String(url).replace("https://uptime.betterstack.com/api/v2", "");
    for (const [prefix, body] of Object.entries(routes)) {
      if (path.startsWith(prefix)) return jsonResponse(body);
    }
    return jsonResponse({ error: "unexpected " + path }, 404);
  });
}

beforeEach(() => {
  mocks.poolQuery.mockReset();
  mocks.fetchBorne.mockReset();
  mocks.poolConnect.mockReset();
  mocks.poolConnect.mockRejectedValue(new Error("sync db unavailable in unit test"));
});

describe("temps de reponse : appartenance et periode", () => {
  it("refuse (404) le moniteur d'une autre organisation sans appeler Better Stack", async () => {
    ownership({ "org-rt-a": ["100"], "org-rt-b": ["200"] });
    await expect(getResponseTimes("200", "org-rt-a", "24h")).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.fetchBorne).not.toHaveBeenCalled();
  });

  it("lit le moniteur de l'organisation et encode l'identifiant et la periode", async () => {
    ownership({ "org-rt-a2": ["100"] });
    provider({ "/monitors/100/response-times": { data: { attributes: { regions: [] } } } });
    await getResponseTimes("100", "org-rt-a2", "7d");
    const called = String(mocks.fetchBorne.mock.calls[0]![0]);
    expect(called).toBe("https://uptime.betterstack.com/api/v2/monitors/100/response-times?period=7d");
  });

  it("refuse une periode qui tenterait d'injecter des parametres, sans appel fournisseur", async () => {
    ownership({ "org-rt-a3": ["100"] });
    await expect(getResponseTimes("100", "org-rt-a3", "24h&per_page=999")).rejects.toMatchObject({ statusCode: 400 });
    await expect(getResponseTimes("100", "org-rt-a3", "../x")).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.fetchBorne).not.toHaveBeenCalled();
  });
});

describe("incidents : un compte partage ne doit rien fuir", () => {
  it("incidentBelongsToOrg : relation, monitor_id, puis URL ; jamais sans lien", () => {
    const ids = new Set(["100"]);
    const urls = new Set(["https://a.example/"]);
    expect(incidentBelongsToOrg(incident("1", "https://zzz.example/", "100"), ids, urls)).toBe(true);
    expect(incidentBelongsToOrg(incident("2", "https://a.example/", "999"), ids, urls)).toBe(false);
    const viaAttr = incident("3", "https://zzz.example/");
    viaAttr.attributes.monitor_id = 100;
    expect(incidentBelongsToOrg(viaAttr, ids, urls)).toBe(true);
    expect(incidentBelongsToOrg(incident("4", "HTTPS://A.EXAMPLE/ "), ids, urls)).toBe(true);
    expect(incidentBelongsToOrg(incident("5", ""), ids, urls)).toBe(false);
    expect(incidentBelongsToOrg(incident("6", "https://other.example/"), ids, urls)).toBe(false);
  });

  it("listIncidents ne renvoie que les incidents des moniteurs de l'organisation", async () => {
    ownership({ "org-inc-a": ["100"], "org-inc-b": ["200"] });
    provider({
      "/monitors": { data: [monitor("100", "https://a.example/"), monitor("200", "https://b.example/")] },
      "/incidents": { data: [incident("i1", "https://a.example/", "100"), incident("i2", "https://b.example/", "200")] },
    });
    const a = await listIncidents("org-inc-a");
    expect(a.map(i => i.id)).toEqual(["i1"]);
    const b = await listIncidents("org-inc-b");
    expect(b.map(i => i.id)).toEqual(["i2"]);
  });

  it("listIncidents refuse de filtrer sur le moniteur d'une autre organisation", async () => {
    ownership({ "org-inc-c": ["100"] });
    await expect(listIncidents("org-inc-c", { monitor_id: "200" })).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.fetchBorne).not.toHaveBeenCalled();
  });

  it("getIncident et acknowledgeIncident : 404 pour l'incident d'autrui, aucun POST d'acquittement", async () => {
    ownership({ "org-inc-d": ["100"] });
    provider({
      "/monitors": { data: [monitor("100", "https://a.example/")] },
      "/incidents/i9": { data: incident("i9", "https://b.example/", "200") },
    });
    await expect(getIncident("i9", "org-inc-d")).rejects.toMatchObject({ statusCode: 404 });
    await expect(acknowledgeIncident("i9", "org-inc-d")).rejects.toMatchObject({ statusCode: 404 });
    const posts = mocks.fetchBorne.mock.calls.filter(c => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(0);
  });

  it("acknowledgeIncident acquitte l'incident d'une organisation proprietaire", async () => {
    ownership({ "org-inc-e": ["100"] });
    provider({
      "/monitors": { data: [monitor("100", "https://a.example/")] },
      "/incidents/i1/acknowledge": {},
      "/incidents/i1": { data: incident("i1", "https://a.example/", "100") },
    });
    await acknowledgeIncident("i1", "org-inc-e");
    const posts = mocks.fetchBorne.mock.calls.filter(c => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(String(posts[0]![0])).toContain("/incidents/i1/acknowledge");
  });
});

describe("registre d'appartenance illisible : une panne n'est ni « vide » ni « introuvable »", () => {
  it("listMonitors et exigerAppartenance repondent 503 au lieu d'une liste vide / d'un 404", async () => {
    mocks.poolQuery.mockRejectedValue(new Error("relation does not exist"));
    provider({ "/monitors": { data: [monitor("100", "https://a.example/")] } });
    await expect(listMonitors("org-down")).rejects.toMatchObject({ statusCode: 503 });
    await expect(exigerAppartenance("100", "org-down")).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("statistiques : aucune panne ni absence de mesure ne devient 100 %", () => {
  it("propage la panne de la liste des moniteurs (pas de 200 « 0 moniteur, 100 % »)", async () => {
    ownership({ "org-st-a": ["100"] });
    mocks.fetchBorne.mockRejectedValue(new Error("provider down"));
    await expect(getMonitoringStats("org-st-a")).rejects.toThrow();
  });

  it("incidents indisponibles : null (inconnu), pas 0 ; sans mesure, avgUptime est null", async () => {
    ownership({ "org-st-b": ["100"] });
    mocks.fetchBorne.mockImplementation(async (url: string) => {
      const path = String(url).replace("https://uptime.betterstack.com/api/v2", "");
      if (path.startsWith("/monitors")) return jsonResponse({ data: [monitor("100", "https://a.example/")] });
      if (path.startsWith("/heartbeats")) return jsonResponse({ data: [] });
      return jsonResponse({ error: "boom" }, 400);
    });
    const stats = await getMonitoringStats("org-st-b");
    expect(stats.totalMonitors).toBe(1);
    expect(stats.avgUptime).toBeNull();
    expect(stats.avgResponseTime).toBeNull();
    expect(stats.activeIncidents).toBeNull();
    expect(stats.heartbeatsOk).toBe(0);
  });

  it("la moyenne ne compte que les moniteurs qui rapportent une disponibilite", async () => {
    ownership({ "org-st-c": ["100", "101", "102"] });
    provider({
      "/monitors": { data: [
        monitor("100", "https://a.example/", { uptime_percentage: "99.0" }),
        monitor("101", "https://b.example/", { uptime_percentage: "97.0" }),
        monitor("102", "https://c.example/"),
      ] },
      "/incidents": { data: [] },
      "/heartbeats": { data: [] },
    });
    const stats = await getMonitoringStats("org-st-c");
    expect(stats.avgUptime).toBe(98);
    expect(stats.activeIncidents).toBe(0);
  });
});
