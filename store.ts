import { db, pool, activityEventsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { MOCK_ME } from "./mock-data.js";

export type UserMe = {
  firstName: string;
  plan: string;
  role: string;
  org: { name: string };
  subscriptionStatus: string;
  trialEndsAt: string | null;
  stripeCustomerId?: string;
  usage: {
    audit: { used: number; limit: number };
    pdf: { used: number; limit: number };
    exports: { used: number; limit: number };
    monitor: { used: number; limit: number };
  };
  addons: {
    whiteLabel: boolean;
    prioritySupport: boolean;
    customDomain: boolean;
    extraSeats: number;
    monitorsPack50: number;
  };
};

export type TriggeredAlert = {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  message: string;
  severity: string;
  url: string;
  time: number;
};

class Store {
  me: UserMe = { ...MOCK_ME };
  sseClients: Set<(data: string) => void> = new Set();
  triggeredAlerts: TriggeredAlert[] = [];
  /** key: `${ruleId}:${url}` → timestamp when condition first became true */
  ruleConditionOnset: Map<string, number> = new Map();
  /** key: `${ruleId}:${url}` → timestamp when alert was last fired */
  ruleLastFired: Map<string, number> = new Map();

  broadcast(payload: object) {
    const data = JSON.stringify(payload);
    this.sseClients.forEach((send) => {
      try { send(`data: ${data}\n\n`); } catch { }
    });
  }

  broadcastPlanUpdate(plan: string) {
    this.broadcast({ type: "plan_updated", plan });
    this.me.plan = plan;
  }

  broadcastAuditComplete(audit: { id: string; url: string; score: number; status: string; origin: string }) {
    this.broadcast({ type: "audit:auto-complete", audit });
  }

  addTriggeredAlert(alert: TriggeredAlert) {
    this.triggeredAlerts.unshift(alert);
    if (this.triggeredAlerts.length > 50) this.triggeredAlerts.pop();
    this.broadcast({ type: "alert:rule-triggered", alert });
    this.logActivity({
      type: "alert",
      label: `Alerte déclenchée : ${alert.ruleName} sur ${alert.url}`,
      targetId: alert.ruleId,
      targetType: "alert",
      metadata: { ruleType: alert.ruleType, severity: alert.severity, url: alert.url },
    }).catch(() => {});
  }

  async logActivity(event: {
    userId?: string;
    userName?: string;
    type: string;
    label: string;
    targetId?: string;
    targetType?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const id = `ae${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const [row] = await db.insert(activityEventsTable).values({
        id,
        userId: event.userId ?? "mael",
        userName: event.userName ?? "Maël H.",
        type: event.type,
        label: event.label,
        targetId: event.targetId ?? null,
        targetType: event.targetType ?? null,
        metadata: event.metadata ?? null,
      }).returning();
      // Retention: move events beyond the 50 most recent into archive, then delete from primary
      const client = await pool.connect();
      try {
        await client.query(`
          INSERT INTO activity_events_archive (id, user_id, user_name, type, label, target_id, target_type, metadata, created_at)
          SELECT id, user_id, user_name, type, label, target_id, target_type, metadata, created_at
          FROM activity_events
          WHERE id NOT IN (SELECT id FROM activity_events ORDER BY created_at DESC LIMIT 50)
          ON CONFLICT (id) DO NOTHING
        `);
        await client.query(
          `DELETE FROM activity_events WHERE id NOT IN (SELECT id FROM activity_events ORDER BY created_at DESC LIMIT 50)`
        );
      } finally {
        client.release();
      }
      this.broadcast({ type: "activity:new", event: row });
    } catch (err) {
      console.error("[store.logActivity] failed", err);
    }
  }

  async getRecentActivity(limit = 50) {
    return db.select().from(activityEventsTable)
      .orderBy(desc(activityEventsTable.createdAt))
      .limit(limit);
  }
}

export const store = new Store();
