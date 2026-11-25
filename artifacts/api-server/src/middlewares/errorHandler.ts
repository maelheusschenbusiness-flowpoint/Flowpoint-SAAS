/**
 * FlowPoint — Centralized Express error handler
 * Must be registered LAST in app.use() chain.
 * Catches all errors thrown/passed via next(err).
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, AppError);
  }
}

export class PlanError extends AppError {
  constructor(feature: string, requiredPlan: string) {
    super(403, 'PLAN_REQUIRED', `${feature} requires ${requiredPlan} plan`, { feature, requiredPlan });
    this.name = 'PlanError';
  }
}

export class QuotaError extends AppError {
  constructor(resource: string, limit: number, plan: string) {
    super(429, 'QUOTA_EXCEEDED', `Quota exceeded for ${resource}`, { resource, limit, plan });
    this.name = 'QuotaError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fields?: unknown) {
    super(400, 'VALIDATION_ERROR', message, fields);
    this.name = 'ValidationError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  // Guard: if response already started, delegate to default Express error handler
  // to avoid ERR_HTTP_HEADERS_SENT crashes.
  if (res.headersSent) { next(err); return; }

  const requestId = (req as { id?: string }).id ?? 'unknown';
  const isProduction = process.env.NODE_ENV === 'production';

  // Known application errors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId, method: req.method, url: req.url }, `[Error] ${err.code}: ${err.message}`);
    } else {
      logger.warn({ err: { code: err.code, message: err.message }, requestId }, `[Error] ${err.code}`);
    }
    res.status(err.statusCode).json({
      ok: false,
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
      requestId,
    });
    return;
  }

  // Stripe errors
  if (err && typeof err === 'object' && 'type' in err && typeof (err as { type: unknown }).type === 'string' && (err as { type: string }).type.startsWith('Stripe')) {
    const stripeErr = err as { type: string; message?: string; code?: string };
    logger.warn({ stripeError: stripeErr.type, requestId }, '[Error] Stripe error');
    res.status(402).json({ ok: false, error: stripeErr.message ?? 'Payment error', code: stripeErr.code ?? 'STRIPE_ERROR', requestId });
    return;
  }

  // Client errors raised by body-parser / http-errors (payload too large, malformed JSON, ...):
  // they carry a 4xx `status` and `expose: true`; answering 500 hides a client mistake as a server fault.
  if (err && typeof err === 'object') {
    const httpErr = err as { status?: unknown; type?: unknown; expose?: unknown };
    if (typeof httpErr.status === 'number' && httpErr.status >= 400 && httpErr.status < 500 && httpErr.expose === true) {
      const tooLarge = httpErr.type === 'entity.too.large';
      res.status(httpErr.status).json({
        ok: false,
        error: tooLarge ? 'Request body too large' : 'Invalid request',
        code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
        requestId,
      });
      return;
    }
  }

  // Generic errors
  const message = err instanceof Error ? err.message : String(err);
  const stack   = err instanceof Error ? err.stack : undefined;

  logger.error({ err: { message, stack: isProduction ? undefined : stack }, requestId, method: req.method, url: req.url }, '[Error] Unhandled error');

  res.status(500).json({
    ok: false,
    error: isProduction ? 'Internal server error' : message,
    code: 'INTERNAL_ERROR',
    requestId,
    ...(!isProduction && stack ? { stack: stack.split('\n').slice(0, 5) } : {}),
  });
}

/** Wrap async route handlers to forward errors to errorHandler */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
