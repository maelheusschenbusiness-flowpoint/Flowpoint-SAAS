/**
 * chat-notifications.test.ts
 *
 * Multi-user regression suite for per-recipient chat notifications.
 * Covers the reviewer-required scenario: sender + recipient A + recipient B —
 * A clearing their notifications must NOT hide or mark-read B's chat alert,
 * and the sender must never receive their own chat notification.
 *
 * Run with:  pnpm vitest run src/routes/chat-notifications.test.ts
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import notificationsRouter from "./notifications.js";
import teamMessagesRouter from "./team-messages.js";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../services/store.js", () => ({
  store: { broadcast: vi.fn() },
}));

type Row = Record<string, unknown>;
type OrgDb = (sql: string, values?: unknown[]) => Promise<{ rows: Row[] }>;

// ─── Shared in-memory DB simulating notifications + team_members + team_messages ──

function makeSharedDb() {
  const notifications: Row[] = [];
  const teamMessages: Row[] = [];
  const channels: Row[] = [];
  const flags = { failChannelInsert: false };
  const teamMembers: Row[] = [
    { org_id: "orgA", user_id: "u-sender", email: "sender@x.co", status: "active" },
    { org_id: "orgA", user_id: "u-alice",  email: "alice@x.co",  status: "active" },
    { org_id: "orgA", user_id: "u-bob",    email: "bob@x.co",    status: "active" },
    { org_id: "orgA", user_id: "",         email: "pending@x.co", status: "pending" },
  ];

  const db: OrgDb = async (sql: string, values: unknown[] = []) => {
    // team_members lookup used by POST /team/messages notification fan-out
    if (/FROM team_members/.test(sql)) {
      const orgId = values[0] as string;
      return {
        rows: teamMembers
          .filter(m => m.org_id === orgId && m.status === "active")
          .map(m => ({ rid: (m.user_id as string) || (m.email as string), email: m.email, user_id: m.user_id })),
      };
    }
    if (/INSERT INTO team_channels/.test(sql)) {
      if (flags.failChannelInsert) throw new Error("channel insert failed (test)");
      // Deliberately deferred: the push only happens after a real async hop,
      // so a fire-and-forget caller would resolve BEFORE the row exists.
      await new Promise(r => setTimeout(r, 10));
      const [org_id, name, created_by] = values as string[];
      if (!channels.some(c => c.org_id === org_id && c.name === name)) {
        channels.push({ org_id, name, created_by, created_at: new Date().toISOString() });
      }
      return { rows: [] };
    }
    if (/SELECT DISTINCT channel FROM team_messages/.test(sql)) {
      const orgId = values[0] as string;
      const names = [...new Set(teamMessages.filter(m => m.org_id === orgId).map(m => String(m.channel)))];
      return { rows: names.map(channel => ({ channel })) };
    }
    if (/SELECT name FROM team_channels/.test(sql)) {
      const orgId = values[0] as string;
      return { rows: channels.filter(c => c.org_id === orgId).map(c => ({ name: c.name })) };
    }
    if (/FROM team_messages/.test(sql) && /org_id=\$1 AND channel=\$2/.test(sql)) {
      const [orgId, channel] = values as string[];
      return {
        rows: teamMessages
          .filter(m => m.org_id === orgId && m.channel === channel)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
      };
    }
    if (/INSERT INTO team_messages/.test(sql)) {
      const [id, org_id, channel, sender_id, sender_name, content, attachment_url, attachment_name] = values as string[];
      const row: Row = { id, org_id, channel, sender_id, sender_name, content, type: "text", attachment_url, attachment_name, created_at: new Date().toISOString() };
      teamMessages.push(row);
      return { rows: [row] };
    }
    if (/SELECT .* FROM team_messages WHERE id=\$1/.test(sql.replace(/\s+/g, " "))) {
      return { rows: teamMessages.filter(m => m.id === values[0]) };
    }
    if (/INSERT INTO notifications/.test(sql)) {
      // team-messages fan-out shape: (id, org_id, 'chat', title, message, read=false, link, recipient_id, NOW())
      const [id, org_id, title, message, link, recipient_id] = values as string[];
      notifications.push({ id, org_id, type: "chat", title, message, read: false, link, recipient_id, created_at: new Date().toISOString() });
      return { rows: [notifications[notifications.length - 1]!] };
    }
    if (/SELECT \* FROM notifications/.test(sql)) {
      const [orgId, , rids] = values as [string, unknown, string[]];
      return {
        rows: notifications
          .filter(n => n.org_id === orgId && (n.recipient_id == null || (rids ?? []).includes(n.recipient_id as string)))
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
      };
    }
    if (/UPDATE notifications SET read = true\s+WHERE id = \$1/.test(sql)) {
      const [id, orgId, rids] = values as [string, string, string[]];
      const n = notifications.find(x => x.id === id && x.org_id === orgId &&
        (x.recipient_id == null || (rids ?? []).includes(x.recipient_id as string)));
      if (n) n.read = true;
      return { rows: n ? [n] : [] };
    }
    if (/UPDATE notifications SET read = true\s+WHERE org_id = \$1/.test(sql)) {
      const [orgId, rids] = values as [string, string[]];
      for (const n of notifications) {
        if (n.org_id === orgId && (n.recipient_id == null || (rids ?? []).includes(n.recipient_id as string))) {
          n.read = true;
        }
      }
      return { rows: [] };
    }
    if (/DELETE FROM notifications/.test(sql)) {
      const [id, orgId, rids] = values as [string, string, string[]];
      const idx = notifications.findIndex(x => x.id === id && x.org_id === orgId &&
        (x.recipient_id == null || (rids ?? []).includes(x.recipient_id as string)));
      if (idx === -1) return { rows: [] };
      const [gone] = notifications.splice(idx, 1);
      return { rows: [gone!] };
    }
    return { rows: [] };
  };

  return { db, notifications, teamMembers, channels, flags };
}

function makeApp(db: OrgDb, user: { userId: string; email: string }, orgId = "orgA") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.orgId = orgId;
    req.orgContext = { orgId, userId: user.userId, email: user.email, role: "owner" };
    req.orgDb = db;
    next();
  });
  app.use(notificationsRouter);
  app.use(teamMessagesRouter);
  return app;
}

const SENDER = { userId: "u-sender", email: "sender@x.co" };
const ALICE  = { userId: "u-alice",  email: "alice@x.co" };
const BOB    = { userId: "u-bob",    email: "bob@x.co" };

const flushAsync = () => new Promise(r => setTimeout(r, 20));

describe("per-recipient chat notifications", () => {
  let shared: ReturnType<typeof makeSharedDb>;
  beforeEach(() => { shared = makeSharedDb(); });

  it("fans out one notification row per active teammate, excluding the sender", async () => {
    const senderApp = makeApp(shared.db, SENDER);
    const r = await request(senderApp).post("/team/messages").send({ channel: "general", text: "salut" });
    expect(r.status).toBe(201);
    await flushAsync();

    const chatRows = shared.notifications.filter(n => n.type === "chat");
    const recipients = chatRows.map(n => n.recipient_id).sort();
    expect(recipients).toEqual(["u-alice", "u-bob"]);   // no sender row, no pending member
    expect(chatRows.every(n => n.read === false)).toBe(true);
  });

  it("GET /notifications only returns the requester's own targeted rows", async () => {
    const senderApp = makeApp(shared.db, SENDER);
    await request(senderApp).post("/team/messages").send({ channel: "general", text: "hello" });
    await flushAsync();

    const aliceRes = await request(makeApp(shared.db, ALICE)).get("/notifications");
    const bobRes   = await request(makeApp(shared.db, BOB)).get("/notifications");
    const senderRes = await request(senderApp).get("/notifications");

    expect(aliceRes.body.filter((n: Row) => n.type === "chat")).toHaveLength(1);
    expect(bobRes.body.filter((n: Row) => n.type === "chat")).toHaveLength(1);
    expect(senderRes.body.filter((n: Row) => n.type === "chat")).toHaveLength(0);
  });

  it("Alice's read-all does NOT mark Bob's chat alert as read", async () => {
    await request(makeApp(shared.db, SENDER)).post("/team/messages").send({ channel: "general", text: "important" });
    await flushAsync();

    const ra = await request(makeApp(shared.db, ALICE)).patch("/notifications/read-all");
    expect(ra.status).toBe(200);

    const aliceRow = shared.notifications.find(n => n.recipient_id === "u-alice");
    const bobRow   = shared.notifications.find(n => n.recipient_id === "u-bob");
    expect(aliceRow?.read).toBe(true);
    expect(bobRow?.read).toBe(false);   // Bob's alert survives Alice's "Tout marquer lu"
  });

  it("Alice cannot mark or delete Bob's targeted notification by id", async () => {
    await request(makeApp(shared.db, SENDER)).post("/team/messages").send({ channel: "general", text: "x" });
    await flushAsync();
    const bobRow = shared.notifications.find(n => n.recipient_id === "u-bob")!;

    await request(makeApp(shared.db, ALICE)).patch(`/notifications/${bobRow.id}/read`);
    expect(bobRow.read).toBe(false);

    const del = await request(makeApp(shared.db, ALICE)).delete(`/notifications/${bobRow.id}`);
    expect(del.status).toBe(404);
    expect(shared.notifications.some(n => n.id === bobRow.id)).toBe(true);
  });

  it("read-all still marks org-wide (recipient_id NULL) notifications read", async () => {
    shared.notifications.push({
      id: "notif-orgwide", org_id: "orgA", type: "info", title: "t", message: "m",
      read: false, link: null, recipient_id: null, created_at: new Date().toISOString(),
    });
    await request(makeApp(shared.db, ALICE)).patch("/notifications/read-all");
    expect(shared.notifications.find(n => n.id === "notif-orgwide")?.read).toBe(true);
  });
});

// ─── Chat message persistence, routing & isolation (task: fiabiliser équipe/chat) ──

describe("chat message persistence & routing", () => {
  let shared: ReturnType<typeof makeSharedDb>;
  beforeEach(() => {
    shared = makeSharedDb();
    vi.clearAllMocks();
  });

  it("persists the channel row before POST resolves — recipient refresh right after sees the channel", async () => {
    const r = await request(makeApp(shared.db, SENDER))
      .post("/team/messages").send({ channel: "#Projet-X", text: "kickoff" });
    expect(r.status).toBe(201);

    // No flushAsync: the awaited insert must already be visible.
    expect(shared.channels.map(c => c.name)).toContain("projet-x"); // normalized (no #, lowercase)

    const all = await request(makeApp(shared.db, ALICE)).get("/team/messages/all");
    expect(Object.keys(all.body)).toContain("projet-x");
    expect((all.body["projet-x"] as Array<{ text: string }>).map(m => m.text)).toContain("kickoff");
  });

  it("survives a channel-insert failure: POST still succeeds and /all surfaces the channel from its messages", async () => {
    shared.flags.failChannelInsert = true;
    const r = await request(makeApp(shared.db, SENDER))
      .post("/team/messages").send({ channel: "orphan-channel", text: "still visible" });
    expect(r.status).toBe(201);
    expect(shared.channels).toHaveLength(0); // channel row genuinely missing

    const all = await request(makeApp(shared.db, ALICE)).get("/team/messages/all");
    expect(Object.keys(all.body)).toContain("orphan-channel");
    expect((all.body["orphan-channel"] as Array<{ text: string }>).map(m => m.text)).toContain("still visible");
  });

  it("delivers bidirectionally: sender sees self:true, recipient sees self:false with senderId", async () => {
    await request(makeApp(shared.db, SENDER)).post("/team/messages").send({ channel: "general", text: "hello" });

    const s = await request(makeApp(shared.db, SENDER)).get("/team/messages?channel=general");
    const a = await request(makeApp(shared.db, ALICE)).get("/team/messages?channel=general");

    expect(s.body).toHaveLength(1);
    expect(s.body[0].self).toBe(true);
    expect(a.body).toHaveLength(1);
    expect(a.body[0].self).toBe(false);
    expect(a.body[0].senderId).toBe("u-sender");
    expect(a.body[0].text).toBe("hello");
  });

  it("isolates messages by organization — another org sees nothing", async () => {
    await request(makeApp(shared.db, SENDER)).post("/team/messages").send({ channel: "general", text: "orgA secret" });

    const EVE = { userId: "u-eve", email: "eve@other.co" };
    const single = await request(makeApp(shared.db, EVE, "orgB")).get("/team/messages?channel=general");
    expect(single.body).toEqual([]);

    const all = await request(makeApp(shared.db, EVE, "orgB")).get("/team/messages/all");
    for (const ch of Object.keys(all.body)) expect(all.body[ch]).toEqual([]);
  });

  it("SSE broadcast carries senderId and self:false, scoped to the sender's org", async () => {
    const { store } = await import("../services/store.js");
    await request(makeApp(shared.db, SENDER)).post("/team/messages").send({ channel: "general", text: "ping" });

    const call = (store.broadcast as ReturnType<typeof vi.fn>).mock.calls
      .find((c: unknown[]) => (c[0] as { type?: string })?.type === "chat:message");
    expect(call).toBeTruthy();
    const payload = call![0] as { message: { self: boolean; senderId: string } };
    expect(payload.message.self).toBe(false);
    expect(payload.message.senderId).toBe("u-sender");
    expect(call![1]).toBe("orgA");
  });
});
