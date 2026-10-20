import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_RAPPORT_SEO_MENSUEL: ResourceArticle = {
  slug: "rapport-seo-mensuel",
  title: "Rapport SEO mensuel : structure, méthode et exemple | Flowpoint",
  metaDescription:
    "Organisez un rapport SEO mensuel autour du périmètre, des données, des changements, des limites et des prochaines actions, sans attribuer trop vite les causes.",
  h1: "Rapport SEO mensuel : structure et exemple",
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
        "Un rapport SEO mensuel donne un rythme de lecture, mais le mois civil n’est pas automatiquement la meilleure fenêtre pour chaque question. Il peut aider à partager les évolutions, les travaux réalisés et les contrôles à venir, à condition de définir le périmètre et de comparer des périodes cohérentes.",
        "Présentez d’abord le constat. Ajoutez ensuite les explications possibles et les limites des données. Terminez par une action vérifiable; ne transformez pas une coïncidence temporelle en preuve qu’un changement a causé une variation.",
      ],
    },
    {
      heading: "Une structure de rapport facile à relire",
      table: {
        caption: "Trame éditoriale pour un suivi récurrent",
        description:
          "Adaptez les rubriques à la question du lecteur et aux sources effectivement disponibles.",
        headers: ["Rubrique", "Contenu à préciser", "Contrôle utile"],
        rows: [
          ["Périmètre", "Propriété, pages, pays, appareils et période.", "Comparer le même périmètre à chaque fois."],
          ["Observations", "Indicateurs et source de chaque valeur.", "Vérifier filtres, dates et configuration."],
          ["Changements", "Mises à jour du site et travaux réalisés.", "Distinguer date documentée et hypothèse."],
          ["Analyse", "Explications plausibles et preuves manquantes.", "Ne pas attribuer une cause sans vérification."],
          ["Actions", "Prochaine étape, responsable et méthode de suivi.", "Définir comment constater l’avancement."],
        ],
      },
    },
    {
      heading: "Choisir des comparaisons valides",
      paragraphs: [
        "Une comparaison peut opposer deux périodes de longueur identique, une période à une période comparable ou deux segments précisément définis. Tenez compte de la saisonnalité, des jours fériés, d’une migration et des modifications de suivi. Si l’échantillon ou la période ne permet pas une lecture stable, signalez-le et évitez les conclusions catégoriques.",
        "Search Console permet de choisir des dates et dimensions, mais les valeurs peuvent dépendre de l’agrégation et des filtres. Pour les conversions ou le chiffre d’affaires, vérifiez séparément le marquage, la fenêtre d’attribution et la source métier.",
      ],
    },
    {
      heading: "Exemple entièrement fictif : rapport d’un atelier",
      paragraphs: [
        "Un atelier fictif prépare une note mensuelle pour ses pages de services. Le document indique les URL examinées, compare une période cohérente, liste les changements de contenu et distingue clics Search Console et demandes enregistrées par l’équipe. Il propose de contrôler une page avant d’étendre la modification aux autres. Ce scénario est entièrement fictif et ne contient pas de résultats observés.",
      ],
    },
    {
      heading: "Faire apparaître les décisions et les inconnues",
      bullets: [
        "Mettre en évidence ce qui a changé depuis le dernier rapport.",
        "Indiquer les données indisponibles ou les mesures modifiées.",
        "Associer chaque recommandation à un constat et à une vérification.",
        "Conserver les actions non terminées sans les présenter comme des résultats.",
      ],
      paragraphs: [
        "Une page de synthèse peut rester courte; les détails et les définitions peuvent suivre en annexe. L’important est que le lecteur puisse retracer une valeur et comprendre ce qu’elle permet ou non de dire.",
      ],
    },
    {
      heading: "Ressources liées au reporting mensuel",
      paragraphs: [
        [
          "Pour les indicateurs à inclure, voyez les ",
          { label: "KPI du tableau de bord SEO", href: "/ressources/tableau-de-bord-seo-kpi" },
          " et le ",
          { label: "reporting SEO pour PME", href: "/ressources/reporting-seo-pme" },
          ". Le ",
          { label: "guide de reporting client", href: "/ressources/reporting-seo-client" },
          " aide à adapter le niveau de détail.",
        ],
        [
          "La page ",
          { label: "SEO Reporting", href: "/seo-reporting" },
          " décrit l’offre de Flowpoint.",
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
    "rapport-google-search-console",
    "reporting-seo-client",
  ],
};
