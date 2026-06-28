export interface LLMVisibilityResult {
  url: string;
  overallScore: number | null;
  dataSource?: string;
  models: Array<{ name: string; mentioned: boolean | null; sentiment: string; context: string }>;
  recommendations: string[];
  checkedAt: string;
}

export async function checkLLMVisibility(url: string, keyword: string): Promise<LLMVisibilityResult> {
  const domain = (() => { try { return new URL(url).hostname; } catch { return url; } })();

  const models = [
    { name: "ChatGPT (GPT-4o)", mentioned: null, sentiment: "unknown", context: "Vérification non effectuée — intégration LLM requise" },
    { name: "Claude (Anthropic)", mentioned: null, sentiment: "unknown", context: "Vérification non effectuée — intégration LLM requise" },
    { name: "Gemini (Google)", mentioned: null, sentiment: "unknown", context: "Vérification non effectuée — intégration LLM requise" },
    { name: "Perplexity AI", mentioned: null, sentiment: "unknown", context: "Vérification non effectuée — intégration LLM requise" },
  ];

  return {
    url,
    overallScore: null,
    dataSource: "pending",
    models,
    recommendations: [
      `Créer du contenu expert structuré sur ${keyword} pour améliorer votre visibilité IA`,
      `Ajouter un schema.org Organization avec description détaillée sur ${domain}`,
      "Obtenir des mentions de marque sur des sites d'autorité (Wikipedia, journaux reconnus)",
      "Publier des études de cas et données originales que les LLMs citent préférentiellement",
    ],
    checkedAt: new Date().toISOString(),
  };
}
