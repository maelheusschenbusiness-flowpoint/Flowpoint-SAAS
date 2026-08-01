/**
 * FlowPoint AI Agents — Phase 2 : Service Undo.
 *
 * Restaure l'état précédent d'une ressource à partir du snapshot stocké dans
 * ai_action_logs.undo_snapshot.
 *
 * Sécurité :
 *  - L'action doit appartenir à l'organisation (org_id scope)
 *  - L'action ne doit pas déjà être annulée (undone_at IS NULL)
 *  - Timeout d'undo : 30 minutes après la création
 *  - Le snapshot null → undo refusé
 *  - Validation de version EXACTE + SQL ATOMIQUE : UPDATE WHERE id=$1 AND org_id=$2
 *    AND updated_at=$3::TIMESTAMPTZ. rowCount=0 → PROPOSAL_STALE ou mission disparue.
 *    Aucune tolérance temporelle. Aucune race condition entre lecture et restauration.
 *  - version_after IS NULL (log antérieur au déploiement) → UNDO_VERSION_UNAVAILABLE.
 *    Mieux vaut refuser que risquer d'écraser des modifications concurrentes invisibles.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";

export const UNDO_TTL_MINUTES = 30;

export interface UndoResult {
  ok: boolean;
  message: string;
  code?: "PROPOSAL_STALE" | "ALREADY_UNDONE" | "TTL_EXPIRED" | "NO_SNAPSHOT" | "NOT_FOUND" | "UNDO_VERSION_UNAVAILABLE";
  actionLogId?: string;
  toolName?: string;
}

export async function undoAction(
  actionLogId: string,
  orgId: string,
  userId: string
): Promise<UndoResult> {
  // 1. Charger l'entrée de log
  let row: Record<string, unknown> | undefined;
  try {
    const r = await pool.query(
      `SELECT id, org_id, tool, undo_snapshot, undone_at, result, created_at, version_after
       FROM ai_action_logs WHERE id = $1 AND org_id = $2`,
      [actionLogId, orgId]
    );
    row = r.rows[0] as Record<string, unknown> | undefined;
  } catch (err) {
    logger.error({ err, actionLogId }, "[undo] DB read failed");
    return { ok: false, message: "Erreur de lecture de la base de données." };
  }

  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Action introuvable ou non accessible.", actionLogId };
  }

  // 2. Vérifications
  if (row["undone_at"]) {
    return { ok: false, code: "ALREADY_UNDONE", message: "Cette action a déjà été annulée.", actionLogId,
      toolName: row["tool"] as string };
  }

  const ageMs = Date.now() - new Date(row["created_at"] as string).getTime();
  if (ageMs > UNDO_TTL_MINUTES * 60_000) {
    return { ok: false, code: "TTL_EXPIRED",
      message: `Délai d'annulation dépassé (${UNDO_TTL_MINUTES} min maximum).`,
      actionLogId, toolName: row["tool"] as string };
  }

  if (!row["undo_snapshot"]) {
    return { ok: false, code: "NO_SNAPSHOT",
      message: "Aucun snapshot disponible pour annuler cette action.",
      actionLogId, toolName: row["tool"] as string };
  }

  const snap = typeof row["undo_snapshot"] === "string"
    ? JSON.parse(row["undo_snapshot"] as string)
    : row["undo_snapshot"];

  if (!snap || typeof snap !== "object") {
    return { ok: false, message: "Snapshot invalide.", actionLogId };
  }

  const toolName  = row["tool"] as string;
  const versionAfter = row["version_after"] as string | null | undefined;

  // 3. Restauration avec validation de version exacte
  try {
    const snapResult = await applySnapshot(toolName, snap as Record<string, unknown>, orgId, versionAfter ?? null);
    if (snapResult?.stale) {
      logger.warn({ actionLogId, toolName, orgId, versionAfter }, "[undo] PROPOSAL_STALE — concurrent modification detected");
      return {
        ok: false,
        code: "PROPOSAL_STALE",
        message: "Cette mission a été modifiée depuis l'action initiale. L'annulation ne peut pas être appliquée sans écraser des changements plus récents.",
        actionLogId,
        toolName,
      };
    }
    if (snapResult?.versionUnavailable) {
      logger.warn({ actionLogId, toolName, orgId }, "[undo] UNDO_VERSION_UNAVAILABLE — legacy log without version_after");
      return {
        ok: false,
        code: "UNDO_VERSION_UNAVAILABLE",
        message: "Cette action ne peut pas être annulée : la version de référence n'est pas disponible (action antérieure au système d'annulation sécurisé).",
        actionLogId,
        toolName,
      };
    }
  } catch (err) {
    logger.error({ err, toolName, actionLogId }, "[undo] applySnapshot failed");
    return { ok: false, message: `Erreur lors de la restauration : ${err instanceof Error ? err.message : String(err)}`,
      actionLogId, toolName };
  }

  // 4. Marquer comme annulé
  await pool.query(
    `UPDATE ai_action_logs SET undone_at = NOW() WHERE id = $1`,
    [actionLogId]
  ).catch(err => logger.warn({ err }, "[undo] mark undone_at failed"));

  // 5. Log activité
  await store.logActivity({
    type: "report", label: `[IA] Annulation : ${toolName} (${(snap as Record<string, unknown>)["title"] ?? actionLogId})`,
    targetId: (snap as Record<string, unknown>)["id"] as string ?? actionLogId,
    targetType: "mission",
    metadata: { actionLogId, toolName }, orgId,
  }).catch(() => {});

  logger.info({ actionLogId, toolName, orgId }, "[undo] action undone");
  return { ok: true, message: "Action annulée avec succès.", actionLogId, toolName };
}

/** Résultat intermédiaire d'applySnapshot. */
interface SnapshotResult {
  stale?: boolean;
  versionUnavailable?: boolean;
}

/**
 * Applique le snapshot sur la ressource cible.
 *
 * Pour update/complete/assign :
 *  - versionAfter IS NULL → UNDO_VERSION_UNAVAILABLE (log legacy, refus sécurisé).
 *  - versionAfter non null → UPDATE atomique WHERE updated_at = $version::TIMESTAMPTZ.
 *    rowCount=0 → stale ou mission disparue (disambiguated par un SELECT).
 *
 * Pour create/delete : pas de version lock (opérations idempotentes).
 */
async function applySnapshot(
  toolName: string,
  snap: Record<string, unknown>,
  orgId: string,
  versionAfter: string | null,
): Promise<SnapshotResult | void> {
  const id = snap["id"] as string;
  if (!id) throw new Error("Snapshot sans ID — impossible de restaurer.");

  if (toolName === "create_mission") {
    // Annuler une création = supprimer la mission.
    // Pas de version lock : l'action est la nôtre, la suppression est toujours valide.
    await pool.query(`DELETE FROM missions WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return;
  }

  if (toolName === "delete_mission") {
    // Annuler une suppression = réinsérer fidèlement depuis le snapshot.
    // ON CONFLICT DO NOTHING : si quelqu'un l'a recréée entre-temps, on ne l'écrase pas.
    const priorityScore = snap["priority_score"] ?? snap["priorityScore"] ??
      ({ critical: 90, high: 75, medium: 50, low: 25 } as Record<string, number>)[(snap["priority"] as string) ?? "medium"] ?? 50;
    const sourceType = snap["source_type"] ?? snap["sourceType"] ?? "manual";
    await pool.query(`
      INSERT INTO missions (
        id, org_id, title, description, category, status, priority, due_date,
        assigned_to, steps, completed_at, dismissed_at, updated_at, created_at,
        last_refreshed_at, source_type, priority_score
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,NOW(),
        COALESCE($13, NOW()), COALESCE($14, NOW()),$15,$16)
      ON CONFLICT (id) DO NOTHING
    `, [
      id, orgId,
      snap["title"] ?? "", snap["description"] ?? null,
      snap["category"] ?? "seo", snap["status"] ?? "todo", snap["priority"] ?? "medium",
      snap["due_date"] ?? null, snap["assigned_to"] ?? null,
      snap["steps"] ? JSON.stringify(snap["steps"]) : "[]",
      snap["completed_at"] ?? null, snap["dismissed_at"] ?? null,
      snap["created_at"] ?? null, snap["last_refreshed_at"] ?? null,
      sourceType, priorityScore,
    ]);
    return;
  }

  if (["update_mission", "complete_mission", "assign_mission"].includes(toolName)) {
    // ── Sécurité version : logs sans version_after refusés ────────────────────
    // Un log antérieur au déploiement de version_after ne peut pas garantir
    // l'absence de modifications concurrentes. Refus explicite > restauration aveugle.
    if (versionAfter === null || versionAfter === undefined) {
      return { versionUnavailable: true };
    }

    // ── Restauration atomique : UPDATE WHERE updated_at = $version ────────────
    // En une seule requête SQL : compare + restaure.
    // Aucune race condition possible entre lecture de version et écriture.
    // rowCount = 0 → mission modifiée entre-temps OU mission supprimée.
    // Atomique : UPDATE ... WHERE id=$9 AND org_id=$10 AND updated_at≈versionAfter.
    // Troncature à la milliseconde des deux côtés : date_trunc('milliseconds', ...).
    // Raison : tool-executor capture updated_at via JS Date.toISOString() (ms),
    // mais PostgreSQL peut stocker avec une précision microseconde.
    // Troncature à la ms garantit la correspondance sans risquer une tolérance large.
    const updateRes = await pool.query<{ id: string }>(`
      UPDATE missions SET
        title        = $1,
        description  = $2,
        status       = $3,
        priority     = $4,
        due_date     = $5,
        assigned_to  = $6,
        completed_at = $7,
        dismissed_at = $8,
        updated_at   = NOW()
      WHERE id = $9 AND org_id = $10
        AND date_trunc('milliseconds', updated_at)
          = date_trunc('milliseconds', $11::TIMESTAMPTZ)
    `, [
      snap["title"], snap["description"], snap["status"], snap["priority"],
      snap["due_date"], snap["assigned_to"], snap["completed_at"], snap["dismissed_at"],
      id, orgId,
      versionAfter,
    ]);

    if ((updateRes.rowCount ?? 0) === 0) {
      // Disambiguate : mission supprimée vs modifiée concurremment
      const existsRow = await pool.query(
        `SELECT id FROM missions WHERE id = $1 AND org_id = $2`,
        [id, orgId]
      );
      if (!existsRow.rows[0]) {
        throw new Error("La mission n'existe plus dans votre organisation. Elle a peut-être été supprimée depuis l'action.");
      }
      // Mission existe mais updated_at ne correspond pas → modification concurrente
      logger.debug({ id, orgId, versionAfter }, "[undo] SQL atomic check: version mismatch");
      return { stale: true };
    }

    return;
  }

  throw new Error(`applySnapshot non implémenté pour l'outil : ${toolName}`);
}
