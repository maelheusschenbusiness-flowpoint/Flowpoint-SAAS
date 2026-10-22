import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
const quotaMock = vi.hoisted(() => ({ checkQuota: vi.fn(async () => ({ allowed: true, used: 0, limit: 50 })) }));
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../middlewares/planGate.js", () => ({ requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../middlewares/rateLimiter.js", () => ({ reportRateLimit: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../middlewares/requireRole.js", () => ({ canWrite: (_req: unknown, _res: unknown, next: () => void) => next(), canAdmin: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../services/billing-service.js", () => quotaMock);
import { pool } from "@workspace/db";
import reportsRouter from "./reports.js";
const orgId = randomUUID();
async function scoped(query: string, values: unknown[] = []) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]); const result = await client.query(query, values); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
function app() { const server=express(); server.use(express.json()); server.use((req,_res,next)=>{Object.assign(req,{orgId,userId:"qa-agency-pack",orgContext:{userId:"qa-agency-pack"},orgDb:(query:string,values?:unknown[])=>scoped(query,values).then(result=>({rows:result.rows}))});next();}); server.use("/api",reportsRouter); return server; }
async function cleanup() { await scoped("DELETE FROM reports WHERE org_id=$1",[orgId]); }
describe("Agency Reporting Packs PostgreSQL integration (synthetic QA rows)",()=>{
  afterAll(async()=>{await cleanup();});
  it("persists and verifies all three reports atomically without billing",async()=>{
    quotaMock.checkQuota.mockClear();
    const response=await request(app()).post("/api/reports/agency-packs/generate").send({clientName:"QA fixture client",dateStart:"2026-10-01",dateEnd:"2026-10-22"});
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({clientName:"QA fixture client",expected:3,verifiedCount:3});
    expect(response.body.reports).toHaveLength(3);
    expect(new Set(response.body.reports.map((row:{template_key:string})=>row.template_key))).toEqual(new Set(["executive","seo","local"]));
    expect(quotaMock.checkQuota).toHaveBeenCalledWith("reports",orgId);
  });
});
