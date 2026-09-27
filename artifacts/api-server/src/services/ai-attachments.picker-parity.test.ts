/**
 * Parity check between the server-side AI attachment allowlist and the file
 * pickers of the AI assistant in the exported dashboard.
 *
 * This test DOCUMENTS the current state: the pickers offer fewer extensions
 * than the server accepts, which is why a .md file is greyed out by the OS
 * file dialog even though the AI pipeline would accept it.
 *
 * Both sides are read as text on purpose: AI_ALLOWED_MIME is module-private
 * and the pickers live in a static HTML/JS export. Each side is pinned
 * exactly, so changing one side without the other turns this test red.
 */
import { readFileSync }         from "node:fs";
import { fileURLToPath }        from "node:url";
import { dirname, resolve }     from "node:path";
import { describe, expect, it } from "vitest";

const HERE             = dirname(fileURLToPath(import.meta.url));
const SERVER_ALLOWLIST = resolve(HERE, "ai-attachments.ts");
const DASHBOARD_HTML   = resolve(HERE, "../../../flowpoint-export/dashboard.html");
const DASHBOARD_JS     = resolve(HERE, "../../../flowpoint-export/dashboard.js");

// The two pickers wired to the AI assistant (team-chat pickers are excluded).
const PICKERS = [
  { label: "dashboard.html #fp-ai-attach-input", file: DASHBOARD_HTML, id: "fp-ai-attach-input" },
  { label: "dashboard.js #ai-file-input",        file: DASHBOARD_JS,   id: "ai-file-input" },
];

/** [mime, extension] pairs declared in AI_ALLOWED_MIME. */
function serverPairs(): [string, string][] {
  const src   = readFileSync(SERVER_ALLOWLIST, "utf8");
  const start = src.indexOf("const AI_ALLOWED_MIME");
  const end   = src.indexOf("};", start);
  if (start < 0 || end < 0) throw new Error("AI_ALLOWED_MIME literal not found");
  return [...src.slice(start, end).matchAll(/"([^"]+\/[^"]+)"\s*:\s*"([a-z0-9]+)"/g)]
    .map((m): [string, string] => [m[1], m[2]]);
}

/** Tokens of the accept="" attribute of the <input> carrying `id`. */
function acceptTokens(file: string, id: string): string[] {
  const src  = readFileSync(file, "utf8");
  const re   = new RegExp(`<input\\b[^>]{0,200}id="${id}"[^>]{0,200}accept="([^"]*)"`, "g");
  const hits = [...src.matchAll(re)];
  if (hits.length !== 1) {
    throw new Error(`expected exactly 1 accept-carrying <input id="${id}">, found ${hits.length}`);
  }
  return hits[0][1].split(",").map(t => t.trim()).filter(Boolean);
}

/** Server extensions that the picker does not offer (image/* covers image MIMEs). */
function missingFromPicker(pairs: [string, string][], tokens: string[]): string[] {
  const offered = new Set<string>();
  for (const token of tokens) {
    if (token === "image/*") {
      for (const [mime, ext] of pairs) if (mime.startsWith("image/")) offered.add(ext);
    } else if (token.startsWith(".")) {
      offered.add(token.slice(1).toLowerCase());
    }
  }
  const missing = pairs.filter(([, ext]) => !offered.has(ext)).map(([, ext]) => ext);
  return [...new Set(missing)].sort();
}

describe("AI attachment allowlist vs assistant file pickers", () => {
  it("the server allowlist accepts these extensions", () => {
    const pairs = serverPairs();
    expect(pairs).toHaveLength(12);
    expect([...new Set(pairs.map(([, ext]) => ext))].sort()).toEqual([
      "csv", "docx", "jpg", "json", "md", "pdf", "png", "txt", "webp", "xls", "xlsx",
    ]);
  });

  it("each assistant picker offers these extensions", () => {
    expect(acceptTokens(DASHBOARD_HTML, "fp-ai-attach-input")).toEqual([
      "image/*", ".pdf", ".txt", ".csv", ".docx", ".xlsx",
    ]);
    expect(acceptTokens(DASHBOARD_JS, "ai-file-input")).toEqual([
      "image/*", ".pdf", ".csv", ".txt", ".docx", ".xlsx",
    ]);
  });

  // Today's gap: json, md and xls are accepted by the server but greyed out
  // by both pickers. md is the extension the dashboard user reported.
  it.each(PICKERS)("$label omits json, md and xls", ({ file, id }) => {
    expect(missingFromPicker(serverPairs(), acceptTokens(file, id)))
      .toEqual(["json", "md", "xls"]);
  });
});
