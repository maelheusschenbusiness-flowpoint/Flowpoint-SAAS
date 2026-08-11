/**
 * FlowPoint — Zod-based request validation factory
 * Creates middleware that validates body/query/params and returns
 * structured 400 errors on failure.
 */

import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger.js";

type ValidateTarget = 'body' | 'query' | 'params';

export function validate<T extends z.ZodTypeAny>(
  schema: T,
  target: ValidateTarget = 'body',
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const issues = result.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
      logger.debug({ issues, target, url: req.url }, '[Validator] Validation failed');
      res.status(400).json({
        ok: false,
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        details: { issues },
      });
      return;
    }
    // Attach parsed data back to request
    (req as unknown as Record<string, unknown>)[`validated_${target}`] = result.data as unknown;
    next();
  };
}

/** Get validated data attached by validate() middleware */
export function validated<T>(req: Request, target: ValidateTarget = 'body'): T {
  return (req as unknown as Record<string, unknown>)[`validated_${target}`] as T;
}

// ── Shared schemas ────────────────────────────────────────────────────────────
export const paginationSchema = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({
  id: z.string().min(1).max(200),
});

export const orgIdSchema = z.object({
  orgId: z.string().min(1).max(100).default('default'),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to:   z.string().datetime().optional(),
});

export const urlSchema = z.object({
  url: z.string().url(),
});

// ── Domain-specific schemas ───────────────────────────────────────────────────
export const createHeatmapSchema = z.object({
  name:       z.string().min(1).max(200),
  keyword:    z.string().min(1).max(200),
  centerLat:  z.number().min(-90).max(90),
  centerLng:  z.number().min(-180).max(180),
  radiusKm:   z.number().min(0.5).max(100).optional().default(5),
  gridSize:   z.union([z.literal(5), z.literal(7), z.literal(9)]).optional().default(7),
  locationId: z.string().optional(),
});

export const createSSOProviderSchema = z.object({
  providerType:  z.string().min(1),
  name:          z.string().min(1).max(200),
  domain:        z.string().optional(),
  clientId:      z.string().optional(),
  clientSecret:  z.string().optional(),
  metadataUrl:   z.string().url().optional(),
  ssoUrl:        z.string().url().optional(),
  scopes:        z.array(z.string()).optional(),
  autoProvision: z.boolean().optional().default(true),
  defaultRoleId: z.string().optional(),
});

export const analyzeReviewSchema = z.object({
  reviewText:  z.string().min(1).max(5000),
  authorName:  z.string().optional(),
  rating:      z.number().int().min(1).max(5).optional(),
  language:    z.string().optional().default('fr'),
  generateReply: z.boolean().optional().default(false),
});

export const createGBPPostSchema = z.object({
  locationId: z.string().min(1),
  postType:   z.enum(['standard', 'offer', 'event', 'update']),
  content:    z.string().min(1).max(1500),
  mediaUrls:  z.array(z.string().url()).optional(),
  scheduledAt: z.string().datetime().optional(),
  keywords:   z.array(z.string()).optional(),
  ctaType:    z.enum(['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL', 'none']).optional(),
  ctaUrl:     z.string().url().optional(),
});

export { z };
