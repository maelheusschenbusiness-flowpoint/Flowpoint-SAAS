/**
 * FlowPoint — Request ID middleware
 * Injects a unique request ID for tracing and error correlation.
 */
import type { Request, Response, NextFunction } from "express";

let _counter = 0;
const _pid = process.pid.toString(36);
const _epoch = Date.now().toString(36).slice(-4);

function generateId(): string {
  _counter = (_counter + 1) % 0xffff;
  return `fp-${_epoch}${_pid}-${_counter.toString(36).padStart(4, '0')}`;
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string | undefined) ?? generateId();
  (req as { id?: string }).id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function getRequestId(req: Request): string {
  return (req as { id?: string }).id ?? 'unknown';
}
