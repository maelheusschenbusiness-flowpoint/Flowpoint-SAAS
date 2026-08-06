import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const runtimeDirectories = ["src", "dist", "../flowpoint-export"];
const forbiddenScope = ["https://www.googleapis.com/auth/analytics", ".edit"].join("");
const runtimeExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".map"]);
const ignoredDirectories = new Set(["node_modules", ".git", "coverage"]);

function visit(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : visit(path);
    }
    const extension = path.slice(path.lastIndexOf("."));
    return runtimeExtensions.has(extension) ? [path] : [];
  });
}

const files = runtimeDirectories.flatMap((directoryName) => {
  const directory = join(root, directoryName);
  return existsSync(directory) ? visit(directory) : [];
});

const matches = files.filter((file) =>
  readFileSync(file, "utf8").toLowerCase().includes(forbiddenScope)
);

if (matches.length) {
  console.error(
    `Forbidden Google Analytics write scope found in runtime artifacts:\n${matches
      .map((file) => relative(root, file))
      .join("\n")}`
  );
  process.exit(1);
}

console.log("Google OAuth runtime scope assertion passed.");