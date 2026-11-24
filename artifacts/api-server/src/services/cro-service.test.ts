import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeCroPage, extractCroSignals, deriveCroFindings } from "./cro-service.js";
import type { FetchUrlResult } from "./url-fetcher.js";

const HTML = `<html><head><title>Plomberie Dupont</title></head><body>
<h1>Plombier à Lyon</h1><h1>Autre titre</h1>
<form><input type="text" name="a"><input type="email"><input type="tel"><input name="d"><input name="e"><input name="f"><input name="g">
<textarea></textarea><input type="hidden" name="csrf"><input type="submit" value="Envoyer"></form>
<a class="btn btn-primary" href="/devis">Devis</a>
<p>Texte de la page sans rien de spécial pour le visiteur.</p></body></html>`;

function page(over: Partial<FetchUrlResult> = {}): FetchUrlResult {
  return {
    ok: true, url: "https://exemple.fr/", statusCode: 200, loadTimeMs: 400, title: "Plomberie Dupont",
    bodyText: "Plombier à Lyon Texte de la page sans rien de spécial pour le visiteur.", wordCount: 12, html: HTML, ...over,
  };
}

describe("analyzeCroPage — D-02", () => {
  it("dérive des constats mesurés du HTML réel (champs, H1, viewport)", async () => {
    const aiChat = vi.fn().mockRejectedValue(new Error("AI_NOT_CONFIGURED"));
    const r = await analyzeCroPage("https://exemple.fr/", { fetchPage: async () => page(), aiChat });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signals.formFieldCounts).toEqual([8]);
    expect(r.signals.genericSubmitLabels).toEqual(["Envoyer"]);
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["form-long-0", "generic-submit", "multi-h1", "no-viewport", "no-social-proof"]));
    expect(r.findings.find((f) => f.id === "form-long-0")?.description).toContain("8 champs");
    expect(r.ai.status).toBe("unavailable");
    expect(r.score).toBeNull();
  });

  it("deux pages différentes donnent des constats différents", () => {
    const a = deriveCroFindings(extractCroSignals("<h1>A</h1><button>Acheter</button><meta name=\"viewport\" content=\"x\">", { bodyText: "avis clients", wordCount: 3 }));
    const b = deriveCroFindings(extractCroSignals("<p>rien</p>", { bodyText: "rien", wordCount: 1 }));
    expect(a.map((f) => f.id)).not.toEqual(b.map((f) => f.id));
    expect(b.map((f) => f.id)).toContain("no-cta");
  });

  it("retourne un état 'unavailable' explicite si la page ne peut pas être lue, sans recommandation", async () => {
    const aiChat = vi.fn();
    const r = await analyzeCroPage("https://exemple.fr/", {
      fetchPage: async () => ({ ok: false, url: "https://exemple.fr/", error: "Timeout" }), aiChat,
    });
    expect(r.status).toBe("unavailable");
    expect(r.findings).toEqual([]);
    if (r.status === "unavailable") {
      expect(r.code).toBe("PAGE_FETCH_FAILED");
      expect(r.message).toContain("Timeout");
    }
    expect(aiChat).not.toHaveBeenCalled();
  });

  it("refuse une URL invalide sans appeler le réseau", async () => {
    const fetchPage = vi.fn();
    const r = await analyzeCroPage("pas une url", { fetchPage });
    expect(r.status).toBe("unavailable");
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("n'accepte un constat IA que s'il cite un extrait réellement présent dans la page", async () => {
    const aiChat = vi.fn().mockResolvedValue(JSON.stringify({ findings: [
      { type: "copy", priority: "high", title: "Titre vague", description: "d", quote: "Texte de la page sans rien", implementation: "i" },
      { type: "copy", priority: "high", title: "Inventé", description: "d", quote: "citation absente de la page", implementation: "i" },
    ] }));
    const r = await analyzeCroPage("https://exemple.fr/", { fetchPage: async () => page(), aiChat });
    if (r.status !== "ok") throw new Error("attendu ok");
    const ai = r.findings.filter((f) => f.source === "ai");
    expect(ai.map((f) => f.title)).toEqual(["Titre vague"]);
    expect(r.ai.status).toBe("ok");
  });

  it("ne contient plus de statistiques ni de confiance codées en dur", () => {
    const src = readFileSync(fileURLToPath(new URL("./cro-service.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/67\s?%|9 champs|confidence:\s*0\.\d|estimatedUplift|CRO_ISSUE_TEMPLATES/);
  });
});
