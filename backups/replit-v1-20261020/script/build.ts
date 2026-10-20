import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "fs/promises";
import path from "path";
import { getProductionResourceArticles } from "../shared/resource-articles";
import { appendResourceArticlesToSitemap } from "../shared/resource-sitemap";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();
  await generateProductionSitemap();

  console.log("building SSR bundle...");
  await viteBuild({
    root: path.resolve(import.meta.dirname, "../client"),
    configFile: false,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "../client/src"),
        "@shared": path.resolve(import.meta.dirname, "../shared"),
        "@assets": path.resolve(import.meta.dirname, "../attached_assets"),
      },
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "react",
    },
    build: {
      ssr: "src/entry-server.tsx",
      outDir: path.resolve(import.meta.dirname, "../dist/server"),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          format: "cjs",
        },
      },
    },
    ssr: {
      noExternal: ["wouter"],
    },
  });

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

async function generateProductionSitemap() {
  const sourcePath = path.resolve(import.meta.dirname, "../client/public/sitemap.xml");
  const outputPath = path.resolve(import.meta.dirname, "../dist/public/sitemap.xml");
  const baseSitemap = await readFile(sourcePath, "utf-8");
  const sitemap = appendResourceArticlesToSitemap(
    baseSitemap,
    getProductionResourceArticles(),
  );
  await writeFile(outputPath, sitemap, "utf-8");
  console.log("generated production sitemap from published resource articles");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
