import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { isPublicPath } from "./routes/public-paths";

const app = express();
const httpServer = createServer(app);

// The published app is reached through Replit's single reverse proxy.
// Trusting exactly one hop lets express-rate-limit use the real client IP
// from X-Forwarded-For without trusting arbitrary proxy chains.
app.set("trust proxy", 1);

app.use((_req, res, next) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.ROBOTS_NOINDEX === "true") {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
  }
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/favicon.ico", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, "/favicon.png?v=3");
});

app.use(
  express.json(),
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const isHomepage = req.method === "GET" && path === "/";
    if (path.startsWith("/api") || isHomepage || path === "/healthz") {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (isHomepage && /googlebot/i.test(req.get("user-agent") || "")) {
        logLine += " :: crawler=Googlebot";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  app.use((req, res) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      const status = isPublicPath(req.path) ? 200 : 404;
      res.status(status).sendFile("index.html", { root: "client" });
      return;
    }
    res.status(404).json({ message: "Not Found" });
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
