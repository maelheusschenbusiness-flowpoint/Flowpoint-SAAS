import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { isPublicPath } from "./routes/public-paths";
import { injectMetadata } from "./seo-metadata";
import { getPublishedResourceArticles } from "@shared/resource-articles";
import { appendResourceArticlesToSitemap } from "@shared/resource-sitemap";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.get("/sitemap.xml", async (_req, res, next) => {
    try {
      const sitemapPath = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "public",
        "sitemap.xml",
      );
      const baseSitemap = await fs.promises.readFile(sitemapPath, "utf-8");
      const sitemap = appendResourceArticlesToSitemap(
        baseSitemap,
        getPublishedResourceArticles(),
      );
      res.status(200).type("application/xml").send(sitemap);
    } catch (error) {
      next(error);
    }
  });

  app.use(vite.middlewares);

  app.use(async (req, res, next) => {
    const url = req.originalUrl;

    if (req.method !== "GET") {
      return next();
    }

    if (
      url.startsWith("/api") ||
      url.startsWith("/src") ||
      url.startsWith("/@vite") ||
      url.startsWith("/node_modules") ||
      url === "/favicon.png" ||
      url === "/apple-touch-icon.png" ||
      url === "/robots.txt" ||
      url === "/sitemap.xml" ||
      url === "/llms.txt"
    ) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const transformed = await vite.transformIndexHtml(url, template);
      const pathname = req.path;
      const page = injectMetadata(transformed, pathname);
      const status = isPublicPath(pathname) ? 200 : 404;

      let finalPage = page;
      try {
        const { render } = (await vite.ssrLoadModule(
          "/src/entry-server.tsx",
        )) as { render: (url: string) => string };
        const appHtml = render(pathname);
        finalPage = page.replace(
          '<div id="root"></div>',
          `<div id="root">${appHtml}</div>`,
        );
      } catch (ssrErr) {
        viteLogger.warn(
          `SSR render failed for ${pathname}, serving SPA shell: ${(ssrErr as Error).message}`,
          { timestamp: true },
        );
      }

      res.status(status).set({ "Content-Type": "text/html" }).end(finalPage);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
