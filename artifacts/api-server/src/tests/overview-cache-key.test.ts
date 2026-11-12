/**
 * La cle de cache d'Overview suit la DUREE, pas son libelle.
 *
 * `rangeLabel` ne sert qu'a la cle ; la charge utile porte `range`. Comme
 * `rangeLabel` a une valeur par defaut (`"30d"`), un appelant qui passe la duree
 * sans le libelle rangeait ses donnees sous la cle d'une AUTRE duree, et le cache
 * de 60 s les resservait a tout le monde.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: (...a: unknown[]) => query(...a) }, db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { getOverviewMetrics } = await import("../services/overview-service.js");

beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [] }); });

describe("la cle de cache d Overview", () => {
  it("deux durees differentes ne partagent pas une entree, meme sans libelle", async () => {
    const org = `org-${Math.random().toString(36).slice(2)}`;
    const a = await getOverviewMetrics(org, 7);
    const b = await getOverviewMetrics(org, 30);
    // Avant la correction, les deux s'ecrivaient sous `org:30d` et le second
    // appel renvoyait l'objet du premier.
    expect(b).not.toBe(a);
    expect(a.range).toBe(7);
    expect(b.range).toBe(30);
  });

  it("la meme duree rend bien l entree en cache", async () => {
    const org = `org-${Math.random().toString(36).slice(2)}`;
    const a = await getOverviewMetrics(org, 7);
    const b = await getOverviewMetrics(org, 7);
    expect(b).toBe(a);
  });

  it("le libelle ne decide plus de rien", async () => {
    // `today` et `1d` designent la meme duree : une seule entree doit exister.
    const org = `org-${Math.random().toString(36).slice(2)}`;
    const a = await getOverviewMetrics(org, 1, "today");
    const b = await getOverviewMetrics(org, 1, "1d");
    expect(b).toBe(a);
  });
});
