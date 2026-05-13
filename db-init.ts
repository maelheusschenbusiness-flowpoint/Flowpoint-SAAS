import { db, pool, monitorsTable, auditsTable, reportsTable, teamMembersTable, downtimeIncidentsTable, auditSchedulesTable, activityEventsTable } from "@workspace/db";

import { eq } from "drizzle-orm";
import { MOCK_AUDITS, MOCK_MONITORS, MOCK_REPORTS, MOCK_TEAM } from "./mock-data.js";
import { logger } from "../lib/logger.js";

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE monitors ADD COLUMN IF NOT EXISTS alert_phone text DEFAULT '';
      ALTER TABLE monitors ADD COLUMN IF NOT EXISTS is_critical boolean DEFAULT false;
      ALTER TABLE audits ADD COLUMN IF NOT EXISTS origin text DEFAULT 'manual';
      CREATE TABLE IF NOT EXISTS audit_schedules (
        id text PRIMARY KEY,
        url text NOT NULL,
        frequency text NOT NULL DEFAULT 'weekly',
        next_run bigint NOT NULL,
        last_run bigint,
        created_at bigint NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audits_url_date ON audits(url, date);
      CREATE TABLE IF NOT EXISTS alert_rules (
        id text PRIMARY KEY,
        name text NOT NULL,
        type text NOT NULL,
        operator text NOT NULL,
        threshold real NOT NULL,
        duration_min integer NOT NULL DEFAULT 0,
        channels text NOT NULL DEFAULT '["email"]',
        site_urls text NOT NULL DEFAULT '[]',
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS activity_events (
        id text PRIMARY KEY,
        user_id text NOT NULL DEFAULT 'mael',
        user_name text NOT NULL DEFAULT 'Maël H.',
        type text NOT NULL,
        label text NOT NULL,
        target_id text,
        target_type text,
        metadata jsonb,
        created_at timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON activity_events(created_at DESC);
      CREATE TABLE IF NOT EXISTS monitor_checks (
        id text PRIMARY KEY,
        monitor_id text NOT NULL,
        checked_at bigint NOT NULL,
        ok boolean NOT NULL,
        latency real NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_monitor_checks_monitor_id ON monitor_checks(monitor_id, checked_at DESC);
      ALTER TABLE reports ADD COLUMN IF NOT EXISTS meeting_notes_json text DEFAULT '[]';
      ALTER TABLE reports ADD COLUMN IF NOT EXISTS date_start text DEFAULT '';
      ALTER TABLE reports ADD COLUMN IF NOT EXISTS date_end text DEFAULT '';
      ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS meeting_notes_json text DEFAULT '[]';
      CREATE TABLE IF NOT EXISTS activity_events_archive (
        id text PRIMARY KEY,
        user_id text NOT NULL DEFAULT 'mael',
        user_name text NOT NULL DEFAULT 'Maël H.',
        type text NOT NULL,
        label text NOT NULL,
        target_id text,
        target_type text,
        metadata jsonb,
        created_at timestamptz NOT NULL,
        archived_at timestamptz DEFAULT now() NOT NULL
      );
    `);
    logger.info("[DB] Migrations applied (alert_phone, is_critical, origin, audit_schedules, idx_audits_url_date, alert_rules, activity_events, monitor_checks, meeting_notes_json, share_tokens_meeting_notes_json)");
  } finally {
    client.release();
  }
}

export async function initDb(): Promise<void> {
  try {
    await runMigrations();
    const existingMonitors = await db.select().from(monitorsTable).limit(1);
    if (existingMonitors.length === 0) {
      logger.info("[DB] Seeding monitors...");
      await db.insert(monitorsTable).values(
        MOCK_MONITORS.map((m) => ({
          id: m.id,
          name: m.name,
          url: m.url,
          status: m.status,
          uptime: m.uptime,
          latency: m.latency,
          lastCheck: m.lastCheck,
          alertEmail: m.alertEmail || "",
          frequency: "5min",
          lastAlertSent: null,
        }))
      );
    }

    const existingAudits = await db.select().from(auditsTable).limit(1);
    if (existingAudits.length === 0) {
      logger.info("[DB] Seeding audits...");
      await db.insert(auditsTable).values(
        MOCK_AUDITS.map((a) => ({
          id: a.id,
          url: a.url,
          score: a.score,
          status: a.status,
          speed: a.speed,
          date: a.date,
          issues: a.issues,
        }))
      );
    }

    const existingReports = await db.select().from(reportsTable).limit(1);
    if (existingReports.length === 0) {
      logger.info("[DB] Seeding reports...");
      await db.insert(reportsTable).values(
        MOCK_REPORTS.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          date: r.date,
          pages: r.pages,
          shared: r.shared,
          auditId: r.auditId || "",
          whiteLabel: r.whiteLabel ?? false,
          pdfReady: r.pdfReady ?? false,
        }))
      );
    }

    const existingTeam = await db.select().from(teamMembersTable).limit(1);
    if (existingTeam.length === 0) {
      logger.info("[DB] Seeding team...");
      await db.insert(teamMembersTable).values(
        MOCK_TEAM.map((t) => ({
          id: t.id,
          name: t.name,
          email: t.email,
          role: t.role,
          joined: t.joined,
        }))
      );
    }

    const existingActivity = await db.select().from(activityEventsTable).limit(1);
    if (existingActivity.length === 0) {
      logger.info("[DB] Seeding activity events...");
      const now = Date.now();
      const SEED_ACTIVITIES = [
        { id: "ae1",  userId: "sophie", userName: "Sophie M.", type: "audit",   label: "Audit terminé : boulangerie-martin.fr (82/100)",         targetId: "a1",  targetType: "audit",   metadata: { score: 82, url: "boulangerie-martin.fr" },             createdAt: new Date(now - 12 * 60 * 1000) },
        { id: "ae2",  userId: "mael",   userName: "Maël H.",   type: "monitor", label: "Monitor DOWN : restaurant-lesoleil.com",                 targetId: "m2",  targetType: "monitor", metadata: { status: "down", url: "restaurant-lesoleil.com" },       createdAt: new Date(now - 44 * 60 * 1000) },
        { id: "ae3",  userId: "mael",   userName: "Maël H.",   type: "report",  label: "Rapport généré : Rapport Mai 2026",                     targetId: "r1",  targetType: "report",  metadata: { name: "Rapport Mai 2026" },                             createdAt: new Date(now - 3 * 3600 * 1000) },
        { id: "ae4",  userId: "lucas",  userName: "Lucas D.",  type: "audit",   label: "Audit lancé : plombier-paris.fr",                       targetId: "a3",  targetType: "audit",   metadata: { url: "plombier-paris.fr" },                             createdAt: new Date(now - 5 * 3600 * 1000) },
        { id: "ae5",  userId: "sophie", userName: "Sophie M.", type: "team",    label: "Invitation acceptée par lucas@client.com",               targetId: "t3",  targetType: "member",  metadata: { email: "lucas@client.com" },                            createdAt: new Date(now - 8 * 3600 * 1000) },
        { id: "ae6",  userId: "mael",   userName: "Maël H.",   type: "monitor", label: "Monitor UP : restaurant-lesoleil.com",                  targetId: "m2",  targetType: "monitor", metadata: { status: "up", url: "restaurant-lesoleil.com" },         createdAt: new Date(now - 24 * 3600 * 1000) },
        { id: "ae7",  userId: "sophie", userName: "Sophie M.", type: "report",  label: "Rapport partagé : Audit SEO complet — Le Soleil",       targetId: "r2",  targetType: "report",  metadata: { name: "Audit SEO complet — Restaurant Le Soleil" },    createdAt: new Date(now - 26 * 3600 * 1000) },
        { id: "ae8",  userId: "mael",   userName: "Maël H.",   type: "monitor", label: "Monitor créé : pharmacie-centre.fr",                    targetId: "m5",  targetType: "monitor", metadata: { url: "pharmacie-centre.fr" },                           createdAt: new Date(now - 30 * 3600 * 1000) },
        { id: "ae9",  userId: "lucas",  userName: "Lucas D.",  type: "audit",   label: "Audit terminé : coiffeur-lyon.com (75/100)",            targetId: "a4",  targetType: "audit",   metadata: { score: 75, url: "coiffeur-lyon.com" },                 createdAt: new Date(now - 36 * 3600 * 1000) },
        { id: "ae10", userId: "mael",   userName: "Maël H.",   type: "alert",   label: "Alerte déclenchée : latence coiffeur-lyon.com > 800ms", targetId: "r1",  targetType: "alert",   metadata: { metric: "latency", value: 890, threshold: 800 },       createdAt: new Date(now - 40 * 3600 * 1000) },
        { id: "ae11", userId: "sophie", userName: "Sophie M.", type: "audit",   label: "Audit lancé : restaurant-lesoleil.com",                 targetId: "a2",  targetType: "audit",   metadata: { url: "restaurant-lesoleil.com" },                       createdAt: new Date(now - 48 * 3600 * 1000) },
        { id: "ae12", userId: "mael",   userName: "Maël H.",   type: "report",  label: "Rapport généré : Export moniteurs Avril 2026",          targetId: "r3",  targetType: "report",  metadata: { name: "Export moniteurs Avril 2026" },                 createdAt: new Date(now - 52 * 3600 * 1000) },
        { id: "ae13", userId: "lucas",  userName: "Lucas D.",  type: "monitor", label: "Monitor supprimé : old-site-test.com",                  targetId: "mx1", targetType: "monitor", metadata: { url: "old-site-test.com" },                             createdAt: new Date(now - 60 * 3600 * 1000) },
        { id: "ae14", userId: "sophie", userName: "Sophie M.", type: "audit",   label: "Audit terminé : pharmacie-centre.fr (55/100)",          targetId: "a5",  targetType: "audit",   metadata: { score: 55, url: "pharmacie-centre.fr" },               createdAt: new Date(now - 72 * 3600 * 1000) },
        { id: "ae15", userId: "mael",   userName: "Maël H.",   type: "team",    label: "Rôle modifié : Sophie M. → Manager",                   targetId: "t2",  targetType: "member",  metadata: { name: "Sophie M.", role: "manager" },                   createdAt: new Date(now - 80 * 3600 * 1000) },
        { id: "ae16", userId: "mael",   userName: "Maël H.",   type: "alert",   label: "Règle d'alerte créée : Score SEO < 50",                 targetId: "ar1", targetType: "alert",   metadata: { type: "score", threshold: 50 },                        createdAt: new Date(now - 90 * 3600 * 1000) },
        { id: "ae17", userId: "sophie", userName: "Sophie M.", type: "report",  label: "Rapport partagé : Rapport mensuel global Q1 2026",      targetId: "r4",  targetType: "report",  metadata: { name: "Rapport mensuel global Q1 2026" },              createdAt: new Date(now - 96 * 3600 * 1000) },
        { id: "ae18", userId: "lucas",  userName: "Lucas D.",  type: "audit",   label: "Audit lancé : garage-auto-nice.com",                    targetId: "a6",  targetType: "audit",   metadata: { url: "garage-auto-nice.com" },                         createdAt: new Date(now - 100 * 3600 * 1000) },
        { id: "ae19", userId: "mael",   userName: "Maël H.",   type: "monitor", label: "Alerte email configurée : plombier-paris.fr",           targetId: "m3",  targetType: "monitor", metadata: { url: "plombier-paris.fr", channel: "email" },          createdAt: new Date(now - 110 * 3600 * 1000) },
        { id: "ae20", userId: "sophie", userName: "Sophie M.", type: "audit",   label: "Audit terminé : garage-auto-nice.com (90/100)",         targetId: "a6",  targetType: "audit",   metadata: { score: 90, url: "garage-auto-nice.com" },             createdAt: new Date(now - 120 * 3600 * 1000) },
      ];
      await db.insert(activityEventsTable).values(SEED_ACTIVITIES);
    }

    const serverStartTs = Date.now();
    const allMonitors = await db.select().from(monitorsTable);
    for (const monitor of allMonitors) {
      if (monitor.status === "down") {
        await db.insert(downtimeIncidentsTable)
          .values({ monitorId: monitor.id, downSince: serverStartTs })
          .onConflictDoNothing();
      }
    }

    logger.info("[DB] Database initialized");
  } catch (err) {
    logger.error({ err }, "[DB] Failed to initialize database");
    throw err;
  }
}
