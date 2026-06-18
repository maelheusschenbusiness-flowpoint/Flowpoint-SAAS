/**
 * FlowPoint — Standardized API response helpers
 * All routes should use these instead of raw res.json() for consistency.
 */

import type { Response } from "express";

export interface ApiSuccess<T = unknown> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  ok: false;
  error: string;
  code?: string;
  details?: unknown;
  requestId?: string;
}

export interface PaginatedResponse<T> extends ApiSuccess<T[]> {
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
}

// ── Success responses ─────────────────────────────────────────────────────────
export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200): void {
  res.status(status).json({ ok: true, data, ...(meta ? { meta } : {}) } satisfies ApiSuccess<T>);
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  ok(res, data, meta, 201);
}

export function paginated<T>(
  res: Response,
  data: T[],
  pagination: { page: number; limit: number; total: number },
): void {
  res.json({
    ok: true,
    data,
    pagination: { ...pagination, hasMore: (pagination.page - 1) * pagination.limit + data.length < pagination.total },
  } satisfies PaginatedResponse<T>);
}

export function noContent(res: Response): void {
  res.status(204).send();
}

// ── Error responses ───────────────────────────────────────────────────────────
export function badRequest(res: Response, message: string, details?: unknown): void {
  res.status(400).json({ ok: false, error: message, code: 'BAD_REQUEST', ...(details ? { details } : {}) } satisfies ApiError);
}

export function unauthorized(res: Response, message = 'Unauthorized'): void {
  res.status(401).json({ ok: false, error: message, code: 'UNAUTHORIZED' } satisfies ApiError);
}

export function forbidden(res: Response, message: string, requiredPlan?: string): void {
  res.status(403).json({ ok: false, error: message, code: 'FORBIDDEN', ...(requiredPlan ? { details: { requiredPlan } } : {}) } satisfies ApiError);
}

export function notFound(res: Response, resource = 'Resource'): void {
  res.status(404).json({ ok: false, error: `${resource} not found`, code: 'NOT_FOUND' } satisfies ApiError);
}

export function conflict(res: Response, message: string): void {
  res.status(409).json({ ok: false, error: message, code: 'CONFLICT' } satisfies ApiError);
}

export function tooManyRequests(res: Response, retryAfterSeconds = 60): void {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ ok: false, error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds } } satisfies ApiError);
}

export function quotaExceeded(res: Response, resource: string, limit: number, plan: string): void {
  res.status(429).json({ ok: false, error: `Quota exceeded for ${resource}`, code: 'QUOTA_EXCEEDED', details: { resource, limit, plan } } satisfies ApiError);
}

export function planRequired(res: Response, feature: string, requiredPlan: string): void {
  res.status(403).json({ ok: false, error: `${feature} requires ${requiredPlan} plan`, code: 'PLAN_REQUIRED', details: { feature, requiredPlan } } satisfies ApiError);
}

export function serverError(res: Response, message = 'Internal server error', requestId?: string): void {
  res.status(500).json({ ok: false, error: message, code: 'INTERNAL_ERROR', ...(requestId ? { requestId } : {}) } satisfies ApiError);
}

export function serviceUnavailable(res: Response, service: string): void {
  res.status(503).json({ ok: false, error: `${service} is temporarily unavailable`, code: 'SERVICE_UNAVAILABLE' } satisfies ApiError);
}

// ── Pagination helper ─────────────────────────────────────────────────────────
export function parsePagination(query: Record<string, unknown>, defaultLimit = 20): { page: number; limit: number; offset: number } {
  const page  = Math.max(1, parseInt(String(query.page  ?? '1'),  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? String(defaultLimit)), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}
