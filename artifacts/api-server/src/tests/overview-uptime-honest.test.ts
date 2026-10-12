/**
 * Sans monitor, Overview ne doit pas annoncer 100 % de disponibilite.
 *
 * `monitorUptime` etait deja `null` dans ce cas ; `uptime`, dans le meme objet,
 * valait 100. Tout consommateur lisant `uptime` affichait une disponibilite
 * parfaite pour un workspace qui ne surveille rien.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: (...a: unknown[]) => query(...a) }, db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { getOverviewMetrics } = await import("../services/overview-service.js");
const org = () => `org-${Math.random().toString(36).slice(2)}`;

beforeEach(() => { query.mockReset(); });

describe("la disponibilite n est pas inventee", () => {
  it("aucun monitor : uptime est null, pas 100", async () => {
    query.mockResolvedValue({ rows: [] });
    const m = await getOverviewMetrics(org(), 30, "30d");
    expect(m.uptime).toBeNull();
    expect(m.uptime).not.toBe(100);
  });

  it("aucun monitor : uptime et monitorUptime disent la meme chose", async () => {
    query.mockResolvedValue({ rows: [] });
    const m = await getOverviewMetrics(org(), 30, "30d");
    expect(m.uptime).toBe(m.monitorUptime);
  });

  it("des monitors presents : la valeur reelle est rendue", async () => {
    // Seule la requete des monitors renvoie des lignes ; les autres restent vides.
    query.mockImplementation(async (sql: string) =>
      /monitors/i.test(String(sql))
        ? { rows: [{ status: "up", avg_uptime: "99.5", avg_latency: "120" },
                    { status: "up", avg_uptime: "98.5", avg_latency: "80" }] }
        : { rows: [] });
    const m = await getOverviewMetrics(org(), 30, "30d");
    expect(m.uptime).toBe(99);
    expect(m.monitorUptime).toBe(99);
  });
});
