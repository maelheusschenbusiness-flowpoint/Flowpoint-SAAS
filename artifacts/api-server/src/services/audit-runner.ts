/**
 * FlowPoint — Shared audit runner (#437)
 *
 * Single source of truth for launching an SEO audit, used by:
 *  - POST /audits (manual launch from the dashboard)
 *  - the scheduled-audit cron (audit_schedules due rows)
 *
 * Behaviour is identical for both origins: insert a `processing` audits row,
 * run PSI mobile+desktop asynchronously, persist the weighted score, evaluate
 * alert rules (which may create notifications), broadcast completion and log
 * the activity feed entries.
 */

import { pool } from "@workspace/db";
import { analyzePSI } from "./pagespeed-service.js";
import { store } from "./store.js";
import { logger } from "../lib/logger.js";

export function normalizeAuditUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const candidate = raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`;
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return null;
    parsed.hash = "";
    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) parsed.port = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Returns the id of an audit already created today for this org+url, or null. */
export async function findAuditToday(orgId: string, url: string): Promise<string | null> {
  // org_id guard: pool runs as superuser (BYPASSRLS) — explicit org_id required.
  const dup = await pool.query(
    `SELECT id FROM audits WHERE org_id = $1 AND url = $2 AND created_at >= date_trunc('day', now()) LIMIT 1`,
    [orgId, url],
  );
  return dup.rows[0]?.id ?? null;
}

export interface LaunchedAudit {
  id: string; url: string; name: string; notes: string;
  score: 0; status: "processing"; speed: 0; date: string; issues: 0; origin: string;
}

/**
 * Insert the processing audit row and kick off the async PSI analysis.
 * `url` must already be normalized via normalizeAuditUrl.
 */
export async function launchAudit(opts: {
  orgId: string; url: string; origin: string; name?: string; userId?: string; userName?: string;
  /** When set, the audit row is already committed to the DB — skip the INSERT. */
  preInsertedId?: string;
}): Promise<LaunchedAudit> {
  const { orgId, url, origin } = opts;
  const auditId = opts.preInsertedId ?? `a${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
  const dateStr = new Date().toISOString();
  const name = opts.name ?? "";

  const createdBy = origin === "scheduled" ? null : (opts.userId ?? null);
  if (!opts.preInsertedId) {
    await pool.query(
      `INSERT INTO audits (id, url, name, score, status, speed, date, issues, origin, org_id, created_by, created_at)
       VALUES ($1,$2,$3,0,'processing',0,$4,0,$5,$6,$7,NOW())`,
      [auditId, url, name, dateStr, origin, orgId, createdBy],
    );
  }

  store.logActivity({
    type: "audit",
    label: origin === "scheduled" ? `Audit planifié lancé : ${url}` : `Audit lancé : ${url}`,
    targetId: auditId, targetType: "audit",
    metadata: { url, origin, type: "SEO complet" }, orgId,
    actionKey: origin === "scheduled" ? "activity.audit.scheduled" : "activity.audit.launched",
    actionParams: { url: String(url) },
    userId: origin === "scheduled" ? "system" : (opts.userId ?? "system"),
    userName: origin === "scheduled" ? "Scheduler" : (opts.userName ?? "Système"),
  }).catch(err => logger.error({ err }, "[audit-runner] logActivity failed"));

  // Async PSI analysis — never blocks the caller.
  (async () => {
    try {
      const [mobile, desktop] = await Promise.allSettled([
        analyzePSI(url, "mobile", orgId),
        analyzePSI(url, "desktop", orgId),
      ]);
      const m = mobile.status === "fulfilled" ? mobile.value : null;
      const d = desktop.status === "fulfilled" ? desktop.value : null;
      if (!m && !d) throw new Error("Both PSI requests failed");

      // Null-safe two-device blend: a missing category (PSI can omit any of
      // seo/accessibility/bestPractices) must NEVER be coerced to 0 — that
      // fabricates a failing score. Blend only the finite values; return null
      // when neither device reported the category.
      const blend2 = (mv: number | null | undefined, dv: number | null | undefined, mw: number, dw: number): number | null => {
        const mOk = typeof mv === "number" && Number.isFinite(mv);
        const dOk = typeof dv === "number" && Number.isFinite(dv);
        if (mOk && dOk) return Math.round((mv as number) * mw + (dv as number) * dw);
        if (mOk) return mv as number;
        if (dOk) return dv as number;
        return null;
      };

      const weightedPerf = blend2(m?.scores.performance, d?.scores.performance, 0.6, 0.4);
      const weightedSeo  = blend2(m?.scores.seo,           d?.scores.seo,           0.6, 0.4);
      const weightedA11y = blend2(m?.scores.accessibility, d?.scores.accessibility, 0.5, 0.5);
      const weightedBP   = blend2(m?.scores.bestPractices, d?.scores.bestPractices, 0.5, 0.5);

      // Renormalize the blend weights over the categories actually available —
      // same contract as the audit-score blends in tool-executor.ts.
      const parts: Array<[number | null, number]> = [
        [weightedPerf, 0.40], [weightedSeo, 0.30], [weightedA11y, 0.15], [weightedBP, 0.15],
      ];
      let weightedSum = 0, weightTotal = 0;
      for (const [value, weight] of parts) {
        if (value !== null) { weightedSum += value * weight; weightTotal += weight; }
      }
      if (weightTotal === 0) throw new Error("PSI returned no usable category scores");
      const score = Math.round(weightedSum / weightTotal);
      const status: "ok" | "warn" | "error" = score >= 70 ? "ok" : score >= 50 ? "warn" : "error";
      const speed  = d?.scores.performance ?? m?.scores.performance ?? 0;
      const issues = (m?.criticalIssues.length ?? 0) + (d?.criticalIssues.length ?? 0);

      // org_id guard: pool runs as postgres (superuser, BYPASSRLS) — RLS bypassed.
      await pool.query(
        `UPDATE audits SET score=$1, status=$2, speed=$3, issues=$4 WHERE id=$5 AND org_id=$6`,
        [score, status, speed, issues, auditId, orgId],
      );
      // Dynamic import avoids a static circular dependency (monitor-cron → audit-runner).
      const { evaluateAlertRulesForAudit } = await import("./monitor-cron.js");
      evaluateAlertRulesForAudit(url, score, orgId).catch(() => {});
      store.broadcast({ type: "audit:complete", auditId, score, status }, orgId);
      store.logActivity({
        type: "audit",
        label: `Audit terminé : ${url} — Score ${score}/100`,
        targetId: auditId, targetType: "audit",
        metadata: { url, score, status, origin }, orgId,
        actionKey: "activity.audit.completed", actionParams: { url: String(url), score },
        userId: origin === "scheduled" ? "system" : (opts.userId ?? "system"),
        userName: origin === "scheduled" ? "Scheduler" : (opts.userName ?? "Système"),
      }).catch(err => logger.error({ err }, "[audit-runner] logActivity (complete) failed"));
    } catch {
      await pool.query(
        `UPDATE audits SET status='error', score=0 WHERE id=$1 AND org_id=$2`,
        [auditId, orgId],
      ).catch(() => {});
      store.broadcast({ type: "audit:error", auditId }, orgId);
    }
  })().catch(() => {});

  // Cumulative usage accounting — never decremented on deletion
  import("./usage-events.js").then(mm => mm.recordUsageEvent(orgId, "audit_created")).catch(() => {});

  return { id: auditId, url, name, notes: "", score: 0, status: "processing", speed: 0, date: dateStr, issues: 0, origin };
}
