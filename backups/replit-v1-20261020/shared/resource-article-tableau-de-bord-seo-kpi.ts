import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_TABLEAU_DE_BORD_SEO_KPI: ResourceArticle = {
  slug: "tableau-de-bord-seo-kpi",
  title: "Tableau de bord SEO : choisir les KPI utiles | Flowpoint",
  metaDescription:
    "Choisissez des KPI SEO reliés à vos objectifs et séparez visibilité, clics, conversions et revenus dans un tableau de bord lisible.",
  h1: "Tableau de bord SEO : quels KPI suivre ?",
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
        "Un tableau de bord SEO n’a pas besoin d’afficher toutes les données disponibles. Il doit montrer les indicateurs nécessaires à une décision, avec leur définition, leur source et leur périmètre. Les KPI retenus dépendent de l’objectif du site et du destinataire du tableau.",
        "Évitez de présenter visibilité, trafic, conversion et chiffre d’affaires comme une seule mesure. Une hausse d’impressions ne prouve pas une hausse de clics; une visite n’est pas une conversion; une conversion attribuée ne donne pas toujours une explication complète du revenu.",
      ],
    },
    {
      heading: "Organiser les KPI par niveau",
      table: {
        caption: "Une chaîne de mesures, pas un score SEO unique",
        description:
          "Chaque niveau demande une source adaptée et une définition explicite.",
        headers: ["Niveau", "Exemples de mesures", "Précaution"],
        rows: [
          ["Visibilité dans la recherche", "Impressions et position moyenne Search Console.", "Les dimensions, regroupements et filtres influencent la lecture."],
          ["Visites depuis la recherche", "Clics Search Console ou sessions mesurées en analytics.", "Les sources et définitions de clic/session diffèrent."],
          ["Actions suivies", "Événement ou objectif configuré dans un outil analytics.", "La mesure dépend de l’implémentation et du consentement."],
          ["Résultat commercial", "Prospects qualifiés ou ventes consignées dans un outil métier.", "L’attribution ne prouve pas que le SEO est l’unique cause."],
        ],
      },
    },
    {
      heading: "Adapter le tableau à la question",
      paragraphs: [
        "Pour une page éditoriale, les requêtes, les clics et la qualité des visites peuvent éclairer des priorités différentes. Pour un service local, le périmètre géographique et les demandes réelles peuvent compter davantage. Dans les deux cas, les conversions exigent un suivi défini séparément de Search Console.",
        "Choisissez une mesure principale et quelques mesures de diagnostic plutôt qu’une liste interminable. Ajoutez une note lorsqu’une propriété, une campagne ou un événement a changé.",
      ],
    },
    {
      heading: "Exemple entièrement fictif : tableau d’une PME",
      paragraphs: [
        "Une PME fictive suit une série de pages de services. Son tableau sépare les impressions et clics issus de Search Console, les formulaires correctement enregistrés par son outil analytics et les demandes validées par l’équipe commerciale. Elle évite d’additionner ces valeurs ou de présenter toute demande comme un revenu attribué au SEO. Ce scénario est fictif et ne contient aucun résultat réel.",
      ],
    },
    {
      heading: "Contrôler les définitions et les données",
      bullets: [
        "Documenter les propriétés, filtres, pays, appareils, périodes et regroupements.",
        "Vérifier que les événements ou conversions fonctionnent avant de les interpréter.",
        "Expliquer les données manquantes, anonymisées ou agrégées.",
        "Comparer des périodes cohérentes et noter les changements de mesure.",
      ],
      paragraphs: [
        "Dans Search Console, la position est une moyenne calculée selon la méthode du rapport; elle ne correspond pas à une position fixe valable pour chaque recherche ou utilisateur. Les tableaux peuvent ne pas afficher toutes les requêtes. Présentez les limites près du chiffre concerné.",
      ],
    },
    {
      heading: "Poursuivre vers le reporting et l’analyse",
      paragraphs: [
        [
          "Le ",
          { label: "guide du reporting SEO", href: "/ressources/reporting-seo-guide" },
          " explique comment passer d’une mesure à une décision. Pour les données de recherche, consultez le guide sur ",
          { label: "Google Search Console", href: "/ressources/rapport-google-search-console" },
          " et le ",
          { label: "reporting SEO pour PME", href: "/ressources/reporting-seo-pme" },
          ".",
        ],
      ],
    },
    {
      heading: "Découvrir la page SEO Reporting",
      paragraphs: [
        [
          "La page commerciale ",
          { label: "SEO Reporting", href: "/seo-reporting" },
          " présente la proposition de Flowpoint; vérifiez que les données disponibles correspondent à vos KPI.",
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
          label: "Limites des données de performances — Google Search Central",
          href: "https://developers.google.com/search/blog/2022/10/performance-data-deep-dive?hl=fr",
        },
      ],
    },
  ],
  relatedArticles: [
    "reporting-seo-guide",
    "reporting-seo-pme",
    "rapport-seo-mensuel",
  ],
};
