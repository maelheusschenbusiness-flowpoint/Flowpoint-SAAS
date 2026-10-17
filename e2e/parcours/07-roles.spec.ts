import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { compteRecette } from "../socle/aides.js";

/**
 * Parcours 7 — PERMISSIONS PAR ROLE : proprietaire, administrateur, membre.
 *
 * Masquer un bouton n'est pas une protection. Ce qui compte est le refus du
 * SERVEUR, et il doit differer selon le role. Ces tests exercent la meme
 * operation avec trois sessions de roles differents et comparent les reponses.
 *
 * Trois niveaux de garde existent dans le produit :
 *   canWrite  — proprietaire, administrateur, membre
 *   canAdmin  — proprietaire, administrateur
 *   ownerOnly — proprietaire seul
 *
 * Un code 4xx autre que 403 n'est PAS un refus d'autorisation : c'est la garde
 * franchie, puis un refus en aval (donnee invalide, ressource absente, service
 * tiers non configure). Ces tests distinguent les deux, sinon ils confondraient
 * « interdit » et « cassé ».
 */

/** Ouvre une session pour un role donne, via la porte prevue pour les tests. */
async function sessionPourRole(
  baseURL: string,
  role: "owner" | "admin" | "member",
): Promise<APIRequestContext> {
  const { email, orgId } = compteRecette();
  const cleAdmin = process.env["E2E_ADMIN_KEY"] ?? "";
  const api = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const r = await api.post("/api/auth/dev-session", {
    headers: { "x-admin-key": cleAdmin, "Content-Type": "application/json" },
    data: { email, orgId, role },
  });
  expect(r.ok(), `impossible d'ouvrir une session ${role} (${r.status()})`).toBe(true);
  const { token } = await r.json() as { token: string };
  await api.dispose();
  return request.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

/** 403 = refus d'autorisation. Tout le reste = garde franchie. */
function refuse(code: number): boolean {
  return code === 403;
}

test.describe("la garde de role est appliquee par le serveur, pas par l'interface", () => {
  let owner: APIRequestContext;
  let admin: APIRequestContext;
  let membre: APIRequestContext;

  test.beforeAll(async ({ baseURL }) => {
    owner  = await sessionPourRole(baseURL!, "owner");
    admin  = await sessionPourRole(baseURL!, "admin");
    membre = await sessionPourRole(baseURL!, "member");
  });

  test.afterAll(async () => {
    for (const c of [owner, admin, membre]) await c?.dispose();
  });

  test("les lectures sont ouvertes aux trois roles", async () => {
    for (const chemin of ["/api/me", "/api/monitors", "/api/team", "/api/missions"]) {
      for (const [nom, ctx] of [["proprietaire", owner], ["administrateur", admin], ["membre", membre]] as const) {
        const r = await ctx.get(chemin);
        expect(r.status(), `${nom} ne peut pas lire ${chemin}`).toBe(200);
      }
    }
  });

  test("un membre ne peut pas creer ni supprimer un moniteur — le serveur repond 403", async () => {
    const creation = { url: "https://exemple-role.fr", name: "essai role" };

    const mCreate = await membre.post("/api/monitors", { data: creation });
    expect(refuse(mCreate.status()), `un membre a franchi la garde de creation (${mCreate.status()})`).toBe(true);

    const mDelete = await membre.delete("/api/monitors/inexistant-zzz");
    expect(refuse(mDelete.status()), `un membre a franchi la garde de suppression (${mDelete.status()})`).toBe(true);

    // Et les deux roles superieurs la franchissent : sans cela, le test
    // passerait aussi avec une garde qui bloque tout le monde.
    for (const [nom, ctx] of [["proprietaire", owner], ["administrateur", admin]] as const) {
      const r = await ctx.post("/api/monitors", { data: creation });
      expect(refuse(r.status()), `${nom} est bloque par la garde de creation (${r.status()})`).toBe(false);
    }
  });

  test("un membre ne peut pas muter un moniteur BetterStack", async () => {
    for (const [methode, chemin] of [
      ["post", "/api/betterstack/monitors"],
      ["post", "/api/betterstack/monitors/zzz/pause"],
      ["post", "/api/betterstack/monitors/zzz/resume"],
      ["delete", "/api/betterstack/monitors/zzz"],
    ] as const) {
      const r = methode === "post"
        ? await membre.post(chemin, { data: { url: "https://exemple-role.fr", name: "x" } })
        : await membre.delete(chemin);
      expect(refuse(r.status()), `un membre a franchi ${methode.toUpperCase()} ${chemin} (${r.status()})`).toBe(true);
    }
  });

  test("seul le proprietaire peut purger les donnees ou inviter", async () => {
    // `ownerOnly` : l'administrateur doit etre refuse lui aussi. C'est le cas
    // que la plupart des matrices de permissions ratent.
    for (const [nom, ctx] of [["administrateur", admin], ["membre", membre]] as const) {
      const purge = await ctx.delete("/api/settings/data");
      expect(refuse(purge.status()), `${nom} a franchi la purge des donnees (${purge.status()})`).toBe(true);

      const invite = await ctx.post("/api/team/invite", {
        data: { email: `role-${Date.now()}@flowpoint-test.internal`, role: "member" },
      });
      expect(refuse(invite.status()), `${nom} a franchi l'invitation (${invite.status()})`).toBe(true);
    }
  });

  test("le proprietaire, lui, franchit les gardes `ownerOnly`", async () => {
    // Garde-fou du test precedent : si le proprietaire etait bloque aussi, les
    // 403 ci-dessus ne prouveraient rien sur la distinction des roles.
    const invite = await owner.post("/api/team/invite", {
      data: { email: `role-owner-${Date.now()}@flowpoint-test.internal`, role: "member" },
    });
    expect(refuse(invite.status()), `le proprietaire est bloque sur l'invitation (${invite.status()})`).toBe(false);
  });

  test("un role inconnu n'obtient aucun privilege", async ({ baseURL }) => {
    const { email, orgId } = compteRecette();
    const api = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const r = await api.post("/api/auth/dev-session", {
      headers: { "x-admin-key": process.env["E2E_ADMIN_KEY"] ?? "", "Content-Type": "application/json" },
      data: { email, orgId, role: "superadmin-invente" },
    });
    expect(r.ok()).toBe(true);
    const { token } = await r.json() as { token: string };
    await api.dispose();

    const ctx = await request.newContext({
      baseURL, storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const creation = await ctx.post("/api/monitors", { data: { url: "https://x.fr", name: "x" } });
    await ctx.dispose();
    expect(refuse(creation.status()),
      `un role invente a franchi la garde de creation (${creation.status()})`).toBe(true);
  });
});
