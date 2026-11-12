/**
 * C-05 — IDOR GBP : un utilisateur de l'org A ne peut ni publier, ni supprimer,
 * ni modifier une ressource de l'org B (404), et Google n'est jamais appele.
 * Le pool est un faux en memoire qui n'applique que ce que le SQL demande
 * (filtre id + org_id) : si le SQL oublie org_id, le test echoue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

type Row = { id: string; org_id: string; status: string; [k: string]: unknown };
const store = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@workspace/db", () => {
  const run = async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ");
    const rows = store.rows as Row[];
    if (/^UPDATE gbp_posts SET status='publishing'/.test(s.trim())) {
      const hit = rows.filter(r => r.id === params[0] && (!/org_id=\$2/.test(s) || r.org_id === params[1]) &&
        ["draft", "scheduled", "failed"].includes(r.status));
      hit.forEach(r => { r.status = "publishing"; });
      return { rows: hit, rowCount: hit.length };
    }
    if (/^DELETE FROM gbp_posts/.test(s.trim())) {
      const before = rows.length;
      store.rows = rows.filter(r => !(r.id === params[0] && (!/org_id=\$2/.test(s) || r.org_id === params[1])));
      return { rows: [], rowCount: before - store.rows.length };
    }
    if (/^UPDATE gbp_posts SET status='failed'/.test(s.trim())) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  };
  return { pool: { query: vi.fn(run), connect: vi.fn(async () => ({ query: run, release: vi.fn() })) } };
});
vi.mock("../services/google-service.js", () => ({ publishGBPPost: vi.fn() }));
vi.mock("../middlewares/planGate.js", () => ({
  requireFeature: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  requireAddon: () => (_q: unknown, _s: unknown, next: () => void) => next(),
}));

import router from "./gbp-posts.js";
import { publishGBPPost } from "../services/google-service.js";

const orgDbPatch = (_sql: string, params: unknown[]) => {
  // PATCH passe par req.orgDb : meme semantique (id + org_id).
  const rows = store.rows as Row[];
  const hit = rows.filter(r => r.id === params[params.length - 2] && r.org_id === params[params.length - 1] &&
    ["draft", "scheduled", "failed"].includes(r.status));
  return Promise.resolve({ rows: hit.map(r => ({ id: r.id })) });
};

function appFor(orgId: string, role = "owner") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId,
      orgDb: orgDbPatch,
      orgContext: { orgId, role, userId: `${role}-${orgId}`, email: `${role}@example.test` },
    });
    next();
  });
  app.use(router);
  return app;
}

describe("GBP posts - isolation entre organisations (C-05)", () => {
  beforeEach(() => {
    store.rows = [{ id: "gp_b1", org_id: "org-B", status: "draft", content: "secret B", location_id: "loc-B" }];
    vi.mocked(publishGBPPost).mockReset();
  });

  it("publier le post de l'org B depuis l'org A -> 404 et Google jamais appele", async () => {
    const r = await request(appFor("org-A")).post("/gbp-posts/gp_b1/publish");
    expect(r.status).toBe(404);
    expect(publishGBPPost).not.toHaveBeenCalled();
    expect((store.rows[0] as Row).status).toBe("draft");
  });

  it("supprimer le post de l'org B depuis l'org A -> 404 et le post subsiste", async () => {
    const r = await request(appFor("org-A")).delete("/gbp-posts/gp_b1");
    expect(r.status).toBe(404);
    expect(store.rows).toHaveLength(1);
  });

  it("modifier le post de l'org B depuis l'org A -> 404", async () => {
    const r = await request(appFor("org-A")).patch("/gbp-posts/gp_b1").send({ content: "pwned" });
    expect(r.status).toBe(404);
  });

  it("le proprietaire (org B) peut supprimer son post", async () => {
    const r = await request(appFor("org-B")).delete("/gbp-posts/gp_b1");
    expect(r.status).toBe(200);
    expect(store.rows).toHaveLength(0);
  });

  it("un client ne peut pas poser lui-meme le statut « published » (faux publie)", async () => {
    const r = await request(appFor("org-B")).patch("/gbp-posts/gp_b1").send({ status: "published" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("GBP_STATUS_NOT_CLIENT_SETTABLE");
  });

  it("un viewer ne peut pas publier", async () => {
    const r = await request(appFor("org-B", "viewer")).post("/gbp-posts/gp_b1/publish");
    expect(r.status).toBe(403);
    expect((store.rows[0] as Row).status).toBe("draft");
    expect(publishGBPPost).not.toHaveBeenCalled();
  });

  it("un membre ne peut pas supprimer un post", async () => {
    const r = await request(appFor("org-B", "member")).delete("/gbp-posts/gp_b1");
    expect(r.status).toBe(403);
    expect(store.rows).toHaveLength(1);
  });
});
