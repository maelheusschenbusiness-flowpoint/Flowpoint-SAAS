import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { isPublicPath } from "./routes/public-paths";
import { injectMetadata } from "./seo-metadata";
import { resolveMarketingLanguage } from "@shared/marketing-language";

let cachedHtml: string | null = null;
let ssrRender: ((url: string, language?: string) => string) | null = null;
let ssrRenderLoaded = false;

function getIndexHtml(distPath: string): string {
  if (!cachedHtml) {
    cachedHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
  }
  return cachedHtml;
}

function getSsrRender(): ((url: string, language?: string) => string) | null {
  if (ssrRenderLoaded) return ssrRender;
  ssrRenderLoaded = true;
  const candidates = [
    path.resolve(__dirname, "server", "entry-server.cjs"),
    path.resolve(__dirname, "server", "entry-server.js"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) {
    try {
      const mod = require(found);
      ssrRender = typeof mod.render === "function" ? mod.render : null;
    } catch (e) {
      console.warn("[static] SSR bundle load failed:", (e as Error).message);
      ssrRender = null;
    }
  }
  return ssrRender;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Do not let express.static serve index.html automatically for `/`.
  // The homepage must pass through the SSR middleware below so crawlers
  // receive the rendered page instead of an empty React root.
  app.use(express.static(distPath, { index: false }));

  app.use((req, res, next) => {
    // Match GET status and headers for HEAD requests; Express omits the body.
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ message: "Not Found" });
    }
    const pathname = req.path;
    const status = isPublicPath(pathname) ? 200 : 404;
    try {
      const isPricingPath = pathname === "/pricing" || pathname === "/tarifs";
      const language = isPricingPath
        ? resolveMarketingLanguage(req.originalUrl, req.get("cookie"))
        : "en";
      if (isPricingPath) {
        res.vary("Cookie");
        res.set("Cache-Control", "private, no-store");
      }

      const raw = getIndexHtml(distPath);
      const page = injectMetadata(
        raw,
        pathname,
        language,
      );

      const render = getSsrRender();
      if (render) {
        try {
          const appHtml = render(pathname, language);
          const finalPage = page.replace(
            '<div id="root"></div>',
            `<div id="root">${appHtml}</div>`,
          );
          if (req.method === "HEAD") {
            res.status(status).type("html").end();
          } else {
            res.status(status).type("html").send(finalPage);
          }
          return;
        } catch (ssrErr) {
          console.warn("[static] SSR render failed:", (ssrErr as Error).message);
        }
      }

      if (req.method === "HEAD") {
        res.status(status).type("html").end();
      } else {
        res.status(status).type("html").send(page);
      }
    } catch {
      res.status(status).sendFile(path.resolve(distPath, "index.html"));
    }
  });
}
