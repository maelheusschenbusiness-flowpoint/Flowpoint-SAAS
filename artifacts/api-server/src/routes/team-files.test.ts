/**
 * team-files.test.ts
 *
 * Integration tests for the /team/files route (Step 3A regression suite).
 * Tests: upload, list, download, delete — covering org isolation,
 * filename sanitization, MIME validation, and size enforcement.
 *
 * Run with:  pnpm vitest run src/routes/team-files.test.ts
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import teamFilesRouter from "./team-files.js";

// ─── Logger mock (avoids pino transport startup) ───────────────────────────────

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Types ────────────────────────────────────────────────────────────────────

type OrgDb = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

// ─── Constants ────────────────────────────────────────────────────────────────

const TF_MAX     = 10 * 1024 * 1024;                // 10 MB per file (matches route constant)
const SMALL_B64  = Buffer.alloc(1024).toString("base64");   // 1 KB — well within limits
const PPTX_MIME  = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// ─── Test-app factory ─────────────────────────────────────────────────────────

/**
 * Build a minimal Express app with the team-files router mounted.
 * Injects req.orgId, req.orgContext, and req.orgDb without requiring
 * the real auth or dbContext middlewares.
 */
function makeApp(mockDb: OrgDb, opts: { role?: string; orgId?: string } = {}) {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.use((req: any, _res, next) => {
    req.orgId      = opts.orgId ?? "orgA";
    req.orgContext = { orgId: opts.orgId ?? "orgA", userId: "u1", role: opts.role ?? "owner" };
    req.orgDb      = mockDb;
    next();
  });

  app.use(teamFilesRouter);
  return app;
}

/** Returns a vi mock DB function that resolves to the given rows for every call. */
function makeDb(rows: Record<string, unknown>[] = []): OrgDb {
  return vi.fn().mockResolvedValue({ rows });
}

/**
 * Returns a vi mock DB that returns specific responses per call index:
 * first call → firstRows, subsequent → laterRows.
 */
function makeDbSeq(firstRows: Record<string, unknown>[], laterRows: Record<string, unknown>[] = []) {
  return vi.fn()
    .mockResolvedValueOnce({ rows: firstRows })
    .mockResolvedValue({ rows: laterRows });
}

// ─── POST /team/files ─────────────────────────────────────────────────────────

describe("POST /team/files — upload", () => {

  it("A — normal name + valid MIME → 201, file descriptor returned", async () => {
    // First call = quota SELECT (cnt, total_bytes), second = INSERT
    const db = makeDbSeq([{ cnt: 0, total_bytes: 0 }], []);
    const res = await request(makeApp(db))
      .post("/team/files")
      .send({ name: "report.pdf", type: "application/pdf", content: SMALL_B64 });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.file).toMatchObject({ name: "report.pdf", type: "application/pdf" });
  });

  it("B — name with path traversal '../report.pdf' → sanitized to 'report.pdf', 201", async () => {
    const db = makeDbSeq([{ cnt: 0, total_bytes: 0 }], []);
    const res = await request(makeApp(db))
      .post("/team/files")
      .send({ name: "../report.pdf", type: "application/pdf", content: SMALL_B64 });

    // path.basename strips the traversal, preserving the safe filename
    expect(res.status).toBe(201);
    expect(res.body.file.name).toBe("report.pdf");
  });

  it("C — name with forbidden chars → chars replaced with '_', 201", async () => {
    const db = makeDbSeq([{ cnt: 0, total_bytes: 0 }], []);
    const res = await request(makeApp(db))
      .post("/team/files")
      .send({ name: "my<script>file.pdf", type: "application/pdf", content: SMALL_B64 });

    expect(res.status).toBe(201);
    expect(res.body.file.name).not.toContain("<");
    expect(res.body.file.name).not.toContain(">");
    expect(res.body.file.name).toMatch(/\.pdf$/);
  });

  it("D — name > 200 chars loses extension after truncation → 415", async () => {
    // "a"×200 + ".pdf" = 204 chars → slice(0,200) removes ".pdf"
    const longName = "a".repeat(200) + ".pdf";
    const res = await request(makeApp(makeDb()))
      .post("/team/files")
      .send({ name: longName, type: "application/pdf", content: SMALL_B64 });

    expect(res.status).toBe(415);
  });

  it("E — CSV with text/csv → 201", async () => {
    const db = makeDbSeq([{ cnt: 0, total_bytes: 0 }], []);
    const res = await request(makeApp(db))
      .post("/team/files")
      .send({ name: "data.csv", type: "text/csv", content: SMALL_B64 });

    expect(res.status).toBe(201);
    expect(res.body.file.type).toBe("text/csv");
  });

  it("F — MIME inconsistent with extension (readme.txt + application/pdf) → 415", async () => {
    const res = await request(makeApp(makeDb()))
      .post("/team/files")
      .send({ name: "readme.txt", type: "application/pdf", content: SMALL_B64 });

    expect(res.status).toBe(415);
  });

  it("G — file over 10 MB size limit → 413", async () => {
    const overB64 = Buffer.alloc(TF_MAX + 1).toString("base64");
    const res = await request(makeApp(makeDb()))
      .post("/team/files")
      .send({ name: "big.pdf", type: "application/pdf", content: overB64 });

    expect(res.status).toBe(413);
  });

  it("H — viewer role cannot upload → 403", async () => {
    const res = await request(makeApp(makeDb(), { role: "viewer" }))
      .post("/team/files")
      .send({ name: "report.pdf", type: "application/pdf", content: SMALL_B64 });

    expect(res.status).toBe(403);
  });

  it("I — missing name field → 400", async () => {
    const res = await request(makeApp(makeDb()))
      .post("/team/files")
      .send({ type: "application/pdf", content: SMALL_B64 });

    expect(res.status).toBe(400);
  });

  it("J — ZIP allowed in team-files (different from AI allowlist) → 201", async () => {
    const db = makeDbSeq([{ cnt: 0, total_bytes: 0 }], []);
    const res = await request(makeApp(db))
      .post("/team/files")
      .send({ name: "archive.zip", type: "application/zip", content: SMALL_B64 });

    expect(res.status).toBe(201);
  });

  it("K — PPTX allowed in team-files (different from AI allowlist) → 201", async () => {
    const db = makeDbSeq([{ cnt: 0, total_bytes: 0 }], []);
    const res = await request(makeApp(db))
      .post("/team/files")
      .send({ name: "deck.pptx", type: PPTX_MIME, content: SMALL_B64 });

    expect(res.status).toBe(201);
  });

  it("L — size derived server-side (client rawSize ignored)", async () => {
    const db = makeDbSeq([{ cnt: 0, total_bytes: 0 }], []);
    const res = await request(makeApp(db))
      .post("/team/files")
      .send({ name: "report.pdf", type: "application/pdf", size: 9999999, content: SMALL_B64 });

    expect(res.status).toBe(201);
    // Server derives size from base64 — not from the client rawSize
    expect(res.body.file.size).toBeGreaterThan(900);
    expect(res.body.file.size).toBeLessThan(1500);
    expect(res.body.file.size).not.toBe(9999999);
  });
});

// ─── GET /team/files ──────────────────────────────────────────────────────────

describe("GET /team/files — list", () => {

  it("M — returns only current org's files (org_id bound in SQL)", async () => {
    const orgAFile = {
      id: "f1", name: "report.pdf", type: "application/pdf",
      size: 1024, shared_by: "Alice", created_at: new Date().toISOString(),
    };
    const db = makeDb([orgAFile]);

    const res = await request(makeApp(db)).get("/team/files");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("f1");

    // Verify orgId was bound as a parameter in the SQL query (org isolation)
    const dbCalls = (db as ReturnType<typeof vi.fn>).mock.calls;
    expect(dbCalls[0][1]).toContain("orgA");
  });

  it("N — returns empty array for org with no files", async () => {
    const res = await request(makeApp(makeDb([]))).get("/team/files");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("O — response shape: id, name, type, size, sharedBy, createdAt", async () => {
    const created = new Date().toISOString();
    const db = makeDb([{
      id: "f2", name: "notes.txt", type: "text/plain",
      size: 256, shared_by: "Bob", created_at: created,
    }]);

    const res = await request(makeApp(db)).get("/team/files");

    expect(res.body[0]).toMatchObject({
      id: "f2", name: "notes.txt", type: "text/plain",
      size: 256, sharedBy: "Bob",
    });
    expect(res.body[0]).toHaveProperty("createdAt");
  });
});

// ─── GET /team/files/:id/content ─────────────────────────────────────────────

describe("GET /team/files/:id/content — download", () => {

  it("P — returns decoded binary content with correct MIME headers", async () => {
    const buf = Buffer.alloc(512, 0xab);
    const b64 = buf.toString("base64");
    const db  = makeDb([{ id: "f1", name: "report.pdf", type: "application/pdf", content: b64 }]);

    const res = await request(makeApp(db))
      .get("/team/files/f1/content")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toContain("report.pdf");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    // Decoded bytes match original
    expect((res.body as Buffer).equals(buf)).toBe(true);
  });

  it("Q — cross-org file not found → 404 (WHERE id=$1 AND org_id=$2)", async () => {
    // The mock returns no rows — simulating RLS / WHERE clause blocking cross-org access
    const db = makeDb([]);

    const res = await request(makeApp(db)).get("/team/files/f_other_org/content");

    expect(res.status).toBe(404);

    // Verify the SQL parameters included the requesting org's ID, not a bypass
    const dbCalls = (db as ReturnType<typeof vi.fn>).mock.calls;
    expect(dbCalls[0][1]).toEqual(["f_other_org", "orgA"]);
  });

  it("R — content header filename is sanitized", async () => {
    const b64 = Buffer.alloc(64).toString("base64");
    const db  = makeDb([{ id: "f1", name: "../../evil.pdf", type: "application/pdf", content: b64 }]);

    const res = await request(makeApp(db)).get("/team/files/f1/content");

    expect(res.status).toBe(200);
    // Content-Disposition must not contain the traversal sequence
    expect(res.headers["content-disposition"]).not.toContain("../../");
  });
});

// ─── DELETE /team/files/:id ───────────────────────────────────────────────────

describe("DELETE /team/files/:id — delete", () => {

  it("S — deletes own file → { ok: true }", async () => {
    const db  = makeDb([]);

    const res = await request(makeApp(db)).delete("/team/files/f1");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("T — cross-org delete uses WHERE org_id isolation (SQL proof)", async () => {
    const db = makeDb([]);

    await request(makeApp(db)).delete("/team/files/f_other_org");

    // The DELETE SQL must bind the requesting org's ID as a parameter
    const dbCalls = (db as ReturnType<typeof vi.fn>).mock.calls;
    const [sql, params] = dbCalls[0];
    expect(String(sql)).toContain("AND org_id=");
    expect(params).toContain("orgA");
    expect(params).toContain("f_other_org");
  });

  it("U — viewer role cannot delete → 403", async () => {
    const res = await request(makeApp(makeDb(), { role: "viewer" })).delete("/team/files/f1");
    expect(res.status).toBe(403);
  });
});
