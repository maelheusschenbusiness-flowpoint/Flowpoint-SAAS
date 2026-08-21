/**
 * team-chat-reliability.test.ts
 *
 * Task #628 — team chat bidirectional reliability.
 *
 * Deterministic API + SSE regression suite proving that:
 *   1. owner → invited member and invited member → owner both receive each
 *      other's chat:message (bidirectional), with correct per-recipient `self`.
 *   2. channel keys are normalized identically on REST hydration AND on the SSE
 *      broadcast payload ("#General" → "general") so both land in one bucket.
 *   3. store.broadcast() reaches an /api/events client through the store→events
 *      SSE bridge (store.addSseClient), scoped to the sender's org.
 *   4. org isolation is preserved — a second org's SSE client and REST reads
 *      never see the first org's messages.
 *
 * Uses the REAL store singleton (its @workspace/db + logger deps are stubbed by
 * vitest.setup.ts) so the store→events bridge is exercised end-to-end.
 *
 * Run with:  pnpm vitest run src/routes/team-chat-reliability.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import teamMessagesRouter from "./team-messages.js";
import { store } from "../services/store.js";

type Row = Record<string, unknown>;
type OrgDb = (sql: string, values?: unknown[]) => Promise<{ rows: Row[] }>;

function extractNamedFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing browser function ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed browser function ${name}`);
}

// ─── Shared in-memory DB (channels + messages + members), multi-org ──────────
function makeSharedDb() {
  const teamMessages: Row[] = [];
  const channels: Row[] = [];
  const teamMembers: Row[] = [
    // orgA: owner + one invited member share the SAME org bucket
    { org_id: "orgA", user_id: "u-owner",  email: "owner@x.co",  status: "active" },
    { org_id: "orgA", user_id: "u-invite", email: "invite@x.co", status: "active" },
    // orgB: a completely separate tenant
    { org_id: "orgB", user_id: "u-eve",    email: "eve@other.co", status: "active" },
  ];

  const db: OrgDb = async (sql: string, values: unknown[] = []) => {
    if (/FROM team_members/.test(sql)) {
      const orgId = values[0] as string;
      return {
        rows: teamMembers
          .filter(m => m.org_id === orgId && m.status === "active")
          .map(m => ({ rid: (m.user_id as string) || (m.email as string), email: m.email, user_id: m.user_id })),
      };
    }
    if (/INSERT INTO team_channels/.test(sql)) {
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
      // Mirror the route's SQL: ORDER BY created_at DESC (the route then reverses
      // to present oldest → newest). Tie-break on id so equal timestamps stay stable.
      return {
        rows: teamMessages
          .filter(m => m.org_id === orgId && m.channel === channel)
          .sort((a, b) => {
            const c = String(b.created_at).localeCompare(String(a.created_at));
            return c !== 0 ? c : String(b.id).localeCompare(String(a.id));
          }),
      };
    }
    if (/INSERT INTO team_messages/.test(sql)) {
      const [id, org_id, channel, sender_id, sender_name, content, attachment_url, attachment_name] = values as string[];
      const row: Row = {
        id, org_id, channel, sender_id, sender_name, content, type: "text",
        attachment_url, attachment_name,
        // Monotonic timestamp keeps ordering deterministic across fast inserts.
        created_at: new Date(Date.now() + teamMessages.length).toISOString(),
      };
      teamMessages.push(row);
      return { rows: [row] };
    }
    if (/SELECT .* FROM team_messages WHERE id=\$1/.test(sql.replace(/\s+/g, " "))) {
      return { rows: teamMessages.filter(m => m.id === values[0]) };
    }
    if (/INSERT INTO notifications/.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  };

  return { db, teamMessages, channels, teamMembers };
}

// Build an app whose middleware injects the given identity + org bucket.
function makeApp(
  db: OrgDb,
  user: { userId: string; email: string; userUuid?: string },
  orgId = "orgA",
) {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((req: any, _res, next) => {
    req.orgId = orgId;
    req.orgContext = { orgId, userId: user.userId, userUuid: user.userUuid, email: user.email, role: "owner" };
    req.orgDb = db;
    next();
  });
  app.use(teamMessagesRouter);
  return app;
}

const OWNER  = { userId: "u-owner",  email: "owner@x.co" };
const INVITE = { userId: "u-invite", email: "invite@x.co" };
const EVE    = { userId: "u-eve",    email: "eve@other.co" };

const flushAsync = () => new Promise(r => setTimeout(r, 20));

describe("team chat bidirectional reliability (task #628)", () => {
  let shared: ReturnType<typeof makeSharedDb>;
  beforeEach(() => { shared = makeSharedDb(); });

  // ── API: bidirectional owner ↔ invited member ─────────────────────────────
  it("owner → invite: owner sees self:true, invited member sees self:false + senderId", async () => {
    const post = await request(makeApp(shared.db, OWNER)).post("/team/messages").send({ channel: "general", text: "hey team" });
    expect(post.status).toBe(201);
    expect(post.body.self).toBe(true);
    expect(post.body.senderId).toBe("u-owner");

    const ownerView  = await request(makeApp(shared.db, OWNER)).get("/team/messages?channel=general");
    const inviteView = await request(makeApp(shared.db, INVITE)).get("/team/messages?channel=general");

    expect(ownerView.body).toHaveLength(1);
    expect(ownerView.body[0].self).toBe(true);

    expect(inviteView.body).toHaveLength(1);
    expect(inviteView.body[0].self).toBe(false);
    expect(inviteView.body[0].senderId).toBe("u-owner");
    expect(inviteView.body[0].text).toBe("hey team");
  });

  it("invite → owner: invited member sees self:true, owner sees self:false + senderId", async () => {
    const post = await request(makeApp(shared.db, INVITE)).post("/team/messages").send({ channel: "general", text: "reply from invite" });
    expect(post.status).toBe(201);
    expect(post.body.self).toBe(true);
    expect(post.body.senderId).toBe("u-invite");

    const inviteView = await request(makeApp(shared.db, INVITE)).get("/team/messages?channel=general");
    const ownerView  = await request(makeApp(shared.db, OWNER)).get("/team/messages?channel=general");

    expect(inviteView.body[0].self).toBe(true);
    expect(ownerView.body[0].self).toBe(false);
    expect(ownerView.body[0].senderId).toBe("u-invite");
    expect(ownerView.body[0].text).toBe("reply from invite");
  });

  it("full round-trip: both messages persist in one shared org bucket, each side computes its own self", async () => {
    await request(makeApp(shared.db, OWNER)).post("/team/messages").send({ channel: "general", text: "ping" });
    await request(makeApp(shared.db, INVITE)).post("/team/messages").send({ channel: "general", text: "pong" });

    const ownerView  = await request(makeApp(shared.db, OWNER)).get("/team/messages?channel=general");
    const inviteView = await request(makeApp(shared.db, INVITE)).get("/team/messages?channel=general");

    // Both see BOTH messages (shared bucket), ordered oldest → newest.
    expect(ownerView.body.map((m: Row) => m.text)).toEqual(["ping", "pong"]);
    expect(inviteView.body.map((m: Row) => m.text)).toEqual(["ping", "pong"]);

    // self is computed per-recipient, mirrored between the two sides.
    expect(ownerView.body.map((m: Row) => m.self)).toEqual([true, false]);
    expect(inviteView.body.map((m: Row) => m.self)).toEqual([false, true]);
  });

  it("userUuid is the canonical sender identity when present", async () => {
    const ownerU = { ...OWNER, userUuid: "uuid-owner" };
    const post = await request(makeApp(shared.db, ownerU)).post("/team/messages").send({ channel: "general", text: "uuid msg" });
    expect(post.body.senderId).toBe("uuid-owner");

    // The same person (matched by userUuid) reads their own message as self.
    const ownerView = await request(makeApp(shared.db, ownerU)).get("/team/messages?channel=general");
    expect(ownerView.body[0].self).toBe(true);
  });

  it("UUID-backed browser sender consumes its SSE echo once as self with no unread badge", () => {
    const backendSource = readFileSync(
      new URL("../../../flowpoint-export/fp-backend.js", import.meta.url),
      "utf8",
    );
    const meSource = readFileSync(new URL("./me.ts", import.meta.url), "utf8");
    expect(meSource).toContain("userUuid:            req.orgContext?.userUuid ?? null");

    const identityFn = extractNamedFunction(backendSource, "_fpChatMessageIsSelf");
    const handlerFn = extractNamedFunction(backendSource, "_fpHandleChatMessage");
    const refreshBadge = vi.fn();
    const playSound = vi.fn();
    const render = vi.fn();
    const state = {
      route: "team",
      me: {
        userId: "org-session-id",
        userUuid: "uuid-owner",
        email: "owner@x.co",
      },
      channelMessages: {
        general: [{
          id: "optimistic_1",
          text: "uuid echo",
          self: true,
          read: true,
        }],
      },
    };
    const context = {
      data: {
        channel: "general",
        message: {
          id: "server-1",
          channel: "general",
          senderId: "uuid-owner",
          from: "owner",
          text: "uuid echo",
          createdAt: "2026-08-21T20:00:00.000Z",
        },
      },
      window: {
        STATE: state,
        _fpRefreshMsgBadge: refreshBadge,
        _fpPlayChatSound: playSound,
        render,
      },
      document: { getElementById: () => null },
      setTimeout: (fn: () => void) => { fn(); return 0; },
      Date,
      console,
      _fpNormChannel: (channel: unknown) => String(channel ?? "general").replace(/^#+/, "").toLowerCase(),
    };

    runInNewContext(
      `${identityFn}\n${handlerFn}\n_fpHandleChatMessage(data);`,
      context,
    );

    expect(state.channelMessages.general).toHaveLength(1);
    expect(state.channelMessages.general[0]).toMatchObject({
      id: "server-1",
      senderId: "uuid-owner",
      self: true,
      read: true,
    });
    expect(refreshBadge).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledOnce();
  });

  // ── Channel normalization on REST hydration ────────────────────────────────
  it("#General normalization: POST '#General' is readable as 'general' and keyed 'general' in /all", async () => {
    const post = await request(makeApp(shared.db, OWNER)).post("/team/messages").send({ channel: "#General", text: "normalized" });
    expect(post.status).toBe(201);
    expect(post.body.channel).toBe("general");

    // Persisted channel row is bare-lowercase.
    expect(shared.channels.map(c => c.name)).toContain("general");
    expect(shared.channels.map(c => c.name)).not.toContain("#General");

    // Readable under the normalized key regardless of the query casing / '#'.
    const g1 = await request(makeApp(shared.db, INVITE)).get("/team/messages?channel=general");
    const g2 = await request(makeApp(shared.db, INVITE)).get("/team/messages?channel=%23General");
    expect(g1.body.map((m: Row) => m.text)).toContain("normalized");
    expect(g2.body.map((m: Row) => m.text)).toContain("normalized");

    const all = await request(makeApp(shared.db, INVITE)).get("/team/messages/all");
    expect(Object.keys(all.body)).toContain("general");
    expect(Object.keys(all.body)).not.toContain("#General");
    expect((all.body["general"] as Array<{ text: string }>).map(m => m.text)).toContain("normalized");
  });

  // ── SSE bridge: store.broadcast() → /api/events client, org-scoped ─────────
  it("store.broadcast reaches the org's SSE client with normalized channel + self:false + senderId", async () => {
    // Register a fake /api/events client for orgA via the store→events bridge.
    const orgAFrames: string[] = [];
    const orgBFrames: string[] = [];
    const sendA = (data: string) => { orgAFrames.push(data); };
    const sendB = (data: string) => { orgBFrames.push(data); };
    store.addSseClient("orgA", sendA);
    store.addSseClient("orgB", sendB);
    try {
      await request(makeApp(shared.db, OWNER)).post("/team/messages").send({ channel: "#General", text: "sse ping" });
      await flushAsync();

      // orgA client received the chat:message frame; orgB did not (isolation).
      const parsed = orgAFrames
        .map(f => { try { return JSON.parse(f.replace(/^data: /, "").trim()); } catch { return null; } })
        .filter((p): p is Record<string, unknown> => !!p && p["type"] === "chat:message");

      expect(parsed).toHaveLength(1);
      const evt = parsed[0]!;
      // Channel normalized identically to REST hydration.
      expect(evt["channel"]).toBe("general");
      const message = evt["message"] as Record<string, unknown>;
      // Broadcast is org-wide: self:false so recipients compute their own self.
      expect(message["self"]).toBe(false);
      expect(message["read"]).toBe(false);
      expect(message["senderId"]).toBe("u-owner");
      expect(message["channel"]).toBe("general");
      expect(message["text"]).toBe("sse ping");

      // orgB (other tenant) never received the frame.
      const bChat = orgBFrames.filter(f => /"type":"chat:message"/.test(f));
      expect(bChat).toHaveLength(0);
    } finally {
      store.removeSseClient("orgA", sendA);
      store.removeSseClient("orgB", sendB);
    }
  });

  // ── Org isolation on REST ───────────────────────────────────────────────────
  it("org isolation: orgB sees nothing of orgA's messages", async () => {
    await request(makeApp(shared.db, OWNER)).post("/team/messages").send({ channel: "general", text: "orgA secret" });

    const single = await request(makeApp(shared.db, EVE, "orgB")).get("/team/messages?channel=general");
    expect(single.body).toEqual([]);

    const all = await request(makeApp(shared.db, EVE, "orgB")).get("/team/messages/all");
    for (const ch of Object.keys(all.body)) expect(all.body[ch]).toEqual([]);
  });
});
