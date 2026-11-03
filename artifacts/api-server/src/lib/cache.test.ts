import { beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "./cache.js";

/** Promesse dont on declenche l'issue depuis le test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * getOrSet mutualise les chargements : les appels simultanes pour un meme
 * couple (namespace, cle) partagent un seul appel a fetcher.
 */
describe("cache.getOrSet — mutualisation des chargements", () => {
  beforeEach(() => {
    cache.clear();
  });

  it("trois appels simultanes sur la meme cle n'appellent fetcher qu'une fois", async () => {
    const chargement = deferred<string>();
    const fetcher = vi.fn(() => chargement.promise);

    const pending = [
      cache.getOrSet("ns", "k", 60, fetcher),
      cache.getOrSet("ns", "k", 60, fetcher),
      cache.getOrSet("ns", "k", 60, fetcher),
    ];

    expect(fetcher).toHaveBeenCalledTimes(1);
    chargement.resolve("valeur");

    await expect(Promise.all(pending)).resolves.toEqual(["valeur", "valeur", "valeur"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("un rejet est partage par tous les appels simultanes, ne cache rien, et l'appel suivant relance fetcher", async () => {
    const boom = new Error("chargement impossible");
    const chargement = deferred<string>();
    const failing = vi.fn(() => chargement.promise);

    const first = cache.getOrSet("ns", "k", 60, failing);
    const second = cache.getOrSet("ns", "k", 60, failing);
    const third = cache.getOrSet("ns", "k", 60, failing);

    expect(failing).toHaveBeenCalledTimes(1);
    chargement.reject(boom);

    await expect(first).rejects.toBe(boom);
    await expect(second).rejects.toBe(boom);
    await expect(third).rejects.toBe(boom);

    // Aucune valeur mise en cache apres un rejet.
    expect(cache.get<string>("ns", "k")).toBeNull();

    // L'appel suivant relance bien un chargement.
    const retry = vi.fn(async () => "apres-echec");
    await expect(cache.getOrSet("ns", "k", 60, retry)).resolves.toBe("apres-echec");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("deux cles differentes se chargent independamment, chacune avec son propre appel", async () => {
    const chargementA = deferred<string>();
    const chargementB = deferred<string>();
    const fetchA = vi.fn(() => chargementA.promise);
    const fetchB = vi.fn(() => chargementB.promise);

    const pendingA = cache.getOrSet("ns", "ka", 60, fetchA);
    const pendingB = cache.getOrSet("ns", "kb", 60, fetchB);

    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).toHaveBeenCalledTimes(1);

    chargementA.resolve("a");
    chargementB.resolve("b");

    await expect(Promise.all([pendingA, pendingB])).resolves.toEqual(["a", "b"]);
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it("une valeur deja en cache ne rappelle pas fetcher", async () => {
    cache.set("ns", "k", "deja-la", 60);
    const fetcher = vi.fn(async () => "recalcule");

    await expect(cache.getOrSet("ns", "k", 60, fetcher)).resolves.toBe("deja-la");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
