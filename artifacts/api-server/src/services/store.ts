import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface ActivityLog {
  id?: string;
  type: string;
  label: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface OrgMe {
  plan: string;
  orgId: string;
  email?: string;
  name?: string;
  addons: Record<string, boolean>;
  seats: number;
  trialEndsAt?: string;
  subscriptionStatus?: string;
  stripeCustomerId?: string;
}

class Store {
  me: OrgMe & Record<string, unknown> = {
    plan: "pro",
    orgId: "default",
    addons: {},
    seats: 5,
  };

  /** In-memory log of triggered alerts (alert rules that fired) */
  triggeredAlerts: Array<Record<string, unknown>> = [];

  /**
   * SSE clients partitioned by orgId for tenant isolation.
   * Each org's connected clients receive only that org's events.
   */
  private _sseByOrg: Map<string, Set<(data: string) => void>> = new Map();

  /** @deprecated Use addSseClient / removeSseClient + broadcast(payload, orgId) */
  get sseClients(): Set<(data: string) => void> {
    return this._sseByOrg.get("default") ?? new Set();
  }

  addSseClient(orgId: string, send: (data: string) => void): void {
    let bucket = this._sseByOrg.get(orgId);
    if (!bucket) { bucket = new Set(); this._sseByOrg.set(orgId, bucket); }
    bucket.add(send);
  }

  removeSseClient(orgId: string, send: (data: string) => void): void {
    const bucket = this._sseByOrg.get(orgId);
    if (bucket) { bucket.delete(send); if (!bucket.size) this._sseByOrg.delete(orgId); }
  }

  /** Broadcast a JSON event to all SSE clients of a specific org */
  broadcast(payload: Record<string, unknown>, orgId = "default"): void {
    const bucket = this._sseByOrg.get(orgId);
    if (!bucket?.size) return;
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    bucket.forEach(send => {
      try { send(msg); } catch { /* client disconnected */ }
    });
  }

  /**
   * Update plan in memory, broadcast to the org's SSE clients, and persist to org_settings DB.
   * This is the single authoritative way to change the active plan.
   */
  broadcastPlanUpdate(plan: string, orgId = "default"): void {
    this.me.plan = plan;
    this.broadcast({ type: "billing:plan_updated", plan }, orgId);

    // Persist to DB so plan survives server restarts — fire-and-forget
    pool.connect().then(client =>
      client.query(
        `INSERT INTO org_settings (org_id, plan)
         VALUES ($1, $2)
         ON CONFLICT (org_id) DO UPDATE SET plan = EXCLUDED.plan, updated_at = NOW()`,
        [orgId, plan]
      )
        .then(() => { logger.info({ plan, orgId }, "[Store] Plan persisted to org_settings"); })
        .catch(err => { logger.error({ err, plan, orgId }, "[Store] Failed to persist plan to org_settings"); })
        .finally(() => client.release())
    ).catch(err => { logger.error({ err }, "[Store] Pool connect failed for plan persist"); });
  }

  async refresh(orgId = "default"): Promise<void> {
    try {
      const client = await pool.connect();
      try {
        const row = await client.query(
          `SELECT plan, email, name, trial_ends_at, subscription_status, stripe_customer_id
           FROM org_settings WHERE org_id = $1 LIMIT 1`,
          [orgId]
        );
        if (row.rows[0]) {
          this.me.plan = row.rows[0].plan ?? "pro";
          this.me.email = row.rows[0].email;
          this.me.name = row.rows[0].name;
          this.me.trialEndsAt = row.rows[0].trial_ends_at;
          if (row.rows[0].subscription_status) this.me.subscriptionStatus = row.rows[0].subscription_status;
          if (row.rows[0].stripe_customer_id)  this.me.stripeCustomerId  = row.rows[0].stripe_customer_id;
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

  /**
   * Fetch activity events with SQL-level filtering and pagination.
   * Always returns an array for backward compatibility with the frontend.
   * Deterministic order: created_at DESC, id DESC.
   */
  async getFilteredActivity(opts: {
    limit: number;
    offset: number;
    type?: string;
  }): Promise<ActivityLog[]> {
    const { limit, offset, type } = opts;
    try {
      const client = await pool.connect();
      try {
        const values: unknown[] = [limit, offset];
        let where = "";
        if (type) {
          values.push(type);
          where = `WHERE type = $${values.length}`;
        }
        const r = await client.query(
          `SELECT id, type, label,
                  target_id   AS "targetId",
                  target_type AS "targetType",
                  metadata,
                  created_at  AS "createdAt"
           FROM activity_logs
           ${where}
           ORDER BY created_at DESC, id DESC
           LIMIT $1 OFFSET $2`,
          values
        );
        return r.rows;
      } finally {
        client.release();
      }
    } catch {
      return [];
    }
  }

  /** @deprecated Prefer getFilteredActivity — kept for any legacy internal callers */
  async getRecentActivity(limit: number): Promise<ActivityLog[]> {
    return this.getFilteredActivity({ limit, offset: 0 });
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
