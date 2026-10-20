import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_RAPPORT_GOOGLE_SEARCH_CONSOLE: ResourceArticle = {
  slug: "rapport-google-search-console",
  title: "Interpréter les données de Google Search Console | Flowpoint",
  metaDescription:
    "Comprenez clics, impressions, CTR et position moyenne dans Search Console, avec les effets des filtres, agrégations et requêtes anonymisées.",
  h1: "Comment interpréter les données de Google Search Console ?",
  cluster: "Reporting SEO",
  parentLanding: "/seo-reporting",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "Équipe Flowpoint",
  published: true,
  content: [
    {
      paragraphs: [
        "Le rapport sur les performances de Search Console aide à examiner les résultats associés à une propriété dans Google Search. Il ne s’agit pas d’un relevé exhaustif de toute interaction avec un site ni d’un outil qui explique à lui seul une évolution. Pour l’interpréter, commencez par vérifier le type de recherche, la propriété, les dates et les filtres.",
      ],
    },
    {
      heading: "Comprendre les quatre métriques principales",
      table: {
        caption: "Les valeurs répondent à des questions différentes",
        description:
          "Reprenez les définitions de Google lorsque vous comparez des rapports ou expliquez un changement.",
        headers: ["Métrique", "Lecture générale", "À ne pas conclure"],
        rows: [
          ["Impressions", "Occurrences où un résultat associé au site est affiché selon les règles du type de résultat.", "Que chaque impression ait été remarquée ou ait entraîné une visite."],
          ["Clics", "Clics enregistrés depuis les résultats Google vers le site.", "Le nombre de sessions analytics ou de prospects."],
          ["CTR", "Rapport entre clics et impressions dans le périmètre retenu.", "La qualité d’une page sans examiner requête, position et contexte."],
          ["Position moyenne", "Moyenne calculée pour les résultats et dimensions du rapport.", "Un rang fixe pour chaque personne, requête et lieu."],
        ],
      },
    },
    {
      heading: "Lire les dimensions et l’agrégation",
      paragraphs: [
        "Le rapport peut regrouper les données par requête, page, pays, appareil ou apparence dans la recherche. La manière d’agréger certains indicateurs, notamment la position moyenne, dépend de la dimension choisie. Un changement de filtre ou de niveau de regroupement peut modifier la valeur observée sans qu’une page ait nécessairement changé.",
        "Certaines requêtes ne sont pas affichées dans les tableaux pour des raisons de confidentialité. La somme des lignes visibles peut donc différer du total indiqué ailleurs dans le rapport. Google documente aussi des limites de lignes et de données; gardez ces éléments à l’esprit lors d’un export.",
      ],
    },
    {
      heading: "Examiner une variation sans sauter à la causalité",
      bullets: [
        "Comparer des périodes de durée et de saison comparables.",
        "Vérifier si le changement touche tout le site, un groupe de pages ou quelques requêtes.",
        "Examiner l’appareil, le pays et le type de recherche avant de généraliser.",
        "Consigner les changements du site et les autres événements connus sans les traiter comme une preuve.",
      ],
      paragraphs: [
        "Une baisse de clics peut être liée à plusieurs facteurs possibles : demande, composition des résultats, évolution du contenu, disponibilité ou mesure. Search Console décrit des observations dans son périmètre; l’analyse doit confronter d’autres sources avant d’expliquer pourquoi.",
      ],
    },
    {
      heading: "Exemple entièrement fictif : une page et plusieurs requêtes",
      paragraphs: [
        "Une association fictive voit ses impressions augmenter sur un groupe de pages tandis que ses clics évoluent autrement. Elle filtre d’abord par page et par appareil, vérifie les dates et compare les requêtes visibles. Elle note que le tableau n’affiche pas nécessairement toutes les requêtes, puis formule des questions à examiner plutôt qu’une explication définitive. L’exemple est fictif.",
      ],
    },
    {
      heading: "Transformer le rapport en support de décision",
      paragraphs: [
        [
          "Pour présenter les métriques dans un tableau de bord, consultez le guide des ",
          { label: "KPI SEO", href: "/ressources/tableau-de-bord-seo-kpi" },
          ". Le ",
          { label: "guide général du reporting", href: "/ressources/reporting-seo-guide" },
          " explique comment distinguer constat et analyse.",
        ],
        [
          "Pour automatiser une collecte sans automatiser les conclusions, lisez ",
          { label: "le guide du rapport automatique", href: "/ressources/rapport-seo-automatique" },
          " et la page ",
          { label: "SEO Reporting", href: "/seo-reporting" },
          ".",
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
          label: "Définitions des impressions, positions et clics — Aide Search Console",
          href: "https://support.google.com/webmasters/answer/7042828?hl=fr",
        },
        {
          label: "Analyse des filtres et limites des données — Google Search Central",
          href: "https://developers.google.com/search/blog/2022/10/performance-data-deep-dive?hl=fr",
        },
      ],
    },
  ],
  relatedArticles: [
    "tableau-de-bord-seo-kpi",
    "rapport-seo-mensuel",
    "reporting-seo-client",
  ],
};
