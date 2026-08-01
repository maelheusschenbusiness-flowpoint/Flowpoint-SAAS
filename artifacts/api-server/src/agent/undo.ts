/**
 * FlowPoint AI Agents — Phase 2 : Service Undo.
 *
 * Restaure l'état précédent d'une ressource à partir du snapshot stocké dans
 * ai_action_logs.undo_snapshot. Ne jamais inverser logiquement une action —
 * toujours restaurer le snapshot réel.
 *
 * Sécurité :
 *  - L'action doit appartenir à l'organisation (org_id scope)
 *  - L'action ne doit pas déjà être annulée (undone_at IS NULL)
 *  - Timeout d'undo : 30 minutes après la création (configurable)
 *  - Le snapshot null (outils sans write, ex: search) → undo refusé
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";

export const UNDO_TTL_MINUTES = 30;

export interface UndoResult {
  ok: boolean;
  message: string;
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
      `SELECT id, org_id, tool, undo_snapshot, undone_at, result, created_at
       FROM ai_action_logs WHERE id = $1 AND org_id = $2`,
      [actionLogId, orgId]
    );
    row = r.rows[0] as Record<string, unknown> | undefined;
  } catch (err) {
    logger.error({ err, actionLogId }, "[undo] DB read failed");
    return { ok: false, message: "Erreur de lecture de la base de données." };
  }

  if (!row) {
    return { ok: false, message: "Action introuvable ou non accessible.", actionLogId };
  }

  // 2. Vérifications
  if (row["undone_at"]) {
    return { ok: false, message: "Cette action a déjà été annulée.", actionLogId,
      toolName: row["tool"] as string };
  }

  const ageMs = Date.now() - new Date(row["created_at"] as string).getTime();
  if (ageMs > UNDO_TTL_MINUTES * 60_000) {
    return { ok: false, message: `Délai d'annulation dépassé (${UNDO_TTL_MINUTES} min maximum).`,
      actionLogId, toolName: row["tool"] as string };
  }

  if (!row["undo_snapshot"]) {
    return { ok: false, message: "Aucun snapshot disponible pour annuler cette action.",
      actionLogId, toolName: row["tool"] as string };
  }

  const snap = typeof row["undo_snapshot"] === "string"
    ? JSON.parse(row["undo_snapshot"] as string)
    : row["undo_snapshot"];

  if (!snap || typeof snap !== "object") {
    return { ok: false, message: "Snapshot invalide.", actionLogId };
  }

  const toolName = row["tool"] as string;

  // 3. Restauration selon l'outil
  try {
    await applySnapshot(toolName, snap as Record<string, unknown>, orgId);
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
    type: "report", label: `[IA] Annulation : ${toolName} (${snap["title"] ?? actionLogId})`,
    targetId: snap["id"] as string ?? actionLogId, targetType: "mission",
    metadata: { actionLogId, toolName }, orgId,
  }).catch(() => {});

  logger.info({ actionLogId, toolName, orgId }, "[undo] action undone");
  return { ok: true, message: "Action annulée avec succès.", actionLogId, toolName };
}

async function applySnapshot(
  toolName: string,
  snap: Record<string, unknown>,
  orgId: string
): Promise<void> {
  const id = snap["id"] as string;
  if (!id) throw new Error("Snapshot sans ID — impossible de restaurer.");

  if (toolName === "create_mission") {
    // Annuler une création = supprimer la mission
    await pool.query(`DELETE FROM missions WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return;
  }

  if (toolName === "delete_mission") {
    // Annuler une suppression = réinsérer fidèlement depuis le snapshot
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
    await pool.query(`
      UPDATE missions SET
        title       = $1,
        description = $2,
        status      = $3,
        priority    = $4,
        due_date    = $5,
        assigned_to = $6,
        completed_at = $7,
        dismissed_at = $8,
        updated_at  = NOW()
      WHERE id = $9 AND org_id = $10
    `, [
      snap["title"], snap["description"], snap["status"], snap["priority"],
      snap["due_date"], snap["assigned_to"], snap["completed_at"], snap["dismissed_at"],
      id, orgId,
    ]);
    return;
  }

  throw new Error(`applySnapshot non implémenté pour l'outil : ${toolName}`);
}
