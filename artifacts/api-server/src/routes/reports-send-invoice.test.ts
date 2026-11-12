/** Constat 5 : POST /reports/send-invoice repondait `sent:true` sans rien envoyer. */
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../middlewares/requireRole.js", async (orig) => ({
  ...(await orig<typeof import("../middlewares/requireRole.js")>()),
  canAdmin: (_q: unknown, _s: unknown, n: () => void) => n(),
  canWrite: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireRole: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  requireQuota: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  requireFeature: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  requirePlan: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  resolvePlanFromDB: vi.fn(async () => "pro"),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const sendMail = vi.hoisted(() => vi.fn());
vi.mock("../services/mailer.js", () => ({ sendMail, sendEmail: sendMail }));

import reportsRouter from "./reports.js";

describe("POST /reports/send-invoice", () => {
  it("501 not_implemented : jamais sent:true, aucun e-mail envoye", async () => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { Object.assign(req, { orgId: "org-a", orgDb: vi.fn() }); next(); });
    a.use("/api", reportsRouter);
    const res = await request(a).post("/api/reports/send-invoice").send({ invoiceId: "in_123" });
    expect(res.status).toBe(501);
    expect(res.body).toMatchObject({ ok: false, sent: false, code: "not_implemented", invoiceId: "in_123" });
    expect(typeof res.body.error).toBe("string");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
