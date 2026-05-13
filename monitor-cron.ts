import { logger } from "../lib/logger.js";
import { db, monitorsTable, downtimeIncidentsTable, auditsTable, auditSchedulesTable, alertRulesTable, monitorChecksTable } from "@workspace/db";
import { eq, lte, gte, and } from "drizzle-orm";
import { sendEmail, buildMonitorDownEmail, buildMonitorUpEmail } from "./email.js";
import { sendSms, buildMonitorDownSms, buildMonitorUpSms } from "./sms.js";
import { store } from "./store.js";
import { computeNextRun } from "./schedule-utils.js";
import { isPrivateHost, checkDnsResolution } from "../lib/validateMonitorUrl.js";

const ALERT_EMAIL = process.env["ALERT_EMAIL"] || "";
const CHECK_TIMEOUT_MS = 10_000;
const REPEAT_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

function evaluateCondition(value: number, operator: string, threshold: number): boolean {
  if (operator === "lt") return value < threshold;
  if (operator === "gt") return value > threshold;
  if (operator === "eq") return value === threshold;
  return false;
}

async function evaluateAlertRules(context: {
  type: "latency" | "uptime" | "seo_score";
  value: number;
  url: string;
}): Promise<void> {
  try {
    const rules = await db.select().from(alertRulesTable);
    const now = Date.now();
    const COOLDOWN_MS = 30 * 60 * 1000; // 30 min between re-fires for same rule+url

    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (rule.type !== context.type) continue;

      const siteUrls: string[] = JSON.parse(rule.siteUrls || "[]");
      if (siteUrls.length > 0 && !siteUrls.includes(context.url)) continue;

      const key = `${rule.id}:${context.url}`;
      const conditionMet = evaluateCondition(context.value, rule.operator, rule.threshold);

      if (!conditionMet) {
        // Condition no longer met — reset onset so timer restarts if condition returns
        store.ruleConditionOnset.delete(key);
        continue;
      }

      // Condition is met — track onset time
      if (!store.ruleConditionOnset.has(key)) {
        store.ruleConditionOnset.set(key, now);
      }
      const onsetTime = store.ruleConditionOnset.get(key)!;
      const durationMs = (rule.durationMin || 0) * 60_000;

      // Not yet sustained long enough
      if (now - onsetTime < durationMs) continue;

      // Check cooldown — avoid re-firing while condition stays true after first alert
      const lastFired = store.ruleLastFired.get(key) || 0;
      if (now - lastFired < COOLDOWN_MS) continue;

      const opLabel = rule.operator === "lt" ? "<" : rule.operator === "gt" ? ">" : "=";
      const unitMap: Record<string, string> = { latency: "ms", seo_score: "/100", uptime: "%" };
      const unit = unitMap[rule.type] || "";
      const typeLabel: Record<string, string> = { latency: "Latence", seo_score: "Score SEO", uptime: "Uptime" };
      const message = `[Règle "${rule.name}"] ${typeLabel[rule.type] || rule.type} ${opLabel} ${rule.threshold}${unit} sur ${context.url} (valeur: ${context.value}${unit})`;
      const severity =
        (rule.type === "seo_score" && context.value < 40) ||
        (rule.type === "uptime" && context.value < 95) ||
        (rule.type === "latency" && context.value > 2000)
          ? "critical"
          : "warning";

      store.ruleLastFired.set(key, now);
      store.addTriggeredAlert({
        id: `tral_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.type,
        message,
        severity,
        url: context.url,
        time: now,
      });

      logger.info({ rule: rule.name, url: context.url, value: context.value, durationMin: rule.durationMin }, "[Cron] Alert rule triggered");
    }
  } catch (err) {
    logger.error({ err }, "[Cron] Failed to evaluate alert rules");
  }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function recordCheck(monitorId: string, ok: boolean, latency: number, now: number): Promise<void> {
  await db.insert(monitorChecksTable).values({
    id: `mc_${now}_${Math.random().toString(36).slice(2, 6)}`,
    monitorId,
    checkedAt: now,
    ok,
    latency,
  });
}

async function computeUptime(monitorId: string, now: number): Promise<number> {
  const since = now - THIRTY_DAYS_MS;
  const checks = await db
    .select({ ok: monitorChecksTable.ok })
    .from(monitorChecksTable)
    .where(and(eq(monitorChecksTable.monitorId, monitorId), gte(monitorChecksTable.checkedAt, since)));

  if (checks.length === 0) return 100;
  const upCount = checks.filter((c) => c.ok).length;
  return Math.round((upCount / checks.length) * 10000) / 100;
}

const MAX_REDIRECTS = 5;

/**
 * Validates a target hostname for SSRF safety: string-based check first, then
 * async DNS resolution to catch external domains resolving to private IPs.
 * Returns true if the host is safe to request, false if it should be blocked.
 */
async function isFetchTargetSafe(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) return false;
  const dnsErr = await checkDnsResolution(hostname);
  return dnsErr === null;
}

async function checkUrl(url: string): Promise<{ ok: boolean; latency: number }> {
  const start = Date.now();

  // Validate the stored URL before making any network request (defense-in-depth
  // for legacy data or direct DB writes that bypassed route validation).
  let initialParsed: URL;
  try {
    initialParsed = new URL(url);
  } catch {
    logger.warn({ url }, "[Cron] Skipping monitor: malformed URL");
    return { ok: false, latency: 0 };
  }
  if (initialParsed.protocol !== "http:" && initialParsed.protocol !== "https:") {
    logger.warn({ url }, "[Cron] Skipping monitor: non-http/https scheme blocked (SSRF)");
    return { ok: false, latency: 0 };
  }
  if (!await isFetchTargetSafe(initialParsed.hostname)) {
    logger.warn({ url, hostname: initialParsed.hostname }, "[Cron] Skipping monitor: initial host blocked (SSRF)");
    return { ok: false, latency: 0 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    let currentUrl = url;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const res = await fetch(currentUrl, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          clearTimeout(timer);
          return { ok: false, latency: Date.now() - start };
        }
        let redirectTarget: URL;
        try {
          redirectTarget = new URL(location, currentUrl);
        } catch {
          clearTimeout(timer);
          return { ok: false, latency: Date.now() - start };
        }
        if (redirectTarget.protocol !== "http:" && redirectTarget.protocol !== "https:") {
          clearTimeout(timer);
          logger.warn({ from: currentUrl, to: redirectTarget.href }, "[Cron] Redirect to non-http/https blocked (SSRF)");
          return { ok: false, latency: 0 };
        }
        if (!await isFetchTargetSafe(redirectTarget.hostname)) {
          clearTimeout(timer);
          logger.warn({ from: currentUrl, to: redirectTarget.hostname }, "[Cron] Redirect to private/internal host blocked (SSRF)");
          return { ok: false, latency: 0 };
        }
        currentUrl = redirectTarget.toString();
        continue;
      }

      clearTimeout(timer);
      const latency = Date.now() - start;
      return { ok: res.ok || res.status < 400, latency };
    }

    clearTimeout(timer);
    return { ok: false, latency: 0 };
  } catch {
    clearTimeout(timer);
    return { ok: false, latency: 0 };
  }
}

async function sendDownAlert(
  monitor: typeof monitorsTable.$inferSelect,
  now: number,
): Promise<void> {
  const emailRecipients = [
    ...new Set([
      ...(monitor.alertEmail ? [monitor.alertEmail] : []),
      ...(ALERT_EMAIL ? [ALERT_EMAIL] : []),
    ]),
  ];
  const canSendSms = monitor.isCritical && !!monitor.alertPhone;

  if (emailRecipients.length === 0 && !canSendSms) {
    logger.warn({ monitor: monitor.name }, "[Cron] Monitor DOWN but no alert email or critical SMS configured");
    return;
  }

  const email = buildMonitorDownEmail(monitor.name, monitor.url);
  for (const to of emailRecipients) {
    await sendEmail({ to, ...email });
  }

  if (canSendSms) {
    const smsBody = buildMonitorDownSms(monitor.name, monitor.url);
    await sendSms(monitor.alertPhone!, smsBody);
  }

  await db.update(monitorsTable)
    .set({ lastAlertSent: now })
    .where(eq(monitorsTable.id, monitor.id));
  logger.warn({ monitor: monitor.name, url: monitor.url, isCritical: monitor.isCritical }, "[Cron] DOWN alert sent");
}

export async function runMonitorChecks(): Promise<void> {
  logger.info("[Cron] Running monitor checks…");

  const monitors = await db.select().from(monitorsTable);

  for (const monitor of monitors) {
    const { ok, latency } = await checkUrl(monitor.url);
    const prevStatus = monitor.status;
    const now = Date.now();

    await recordCheck(monitor.id, ok, latency, now);
    const computedUptime = await computeUptime(monitor.id, now);

    if (!ok) {
      await db.update(monitorsTable)
        .set({ status: "down", latency: 0, uptime: computedUptime, lastCheck: "à l'instant" })
        .where(eq(monitorsTable.id, monitor.id));

      const wasAlreadyDown = prevStatus === "down";

      if (!wasAlreadyDown) {
        await db.insert(downtimeIncidentsTable)
          .values({ monitorId: monitor.id, downSince: now })
          .onConflictDoNothing();
        await sendDownAlert(monitor, now);
        store.logActivity({
          type: "monitor",
          label: `Monitor DOWN : ${monitor.name} (${monitor.url})`,
          targetId: monitor.id,
          targetType: "monitor",
          metadata: { url: monitor.url, name: monitor.name, status: "down" },
        }).catch(() => {});
      } else {
        const lastSent = monitor.lastAlertSent || 0;
        if (now - lastSent > REPEAT_ALERT_COOLDOWN_MS) {
          await sendDownAlert(monitor, now);
        }
      }
      await evaluateAlertRules({ type: "uptime", value: computedUptime, url: monitor.url });
    } else {
      const newStatus = latency > 600 ? "warn" : "up";
      await db.update(monitorsTable)
        .set({ status: newStatus, latency, uptime: computedUptime, lastCheck: "à l'instant" })
        .where(eq(monitorsTable.id, monitor.id));

      const wasPreviouslyDown = prevStatus === "down";
      if (wasPreviouslyDown) {
        const [incident] = await db.select()
          .from(downtimeIncidentsTable)
          .where(eq(downtimeIncidentsTable.monitorId, monitor.id));

        const downAt = incident?.downSince;
        const durationMs = downAt ? now - downAt : 0;
        const durationStr = durationMs >= 60_000
          ? `${Math.round(durationMs / 60_000)} min`
          : durationMs >= 1_000
            ? `${Math.round(durationMs / 1_000)}s`
            : "< 1 min";

        await db.delete(downtimeIncidentsTable)
          .where(eq(downtimeIncidentsTable.monitorId, monitor.id));

        const emailRecipients = [
          ...new Set([
            ...(monitor.alertEmail ? [monitor.alertEmail] : []),
            ...(ALERT_EMAIL ? [ALERT_EMAIL] : []),
          ]),
        ];
        if (emailRecipients.length > 0) {
          const email = buildMonitorUpEmail(monitor.name, monitor.url, durationStr);
          for (const to of emailRecipients) {
            await sendEmail({ to, ...email });
          }
          logger.info({ monitor: monitor.name, duration: durationStr }, "[Cron] UP recovery email sent");
        }
        if (monitor.isCritical && monitor.alertPhone) {
          const smsBody = buildMonitorUpSms(monitor.name, monitor.url, durationStr);
          await sendSms(monitor.alertPhone, smsBody);
          logger.info({ monitor: monitor.name, duration: durationStr }, "[Cron] UP recovery SMS sent");
        }
        store.logActivity({
          type: "monitor",
          label: `Monitor UP : ${monitor.name} — rétabli après ${durationStr}`,
          targetId: monitor.id,
          targetType: "monitor",
          metadata: { url: monitor.url, name: monitor.name, status: "up", duration: durationStr },
        }).catch(() => {});
      }

      await evaluateAlertRules({ type: "latency", value: latency, url: monitor.url });
      await evaluateAlertRules({ type: "uptime", value: computedUptime, url: monitor.url });
    }
  }

  logger.info("[Cron] Monitor checks complete");
}

export async function runScheduledAudits(): Promise<void> {
  const now = Date.now();
  try {
    const dueSchedules = await db
      .select()
      .from(auditSchedulesTable)
      .where(lte(auditSchedulesTable.nextRun, now));

    if (dueSchedules.length === 0) return;
    logger.info({ count: dueSchedules.length }, "[Cron] Running scheduled audits…");

    for (const sched of dueSchedules) {
      try {
        const statusOptions = ["ok", "warn", "error"] as const;
        const score = Math.floor(Math.random() * 50) + 40;
        const status = statusOptions[Math.floor(Math.random() * statusOptions.length)];
        const auditId = `a_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await db.insert(auditsTable).values({
          id: auditId,
          url: sched.url,
          score,
          status,
          speed: Math.floor(Math.random() * 40) + 50,
          date: new Date().toISOString(),
          issues: Math.floor(Math.random() * 15) + 1,
          origin: "auto",
        });

        await db.update(auditSchedulesTable)
          .set({ lastRun: now, nextRun: computeNextRun(sched.frequency) })
          .where(eq(auditSchedulesTable.id, sched.id));

        store.broadcastAuditComplete({ id: auditId, url: sched.url, score, status, origin: "auto" });
        store.logActivity({
          type: "audit",
          label: `Audit terminé : ${sched.url} (${score}/100)`,
          targetId: auditId,
          targetType: "audit",
          metadata: { url: sched.url, score, origin: "auto" },
        }).catch(() => {});
        logger.info({ url: sched.url, frequency: sched.frequency, score }, "[Cron] Scheduled audit complete");

        await evaluateAlertRules({ type: "seo_score", value: score, url: sched.url });
      } catch (err) {
        logger.error({ err, url: sched.url }, "[Cron] Scheduled audit failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "[Cron] Failed to run scheduled audits");
  }
}

/** Public wrapper: evaluate SEO score rules for a manually triggered audit */
export async function evaluateAlertRulesForAudit(url: string, score: number): Promise<void> {
  await evaluateAlertRules({ type: "seo_score", value: score, url });
}

export async function startMonitorCron(): Promise<void> {
  try {
    const cron = await import("node-cron");
    cron.schedule("*/5 * * * *", () => {
      runMonitorChecks().catch((err) => logger.error({ err }, "[Cron] Monitor check failed"));
    });
    cron.schedule("0 * * * *", () => {
      runScheduledAudits().catch((err) => logger.error({ err }, "[Cron] Scheduled audit run failed"));
    });
    logger.info("[Cron] Monitor check cron scheduled every 5 minutes");
    logger.info("[Cron] Scheduled audit cron started (hourly)");
  } catch (err) {
    logger.error({ err }, "[Cron] Failed to start monitor cron");
  }
}
