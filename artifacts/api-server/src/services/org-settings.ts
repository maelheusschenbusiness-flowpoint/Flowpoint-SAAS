import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

// Structural interface covering the pg PoolClient operations used in this module.
// We cannot import PoolClient from "pg" directly because pg lives in @workspace/db's
// private node_modules (not hoisted).  Using Awaited<ReturnType<typeof pool.connect>>
// is also broken: TypeScript picks the callback overload of Pool.connect() → void.
interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(queryText: string, values?: any[]): Promise<{ rows: any[]; rowCount: number | null }>;
  release(err?: boolean | Error): void;
}
type PoolClient = DbClient;

export interface OrgSettings {
  orgId: string;
  plan: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  orgName: string | null;
  website: string | null;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  trialEndsAt: string | null;
  addons: Record<string, unknown>;
  usage: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  region: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  serviceArea: string[];
  locationConfigured: boolean;
  locationSource: string | null;
  timezone: string | null;
  language: string | null;
  currency: string | null;
  dateFormat: string | null;
  timeFormat: string | null;
  pendingPlan: string | null;
  pendingPlanDate: string | null;
}

/**
 * Load org settings for the given orgId.
 *
 * @param orgId          — org_settings primary key (default: "default")
 * @param clientOverride — optional shared PoolClient; when provided the caller owns the
 *                         connection lifecycle (no connect/release performed here).
 *                         Used by ensure-stripe-customer to keep all critical operations
 *                         on a single connection inside one BEGIN/COMMIT transaction
 *                         so pg_advisory_xact_lock is held for the full duration.
 */
export async function loadOrgSettings(
  orgId = "default",
  clientOverride?: PoolClient,
): Promise<OrgSettings | null> {
  const ownClient = !clientOverride;
  const client: PoolClient = clientOverride ?? (await pool.connect() as unknown as PoolClient);
  try {
    const res = await client.query(
      `SELECT * FROM org_settings WHERE org_id = $1 LIMIT 1`,
      [orgId],
    );
    if (!res.rows[0]) return null;
    const r = res.rows[0];
    return {
      orgId: r.org_id,
      plan: r.plan ?? "standard",
      email: r.email ?? null,
      firstName: r.first_name ?? null,
      lastName: r.last_name ?? null,
      orgName: r.org_name ?? null,
      website: r.website ?? null,
      subscriptionStatus: r.subscription_status ?? null,
      stripeCustomerId: r.stripe_customer_id ?? null,
      stripeSubscriptionId: r.stripe_subscription_id ?? null,
      trialEndsAt: r.trial_ends_at ?? null,
      addons: r.addons ?? {},
      usage: r.usage ?? {},
      createdAt: r.created_at ?? new Date().toISOString(),
      updatedAt: r.updated_at ?? new Date().toISOString(),
      address: r.address ?? null,
      city: r.city ?? null,
      postalCode: r.postal_code ?? null,
      country: r.country ?? null,
      region: r.region ?? null,
      phone: r.phone ?? null,
      latitude: r.latitude != null ? parseFloat(r.latitude) : null,
      longitude: r.longitude != null ? parseFloat(r.longitude) : null,
      serviceArea: Array.isArray(r.service_area)
        ? r.service_area
        : r.service_area
          ? JSON.parse(r.service_area)
          : [],
      locationConfigured: r.location_configured ?? false,
      locationSource: r.location_source ?? null,
      timezone: r.timezone ?? null,
      language: r.language ?? null,
      currency: r.currency ?? null,
      dateFormat: r.date_format ?? null,
      timeFormat: r.time_format ?? null,
      pendingPlan: r.pending_plan ?? null,
      pendingPlanDate: r.pending_plan_date ?? null,
    };
  } catch (err) {
    logger.debug({ err }, "[org-settings] loadOrgSettings failed");
    return null;
  } finally {
    if (ownClient) client.release();
  }
}

/**
 * Upsert org_settings using two separate queries to avoid PostgreSQL type-inference
 * issues with multi-param CASE/COALESCE expressions across mixed column types.
 *
 * Step 1 — Ensure the row exists with safe NOT NULL defaults (INSERT ON CONFLICT DO NOTHING).
 * Step 2 — UPDATE only the columns that were explicitly provided (non-null in `data`).
 *           Each column gets its own typed bind parameter, so pg can resolve types trivially.
 *
 * @param clientOverride — optional shared PoolClient (same contract as loadOrgSettings).
 *                         When provided, the confirm-read at the end uses the same client
 *                         so it sees uncommitted writes from the same transaction.
 */
export async function upsertOrgSettings(
  orgId: string,
  data: Partial<Omit<OrgSettings, "orgId" | "createdAt" | "updatedAt">>,
  clientOverride?: PoolClient,
): Promise<OrgSettings> {
  const ownClient = !clientOverride;
  const client: PoolClient = clientOverride ?? (await pool.connect() as unknown as PoolClient);
  try {
    // ── Step 1: guarantee row exists ─────────────────────────────────────────
    await client.query(
      `INSERT INTO org_settings (org_id)
       VALUES ($1)
       ON CONFLICT (org_id) DO NOTHING`,
      [orgId],
    );

    // ── Step 2: update only provided fields ──────────────────────────────────
    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;

    // text columns (plain text, no cast needed)
    const textCols: Array<[string | null | undefined, string]> = [
      [data.firstName,            "first_name"],
      [data.lastName,             "last_name"],
      [data.orgName,              "org_name"],
      [data.email,                "email"],
      [data.website,              "website"],
      [data.plan,                 "plan"],
      [data.subscriptionStatus,   "subscription_status"],
      [data.stripeCustomerId,     "stripe_customer_id"],
      [data.stripeSubscriptionId, "stripe_subscription_id"],
      [data.address,              "address"],
      [data.city,                 "city"],
      [data.postalCode,           "postal_code"],
      [data.country,              "country"],
      [data.region,               "region"],
      [data.phone,                "phone"],
      [data.locationSource,       "location_source"],
      [data.timezone,             "timezone"],
      [data.language,             "language"],
      [data.currency,             "currency"],
      [data.dateFormat,           "date_format"],
      [data.timeFormat,           "time_format"],
    ];
    for (const [val, col] of textCols) {
      if (val !== undefined && val !== null) {
        sets.push(`${col} = $${n++}`);
        vals.push(val);
      }
    }

    // nullable text columns — undefined = skip; null = SET col = NULL; string = SET col = value
    const nullableTextCols: Array<[string | null | undefined, string]> = [
      [data.pendingPlan,     "pending_plan"],
      [data.pendingPlanDate, "pending_plan_date"],
    ];
    for (const [val, col] of nullableTextCols) {
      if (val !== undefined) {
        if (val === null) {
          sets.push(`${col} = NULL`);
        } else {
          sets.push(`${col} = $${n++}`);
          vals.push(val);
        }
      }
    }

    // timestamptz
    if (data.trialEndsAt !== undefined && data.trialEndsAt !== null) {
      sets.push(`trial_ends_at = $${n++}::timestamptz`);
      vals.push(data.trialEndsAt);
    }

    // jsonb
    if (data.addons !== undefined && data.addons !== null) {
      sets.push(`addons = $${n++}::jsonb`);
      vals.push(JSON.stringify(data.addons));
    }
    if (data.usage !== undefined && data.usage !== null) {
      sets.push(`usage = $${n++}::jsonb`);
      vals.push(JSON.stringify(data.usage));
    }
    if (data.serviceArea !== undefined && data.serviceArea !== null) {
      sets.push(`service_area = $${n++}::jsonb`);
      vals.push(JSON.stringify(data.serviceArea));
    }

    // numeric
    if (data.latitude !== undefined && data.latitude !== null) {
      sets.push(`latitude = $${n++}::numeric`);
      vals.push(data.latitude);
    }
    if (data.longitude !== undefined && data.longitude !== null) {
      sets.push(`longitude = $${n++}::numeric`);
      vals.push(data.longitude);
    }

    // boolean
    if (data.locationConfigured !== undefined && data.locationConfigured !== null) {
      sets.push(`location_configured = $${n++}::boolean`);
      vals.push(data.locationConfigured);
    }

    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      await client.query(
        `UPDATE org_settings SET ${sets.join(", ")} WHERE org_id = $${n}`,
        [...vals, orgId],
      );
    }

    // Pass the shared client so the confirm-read sees the uncommitted write
    // when called inside a transaction (e.g., from ensure-stripe-customer).
    return (await loadOrgSettings(orgId, client))!;
  } catch (err) {
    logger.error({ err }, "[org-settings] upsertOrgSettings failed");
    throw err;
  } finally {
    if (ownClient) client.release();
  }
}
