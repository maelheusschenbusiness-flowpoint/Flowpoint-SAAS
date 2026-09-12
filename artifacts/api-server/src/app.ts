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

// Only the directly-connected deployment proxy is trusted. Express will then
// use the client address supplied by that proxy; never accept arbitrary
// multi-hop X-Forwarded-For chains from the public internet.
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pinoMiddleware = (pinoHttp as any)({
  logger,
  genReqId: (req: { id?: string }) => req.id ?? "unknown",
  serializers: {
    req: (req: { id?: string; method?: string; url?: string }) => ({
      id: req.id, method: req.method, url: req.url?.split("?")[0],
    }),
    res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
  },
}) as import("express").RequestHandler;
app.use(pinoMiddleware);

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

// ── CSP for HTML pages ────────────────────────────────────────────────────────
// Applied only to HTML page responses — NOT to JSON API responses.
// The API server uses helmet({ contentSecurityPolicy: false }) because
// API JSON responses don't need CSP.  HTML pages served to browsers do.
//
// Directive rationale:
//  script-src   'unsafe-inline' required: dashboard.js uses many inline onclick=
//               handlers.  'unsafe-eval' required: no dynamic eval in current
//               code but Stripe.js and Google Maps need it.
//  style-src    'unsafe-inline': inline style attributes throughout dashboard.
//  img-src      data: for inline SVG/base64, blob: for canvas export.
//  connect-src  self + Stripe API + Google APIs (Maps, GSC) + Resend CDN.
//  frame-src    Stripe payment iframes.
//  object-src   'none': block Flash/plugins.
//  base-uri     'self': prevent base tag injection.
//  form-action  'self': prevent form hijacking.
const CSP_HTML = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://maps.googleapis.com https://*.replit.dev https://*.replit.app",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self' https://api.stripe.com https://maps.googleapis.com https://maps.gstatic.com https://fonts.googleapis.com https://*.onrender.com https://*.replit.dev https://*.replit.app https://api.resend.com",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// ── HTML page helpers ─────────────────────────────────────────────────────────
function servePage(file: string) {
  return (_req: Request, res: Response): void => {
    const htmlPath = path.join(dashboardDir, file);
    try {
      let html = fs.readFileSync(htmlPath, "utf8");
      // Force browsers to load the latest JS/CSS by injecting a dynamic
      // cache-bust timestamp. This avoids stale cached scripts across restarts.
      const ts = Date.now();
      html = html.replace(/\?v=\d+[a-z]?"/g, `?v=${ts}"`);
      // For signin.html: inject signin-extras.js which handles:
      //   • ?deleted=1  — clear all storage + show deletion confirmation banner
      //   • pre-redirect — clear fp:last-route so re-registration always lands on overview
      // The file lives alongside other frontend assets and is pushed independently,
      // avoiding the WAF rule that blocks direct blob updates to signin.html.
      if (file === "signin.html") {
        const extrasTag = `<script src="/signin-extras.js?v=${ts}" defer></script>`;
        html = html.replace("</head>", `${extrasTag}\n</head>`);
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", CSP_HTML);
      res.send(html);
    } catch {
      res.status(500).send(`${file} not found`);
    }
  };
}

// ── Favicon — serve all assets explicitly, never cached ──
app.get("/favicon.svg", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "favicon.svg"));
});
app.get("/favicon.ico", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/x-icon");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "favicon.ico"));
});
app.get("/favicon-32x32.png", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "favicon-32x32.png"));
});
app.get("/favicon-16x16.png", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "favicon-16x16.png"));
});
app.get("/apple-touch-icon.png", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(dashboardDir, "apple-touch-icon.png"));
});

// ── Well-known / crawler files — public, no auth, fast inline response ───────
app.get("/robots.txt", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(
    "User-agent: *\n" +
    "Disallow: /api/\n" +
    "Disallow: /checkout\n" +
    "Disallow: /checkout-payment\n" +
    "Disallow: /checkout-return\n" +
    "Disallow: /dashboard\n" +
    "Disallow: /login-verify\n" +
    "Allow: /\n" +
    "\n" +
    "Sitemap: https://app.flowpoint.pro/sitemap.xml\n"
  );
});

app.get("/sitemap.xml", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    '  <url><loc>https://app.flowpoint.pro/</loc></url>\n' +
    '  <url><loc>https://app.flowpoint.pro/pricing.html</loc></url>\n' +
    '  <url><loc>https://app.flowpoint.pro/login.html</loc></url>\n' +
    '</urlset>\n'
  );
});

app.get("/.well-known/security.txt", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(
    "Contact: mailto:security@flowpoint.pro\n" +
    "Expires: 2027-07-13T00:00:00Z\n" +
    "Preferred-Languages: fr, en\n"
  );
});

// ── Frontend page routes ──────────────────────────────────────────────────────
// Landing / Signup page — public marketing & auth entry point
app.get("/index.html", (_req: Request, res: Response) => res.redirect(301, "/signin.html"));
app.get("/", (_req: Request, res: Response) => res.redirect(301, "/signin.html"));
app.get(["/index", "/signup", "/inscription", "/signin", "/signin.html"], servePage("signin.html"));
// Dashboard — primary app entry point (authenticated)
// Server-side gate: if no fp_token cookie is present the visitor is definitely
// unauthenticated (sessionStorage tokens never reach the server).  We redirect
// to signin.html so that CTAs on flowpoint.pro (or any direct link to
// /dashboard.html) never land an unauthenticated visitor directly on the app.
// Authenticated users with a valid cookie pass through instantly (<1ms); users
// whose cookie has expired will be re-verified by signin.html session-restore.
app.get(["/dashboard", "/dashboard.html"], (req: Request, res: Response) => {
  const cookieToken: string = (req as any).cookies?.fp_token ?? "";
  if (!cookieToken) {
    // No httpOnly cookie → definitely not logged in → send to signin
    logger.info(
      {
        source: req.headers.referer ?? "(direct)",
        target: "/signin.html",
        ip: req.ip ?? "(unknown)",
        userAgent: (req.headers["user-agent"] as string | undefined)?.slice(0, 80) ?? "",
        hasCookie: false,
      },
      "[MARKETING AUTH REDIRECT] Unauthenticated /dashboard.html → /signin.html"
    );
    res.redirect(302, "/signin.html");
    return;
  }
  logger.debug({ source: req.headers.referer ?? "(direct)", hasCookie: true }, "[MARKETING AUTH REDIRECT] Cookie present — serving dashboard.html");
  servePage("dashboard.html")(req, res);
});
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
app.get(["/report/:token", "/r/:token", "/report-view.html"], servePage("report-view.html"));
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
// ── SEO & Security standard files ────────────────────────────────────────────
app.get("/robots.txt", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(
    [
      "User-agent: *",
      "Disallow: /api/",
      "Disallow: /checkout",
      "Disallow: /checkout-payment.html",
      "Disallow: /checkout-return.html",
      "Disallow: /login-verify.html",
      "",
      "Sitemap: https://app.flowpoint.pro/sitemap.xml",
    ].join("\n"),
  );
});

app.get("/sitemap.xml", (_req: Request, res: Response): void => {
  const ts = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://app.flowpoint.pro/</loc><lastmod>${ts}</lastmod><changefreq>monthly</changefreq><priority>1.0</priority></url>\n  <url><loc>https://app.flowpoint.pro/pricing.html</loc><lastmod>${ts}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n  <url><loc>https://app.flowpoint.pro/login.html</loc><lastmod>${ts}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>\n</urlset>`,
  );
});

app.get("/.well-known/security.txt", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  res.send(
    [
      "Contact: mailto:security@flowpoint.pro",
      `Expires: ${expires}`,
      "Preferred-Languages: fr, en",
      "Policy: https://flowpoint.pro/politique-de-confidentialite",
    ].join("\n"),
  );
});

// ── Legacy /api/dashboard/* aliases — redirect to canonical URL ──────────────
// These routes were removed; redirect any lingering bookmarks to /dashboard.html
app.get(["/api/dashboard", "/api/dashboard/", "/api/dashboard/dashboard.html"], (_req: Request, res: Response) => {
  res.redirect(301, "/dashboard.html");
});

app.use("/", staticCache, express.static(dashboardDir, { index: false }));

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
