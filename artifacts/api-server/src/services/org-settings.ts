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
  /** Set by Stripe webhook when the first real trialing subscription is created. NULL = no real trial ever started. */
  trialConsumedAt: string | null;
  /** Same timestamp as trialConsumedAt — kept separately for analytics. */
  trialStartedAt: string | null;
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
  vat: string | null;
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
/**
 * CLE CANONIQUE DE org_settings
 *
 * org_settings est clee par org_id, mais deux cles coexistent pour une meme
 * organisation : l'UUID de `organizations` et, pour les comptes crees avant
 * l'existence de cet UUID, l'adresse e-mail. L'activation de compte ecrit
 * d'ailleurs explicitement les deux ("we write TWICE … so the address is found
 * regardless of which key is used"), puis les deux lignes derivent : tout
 * upsert ulterieur par UUID (dashboard, /me, localisation) laisse la ligne
 * e-mail figee, tandis que les chemins OAuth/SSO ecrivent par e-mail.
 *
 * Divergences mesurees sur une organisation reelle :
 *   - ligne e-mail : plan standard, statut canceled, ville Paris, adresse
 *   - ligne UUID   : plan pro,      statut active,   ville NULL, adresse NULL
 * L'adresse saisie a l'inscription etait donc invisible du chemin principal,
 * et le plan lu par un chemin encore clee e-mail (repli « session legacy » de
 * planGate) etait perime.
 *
 * Correction de la cause : toute cle non-UUID est resolue vers l'UUID de
 * l'organisation quand elle existe. Les lectures et les ecritures visent
 * alors une seule ligne. AUCUNE donnee client n'est fusionnee ni supprimee :
 * la ligne legacy reste en place, et la lecture la consulte uniquement pour
 * completer les champs restes vides sur la ligne canonique — completion en
 * memoire, jamais ecrite.
 */
const ORG_SETTINGS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Colonnes qui identifient la ligne ou tracent son cycle de vie : jamais completees. */
const ORG_SETTINGS_IDENTITY_COLS = new Set(["org_id", "created_at", "updated_at"]);

/**
 * Resout la cle canonique (UUID de l'organisation) pour un org_id donne.
 * Retourne l'org_id inchange quand il est deja un UUID, quand aucune
 * organisation ne correspond (fenetre avant creation du compte), ou en cas
 * d'erreur de lecture — la resolution ne doit jamais faire echouer un acces.
 */
export async function canonicalOrgSettingsKey(
  orgId: string,
  client: PoolClient,
): Promise<string> {
  if (!orgId || orgId === "default" || ORG_SETTINGS_UUID_RE.test(orgId)) return orgId;
  try {
    const r = await client.query(
      `SELECT id::text AS id FROM organizations WHERE owner_email = $1 LIMIT 1`,
      [orgId],
    );
    const found = r.rows[0] as { id?: string } | undefined;
    return found?.id ?? orgId;
  } catch (err) {
    logger.debug({ err, orgId }, "[org-settings] resolution de cle canonique impossible — cle inchangee");
    return orgId;
  }
}

/**
 * Cle legacy (e-mail) correspondant a une cle canonique UUID, quand une ligne
 * org_settings existe sous cette cle. Sert uniquement a completer une lecture :
 * le chemin principal lit par UUID, et l'adresse saisie a l'inscription peut
 * n'exister que sous la cle e-mail.
 */
async function legacyOrgSettingsKey(
  orgId: string,
  client: PoolClient,
): Promise<string | null> {
  if (!ORG_SETTINGS_UUID_RE.test(orgId)) return null;
  try {
    const r = await client.query(
      `SELECT o.owner_email::text AS email
         FROM organizations o
         JOIN org_settings s ON s.org_id = o.owner_email
        WHERE o.id::text = $1 LIMIT 1`,
      [orgId],
    );
    const found = r.rows[0] as { email?: string } | undefined;
    return found?.email ?? null;
  } catch (err) {
    logger.debug({ err, orgId }, "[org-settings] resolution de cle legacy impossible");
    return null;
  }
}

export async function loadOrgSettings(
  orgId = "default",
  clientOverride?: PoolClient,
): Promise<OrgSettings | null> {
  const ownClient = !clientOverride;
  const client: PoolClient = clientOverride ?? (await pool.connect() as unknown as PoolClient);
  try {
    const canonicalKey = await canonicalOrgSettingsKey(orgId, client);
    const res = await client.query(
      `SELECT * FROM org_settings WHERE org_id = $1 LIMIT 1`,
      [canonicalKey],
    );
    let r = res.rows[0];

    // Ligne legacy clee autrement (e-mail) : elle n'est NI fusionnee NI
    // supprimee. Elle sert uniquement a completer, en memoire, les champs
    // restes vides sur la ligne canonique — sinon l'adresse saisie a
    // l'inscription resterait invisible du chemin principal.
    // Cle de la ligne legacy : l'org_id d'origine quand il n'etait pas un UUID,
    // sinon l'e-mail proprietaire de l'organisation (le chemin principal lit
    // par UUID, et l'adresse d'inscription peut n'exister que sous l'e-mail).
    const legacyKey = canonicalKey !== orgId
      ? orgId
      : await legacyOrgSettingsKey(orgId, client);

    if (legacyKey && legacyKey !== canonicalKey) {
      const legacy = await client.query(
        `SELECT * FROM org_settings WHERE org_id = $1 LIMIT 1`,
        [legacyKey],
      );
      const lr = legacy.rows[0];
      if (lr) {
        if (!r) {
          // Pas encore de ligne canonique : on sert la ligne legacy telle quelle.
          logger.info({ orgId, canonicalKey, legacyKey },
            "[org-settings] aucune ligne canonique — lecture de la ligne legacy");
          r = lr;
        } else {
          const completed: string[] = [];
          for (const [col, val] of Object.entries(lr)) {
            if (ORG_SETTINGS_IDENTITY_COLS.has(col)) continue;
            if ((r[col] === null || r[col] === undefined) && val !== null && val !== undefined) {
              r[col] = val;
              completed.push(col);
            }
          }
          if (completed.length > 0) {
            // Divergence a reconcilier manuellement : aucune ecriture ici.
            logger.warn({ orgId, canonicalKey, legacyKey, completed },
              "[org-settings] lignes divergentes — champs completes en lecture depuis la ligne legacy (aucune fusion ecrite)");
          }
        }
      }
    }

    if (!r) {
      logger.debug({ orgId, canonicalKey }, "[org-settings] loadOrgSettings — no row found, returning null");
      return null;
    }
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
      trialConsumedAt: r.trial_consumed_at ?? null,
      trialStartedAt: r.trial_started_at ?? null,
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
      vat:   r.vat   ?? null,
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
    // Ecriture sur la cle CANONIQUE : sans cela, un upsert par e-mail et un
    // upsert par UUID alimentent deux lignes qui derivent ensuite.
    const canonicalKey = await canonicalOrgSettingsKey(orgId, client);
    if (canonicalKey !== orgId) {
      logger.info({ orgId, canonicalKey },
        "[org-settings] upsert redirige vers la cle canonique de l'organisation");
    }
    orgId = canonicalKey;

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
      [data.vat,                  "vat"],
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
    if (data.trialConsumedAt !== undefined && data.trialConsumedAt !== null) {
      sets.push(`trial_consumed_at = $${n++}::timestamptz`);
      vals.push(data.trialConsumedAt);
    }
    if (data.trialStartedAt !== undefined && data.trialStartedAt !== null) {
      sets.push(`trial_started_at = $${n++}::timestamptz`);
      vals.push(data.trialStartedAt);
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
