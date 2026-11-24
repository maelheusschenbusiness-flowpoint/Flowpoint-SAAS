/**
 * AI GBP Posting : la file de publication (gbp_post_queue) et la mediatheque (gbp_media_assets) ne sont alimentees
 * par aucun code. Aucune interface ne doit les presenter comme fonctionnelles : pas d'appel a /queue ou /media,
 * pas de bouton de televersement ; la carte « Publication de posts GBP » reste explicitement « Bientôt ».
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files: Record<string, string> = {
  "src/frontend/dashboard.js": readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8"),
  "artifacts/flowpoint-export/dashboard.js": readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8"),
};

describe.each(Object.entries(files))("GBP Posting UI — %s", (_l, src) => {
  it("n'appelle jamais /api/gbp-posts/queue ni /api/gbp-posts/media", () => {
    expect(src).not.toMatch(/gbp-posts\/(queue|media)/);
    expect(src).not.toMatch(/gbp_post_queue|gbp_media_assets/);
  });

  it("l'API cliente GBP n'expose ni file d'attente ni televersement de medias", () => {
    const i = src.indexOf("window.FP_GBP_POSTS_API = {");
    expect(i).toBeGreaterThan(-1);
    const api = src.slice(i, src.indexOf("};", i));
    expect(api).not.toMatch(/queue|media|upload/i);
  });

  it("la publication de posts GBP est annoncee « Bientôt » (aucun bouton de publication actif)", () => {
    const i = src.indexOf("Publication de posts GBP</div>");
    expect(i).toBeGreaterThan(-1);
    const card = src.slice(i - 400, i + 700);
    expect(card).toContain("bientôt disponible");
    expect(card).toContain(">Bientôt<");
    expect(card).not.toMatch(/<button|type="file"/);
  });
});
