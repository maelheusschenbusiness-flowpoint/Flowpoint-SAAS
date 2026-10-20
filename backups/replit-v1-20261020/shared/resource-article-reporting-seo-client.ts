import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_REPORTING_SEO_CLIENT: ResourceArticle = {
  slug: "reporting-seo-client",
  title: "Reporting SEO client : présenter les résultats avec clarté | Flowpoint",
  metaDescription:
    "Présentez un reporting SEO client compréhensible : périmètre, sources, constats, limites, actions et responsabilités, sans promesse de position.",
  h1: "Reporting SEO client : comment présenter les résultats ?",
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
        "Un reporting destiné à un client doit rendre les constats compréhensibles et vérifiables. Il explique ce qui a été suivi, ce qui a changé, ce qui reste incertain et ce qui est proposé ensuite. Il ne doit pas promettre un classement ni présenter une hypothèse comme un résultat acquis.",
        "Adaptez le niveau de détail au destinataire, sans supprimer la source ou la définition d’une mesure. Une synthèse peut être courte; les éléments nécessaires pour la contrôler doivent rester accessibles.",
      ],
    },
    {
      heading: "Commencer par le périmètre convenu",
      paragraphs: [
        "Rappelez les objectifs, les pages et marchés couverts, les sources utilisées et les dates de comparaison. Distinguez le travail réalisé des évolutions mesurées. Si le périmètre a changé ou qu’une intégration n’a pas collecté de données, dites-le avant de comparer les chiffres.",
        "Séparez les indicateurs de visibilité des sessions, des conversions configurées et des ventes. Une vente peut dépendre de plusieurs canaux et étapes; un tableau SEO ne prouve pas automatiquement qu’une action donnée l’a causée.",
      ],
    },
    {
      heading: "Présenter le constat, puis l’interprétation",
      bullets: [
        "Énoncer ce que la source mesure, avec sa période et ses filtres.",
        "Nommer les changements confirmés et les hypothèses à investiguer séparément.",
        "Expliquer les limites, notamment les requêtes ou segments non visibles.",
        "Relier la recommandation à une page, une question et un contrôle futur.",
      ],
      paragraphs: [
        "Évitez les graphiques dont les axes ou les dates sont cachés, les pourcentages sans valeurs de référence et les comparaisons qui mélangent des propriétés. Si l’impact n’est pas encore mesurable, formulez une prochaine étape plutôt qu’une conclusion prématurée.",
      ],
    },
    {
      heading: "Exemple entièrement fictif : présenter une baisse de clics",
      paragraphs: [
        "Une agence fictive constate une baisse de clics sur quelques pages d’un client. Elle indique la période et les filtres Search Console, distingue les pages affectées des autres, puis vérifie les modifications récentes et les données disponibles. Elle propose un diagnostic avant toute réécriture. Ce scénario est fictif et ne constitue pas un résultat client.",
        "La présentation protège ainsi la confiance : le client voit le signal, la limite d’interprétation et la prochaine décision au lieu d’une promesse de retour rapide.",
      ],
    },
    {
      heading: "Convenir des actions et des responsabilités",
      paragraphs: [
        "Chaque action doit préciser qui la réalise, quelle page ou donnée elle concerne et comment le suivi sera fait. L’agence peut recommander un contrôle ou une amélioration; le client peut fournir des informations métier ou valider un contenu. Inscrivez séparément les dépendances et les tâches en attente.",
        [
          "Le ",
          { label: "rapport mensuel SEO", href: "/ressources/rapport-seo-mensuel" },
          " fournit une trame; le ",
          { label: "guide de reporting", href: "/ressources/reporting-seo-guide" },
          " distingue constat, analyse et décision.",
        ],
      ],
    },
    {
      heading: "Choisir un format qui permet le dialogue",
      paragraphs: [
        "Préparez une synthèse pour la réunion et conservez les tableaux, définitions et filtres en complément. Invitez le destinataire à clarifier une priorité commerciale ou une limite des données; un rapport ne remplace pas ce contexte.",
        [
          "Pour sélectionner les indicateurs, consultez les ",
          { label: "KPI du tableau de bord SEO", href: "/ressources/tableau-de-bord-seo-kpi" },
          " et le guide sur ",
          { label: "Search Console", href: "/ressources/rapport-google-search-console" },
          ".",
        ],
      ],
    },
    {
      heading: "Découvrir le reporting SEO de Flowpoint",
      paragraphs: [
        [
          "La page ",
          { label: "SEO Reporting", href: "/seo-reporting" },
          " décrit l’offre commerciale. Confirmez le périmètre et les données disponibles avant de vous appuyer sur un outil dans un engagement client.",
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
    "rapport-seo-mensuel",
    "choisir-outil-reporting-seo",
  ],
};
