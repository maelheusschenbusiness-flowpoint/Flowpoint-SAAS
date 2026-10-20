import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_IDENTIFIER_CONCURRENTS_SEO: ResourceArticle = {
  slug: "identifier-concurrents-seo",
  title: "Comment identifier ses concurrents SEO ? | Flowpoint",
  metaDescription:
    "Distinguez concurrents commerciaux et concurrents visibles dans Google, puis construisez une liste SEO liée à vos requêtes, publics et zones.",
  h1: "Comment identifier ses concurrents SEO ?",
  cluster: "Analyse concurrentielle SEO",
  parentLanding: "/competitor-analysis",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "Équipe Flowpoint",
  published: true,
  content: [
    {
      paragraphs: [
        "La liste des concurrents de l’entreprise n’est pas automatiquement la liste des sites qui rivalisent avec elle dans la recherche. Un client peut comparer des offres directes tandis que Google affiche aussi des annuaires, médias, places de marché ou pages explicatives. L’analyse SEO porte sur les résultats visibles pour un ensemble défini de requêtes.",
        "Cette distinction rend le benchmark plus précis : au lieu de demander « qui sont nos concurrents ? », demandez « quelles pages répondent actuellement à ces recherches et quels besoins couvrent-elles ? »",
      ],
    },
    {
      heading: "Séparer deux familles de concurrents",
      table: {
        caption: "Deux listes utiles à conserver séparément",
        description:
          "Une même organisation peut appartenir aux deux familles, à une seule ou à aucune selon le périmètre.",
        headers: ["Famille", "Définition de travail", "Source de repérage"],
        rows: [
          ["Commerciale", "Entreprise ou offre que le public pourrait choisir à la place de la vôtre.", "Connaissance du marché, offres et retours clients."],
          ["SEO", "Domaine ou page visible sur les requêtes organiques sélectionnées.", "Observation des SERP, outils de recherche et vos données."],
        ],
      },
    },
    {
      heading: "Construire un échantillon de recherches",
      paragraphs: [
        "Choisissez des requêtes représentatives de vos services, contenus et publics. Regroupez-les par intention — apprendre, comparer, trouver un prestataire ou réaliser une action — puis précisez les pays ou zones utiles. Une page d’annuaire peut être une concurrente de résultat pour une requête tout en n’étant pas une entreprise rivale.",
        "Les SERP évoluent selon la requête, le contexte et la période; une observation isolée n’établit pas une présence durable. Notez la date et la méthode, puis recherchez des motifs communs avant de décider qu’un domaine mérite une analyse approfondie.",
      ],
    },
    {
      heading: "Exemple entièrement fictif : une entreprise de cours",
      paragraphs: [
        "Une école de langue fictive considère d’abord les autres écoles comme ses concurrents commerciaux. En observant des requêtes d’apprentissage, elle voit également des dictionnaires et des sites éditoriaux. Elle garde les deux listes séparées : les écoles pour l’étude des offres, les pages visibles pour comprendre les formats et les besoins dans les résultats. L’exemple est entièrement fictif.",
      ],
    },
    {
      heading: "Valider avant de comparer",
      bullets: [
        "Vérifier que la page répond à une intention comparable.",
        "Distinguer le domaine de l’URL réellement visible.",
        "Noter le lieu, la date, l’appareil et la requête observée.",
        "Éviter de traiter les annonces ou résultats spéciaux comme des positions organiques classiques.",
      ],
      paragraphs: [
        "Une fois la liste construite, comparez les pages qui comptent plutôt que des domaines entiers. Le contenu, le type de résultat et le public peuvent varier fortement d’une section à l’autre.",
      ],
    },
    {
      heading: "Poursuivre l’analyse",
      paragraphs: [
        [
          "Le ",
          { label: "guide complet d’analyse concurrentielle", href: "/ressources/analyse-concurrentielle-seo-guide" },
          " aide à organiser les étapes. Pour examiner les requêtes, consultez l’",
          { label: "analyse des mots-clés concurrents", href: "/ressources/analyse-mots-cles-concurrents" },
          " et les ",
          { label: "indicateurs de benchmark", href: "/ressources/benchmark-seo-indicateurs" },
          ".",
        ],
        [
          "La page ",
          { label: "Competitor Analysis", href: "/competitor-analysis" },
          " présente l’offre commerciale de Flowpoint.",
        ],
      ],
    },
    {
      heading: "Sources officielles",
      links: [
        {
          label: "Rapport sur les performances de la recherche — Aide Search Console",
          href: "https://support.google.com/webmasters/answer/7576553?hl=fr",
        },
        {
          label: "Créer des contenus utiles, fiables et people-first — Google Search Central",
          href: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content?hl=fr",
        },
      ],
    },
  ],
  relatedArticles: [
    "analyse-concurrentielle-seo-guide",
    "analyse-mots-cles-concurrents",
    "opportunites-seo-concurrence",
  ],
};
