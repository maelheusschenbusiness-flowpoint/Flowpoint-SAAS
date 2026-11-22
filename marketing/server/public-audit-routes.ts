import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  getPublicAuditQuota,
  isPublicAuditEnabled,
  PublicAuditBusyError,
  PublicAuditQuotaError,
  PublicAuditUnavailableError,
  releasePublicAuditSlot,
  reservePublicAudit,
  startPublicAuditQuotaCleanup,
  type PublicAuditReservation,
} from "./public-audit-quota";
import {
  createPublicAuditReport,
  getPublicAuditFailureMessage,
} from "./public-audit-report";
import {
  PublicAuditTargetError,
  sanitizePublicAuditUrlForLog,
} from "./public-audit-fetch";

const ALLOWED_PUBLIC_ORIGINS = new Set([
  "https://flowpoint.pro",
  "https://www.flowpoint.pro",
]);

function hasSameOrigin(req: Request): boolean {
  const origin = req.get("origin") ?? req.get("referer");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const requestOrigin = `${req.protocol}://${req.get("host")}`;
    return (
      originUrl.origin === requestOrigin ||
      ALLOWED_PUBLIC_ORIGINS.has(originUrl.origin)
    );
  } catch {
    return false;
  }
}

const auditRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({
      code: "PUBLIC_AUDIT_RATE_LIMIT",
      message: "Please wait before starting another website check.",
    }),
});

const quotaReadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({
      code: "PUBLIC_AUDIT_RATE_LIMIT",
      message: "Please wait before checking the free audit limit again.",
    }),
});

const auditRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(2048).url(),
  })
  .strict();

type PublicAuditRouteOptions = {
  createReport?: typeof createPublicAuditReport;
};

function isMissingAuditTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01"
  );
}

function ensureEnabled(res: Response): boolean {
  if (isPublicAuditEnabled()) return true;
  res.status(503).json({
    code: "PUBLIC_AUDIT_UNAVAILABLE",
    message: "The public website audit is temporarily unavailable.",
  });
  return false;
}

function reportError(res: Response, error: unknown): void {
  if (isMissingAuditTable(error)) {
    res.status(503).json({
      code: "PUBLIC_AUDIT_UNAVAILABLE",
      message: "The public website audit is temporarily unavailable.",
    });
    return;
  }

  if (error instanceof PublicAuditQuotaError) {
    if (error.kind === "visitor") {
      res.status(429).json({
        code: "PUBLIC_AUDIT_VISITOR_LIMIT",
        message:
          "You've used your 3 free audits today. Need more analyses? Explore FlowPoint plans.",
        quota: { remaining: 0, limit: 3, resetAt: error.resetAt },
      });
      return;
    }
    res.status(429).json({
      code: "PUBLIC_AUDIT_DAILY_LIMIT",
      message: "The free audit is at its daily limit. Please try again tomorrow.",
      quota: { remaining: null, limit: null, resetAt: error.resetAt },
    });
    return;
  }
  if (error instanceof PublicAuditBusyError) {
    res.status(503).json({
      code: "PUBLIC_AUDIT_BUSY",
      message: error.message,
    });
    return;
  }
  if (error instanceof PublicAuditUnavailableError) {
    res.status(503).json({
      code: "PUBLIC_AUDIT_UNAVAILABLE",
      message: error.message,
    });
    return;
  }

  res.status(502).json({
    code: "PUBLIC_AUDIT_FAILED",
    message: getPublicAuditFailureMessage(error),
  });
}

function logTargetResponse(error: unknown): void {
  if (!(error instanceof PublicAuditTargetError) || error.httpStatus === undefined) {
    return;
  }
  const contentType = error.contentType
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 120);
  console.warn(
    "[public-audit] target response",
    JSON.stringify({
      code: error.code,
      status: error.httpStatus,
      finalUrl: error.finalUrl
        ? sanitizePublicAuditUrlForLog(error.finalUrl)
        : null,
      contentType: contentType || null,
    }),
  );
}

export function registerPublicAuditRoutes(
  app: Express,
  options: PublicAuditRouteOptions = {},
): void {
  startPublicAuditQuotaCleanup();
  const createReport = options.createReport ?? createPublicAuditReport;

  app.get(
    "/api/public-audit/quota",
    quotaReadRateLimit,
    async (req, res) => {
      if (!ensureEnabled(res)) return;
      try {
        res.json(await getPublicAuditQuota(req, res));
      } catch {
        res.status(503).json({
          code: "PUBLIC_AUDIT_UNAVAILABLE",
          message: "The public website audit is temporarily unavailable.",
        });
      }
    },
  );

  app.post(
    "/api/public-audit",
    auditRateLimit,
    async (req, res) => {
      if (!ensureEnabled(res)) return;
      if (process.env.NODE_ENV === "production" && !hasSameOrigin(req)) {
        res.status(403).json({
          code: "PUBLIC_AUDIT_FORBIDDEN",
          message: "Start a website check from the FlowPoint website.",
        });
        return;
      }

      const parsed = auditRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          code: "PUBLIC_AUDIT_INVALID_REQUEST",
          message: "Enter a valid public website address.",
        });
        return;
      }

      let reservation: PublicAuditReservation;
      try {
        reservation = await reservePublicAudit(req, res);
      } catch (error) {
        reportError(res, error);
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      timeout.unref();
      const abortOnDisconnect = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.once("close", abortOnDisconnect);

      try {
        const report = await createReport(
          parsed.data.url,
          reservation.quota,
          controller.signal,
        );
        if (!res.writableEnded) res.json(report);
      } catch (error) {
        logTargetResponse(error);
        if (!res.writableEnded) {
          if (error instanceof PublicAuditUnavailableError) {
            reportError(res, error);
          } else {
            res.status(502).json({
              code: "PUBLIC_AUDIT_FAILED",
              message: getPublicAuditFailureMessage(error),
              quota: reservation.quota,
            });
          }
        }
      } finally {
        clearTimeout(timeout);
        res.removeListener("close", abortOnDisconnect);
        await releasePublicAuditSlot(
          reservation.slotId,
          reservation.leaseId,
        ).catch(() => undefined);
      }
    },
  );
}
