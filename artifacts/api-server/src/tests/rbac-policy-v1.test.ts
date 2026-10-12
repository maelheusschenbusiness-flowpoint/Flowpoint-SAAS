/**
 * La politique RBAC de la V1, telle que le produit l'a validee.
 *
 *   Consulter audits / monitors / rapports / statistiques : Owner, Manager, Viewer
 *   Creer, modifier, supprimer des ressources             : Owner, Manager
 *   Administrer les membres                               : Owner SEUL
 *   Modifier l'abonnement et les reglages sensibles       : Owner SEUL
 *
 * Tests positifs ET negatifs, cote backend (gardes reellement appliquees) et
 * cote interface (table de navigation), pour que les deux ne divergent plus —
 * c'est precisement la contradiction que ce chantier corrige.
 */
import { describe, it, expect, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const { requireRole, canWrite, canAdmin, ownerOnly } = await import("../middlewares/requireRole.js");

const ROLES = ["owner", "admin", "member", "viewer"] as const;
type Role = (typeof ROLES)[number];

/** Monte une garde seule et renvoie le statut obtenu pour un role donne. */
async function statusFor(guard: ReturnType<typeof requireRole>, role: Role | null): Promise<number> {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.orgContext = role ? { orgId: "org-1", role } : { orgId: "org-1" };
    next();
  });
  app.get("/g", guard, (_req, res) => res.status(200).json({ ok: true }));
  return (await request(app).get("/g")).status;
}

describe("backend — ecriture des ressources (canWrite)", () => {
  it.each(["owner", "admin", "member"] as Role[])("%s PEUT ecrire", async (r) => {
    expect(await statusFor(canWrite, r)).toBe(200);
  });
  it("viewer NE PEUT PAS ecrire", async () => {
    expect(await statusFor(canWrite, "viewer")).toBe(403);
  });
  it("un appelant sans role est refuse", async () => {
    expect(await statusFor(canWrite, null)).toBe(401);
  });
});

describe("backend — ressources sensibles (canAdmin)", () => {
  it.each(["owner", "admin"] as Role[])("%s PEUT", async (r) => {
    expect(await statusFor(canAdmin, r)).toBe(200);
  });
  it.each(["member", "viewer"] as Role[])("%s NE PEUT PAS", async (r) => {
    expect(await statusFor(canAdmin, r)).toBe(403);
  });
});

describe("backend — proprietaire seul (ownerOnly)", () => {
  it("owner PEUT", async () => { expect(await statusFor(ownerOnly, "owner")).toBe(200); });
  it.each(["admin", "member", "viewer"] as Role[])("%s NE PEUT PAS", async (r) => {
    expect(await statusFor(ownerOnly, r)).toBe(403);
  });
});

describe("backend — administration des membres reservee au proprietaire", () => {
  const team = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "routes", "team.ts"), "utf8");
  it.each([
    ['router.post("/team/invite"', "inviter"],
    ['router.patch("/team/:id"', "modifier un membre"],
    ['router.delete("/team/:id"', "retirer un membre"],
    ['router.post("/team/invitations/:id/resend"', "relancer une invitation"],
    ['router.delete("/team/invitations/:id"', "annuler une invitation"],
  ])("%s est garde par ownerOnly", (route) => {
    const line = team.split("\n").find((l) => l.startsWith(route));
    expect(line, `route introuvable : ${route}`).toBeTruthy();
    expect(line).toContain("ownerOnly");
    expect(line).not.toContain("canAdmin");
  });
});

describe("backend — abonnement reserve au proprietaire", () => {
  const billing = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "routes", "billing.ts"), "utf8");
  it.each(["/billing/checkout", "/billing/cancel", "/billing/reactivate", "/billing/upgrade", "/billing/trial"])(
    "%s est garde par ownerOnly", (route) => {
      const line = billing.split("\n").find((l) => l.startsWith(`router.post("${route}"`));
      expect(line, `route introuvable : ${route}`).toBeTruthy();
      expect(line).toContain("ownerOnly");
    });
});

describe("interface — la table de navigation suit la meme politique", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const COPIES: [string, string][] = [
    ["export", join(root, "artifacts/flowpoint-export/dashboard.js")],
    ["source", join(root, "src/frontend/dashboard.js")],
  ];

  describe.each(COPIES)("%s", (_n, path) => {
    const js = readFileSync(path, "utf8");
    const table = /const _FP_ROLE_PERMS = \{[\s\S]*?\n\};/.exec(js)![0];
    const perms = (role: string) => {
      const line = table.split("\n").find((l) => l.trim().startsWith(`${role}:`))!;
      return Object.fromEntries([...line.matchAll(/(\w+):(true|false)/g)].map(([, k, v]) => [k, v === "true"]));
    };

    it.each(["owner", "admin", "member", "viewer"])("%s consulte audits, monitors et rapports", (role) => {
      const p = perms(role);
      expect(p.audits, "audits").toBe(true);
      expect(p.monitors, "monitors").toBe(true);
      expect(p.reports, "reports").toBe(true);
    });

    it.each(["admin", "member", "viewer"])("%s n accede NI aux membres NI a la facturation NI aux reglages", (role) => {
      const p = perms(role);
      expect(p.team, "team").toBe(false);
      expect(p.billing, "billing").toBe(false);
      expect(p.settings, "settings").toBe(false);
    });

    it("owner garde tout", () => {
      expect(Object.values(perms("owner")).every(Boolean)).toBe(true);
    });

    it("l en-tete ne contredit plus la table", () => {
      // La contradiction corrigee : l'en-tete annoncait « Editor can SEE monitors »
      // et « viewer : audits read-only », que la table interdisait.
      expect(js).not.toContain("Editor can SEE monitors");
      expect(js).not.toContain("viewer : audits read-only");
    });
  });
});

describe("le role ne peut pas etre falsifie par la requete", () => {
  it("la garde lit orgContext, jamais le corps ni l en-tete", async () => {
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.orgContext = { orgId: "org-1", role: "viewer" };
      next();
    });
    app.post("/g", canWrite, (_req, res) => res.status(200).json({ ok: true }));
    // Un viewer qui pretend etre owner par tous les moyens a sa portee.
    const r = await request(app).post("/g")
      .set("x-role", "owner").set("role", "owner")
      .send({ role: "owner", orgContext: { role: "owner" } });
    expect(r.status).toBe(403);
  });

  it("la source de la garde est bien orgContext", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "middlewares", "requireRole.ts"), "utf8");
    expect(src).toContain("req.orgContext?.role");
    expect(src).not.toMatch(/req\.body\s*\.\s*role|req\.headers\[["']x-role/);
  });
});
