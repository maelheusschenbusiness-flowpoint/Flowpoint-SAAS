import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface ActivityLog {
  type: string;
  label: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
}

export interface OrgMe {
  plan: string;
  orgId: string;
  email?: string;
  name?: string;
  addons: Record<string, boolean>;
  seats: number;
  trialEndsAt?: string;
}

class Store {
  me: OrgMe = {
    plan: "pro",
    orgId: "default",
    addons: {},
    seats: 5,
  };

  async refresh(orgId = "default"): Promise<void> {
    try {
      const client = await pool.connect();
      try {
        const row = await client.query(
          `SELECT plan, email, name, trial_ends_at FROM org_settings WHERE org_id = $1 LIMIT 1`,
          [orgId]
        );
        if (row.rows[0]) {
          this.me.plan = row.rows[0].plan ?? "pro";
          this.me.email = row.rows[0].email;
          this.me.name = row.rows[0].name;
          this.me.trialEndsAt = row.rows[0].trial_ends_at;
        }
        const addons = await client.query(
          `SELECT addon_key FROM org_addons WHERE org_id = $1 AND active = true`,
          [orgId]
        );
        this.me.addons = Object.fromEntries(addons.rows.map((r: { addon_key: string }) => [r.addon_key, true]));
      } finally {
        client.release();
      }
    } catch { /* non-fatal */ }
  }

  async logActivity(opts: ActivityLog): Promise<void> {
    try {
      const client = await pool.connect();
      try {
        const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await client.query(
          `INSERT INTO activity_logs (id, type, label, target_id, target_type, metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (id) DO NOTHING`,
          [id, opts.type, opts.label, opts.targetId ?? null, opts.targetType ?? null, JSON.stringify(opts.metadata ?? {})]
        );
      } finally {
        client.release();
      }
    } catch (err) {
      logger.debug({ err }, "[store] logActivity failed (non-fatal)");
    }
  }
}

export const store = new Store();
