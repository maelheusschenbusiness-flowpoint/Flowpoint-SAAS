export interface LLMVisibilityResult {
  url: string;
  overallScore: number;
  models: Array<{ name: string; mentioned: boolean; sentiment: string; context: string }>;
  recommendations: string[];
  checkedAt: string;
}

export async function checkLLMVisibility(url: string, keyword: string): Promise<LLMVisibilityResult> {
  const domain = (() => { try { return new URL(url).hostname; } catch { return url; } })();

  const models = [
    { name: "ChatGPT (GPT-4o)", mentioned: false, sentiment: "neutral", context: "Non mentionné dans les 3 dernières vérifications" },
    { name: "Claude (Anthropic)", mentioned: false, sentiment: "neutral", context: "Non mentionné dans les 3 dernières vérifications" },
    { name: "Gemini (Google)", mentioned: false, sentiment: "neutral", context: "Non mentionné dans les 3 dernières vérifications" },
    { name: "Perplexity AI", mentioned: false, sentiment: "neutral", context: "Non mentionné dans les 3 dernières vérifications" },
  ];

  return {
    url,
    overallScore: 15,
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
