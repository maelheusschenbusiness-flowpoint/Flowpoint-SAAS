import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { stableId } from "../../lib/stable-id.js";
import { getCrmLimit } from "../crm-service.js";
import { CrmProviderError, type CrmProviderAdapter, type CrmContact } from "./adapter.js";
import { decryptCrmToken, encryptCrmToken } from "./token-crypto.js";

export const CRM_STATE_TTL_MINUTES = 10;
const SYNC_PAGE_SIZE = 100;
const SYNC_MAX_PAGES = 20;
const SYNC_LOCK_MINUTES = 15;

export class CrmError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus = 400) {
    super(message);
    this.name = "CrmError";
  }
}

export function crmRedirectUri(provider: string): string {
  const explicit = process.env["CRM_OAUTH_REDIRECT_BASE"];
  const base = explicit ?? process.env["RENDER_EXTERNAL_URL"] ?? process.env["PUBLIC_URL"] ?? process.env["FRONTEND_URL"] ?? "https://app.flowpoint.pro";
  return `${base.replace(/\/+$/, "")}/api/crm/oauth/${provider}/callback`;
}

const hashState = (state: string): string => createHash("sha256").update(state).digest("hex");

/** Nombre d'integrations connectees, hors le fournisseur demande (reconnexion = pas de nouveau slot). */
async function connectedCountExcluding(orgId: string, provider: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM crm_integrations WHERE org_id=$1 AND status='connected' AND provider<>$2`,
    [orgId, provider],
  );
  return Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

async function assertQuota(orgId: string, provider: string, plan: string): Promise<void> {
  if ((await connectedCountExcluding(orgId, provider)) >= getCrmLimit(plan)) {
    throw new CrmError("CRM_LIMIT_REACHED", "CRM integration limit reached for this plan.", 403);
  }
}

/** Etape 1 : etat aleatoire 256 bits, stocke haché, a usage unique, lie a l'organisation. */
export async function startCrmOAuth(orgId: string, plan: string, adapter: CrmProviderAdapter): Promise<{ url: string; redirectUri: string; state: string }> {
  if (!adapter.isConfigured()) throw new CrmError("CRM_PROVIDER_NOT_CONFIGURED", "This CRM provider is not configured.", 503);
  encryptCrmToken("configuration-check"); // echec ferme si la cle de chiffrement est absente
  await assertQuota(orgId, adapter.id, plan);
  const state = randomBytes(32).toString("hex");
  await pool.query(`DELETE FROM crm_oauth_states WHERE expires_at < NOW()`);
  await pool.query(
    `INSERT INTO crm_oauth_states (state_hash, org_id, provider, expires_at)
     VALUES ($1,$2,$3,NOW() + $4::int * INTERVAL '1 minute')`,
    [hashState(state), orgId, adapter.id, CRM_STATE_TTL_MINUTES],
  );
  const redirectUri = crmRedirectUri(adapter.id);
  return { url: adapter.buildAuthUrl(state, redirectUri), redirectUri, state };
}

/** Consomme l'etat (usage unique, expiration, fournisseur identique) -> organisation, sinon null. */
export async function consumeCrmState(state: string, provider: string): Promise<string | null> {
  if (!/^[a-f\d]{64}$/i.test(state)) return null;
  const r = await pool.query(
    `DELETE FROM crm_oauth_states WHERE state_hash=$1 AND provider=$2 AND expires_at > NOW() RETURNING org_id`,
    [hashState(state), provider],
  );
  return (r.rows[0] as { org_id?: string } | undefined)?.org_id ?? null;
}

/** Etape 2 : echange du code, quota revalide, jetons chiffres. Retourne l'id d'integration. */
export async function completeCrmOAuth(
  adapter: CrmProviderAdapter, orgId: string, plan: string, code: string,
): Promise<string> {
  await assertQuota(orgId, adapter.id, plan);
  const tokens = await adapter.exchangeCode(code, crmRedirectUri(adapter.id));
  const id = stableId("crm", orgId, adapter.id);
  // Verification du quota ET ecriture dans une transaction verrouillee par organisation :
  // deux callbacks simultanes ne peuvent pas depasser la limite du plan.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`crm-quota:${orgId}`]);
    const used = await client.query(
      `SELECT COUNT(*)::int AS n FROM crm_integrations WHERE org_id=$1 AND status='connected' AND provider<>$2`,
      [orgId, adapter.id],
    );
    if (Number((used.rows[0] as { n?: number }).n ?? 0) >= getCrmLimit(plan)) {
      throw new CrmError("CRM_LIMIT_REACHED", "CRM integration limit reached for this plan.", 403);
    }
    await client.query(
      `INSERT INTO crm_integrations
         (id, org_id, provider, name, status, access_token, refresh_token, token_expires_at, portal_id, scope, connected_at, updated_at)
       VALUES ($1,$2,$3,$3,'connected',$4,$5,NOW() + $6::int * INTERVAL '1 second',$7,$8,NOW(),NOW())
       ON CONFLICT (org_id, provider) DO UPDATE SET
         status='connected', access_token=$4, refresh_token=$5,
         token_expires_at=EXCLUDED.token_expires_at, portal_id=$7, scope=$8, updated_at=NOW()`,
      [id, orgId, adapter.id, encryptCrmToken(tokens.accessToken), encryptCrmToken(tokens.refreshToken),
        tokens.expiresInSeconds, tokens.accountId ?? null, tokens.scope ?? null],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  logger.info({ event: "crm_connected", provider: adapter.id }, "[crm] integration connected");
  return id;
}

/** Deconnexion : revocation chez le fournisseur (au mieux), puis jetons effaces localement dans tous les cas. */
export async function disconnectCrmIntegration(adapter: CrmProviderAdapter, orgId: string): Promise<void> {
  const r = await pool.query(`SELECT refresh_token FROM crm_integrations WHERE org_id=$1 AND provider=$2`, [orgId, adapter.id]);
  const stored = (r.rows[0] as { refresh_token?: string | null } | undefined)?.refresh_token;
  if (stored && adapter.revoke) {
    try { await adapter.revoke(decryptCrmToken(stored)); }
    catch (error) { logger.warn({ event: "crm_revoke_failed", provider: adapter.id, code: (error as { code?: string }).code }, "[crm] provider revocation failed"); }
  }
  await pool.query(
    `UPDATE crm_integrations SET status='disconnected', access_token=NULL, refresh_token=NULL, updated_at=NOW() WHERE org_id=$1 AND provider=$2`,
    [orgId, adapter.id],
  );
}

interface IntegrationRow {
  id: string; access_token: string | null; refresh_token: string | null; token_expires_at: Date | null; status: string;
}

/** Jeton d'acces valide : rafraichi (et re-chiffre) s'il expire dans moins d'une minute. */
export async function getValidCrmToken(adapter: CrmProviderAdapter, orgId: string): Promise<{ integrationId: string; accessToken: string }> {
  const r = await pool.query(
    `SELECT id, access_token, refresh_token, token_expires_at, status FROM crm_integrations WHERE org_id=$1 AND provider=$2`,
    [orgId, adapter.id],
  );
  const row = r.rows[0] as IntegrationRow | undefined;
  if (!row || row.status !== "connected" || !row.access_token || !row.refresh_token) {
    throw new CrmError("CRM_NOT_CONNECTED", "This CRM is not connected.", 409);
  }
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() > Date.now() + 60_000) {
    return { integrationId: row.id, accessToken: decryptCrmToken(row.access_token) };
  }
  try {
    const fresh = await adapter.refresh(decryptCrmToken(row.refresh_token));
    await pool.query(
      `UPDATE crm_integrations SET access_token=$3, refresh_token=$4,
         token_expires_at=NOW() + $5::int * INTERVAL '1 second', updated_at=NOW()
       WHERE org_id=$1 AND provider=$2`,
      [orgId, adapter.id, encryptCrmToken(fresh.accessToken), encryptCrmToken(fresh.refreshToken), fresh.expiresInSeconds],
    );
    return { integrationId: row.id, accessToken: fresh.accessToken };
  } catch (error) {
    if (error instanceof CrmProviderError && (error.status === 400 || error.status === 401 || error.status === 403)) {
      // 429 / 5xx : panne transitoire, les jetons sont conserves.
      // Refresh refuse (revocation) : jetons effaces, reconnexion exigee.
      await pool.query(
        `UPDATE crm_integrations SET status='reauth_required', access_token=NULL, refresh_token=NULL, updated_at=NOW() WHERE org_id=$1 AND provider=$2`,
        [orgId, adapter.id],
      );
      throw new CrmError("CRM_REAUTH_REQUIRED", "CRM authorization expired: reconnect the CRM.", 409);
    }
    throw error;
  }
}

async function upsertContact(orgId: string, provider: string, c: CrmContact): Promise<"created" | "updated"> {
  const r = await pool.query(
    `INSERT INTO crm_contacts (id, org_id, provider, external_id, name, email, phone, status, source, external_updated_at, synced_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$3,$9,NOW(),NOW())
     ON CONFLICT (org_id, provider, external_id) DO UPDATE SET
       name=EXCLUDED.name, email=EXCLUDED.email, phone=EXCLUDED.phone, status=EXCLUDED.status,
       external_updated_at=EXCLUDED.external_updated_at, synced_at=NOW()
     RETURNING (xmax = 0) AS inserted`,
    [stableId("crmc", orgId, provider, c.externalId), orgId, provider, c.externalId, c.name, c.email, c.phone, c.status, c.updatedAt],
  );
  return (r.rows[0] as { inserted: boolean }).inserted ? "created" : "updated";
}

export interface CrmSyncResult { ok: boolean; created: number; updated: number; failed: number; durationMs: number; truncated: boolean }

/** Synchronisation de contacts : bornee, idempotente (cle org+provider+external_id), verrouillee, journalisee. */
export async function syncCrmContacts(adapter: CrmProviderAdapter, orgId: string): Promise<CrmSyncResult> {
  const { integrationId, accessToken } = await getValidCrmToken(adapter, orgId);
  const logId = stableId("crmlog", orgId, integrationId, randomBytes(8).toString("hex"));
  const started = Date.now();
  // Les verrous orphelins (processus interrompu) sont liberes ; un index unique partiel
  // garantit ensuite UNE seule synchronisation `running` par integration, sans course.
  await pool.query(
    `UPDATE crm_sync_logs SET status='failed', error='CRM_SYNC_STALE', completed_at=NOW()
      WHERE org_id=$1 AND crm_integration_id=$2 AND status='running' AND started_at <= NOW() - $3::int * INTERVAL '1 minute'`,
    [orgId, integrationId, SYNC_LOCK_MINUTES],
  );
  try {
    await pool.query(
      `INSERT INTO crm_sync_logs (id, org_id, crm_integration_id, provider, direction, entity_type, status, started_at)
       VALUES ($1,$2,$3,$4,'import','contacts','running',NOW())`,
      [logId, orgId, integrationId, adapter.id],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new CrmError("CRM_SYNC_IN_PROGRESS", "A synchronization is already in progress.", 409);
    throw error;
  }
  let created = 0, updated = 0, failed = 0, truncated = false;
  let status = "success";
  let errorCode: string | null = null;
  try {
    let cursor: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= SYNC_MAX_PAGES) { truncated = true; break; }
      const result = await adapter.fetchContacts(accessToken, cursor, SYNC_PAGE_SIZE);
      for (const contact of result.contacts) {
        try {
          if ((await upsertContact(orgId, adapter.id, contact)) === "created") created++; else updated++;
        } catch { failed++; }
      }
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    if (failed > 0) status = "partial";
  } catch (error) {
    status = "failed";
    errorCode = error instanceof CrmProviderError ? error.code : "CRM_SYNC_FAILED";
    if (errorCode === "CRM_UNAUTHORIZED") {
      // Jeton rejete avant son expiration (acces revoque chez le fournisseur) : reconnexion exigee.
      await pool.query(
        `UPDATE crm_integrations SET status='reauth_required', access_token=NULL, refresh_token=NULL, updated_at=NOW() WHERE org_id=$1 AND provider=$2`,
        [orgId, adapter.id],
      );
    }
    logger.warn({ event: "crm_sync_failed", provider: adapter.id, code: errorCode }, "[crm] sync failed");
  }
  const durationMs = Date.now() - started;
  await pool.query(
    `UPDATE crm_sync_logs SET status=$2, count=$3, records_processed=$3, records_created=$4, records_updated=$5,
       records_failed=$6, duration_ms=$7, error=$8, completed_at=NOW() WHERE id=$1 AND org_id=$9`,
    [logId, status, created + updated + failed, created, updated, failed, durationMs, errorCode, orgId],
  );
  await pool.query(
    `UPDATE crm_integrations SET last_sync_at=NOW(), last_sync_status=$3,
       synced_contacts=(SELECT COUNT(*) FROM crm_contacts WHERE org_id=$1 AND provider=$2), updated_at=NOW()
     WHERE org_id=$1 AND provider=$2`,
    [orgId, adapter.id, status],
  );
  if (errorCode === "CRM_UNAUTHORIZED") throw new CrmError("CRM_REAUTH_REQUIRED", "CRM authorization expired: reconnect the CRM.", 409);
  if (status === "failed") throw new CrmError(errorCode ?? "CRM_SYNC_FAILED", "CRM synchronization failed.", 502);
  return { ok: true, created, updated, failed, durationMs, truncated };
}

/** Webhook authentifie : deduplication par evenement, rattachement a l'organisation via le portail. */
export async function processCrmWebhook(
  adapter: CrmProviderAdapter, events: ReturnType<CrmProviderAdapter["parseWebhook"]>,
): Promise<{ processed: number; duplicates: number; ignored: number; retry: number }> {
  let processed = 0, duplicates = 0, ignored = 0, retry = 0;
  for (const event of events) {
    if (!event.portalId) { ignored++; continue; }
    const owner = await pool.query(
      `SELECT org_id FROM crm_integrations WHERE provider=$1 AND portal_id=$2 AND status='connected' LIMIT 2`,
      [adapter.id, event.portalId],
    );
    // Portail inconnu ou ambigu (rattache a plusieurs organisations) : on ignore, jamais de deduction.
    if (owner.rows.length !== 1) { ignored++; continue; }
    const orgId = String((owner.rows[0] as { org_id: string }).org_id);
    const fresh = await pool.query(
      `INSERT INTO crm_webhook_events (provider, event_id, org_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1`,
      [adapter.id, event.eventId, orgId],
    );
    if (fresh.rows.length === 0) { duplicates++; continue; }
    if (event.contactExternalId) {
      try {
        const { accessToken } = await getValidCrmToken(adapter, orgId);
        const contact = await adapter.fetchContact(accessToken, event.contactExternalId);
        if (contact) await upsertContact(orgId, adapter.id, contact);
      } catch (error) {
        // Evenement non traite : on le "libere" pour que la relivraison du fournisseur soit rejouee.
        await pool.query(`DELETE FROM crm_webhook_events WHERE provider=$1 AND event_id=$2 AND org_id=$3`, [adapter.id, event.eventId, orgId]);
        retry++;
        continue;
        logger.warn({ event: "crm_webhook_fetch_failed", provider: adapter.id, code: (error as { code?: string }).code }, "[crm] webhook contact refresh failed");
      }
    }
    processed++;
  }
  return { processed, duplicates, ignored, retry };
}
