import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_ID = "member-a";
const MEMBER_EMAIL = "member@example.test";
const MEMBER_UUID = "11111111-1111-4111-8111-111111111111";

type Session = { userId: string; orgId: string; email: string; role: string; userUuid?: string };
const sessions = new Map<string, Session>();
const canonicalMemberships = new Map<string, string>();
const teamMemberStatus = new Map<string, "active" | "removed">();

function key(orgId: string, email: string): string {
  return `${orgId}:${email.toLowerCase()}`;
}

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock("../middlewares/requireRole.js", () => ({
  canAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../services/sessions.js", () => ({
  SESSION_TTL_MS: 604_800_000,
  createSession: vi.fn(),
  getSession: vi.fn(async (token: string) => {
    const session = sessions.get(token);
    return session ? { token, createdAt: 0, expiresAt: Date.now() + 60_000, ...session } : null;
  }),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  withOrgDb: vi.fn(async (orgId: string, callback: (client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) => unknown) => {
    const client = {
      query: async (sql: string, values: unknown[] = []) => {
        if (/SELECT id, email, role, user_id\s+FROM team_members/.test(sql)) {
          const [memberId, scopedOrgId] = values as [string, string];
          if (scopedOrgId === ORG_A && memberId === MEMBER_ID && teamMemberStatus.get(key(ORG_A, MEMBER_EMAIL)) === "active") {
            return { rows: [{ id: MEMBER_ID, email: MEMBER_EMAIL, role: "member", user_id: MEMBER_UUID }] };
          }
          return { rows: [] };
        }
        if (/DELETE FROM organization_members/.test(sql)) {
          const [scopedOrgId, userId] = values as [string, string];
          const membershipKey = [...canonicalMemberships.entries()].find(
            ([entryKey, entryUserId]) => entryKey.startsWith(`${scopedOrgId}:`) && entryUserId === userId,
          )?.[0];
          if (!membershipKey) return { rows: [] };
          canonicalMemberships.delete(membershipKey);
          return { rows: [{ user_id: userId }] };
        }
        if (/DELETE FROM user_sessions/.test(sql)) {
          const [scopedOrgId, email, userUuid] = values as [string, string, string | null];
          for (const [token, session] of sessions) {
            const matchesMember = session.email.toLowerCase() === email.toLowerCase() || (!!userUuid && session.userUuid === userUuid);
            if (session.orgId === scopedOrgId && matchesMember) sessions.delete(token);
          }
          return { rows: [] };
        }
        if (/UPDATE team_members\s+SET status = 'removed'/.test(sql)) {
          const [memberId, scopedOrgId] = values as [string, string];
          if (memberId === MEMBER_ID && scopedOrgId === ORG_A && teamMemberStatus.get(key(ORG_A, MEMBER_EMAIL)) === "active") {
            teamMemberStatus.set(key(ORG_A, MEMBER_EMAIL), "removed");
            return { rows: [{ id: MEMBER_ID }] };
          }
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL in member-removal test: ${sql}`);
      },
    };
    return callback(client);
  }),
}));

import teamRouter from "./team.js";
import { requireAuth } from "../middlewares/requireAuth.js";

function removalApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.orgId = ORG_A;
    req.orgContext = { orgId: ORG_A, email: "owner@example.test", role: "owner" };
    next();
  });
  app.use("/api", teamRouter);
  return app;
}

function protectedApp() {
  const app = express();
  app.get("/protected", requireAuth, (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("DELETE /team/:id — member access revocation", () => {
  beforeEach(() => {
    sessions.clear();
    canonicalMemberships.clear();
    teamMemberStatus.clear();
    canonicalMemberships.set(key(ORG_A, MEMBER_EMAIL), MEMBER_UUID);
    canonicalMemberships.set(key(ORG_B, MEMBER_EMAIL), MEMBER_UUID);
    teamMemberStatus.set(key(ORG_A, MEMBER_EMAIL), "active");
    sessions.set("org-a-token", { userId: ORG_A, orgId: ORG_A, email: MEMBER_EMAIL, role: "member", userUuid: MEMBER_UUID });
    sessions.set("org-b-token", { userId: ORG_B, orgId: ORG_B, email: MEMBER_EMAIL, role: "member", userUuid: MEMBER_UUID });
  });

  it("revokes the removed member's existing org-A token while preserving their org-B token", async () => {
    const protectedRoutes = protectedApp();
    expect((await request(protectedRoutes).get("/protected").set("Authorization", "Bearer org-a-token")).status).toBe(200);
    expect((await request(protectedRoutes).get("/protected").set("Authorization", "Bearer org-b-token")).status).toBe(200);

    const removal = await request(removalApp()).delete(`/api/team/${MEMBER_ID}`);
    expect(removal.status).toBe(200);
    expect(canonicalMemberships.has(key(ORG_A, MEMBER_EMAIL))).toBe(false);
    expect(teamMemberStatus.get(key(ORG_A, MEMBER_EMAIL))).toBe("removed");

    expect((await request(protectedRoutes).get("/protected").set("Authorization", "Bearer org-a-token")).status).toBe(401);
    expect((await request(protectedRoutes).get("/protected").set("Authorization", "Bearer org-b-token")).status).toBe(200);
  });

  it("refuses a forged member id from another organization without touching its session", async () => {
    const result = await request(removalApp()).delete("/api/member-belongs-to-org-b");
    expect(result.status).toBe(404);
    expect(sessions.has("org-b-token")).toBe(true);
    expect(canonicalMemberships.has(key(ORG_B, MEMBER_EMAIL))).toBe(true);
  });
});