import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildRecommendationTranslationRequestId,
  buildConfirmationPreview,
  getRecommendationCanonicalSource,
  normalizeRecommendationLanguage,
  parseRecommendationTranslations,
  RECOMMENDATION_UI_LANGUAGES,
} from "./ai.js";
import { MISSION_TOOLS } from "../agent/mission-tools.js";
import { CALENDAR_TOOLS } from "../agent/calendar-tools.js";
import { AUDIT_TOOLS } from "../agent/audit-tools.js";
import { MONITOR_TOOLS } from "../agent/monitor-tools.js";
import { RECOMMENDATION_TOOLS } from "../agent/recommendation-tools.js";

/**
 * Task #515 — la carte de confirmation doit afficher un libellé lisible pour
 * TOUS les outils confirmables, jamais un nom brut comme « run_audit ».
 */
describe("buildConfirmationPreview — libellés humains", () => {
  it("run_audit FR : phrase claire avec l'URL, pas de nom d'outil brut", () => {
    const p = buildConfirmationPreview("run_audit", { url: "https://example.com" }, "fr");
    expect(p).toContain("Lancer un audit SEO complet");
    expect(p).toContain("https://example.com");
    expect(p).not.toContain("run_audit");
  });

  it("run_audit EN : clear sentence with the URL", () => {
    const p = buildConfirmationPreview("run_audit", { url: "https://example.com" }, "en-US");
    expect(p).toContain("Run a full SEO audit");
    expect(p).toContain("https://example.com");
    expect(p).not.toContain("run_audit");
  });

  it("run_audit ES : frase clara", () => {
    const p = buildConfirmationPreview("run_audit", { url: "https://example.com" }, "es");
    expect(p).toContain("auditoría SEO completa");
    expect(p).not.toContain("run_audit");
  });

  it("run_audit sans URL : fallback « votre site »", () => {
    const p = buildConfirmationPreview("run_audit", {}, "fr");
    expect(p).toContain("votre site");
  });

  it("rerun_audit FR : libellé humain", () => {
    const p = buildConfirmationPreview("rerun_audit", { auditId: "a1" }, "fr");
    expect(p).toContain("Relancer l'audit");
    expect(p).not.toContain("rerun_audit");
  });

  it("TOUS les outils confirmables (preview/full) du registre : jamais de nom brut, en fr/en/es", () => {
    const allConfirmable = [
      ...MISSION_TOOLS, ...CALENDAR_TOOLS, ...AUDIT_TOOLS,
      ...MONITOR_TOOLS, ...RECOMMENDATION_TOOLS,
    ].filter((t) => t.confirmationLevel === "preview" || t.confirmationLevel === "full");
    expect(allConfirmable.length).toBeGreaterThan(20); // sanity: le registre est bien chargé
    for (const tool of allConfirmable) {
      for (const lang of ["fr", "en", "es"]) {
        const p = buildConfirmationPreview(tool.name, {}, lang);
        // Le fallback brut est « Exécuter l'action "<tool>" » (et variantes en/es) —
        // aucun outil enregistré ne doit y retomber.
        expect(p, `${tool.name} (${lang})`).not.toContain(`"${tool.name}"`);
        expect(p, `${tool.name} (${lang})`).not.toMatch(/Exécuter l'action|Run the "|Ejecutar la acción/);
      }
    }
  });

  it("configure_monitor : création vs modification, avec détails", () => {
    const create = buildConfirmationPreview("configure_monitor", { url: "https://x.com", name: "Prod" }, "fr");
    expect(create).toContain("Créer un nouveau monitor");
    expect(create).toContain("https://x.com");
    const update = buildConfirmationPreview("configure_monitor", { monitor_id: "m1", name: "Prod" }, "en");
    expect(update).toContain("Update the monitor settings");
    expect(update).toContain('"Prod"');
    expect(buildConfirmationPreview("configure_monitor", {}, "es")).toContain("monitor");
  });

  it("outil totalement inconnu : fallback générique conservé", () => {
    const p = buildConfirmationPreview("some_unknown_tool", {}, "fr");
    expect(p).toContain("some_unknown_tool"); // fallback explicite, acceptable
  });

  it("missions : libellés existants inchangés", () => {
    expect(buildConfirmationPreview("delete_mission", { id: "m1" }, "fr")).toContain("Supprimer définitivement");
    expect(buildConfirmationPreview("create_mission", { title: "T" }, "en")).toContain('Create a mission titled "T"');
  });
});

describe("persisted recommendation localization", () => {
  it("normalizes all supported regional UI locales and rejects unsupported ones", () => {
    for (const language of ["fr", "en", "es", "de", "it", "pt", "nl", "pl", "sv", "ro", "cs"]) {
      expect(RECOMMENDATION_UI_LANGUAGES.has(language)).toBe(true);
      expect(normalizeRecommendationLanguage(`${language}-XX`)).toBe(language);
    }
    expect(normalizeRecommendationLanguage("ja")).toBeNull();
    expect(normalizeRecommendationLanguage(["en"])).toBeNull();
  });

  it("accepts valid provider JSON only for requested recommendation IDs", () => {
    const parsed = parseRecommendationTranslations(
      '```json\n{"translations":[' +
        '{"id":"tenant-rec-1","title":"Localized title","description":"Localized description"},' +
        '{"id":"another-tenant-rec","title":"Do not use","description":"Do not use"},' +
        '{"id":"tenant-rec-2","title":"","description":"Incomplete"}' +
      "]}\n```",
      new Set(["tenant-rec-1", "tenant-rec-2"]),
    );
    expect(parsed).toEqual(new Map([
      ["tenant-rec-1", { title: "Localized title", description: "Localized description" }],
    ]));
    expect(parseRecommendationTranslations("not json", new Set(["tenant-rec-1"]))).toEqual(new Map());
  });

  it("always translates a localized persisted recommendation from its retained French source", () => {
    expect(getRecommendationCanonicalSource({
      title: "English persisted title",
      description: "English persisted description",
      metadata: {
        language: "en",
        requestedLanguage: "en",
        sourceLanguage: "fr",
        originalTitle: "Titre source français",
        originalDescription: "Description source française",
      },
    })).toEqual({
      title: "Titre source français",
      description: "Description source française",
      sourceLanguage: "fr",
    });
  });

  it("uses a stable billing idempotency key for the same logical translation", () => {
    const rows = [{
      id: "rec-1",
      sourceLanguage: "fr",
      title: "Titre source",
      description: "Description source",
    }];
    const first = buildRecommendationTranslationRequestId("org-1", "de", rows);
    expect(buildRecommendationTranslationRequestId("org-1", "de", rows)).toBe(first);
    expect(buildRecommendationTranslationRequestId("org-1", "en", rows)).not.toBe(first);
  });

  it("keeps provider localization behind rate, module, quota, accounting, and a DB single-flight lock", () => {
    const routeSource = readFileSync(new URL("./ai.ts", import.meta.url), "utf8");
    const start = routeSource.indexOf("export async function recommendationsHandler");
    const end = routeSource.indexOf('router.get("/ai/recommendations"', start);
    const recommendationHandler = routeSource.slice(start, end);
    expect(routeSource).toContain('router.get("/ai/recommendations", aiRateLimit, recommendationsHandler)');
    expect(recommendationHandler).toContain("pg_advisory_lock");
    expect(recommendationHandler).toContain("const settled = await withOrgDbClient(");
    expect(recommendationHandler).toContain("await withOrgDbClient(client, orgId, async (orgClient)");
    expect(recommendationHandler).toContain('checkModuleEnabled(aiPrefs, "aiStrategist")');
    expect(recommendationHandler).toContain('checkAIQuota({ feature: "strategist", orgId })');
    expect(recommendationHandler).toContain("checkDistributedAiProviderRateLimit(");
    expect(recommendationHandler).toContain("await recordCompletedUsage({");
    expect(recommendationHandler).toContain("buildRecommendationTranslationRequestId(");
    expect(recommendationHandler).toContain("translationResults");
    const rateLimiterSource = readFileSync(new URL("../middlewares/rateLimiter.ts", import.meta.url), "utf8");
    const distributedStart = rateLimiterSource.indexOf("export async function checkDistributedAiProviderRateLimit");
    const distributedEnd = rateLimiterSource.indexOf("/** General API rate limiter", distributedStart);
    const distributedLimiter = rateLimiterSource.slice(distributedStart, distributedEnd);
    expect(distributedLimiter).toContain("const result = await runOrgScoped(");
    expect(rateLimiterSource).toContain("withOrgDbClient(existingClient, orgId, callback)");
    expect(distributedLimiter).toContain("ON CONFLICT (org_id, bucket) DO UPDATE");

    const toolSource = readFileSync(new URL("../agent/tool-executor.ts", import.meta.url), "utf8");
    const toolStart = toolSource.indexOf('if (name2 === "generate_recommendations")');
    const toolEnd = toolSource.indexOf("const genCreated", toolStart);
    expect(toolSource.slice(toolStart, toolEnd)).not.toContain("aiChat(");
  });
});
