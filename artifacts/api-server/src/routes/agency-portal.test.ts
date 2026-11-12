import express from "express";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, releaseMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  pool: { connect: vi.fn(async () => ({ query: queryMock, release: releaseMock })) },
}));

import shareRouter from "./share.js";

const app = express().use("/api", shareRouter);
const token = randomBytes(32).toString("base64url");

describe("Agency customer read-only portal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hashes the bearer token and renders only explicitly granted reports in a read-only page", async () => {
    queryMock.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes("FROM agency_customer_portals")) {
        expect(values[0]).toBe(createHash("sha256").update(token).digest("hex"));
        return { rows: [{
          org_id: "org-a", client_name: "Client <script>alert(1)</script>",
          report_ids: ["r-a"], expires_at: new Date(Date.now() + 60_000), revoked_at: null,
        }] };
      }
      if (sql.includes("FROM reports")) {
        expect(values).toEqual(["org-a", ["r-a"]]);
        return { rows: [{
          id: "r-a", name: "SEO report", type: "PDF", date: "2026-11-01",
          template_key: "executive",
          meeting_notes_json: JSON.stringify([{ site: "https://site.example", notes: "Private meeting notes" }]),
          generation_metadata_json: JSON.stringify({
            source: "agency_multi_site",
            sites: [{ url: "https://site.example", score: 82, speed: 70, issues: 4, auditDate: "2026-11-01" }],
          }),
        }] };
      }
      return { rows: [] };
    });

    const response = await request(app).get(`/api/agency-portal/${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.text).toContain("SEO report");
    expect(response.text).toContain("https://site.example");
    expect(response.text).toContain("82");
    expect(response.text).not.toContain("Private meeting notes");
    expect(response.text).not.toContain("<script>alert(1)</script>");
    expect(response.text).not.toContain("meeting_notes_json");
  });

  it("refuses revoked or expired credentials without loading reports", async () => {
    queryMock.mockResolvedValue({ rows: [{
      org_id: "org-a", client_name: "Client", report_ids: ["r-a"],
      expires_at: new Date(Date.now() + 60_000), revoked_at: new Date(),
    }] });

    const response = await request(app).get(`/api/agency-portal/${token}`);

    expect(response.status).toBe(404);
    expect(response.text).toContain("revoked");
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("FROM reports"))).toBe(false);
  });
});
