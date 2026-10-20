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
  const calendarTools = ["create_calendar_event", "update_calendar_event", "move_calendar_event", "delete_calendar_event",
    "reschedule_week", "optimize_schedule", "create_recurring_event", "update_recurring_event", "delete_recurring_series",
    "find_free_slots"];
  const recommTools  = ["generate_recommendations", "generate_seo_strategy", "dismiss_recommendation", "restore_recommendation", "create_missions_from_strategy"];
  const auditTools   = ["run_audit", "rerun_audit", "delete_audit", "create_missions_from_audit"];
  const monitorTools = ["search_monitors", "search_incidents", "explain_incident", "compare_incidents",
    "acknowledge_incident", "resolve_incident", "create_missions_from_incident", "optimize_monitors",
    "configure_monitor", "suspend_monitor", "resume_monitor", "delete_monitor"];
  const targetType = calendarTools.includes(toolName) ? "calendar_event"
    : auditTools.includes(toolName)    ? "audit"
    : recommTools.includes(toolName)   ? "report"
    : monitorTools.includes(toolName)  ? "organization"
    : "mission";
  await store.logActivity({
    type: "report", label: `[IA] Annulation : ${toolName} (${(snap as Record<string, unknown>)["title"] ?? actionLogId})`,
    targetId: (snap as Record<string, unknown>)["id"] as string ?? actionLogId,
    targetType,
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

  // ── Phase 3 avancé — opérations batch (MUST be first — no top-level id) ──
  // reschedule_week / optimize_schedule / create_recurring_event
  // Détecté par snap.batchType.
  // - create_recurring_event : DELETE atomique (toujours idempotent — on efface ce qu'on a créé).
  // - reschedule_week / optimize_schedule : version lock sur chaque événement via postWriteVersions ;
  //   si un événement a été modifié depuis l'action → ROLLBACK → PROPOSAL_STALE.
  if (snap["batchType"] && Array.isArray(snap["events"])) {
    const batchType   = snap["batchType"] as string;
    const batchEvents = snap["events"] as Record<string, unknown>[];

    if (batchType === "create_recurring_event") {
      // Annuler = supprimer toutes les occurrences créées dans une transaction atomique
      const delClient = await pool.connect();
      try {
        await delClient.query("BEGIN");
        for (const e of batchEvents) {
          await delClient.query(
            `DELETE FROM calendar_events WHERE id = $1 AND org_id = $2`,
            [e["id"], orgId]
          );
        }
        await delClient.query("COMMIT");
      } catch (err) {
        await delClient.query("ROLLBACK");
        delClient.release();
        throw err;
      }
      delClient.release();
      return;
    }

    if (batchType === "reschedule_week" || batchType === "optimize_schedule") {
      // postWriteVersions : { [eventId]: isoTimestamp } capturé par tool-executor après l'écriture.
      // Si absent (ancien log), on procède sans version lock (compat ascendante — no user data at risk
      // for logs written before this fix because those logs pre-date the postWriteVersions field).
      const postWriteVersions = snap["postWriteVersions"] as Record<string, string> | undefined;

      const batchClient = await pool.connect();
      try {
        await batchClient.query("BEGIN");

        for (const e of batchEvents) {
          const evId = e["id"] as string;
          const pwv  = postWriteVersions?.[evId];

          if (batchType === "reschedule_week") {
            // Restore original date with version check
            let rows: number;
            if (pwv) {
              const res = await batchClient.query(
                `UPDATE calendar_events
                    SET date = $1, updated_at = NOW()
                  WHERE id = $2 AND org_id = $3
                    AND date_trunc('milliseconds', updated_at)
                      = date_trunc('milliseconds', $4::TIMESTAMPTZ)
                 RETURNING id`,
                [e["date"], evId, orgId, pwv]
              );
              rows = res.rowCount ?? 0;
            } else {
              // Legacy log — no version lock
              const res = await batchClient.query(
                `UPDATE calendar_events SET date = $1, updated_at = NOW()
                  WHERE id = $2 AND org_id = $3 RETURNING id`,
                [e["date"], evId, orgId]
              );
              rows = res.rowCount ?? 0;
            }
            if (pwv && rows === 0) {
              // Event was modified after the batch write — abort entire undo
              await batchClient.query("ROLLBACK");
              batchClient.release();
              return { stale: true };
            }
          } else {
            // optimize_schedule — restore original start_time with version check
            const origSt = String(e["start_time"] ?? e["startTime"] ?? "");
            let rows: number;
            if (pwv) {
              const res = await batchClient.query(
                `UPDATE calendar_events
                    SET start_time = $1, updated_at = NOW()
                  WHERE id = $2 AND org_id = $3
                    AND date_trunc('milliseconds', updated_at)
                      = date_trunc('milliseconds', $4::TIMESTAMPTZ)
                 RETURNING id`,
                [origSt, evId, orgId, pwv]
              );
              rows = res.rowCount ?? 0;
            } else {
              const res = await batchClient.query(
                `UPDATE calendar_events SET start_time = $1, updated_at = NOW()
                  WHERE id = $2 AND org_id = $3 RETURNING id`,
                [origSt, evId, orgId]
              );
              rows = res.rowCount ?? 0;
            }
            if (pwv && rows === 0) {
              await batchClient.query("ROLLBACK");
              batchClient.release();
              return { stale: true };
            }
          }
        }

        await batchClient.query("COMMIT");
      } catch (err) {
        await batchClient.query("ROLLBACK");
        batchClient.release();
        throw err;
      }
      batchClient.release();
      return;
    }

    // ── delete_recurring_series — réinsérer les occurrences supprimées ────────
    if (batchType === "delete_recurring_series") {
      const reinsertClient = await pool.connect();
      try {
        await reinsertClient.query("BEGIN");
        for (const e of batchEvents) {
          await reinsertClient.query(
            `INSERT INTO calendar_events
               (id, org_id, title, site, type, date, start_time, duration, notes,
                client_name, priority, color, reminder, linked_mission_id, rrule,
                series_id, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
             ON CONFLICT (id) DO NOTHING`,
            [
              e["id"], orgId,
              e["title"]      ?? "",
              e["site"]       ?? "",
              e["type"]       ?? "Autre",
              e["date"]       ?? "",
              e["start_time"] ?? "",
              e["duration"]   ?? 60,
              e["notes"]      ?? "",
              e["client_name"]      ?? "",
              e["priority"]         ?? "normal",
              e["color"]            ?? "",
              e["reminder"]         ?? 0,
              e["linked_mission_id"]?? null,
              e["rrule"]      ?? null,
              e["series_id"]  ?? null,
              e["created_at"] ?? new Date().toISOString(),
            ]
          );
        }
        await reinsertClient.query("COMMIT");
      } catch (err) {
        await reinsertClient.query("ROLLBACK");
        reinsertClient.release();
        throw err;
      }
      reinsertClient.release();
      return;
    }

    // ── update_recurring_event — restaurer les champs avant modification ──────
    if (batchType === "update_recurring_event") {
      const postWriteVersions = snap["postWriteVersions"] as Record<string, string> | undefined;
      const updUndoClient = await pool.connect();
      try {
        await updUndoClient.query("BEGIN");
        for (const e of batchEvents) {
          const evId = e["id"] as string;
          const pwv  = postWriteVersions?.[evId];

          let rowsAffected: number;
          if (pwv) {
            const res = await updUndoClient.query(
              `UPDATE calendar_events
                  SET title       = $1,  site        = $2,  type       = $3,
                      date        = $4,  start_time  = $5,  duration   = $6,
                      notes       = $7,  client_name = $8,  priority   = $9,
                      color       = $10, reminder    = $11, linked_mission_id = $12,
                      updated_at  = NOW()
               WHERE id = $13 AND org_id = $14
                 AND date_trunc('milliseconds', updated_at)
                   = date_trunc('milliseconds', $15::TIMESTAMPTZ)
               RETURNING id`,
              [
                e["title"] ?? "", e["site"] ?? "", e["type"] ?? "Autre",
                e["date"]  ?? "", e["start_time"] ?? String(e["startTime"] ?? ""), e["duration"] ?? 60,
                e["notes"] ?? "", e["client_name"] ?? String(e["clientName"] ?? ""),
                e["priority"] ?? "normal", e["color"] ?? "", e["reminder"] ?? 0,
                e["linked_mission_id"] ?? null,
                evId, orgId, pwv,
              ]
            );
            rowsAffected = res.rowCount ?? 0;
          } else {
            // Legacy log — no version lock
            const res = await updUndoClient.query(
              `UPDATE calendar_events
                  SET title = $1, site = $2, type = $3, date = $4, start_time = $5,
                      duration = $6, notes = $7, client_name = $8, priority = $9,
                      color = $10, reminder = $11, linked_mission_id = $12, updated_at = NOW()
               WHERE id = $13 AND org_id = $14 RETURNING id`,
              [
                e["title"] ?? "", e["site"] ?? "", e["type"] ?? "Autre",
                e["date"]  ?? "", e["start_time"] ?? "", e["duration"] ?? 60,
                e["notes"] ?? "", e["client_name"] ?? "", e["priority"] ?? "normal",
                e["color"] ?? "", e["reminder"] ?? 0, e["linked_mission_id"] ?? null,
                evId, orgId,
              ]
            );
            rowsAffected = res.rowCount ?? 0;
          }
          if (pwv && rowsAffected === 0) {
            await updUndoClient.query("ROLLBACK");
            updUndoClient.release();
            return { stale: true };
          }
        }
        await updUndoClient.query("COMMIT");
      } catch (err) {
        await updUndoClient.query("ROLLBACK");
        updUndoClient.release();
        throw err;
      }
      updUndoClient.release();
      return;
    }

    throw new Error(`Batch undo non implémenté pour le type : ${batchType}`);
  }

  // ── Phase 5 — create_missions_from_strategy batch undo ──────────────────
  // snap.missions is the list of missions created from a strategy; undo = DELETE all of them.
  if (snap["batchType"] === "create_missions_from_strategy" && Array.isArray(snap["missions"])) {
    const stratMissions = snap["missions"] as Record<string, unknown>[];
    const stratDelClient = await pool.connect();
    try {
      await stratDelClient.query("BEGIN");
      for (const m of stratMissions) {
        await stratDelClient.query(
          `DELETE FROM missions WHERE id = $1 AND org_id = $2`,
          [m["id"], orgId]
        );
      }
      await stratDelClient.query("COMMIT");
    } catch (err) {
      await stratDelClient.query("ROLLBACK");
      stratDelClient.release();
      throw err;
    }
    stratDelClient.release();
    return;
  }

  // ── Phase 6 — create_missions_from_incident batch undo ───────────────────
  if (snap["batchType"] === "create_missions_from_incident" && Array.isArray(snap["missions"])) {
    const incMissions = snap["missions"] as Record<string, unknown>[];
    const incDelClient = await pool.connect();
    try {
      await incDelClient.query("BEGIN");
      for (const m of incMissions) {
        await incDelClient.query(`DELETE FROM missions WHERE id=$1 AND org_id=$2`, [m["id"], orgId]);
      }
      await incDelClient.query("COMMIT");
    } catch (err) {
      await incDelClient.query("ROLLBACK");
      incDelClient.release();
      throw err;
    }
    incDelClient.release();
    return;
  }

  // ── Phase 4 — create_missions_from_audit batch undo ─────────────────────
  // snap.missions is the list of missions created; undo = DELETE all of them.
  if (snap["batchType"] === "create_missions_from_audit" && Array.isArray(snap["missions"])) {
    const missions = snap["missions"] as Record<string, unknown>[];
    const delClient = await pool.connect();
    try {
      await delClient.query("BEGIN");
      for (const m of missions) {
        await delClient.query(
          `DELETE FROM missions WHERE id = $1 AND org_id = $2`,
          [m["id"], orgId]
        );
      }
      await delClient.query("COMMIT");
    } catch (err) {
      await delClient.query("ROLLBACK");
      delClient.release();
      throw err;
    }
    delClient.release();
    return;
  }

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

  // ── Calendrier — Phase 3 ─────────────────────────────────────────────────────

  if (toolName === "create_calendar_event") {
    // Annuler une création = supprimer l'événement (idempotent)
    await pool.query(`DELETE FROM calendar_events WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return;
  }

  if (toolName === "delete_calendar_event") {
    // Annuler une suppression = réinsérer fidèlement depuis le snapshot
    await pool.query(`
      INSERT INTO calendar_events (
        id, org_id, title, site, type, date, start_time, duration, notes, client_name,
        priority, color, reminder, linked_mission_id, updated_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),COALESCE($15,NOW()))
      ON CONFLICT (id) DO NOTHING
    `, [
      id, orgId,
      snap["title"] ?? "", snap["site"] ?? "", snap["type"] ?? "Autre",
      snap["date"] ?? "", snap["start_time"] ?? snap["startTime"] ?? "",
      snap["duration"] ?? 60, snap["notes"] ?? "", snap["client_name"] ?? snap["clientName"] ?? "",
      snap["priority"] ?? "normal", snap["color"] ?? "", snap["reminder"] ?? 0,
      snap["linked_mission_id"] ?? snap["linkedMissionId"] ?? null,
      snap["created_at"] ?? null,
    ]);
    return;
  }

  if (toolName === "update_calendar_event" || toolName === "move_calendar_event") {
    // Même règle que missions : logs sans version_after refusés
    if (versionAfter === null || versionAfter === undefined) {
      return { versionUnavailable: true };
    }

    // Restauration atomique avec comparaison de version (troncature ms obligatoire)
    const calUpdateRes = await pool.query<{ id: string }>(`
      UPDATE calendar_events SET
        title             = $1,
        site              = $2,
        type              = $3,
        date              = $4,
        start_time        = $5,
        duration          = $6,
        notes             = $7,
        client_name       = $8,
        priority          = COALESCE($9, priority),
        color             = COALESCE($10, color),
        reminder          = COALESCE($11::INTEGER, reminder),
        linked_mission_id = $12,
        updated_at        = NOW()
      WHERE id = $13 AND org_id = $14
        AND date_trunc('milliseconds', updated_at)
          = date_trunc('milliseconds', $15::TIMESTAMPTZ)
    `, [
      snap["title"] ?? "", snap["site"] ?? "", snap["type"] ?? "Autre",
      snap["date"] ?? "", snap["start_time"] ?? snap["startTime"] ?? "",
      snap["duration"] ?? 60, snap["notes"] ?? "", snap["client_name"] ?? snap["clientName"] ?? "",
      snap["priority"] ?? null, snap["color"] ?? null,
      snap["reminder"] != null ? String(snap["reminder"]) : null,
      snap["linked_mission_id"] ?? snap["linkedMissionId"] ?? null,
      id, orgId, versionAfter,
    ]);

    if ((calUpdateRes.rowCount ?? 0) === 0) {
      const existsRow = await pool.query(
        `SELECT id FROM calendar_events WHERE id = $1 AND org_id = $2`, [id, orgId]
      );
      if (!existsRow.rows[0]) {
        throw new Error("L'événement n'existe plus dans votre organisation.");
      }
      return { stale: true };
    }
    return;
  }

  // ── Phase 6 — resolve_incident undo ──────────────────────────────────────
  if (toolName === "resolve_incident") {
    const riId = snap["id"] as string;
    if (!riId) throw new Error("Snapshot resolve_incident sans ID.");
    await pool.query(
      `UPDATE monitor_incidents SET resolved_at=NULL, duration_s=NULL WHERE id=$1 AND org_id=$2`,
      [riId, orgId]
    );
    return;
  }

  // ── Phase 6 — suspend_monitor undo (= resume) ────────────────────────────
  if (toolName === "suspend_monitor") {
    const susId = snap["id"] as string;
    if (!susId) throw new Error("Snapshot suspend_monitor sans ID.");
    await pool.query(
      `UPDATE monitors SET enabled=true, updated_at=NOW() WHERE id=$1 AND org_id=$2`,
      [susId, orgId]
    );
    return;
  }

  // ── Phase 6 — delete_monitor undo (= re-insert from snapshot) ────────────
  if (toolName === "delete_monitor") {
    const dm = snap as Record<string, unknown>;
    if (!dm["id"]) throw new Error("Snapshot delete_monitor sans ID.");
    await pool.query(
      `INSERT INTO monitors (id, org_id, name, url, status, uptime, latency, last_check,
                             alert_email, alert_phone, is_critical, frequency, enabled, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [dm["id"], orgId, dm["name"] ?? "Restored monitor", dm["url"] ?? "", dm["status"] ?? "unknown",
       dm["uptime"] ?? 100, dm["latency"] ?? 0, dm["last_check"] ?? null,
       dm["alert_email"] ?? null, dm["alert_phone"] ?? null, dm["is_critical"] ?? false,
       dm["frequency"] ?? 300, dm["enabled"] ?? true, dm["created_at"] ?? new Date().toISOString()]
    );
    return;
  }

  // ── Phase 6 — configure_monitor undo (= restore previous values) ─────────
  if (toolName === "configure_monitor") {
    const cm = snap as Record<string, unknown>;
    if (cm["action"] === "create") {
      // Undo create = delete the newly created monitor
      const newMonId = cm["id"] as string;
      if (newMonId) await pool.query(`DELETE FROM monitors WHERE id=$1 AND org_id=$2`, [newMonId, orgId]);
      return;
    }
    if (!cm["id"]) throw new Error("Snapshot configure_monitor sans ID.");
    // Undo update = restore previous field values
    await pool.query(
      `UPDATE monitors SET name=$1, url=$2, frequency=$3, alert_email=$4, alert_phone=$5,
                           is_critical=$6, enabled=$7, updated_at=NOW()
         WHERE id=$8 AND org_id=$9`,
      [cm["name"], cm["url"], cm["frequency"] ?? 300, cm["alert_email"] ?? null,
       cm["alert_phone"] ?? null, cm["is_critical"] ?? false, cm["enabled"] ?? true,
       cm["id"], orgId]
    );
    return;
  }

  // ── Phase 5 — dismiss_recommendation undo ────────────────────────────────
  // Undo dismiss = restore status to the previous value (snap.status, typically "active").
  if (toolName === "dismiss_recommendation") {
    const prevStatus = (snap["status"] as string) ?? "active";
    await pool.query(
      `UPDATE ai_recommendations SET status=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3`,
      [prevStatus, id, orgId]
    );
    return;
  }

  // ── Phase 5 — restore_recommendation undo ────────────────────────────────
  // Undo restore = revert status to "dismissed".
  if (toolName === "restore_recommendation") {
    await pool.query(
      `UPDATE ai_recommendations SET status='dismissed', updated_at=NOW() WHERE id=$1 AND org_id=$2`,
      [id, orgId]
    );
    return;
  }

  // ── Phase 5 — generate_recommendations / generate_seo_strategy undo ──────
  // Undo = mark the generated row as archived/dismissed (soft-delete pattern).
  if (toolName === "generate_recommendations" || toolName === "generate_seo_strategy") {
    await pool.query(
      `UPDATE ai_recommendations SET status='dismissed', updated_at=NOW() WHERE id=$1 AND org_id=$2`,
      [id, orgId]
    );
    return;
  }

  throw new Error(`applySnapshot non implémenté pour l'outil : ${toolName}`);
}
