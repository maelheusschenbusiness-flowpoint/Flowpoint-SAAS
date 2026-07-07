import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { behavioralOriginAllowlist } from "./routes/behavioral.js";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { requestId } from "./middlewares/requestId.js";
import { orgContext }    from "./middlewares/orgContext.js";
import { dbContext }      from "./middlewares/dbContext.js";
import { globalRateLimit } from "./middlewares/rateLimiter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.set("trust proxy", 1);

// ── 0. Gzip / Brotli response compression ────────────────────────────────────
// Compresses text (JSON, HTML, JS, CSS, SVG) before sending.
// Skip already-compressed formats (images, woff2, gzip, etc.).
app.use(
  compression({
    level: 6,          // balanced CPU vs ratio (default 6)
    threshold: 1024,   // only compress responses ≥ 1 KB
    filter(req, res) {
      // Never compress SSE streams or WebSocket upgrades
      if (req.headers["accept"] === "text/event-stream") return false;
      return compression.filter(req, res);
    },
  }),
);

// ── 1. Request ID injection — first so every log carries it ──────────────────
app.use(requestId);

// ── 2. Structured HTTP logging ────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req as { id?: string }).id ?? "unknown",
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── 3. Security headers ───────────────────────────────────────────────────────
app.use(
  helmet({
    // API server — disable CSP/HSTS (handled by reverse proxy / CDN in prod)
    contentSecurityPolicy: false,
    hsts: process.env["NODE_ENV"] === "production"
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
    // frameguard is applied only on /api/ routes below — dashboard.html must be
    // embeddable in iframes (Replit canvas, partner integrations).
    frameguard: false,
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

// ── 4. CORS ───────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  // Local development
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  // Replit preview
  /\.replit\.dev$/,
  /\.replit\.app$/,
  // FlowPoint production domains (always allowed — safe to hardcode public origins)
  "https://app.flowpoint.pro",
  "https://flowpoint.pro",
  "https://www.flowpoint.pro",
];

// Pull additional allowed origins from every env var name the Render config might use.
// CORS_ORIGIN supports comma-separated list: "https://a.com,https://b.com"
for (const envKey of ["PUBLIC_URL", "PUBLIC_BASE_URL", "APP_URL", "FRONTEND_URL", "CORS_ORIGIN"]) {
  const val = process.env[envKey];
  if (!val) continue;
  for (const raw of val.split(",")) {
    const origin = raw.trim();
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      ALLOWED_ORIGINS.push(origin);
    }
  }
}

logger.info({ allowedOrigins: ALLOWED_ORIGINS.map(o => o.toString()) }, "[CORS] Allowed origins");

app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header = same-origin / server-to-server → always allow
      if (!origin) { cb(null, true); return; }
      // Behavioral tracking origins are managed by their own allowlist
      if (behavioralOriginAllowlist.has(origin)) { cb(null, true); return; }
      const allowed = ALLOWED_ORIGINS.some(p =>
        typeof p === "string" ? p === origin : p.test(origin)
      );
      if (!allowed) {
        // Log the blocked origin so it appears in Render logs — never throw
        // (throwing here propagates as a 500 through Express error handlers).
        logger.warn({ origin }, "[CORS] Blocked origin");
      }
      cb(null, allowed);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Org-Id", "X-Admin-Key", "X-FlowPoint-Token"],
  }),
);

// CORS rejection produces a response with no Access-Control-Allow-Origin header,
// which the browser surfaces as a network error. Return a plain 403 for preflight
// rejections so the cause is visible in Render logs and browser DevTools.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin ?? "";
    const allowed = !origin || ALLOWED_ORIGINS.some(p =>
      typeof p === "string" ? p === origin : p.test(origin)
    );
    if (!allowed) {
      logger.warn({ origin }, "[CORS] Preflight rejected — 403");
      res.status(403).json({ ok: false, error: "CORS: origin not allowed" });
      return;
    }
  }
  next();
});

// ── 5. Stripe raw body (must come before JSON parser) ────────────────────────
// Registered on both paths: canonical /api/webhooks/stripe AND legacy
// /api/billing/webhook (active Stripe Dashboard endpoint).
for (const webhookPath of ["/api/webhooks/stripe", "/api/billing/webhook"]) {
  app.use(
    webhookPath,
    express.raw({ type: "application/json" }),
    (req: Request & { rawBody?: Buffer }, _res: Response, next: NextFunction) => {
      req.rawBody = req.body as Buffer;
      next();
    },
  );
}

// ── 6. Body parsers + cookie parser ──────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── 7. Org/User context extraction from JWT or X-Org-Id header ───────────────
app.use(orgContext);

// ── 7b. Per-request RLS-scoped DB helper (req.orgDb) ─────────────────────────
// Must run after orgContext so req.orgId is already populated.
app.use(dbContext);

// ── 8. Rate limiting + API-level security headers ────────────────────────────
app.use("/api", globalRateLimit);
// X-Frame-Options on API JSON responses (not on dashboard HTML — must be embeddable)
app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// ── 9. Static file serving ────────────────────────────────────────────────────
// express.static only intercepts actual files, so /api/* routes are never blocked.
const dashboardDir = path.resolve(__dirname, "../../flowpoint-export");

// ── HTML page helpers ─────────────────────────────────────────────────────────
function servePage(file: string) {
  return (_req: Request, res: Response): void => {
    const htmlPath = path.join(dashboardDir, file);
    try {
      const html = fs.readFileSync(htmlPath, "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch {
      res.status(500).send(`${file} not found`);
    }
  };
}

// ── Favicon — serve all assets explicitly, never cached ──
app.get(["/favicon.svg", "/api/dashboard/favicon.svg"], (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "favicon.svg"));
});
app.get(["/favicon.ico", "/api/dashboard/favicon.ico"], (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/x-icon");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "favicon.ico"));
});
app.get(["/favicon-32x32.png", "/api/dashboard/favicon-32x32.png"], (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "favicon-32x32.png"));
});
app.get(["/favicon-16x16.png", "/api/dashboard/favicon-16x16.png"], (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "favicon-16x16.png"));
});
app.get(["/apple-touch-icon.png", "/api/dashboard/apple-touch-icon.png"], (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "apple-touch-icon.png"));
});

// ── Frontend page routes ──────────────────────────────────────────────────────
// Landing / Signup page — public marketing & auth entry point
app.get(["/", "/index", "/index.html", "/signup", "/inscription", "/signin", "/signin.html"], servePage("signin.html"));
// Dashboard — primary app entry point (authenticated)
app.get(["/dashboard", "/dashboard.html", "/api/dashboard", "/api/dashboard/", "/api/dashboard/dashboard.html"], servePage("dashboard.html"));
// Login (kept for direct link access / legacy)
app.get(["/login", "/login.html"], servePage("login.html"));
// Login verify (magic-link callback)
app.get(["/login-verify", "/login-verify.html"], servePage("login-verify.html"));
// Pricing
app.get(["/pricing", "/pricing.html"], servePage("pricing.html"));
// Legal pages — redirect to public flowpoint.pro page
app.get(["/legal", "/legal.html", "/informations-legales"], (_req: Request, res: Response) => {
  res.redirect(301, "https://flowpoint.pro/informations-legales");
});
// Report viewer (shared reports by token)
app.get(["/report/:token", "/report-view.html"], servePage("report-view.html"));
// Checkout pages
app.get(["/checkout", "/checkout.html"], servePage("checkout.html"));
app.get(["/checkout-payment", "/checkout-payment.html"], servePage("checkout-payment.html"));
app.get(["/checkout-return", "/checkout-return.html"], servePage("checkout-return.html"));
app.get(["/success", "/success.html"], servePage("success.html"));
app.get(["/cancel", "/cancel.html"], servePage("cancel.html"));

// Smart cache headers for static assets:
//  - HTML pages       → no-store (always fresh, auth-sensitive)
//  - Fonts            → 1 year immutable (never change, no hash needed)
//  - Hashed JS/CSS    → 1 year immutable (filename carries a content hash,
//                       e.g. app.a1b2c3.js — safe to cache forever)
//  - Un-hashed JS/CSS → must-revalidate (dashboard.js/dashboard.css etc ship
//                       under a fixed filename and change on every deploy;
//                       caching these as "immutable" silently served stale
//                       code to returning users for up to a year after any
//                       fix — always revalidate with the server via ETag)
//  - Images           → 7 days (may change without hash)
//  - Everything else  → no-store (safe default)
const HASHED_ASSET_RE = /-[a-f0-9]{8,}\.(js|css)(\?|$)/i;
const staticCache = (req: Request, res: Response, next: Function) => {
  const url = req.url.split("?")[0] ?? "";
  if (/\.(woff2?|ttf|otf)(\?|$)/.test(url)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else if (HASHED_ASSET_RE.test(url)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else if (/\.(js|css)(\?|$)/.test(url)) {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
  } else if (/\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/.test(url)) {
    res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
};
// Dev-only auth helper: never serve in real production deployments
app.get("/dev-login.html", (req: Request, res: Response, next: NextFunction) => {
  if (process.env["NODE_ENV"] === "production" && !process.env["REPLIT_DEV_DOMAIN"]) {
    res.status(404).json({ ok: false, error: "Not found", code: "NOT_FOUND" });
    return;
  }
  next();
});

app.use("/", staticCache, express.static(dashboardDir, { index: false }));
app.use("/api/dashboard", staticCache, express.static(dashboardDir));

// ── 10. All API routes ────────────────────────────────────────────────────────
app.use("/api", router);

// ── 11. 404 handler ──────────────────────────────────────────────────────────
app.use((req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: `Cannot ${req.method} ${req.path}`,
    code: "NOT_FOUND",
    requestId: (req as { id?: string }).id,
  });
});

// ── 12. Centralized error handler — MUST be last ─────────────────────────────
app.use(errorHandler);

export default app;
