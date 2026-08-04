import type { Request, Response, NextFunction } from "express";

const _cache = new Map<string, { ts: number; data: unknown }>();

export function withCache(ttlSeconds: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Key MUST include the org, otherwise org-scoped responses leak across tenants
    const orgId = (req as Request & { orgId?: string }).orgId ?? "anon";
    const key = `${orgId}:${req.originalUrl || req.url}`;
    const now = Date.now();
    const hit = _cache.get(key);
    if (hit && now - hit.ts < ttlSeconds * 1000) {
      res.setHeader("X-Cache", "HIT");
      res.json(hit.data);
      return;
    }
    const _origJson = res.json.bind(res);
    res.json = (body: unknown) => {
      _cache.set(key, { ts: now, data: body });
      res.setHeader("X-Cache", "MISS");
      return _origJson(body);
    };
    next();
  };
}

export function clearCache(prefix?: string) {
  if (!prefix) { _cache.clear(); return; }
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}
