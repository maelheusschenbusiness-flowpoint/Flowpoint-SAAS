import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_ANALYSE_CONCURRENTIELLE_SEO_GUIDE: ResourceArticle = {
  slug: "analyse-concurrentielle-seo-guide",
  title: "Analyse concurrentielle SEO : méthode complète et limites | Flowpoint",
  metaDescription:
    "Analysez la concurrence SEO avec un périmètre clair : distinguez concurrents commerciaux et visibles, comparez des pages et transformez les constats en pistes.",
  h1: "Analyse concurrentielle SEO : méthode complète",
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
        "Une analyse concurrentielle SEO compare la présence de plusieurs sites sur des recherches et des besoins précis. Elle commence par distinguer les concurrents commerciaux des pages qui apparaissent dans les résultats : les deux ensembles peuvent se recouper, sans être identiques. Le choix du périmètre évite de comparer des entreprises qui ne ciblent ni le même public ni les mêmes intentions.",
        "Les données de recherche peuvent décrire ce qui est visible ou estimé; elles ne révèlent pas l’ensemble des analytics, ventes ou décisions d’un concurrent. Utilisez-les pour formuler des questions, pas comme des preuves de causalité ni comme une invitation à copier.",
      ],
    },
    {
      heading: "Définir le marché et les concurrents de recherche",
      paragraphs: [
        "Commencez par les offres, les publics et les zones pertinentes pour l’entreprise. Ajoutez ensuite un ensemble limité de requêtes importantes, en précisant leur intention et le lieu ou contexte observé. Les concurrents commerciaux vendent une solution proche; les concurrents SEO sont les domaines ou pages qui occupent l’espace dans les résultats pour ces recherches. Une grande plateforme peut être présente dans les SERP sans être un rival commercial direct.",
        [
          "Pour identifier ces deux ensembles sans les mélanger, consultez ",
          { label: "le guide d’identification des concurrents SEO", href: "/ressources/identifier-concurrents-seo" },
          ".",
        ],
      ],
    },
    {
      heading: "Comparer des pages et des signaux pertinents",
      table: {
        caption: "Comparer des éléments observables",
        description:
          "Gardez la date, la requête et la méthode pour rendre une observation interprétable.",
        headers: ["Volet", "À observer", "Limite"],
        rows: [
          ["Requêtes", "Intention, page qui apparaît et sujets couverts.", "Les estimations de volumes ou positions varient selon l’outil."],
          ["Contenu", "Utilité, format, preuves, actualité et questions traitées.", "Une longueur ou un format n’explique pas seul la visibilité."],
          ["Liens", "Sources et pages référencées lorsqu’une donnée est disponible.", "Un outil tiers ne possède pas la vision complète de Google."],
          ["Résultats", "Pages réellement visibles pour le périmètre retenu.", "Les résultats peuvent changer selon requête, lieu et période."],
        ],
      },
    },
    {
      heading: "Transformer le benchmark en pistes, pas en recettes",
      paragraphs: [
        "Cherchez un besoin de lecteur mal servi, une page manquante ou une question qui mérite une réponse plus claire. Vérifiez si la piste correspond à l’offre, aux compétences et aux preuves disponibles. Une différence entre sites ne démontre ni qu’elle cause un meilleur classement ni qu’elle convient à votre situation.",
        [
          "Le guide sur l’",
          { label: "analyse des mots-clés concurrents", href: "/ressources/analyse-mots-cles-concurrents" },
          " et celui du ",
          { label: "benchmark SEO", href: "/ressources/benchmark-seo-indicateurs" },
          " détaillent les méthodes de comparaison.",
        ],
      ],
    },
    {
      heading: "Exemple entièrement fictif : un service régional",
      paragraphs: [
        "Une société fictive de réparation étudie quelques recherches locales. Elle distingue les ateliers qui vendent le même service des annuaires et guides qui apparaissent aussi dans les résultats. Elle compare les pages, repère les informations de service absentes de son site et vérifie si ces sujets répondent à une demande réelle. Le scénario est entièrement fictif et ne rapporte aucun résultat observé.",
      ],
    },
    {
      heading: "Documenter les limites de l’analyse",
      bullets: [
        "Noter la date, les requêtes, le lieu et l’outil de chaque observation.",
        "Étiqueter les estimations tierces comme des estimations.",
        "Ne pas traiter une position, un score de lien ou une estimation de trafic comme une preuve causale.",
        "Produire un contenu original fondé sur les besoins et l’expertise de votre équipe.",
      ],
      paragraphs: [
        [
          "Pour transformer les constats en priorités, reliez-les à un ",
          { label: "audit SEO", href: "/ressources/comment-faire-audit-seo-site-web" },
          " et à un ",
          { label: "reporting explicite", href: "/ressources/reporting-seo-guide" },
          ".",
        ],
      ],
    },
    {
      heading: "Découvrir l’analyse concurrentielle de Flowpoint",
      paragraphs: [
        [
          "La page ",
          { label: "Competitor Analysis", href: "/competitor-analysis" },
          " présente le positionnement commercial de Flowpoint. Vérifiez les données et fonctionnalités disponibles avant de choisir un processus.",
        ],
      ],
    },
    {
      heading: "Sources officielles",
      links: [
        {
          label: "Créer des contenus utiles, fiables et people-first — Google Search Central",
          href: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content?hl=fr",
        },
        {
          label: "Rapport sur les performances de la recherche — Aide Search Console",
          href: "https://support.google.com/webmasters/answer/7576553?hl=fr",
        },
        {
          label: "Règles concernant le spam dans la recherche — Google Search Central",
          href: "https://developers.google.com/search/docs/essentials/spam-policies?hl=fr",
        },
      ],
    },
  ],
  relatedArticles: [
    "identifier-concurrents-seo",
    "analyse-mots-cles-concurrents",
    "benchmark-seo-indicateurs",
  ],
};
