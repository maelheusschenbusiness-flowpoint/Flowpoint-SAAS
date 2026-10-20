import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_AUDIT_SEO_LOCAL: ResourceArticle = {
  slug: "audit-seo-local",
  title:
    "Audit SEO local : vérifier la visibilité de son entreprise | Flowpoint",
  metaDescription:
    "Suivez une méthode d’audit SEO local pour vérifier votre fiche, votre site, vos pages, vos avis et les données disponibles avant de prioriser des actions.",
  h1: "Audit SEO local : comment vérifier la visibilité de son entreprise ?",
  cluster: "SEO local",
  parentLanding: "/local-seo",
  parentLandingCta: null,
  datePublished: "2026-10-08",
  dateModified: "2026-10-08",
  author: "Équipe Flowpoint",
  published: true,
  content: [
    {
      paragraphs: [
        "Un audit SEO local examine la présence d’une entreprise dans les recherches liées à ses activités et à ses lieux de service. Il met en regard les informations de Google Business Profile, les pages du site, les avis et les données disponibles. Son but est de distinguer les faits vérifiés des hypothèses, puis de décider quoi examiner ou corriger.",
        [
          "Ce guide est informationnel : il présente une méthode de diagnostic, pas une promesse de visibilité. Il ne remplace ni le guide général du ",
          {
            label: "référencement local",
            href: "/ressources/guide-referencement-local",
          },
          " ni la page commerciale de l’outil.",
        ],
      ],
    },
    {
      heading: "1. Définir le périmètre avant d’ouvrir les outils",
      paragraphs: [
        "Notez les établissements réels, les services proposés, les zones réellement desservies et l’action que le site doit permettre : appel, visite, demande de devis ou autre démarche. Choisissez quelques pages et requêtes prioritaires pour commencer. Une analyse portant sur une seule adresse ne décrit pas nécessairement toutes les autres.",
        "Indiquez aussi les limites des données : période observée, accès disponibles, changements récents et données qui ne peuvent pas être reliées à une demande ou à une vente. Si l’entreprise n’est pas éligible à une fiche Google Business Profile, ne prévoyez pas de créer une fiche pour contourner cette règle.",
      ],
    },
    {
      heading: "2. Vérifier la fiche et les informations de l’établissement",
      paragraphs: [
        "Pour chaque fiche réellement éligible, confirmez que la personne qui la gère est autorisée, que le nom représente l’entreprise telle qu’elle est connue et qu’il n’existe pas de doublon pour le même établissement. Comparez l’adresse ou la zone desservie, les coordonnées, les horaires, les catégories et les services affichés aux informations que l’entreprise peut confirmer.",
        "Les catégories doivent décrire l’activité principale, non chaque mot-clé ou service secondaire. Des horaires périmés, une adresse imprécise ou des services qui ne sont plus proposés peuvent induire les clients en erreur. Notez le champ, la valeur actuelle, la source de vérification et la correction attendue; ne modifiez pas les données par supposition.",
        [
          "Pour approfondir les critères d’éligibilité et les champs de la fiche, consultez le guide sur l’",
          {
            label: "optimisation de Google Business Profile",
            href: "/ressources/optimiser-google-business-profile",
          },
          ".",
        ],
      ],
    },
    {
      heading: "3. Examiner le site et les pages locales",
      paragraphs: [
        "Parcourez les pages de service et d’établissement qui doivent répondre aux recherches locales. Vérifiez qu’elles décrivent une offre actuelle, qu’elles indiquent clairement où l’entreprise intervient ou reçoit ses clients et qu’un visiteur peut trouver une manière de la contacter. Relevez les coordonnées incohérentes, les liens qui ne fonctionnent plus et les pages locales qui ne correspondent plus à une activité réelle.",
        "Une différence d’adresse ou d’horaire peut avoir une explication légitime, par exemple une zone d’intervention distincte d’un établissement ouvert au public. Avant de conclure à une erreur, demandez confirmation à l’équipe. Si plusieurs pages de villes sont presque identiques, vérifiez leur utilité pour les visiteurs et le risque qu’elles ne servent qu’à conduire vers une même destination.",
        [
          "La ressource sur les ",
          {
            label: "pages locales SEO",
            href: "/ressources/pages-locales-seo",
          },
          " détaille les critères de contenu et les risques de duplication.",
        ],
      ],
    },
    {
      heading: "4. Contrôler les requêtes et la visibilité dans leur contexte",
      paragraphs: [
        "Dans Search Console, examinez les requêtes et pages qui ont déjà généré des impressions ou des clics dans les résultats de recherche du site. Comparez des périodes cohérentes et vérifiez si les pages affichées correspondent aux services et aux zones visés. Ces données n’incluent pas toutes les recherches possibles et ne constituent pas un rapport exhaustif de la visibilité sur Google Maps.",
        "Les résultats Maps et locaux dépendent notamment de la requête et de la distance avec la personne. Une seule recherche effectuée depuis un bureau ne décrit donc pas la visibilité de l’entreprise dans toute une ville. Si vous observez des positions, consignez l’endroit, la requête, la date et la méthode.",
        [
          "Pour construire une liste de recherches à examiner, consultez le guide des ",
          {
            label: "mots-clés SEO locaux",
            href: "/ressources/mots-cles-seo-local",
          },
          ", puis le guide du ",
          {
            label: "suivi de visibilité locale",
            href: "/ressources/suivi-referencement-local",
          },
          ".",
        ],
      ],
    },
    {
      heading: "5. Examiner les avis et les comparaisons locales",
      paragraphs: [
        "Les avis doivent refléter des expériences réelles et être traités selon les règles de Google. Vérifiez que l’entreprise n’offre pas d’avantages en échange d’avis, ne sollicite pas uniquement des commentaires positifs et ne décourage pas les avis négatifs. Repérez plutôt les thèmes récurrents que l’équipe peut confirmer et les réponses qui nécessitent un suivi.",
        "Une comparaison avec quelques établissements pertinents peut donner du contexte sur les offres et les informations présentées. Utilisez une requête et un point de recherche clairement définis, et ne déduisez pas la cause d’une différence de position à partir d’une seule capture. Les profils visibles ne révèlent pas toutes les raisons d’un classement.",
      ],
      links: [
        {
          label: "Avis Google : règles et bonnes pratiques",
          href: "/ressources/avis-google-seo-local",
        },
        {
          label: "Référencement Google Maps et variations locales",
          href: "/ressources/referencement-google-maps",
        },
      ],
    },
    {
      heading: "6. Prioriser les constats selon les preuves",
      paragraphs: [
        "Classez les constats en trois groupes : problème confirmé, question à investiguer et comportement voulu. Pour chacun, indiquez la source, les pages ou fiches concernées, la conséquence plausible pour les clients, la personne qui peut valider et le prochain contrôle. Une anomalie dans un outil ne devient pas automatiquement une correction à déployer.",
      ],
      bullets: [
        "Corriger une information de fiche inexacte après confirmation auprès de l’entreprise.",
        "Investiguer une page importante si son contenu, son lieu de service ou son parcours de contact prête à confusion.",
        "Comparer les données de recherche et de fiche séparément avant d’expliquer une variation.",
        "Reporter une recommandation spéculative tant qu’aucune preuve ou action utile n’est établie.",
      ],
    },
    {
      heading: "Exemple fictif : deux agences d’un même service",
      paragraphs: [
        "Situation entièrement fictive : une société de réparation possède deux agences et intervient aussi chez ses clients. Pendant l’audit, l’équipe constate que les horaires de l’une des fiches diffèrent de ceux de la page correspondante. Elle confirme les horaires auprès du responsable, vérifie les liens de contact et distingue l’adresse ouverte au public des zones d’intervention.",
        "L’équipe remarque également une page de ville dont le texte décrit le même service et le même parcours que la page générale. Elle vérifie si cette zone est réellement desservie et si une information locale spécifique peut être fournie. Si ce n’est pas le cas, elle n’ajoute pas d’autres pages similaires. Aucun résultat de classement n’est supposé dans cet exemple.",
      ],
    },
    {
      heading: "Découvrir la page SEO local de Flowpoint",
      paragraphs: [
        [
          "Pour consulter la présentation commerciale de Flowpoint, visitez la page ",
          {
            label: "SEO local",
            href: "/local-seo",
          },
          ".",
        ],
      ],
    },
    {
      heading: "Sources officielles",
      links: [
        {
          label:
            "Conseils pour améliorer le classement local — Aide Google Business Profile",
          href: "https://support.google.com/business/answer/7091?hl=fr",
        },
        {
          label:
            "Éligibilité et propriété des fiches — Aide Google Business Profile",
          href: "https://support.google.com/business/answer/13763036?hl=fr",
        },
        {
          label:
            "Consignes sur les informations de l’établissement — Aide Google Business Profile",
          href: "https://support.google.com/business/answer/3038177?hl=fr",
        },
        {
          label:
            "Rapport sur les performances de la recherche — Aide Search Console",
          href: "https://support.google.com/webmasters/answer/7576553?hl=fr",
        },
        {
          label:
            "Contenus interdits et soumis à des restrictions dans Google Maps",
          href: "https://support.google.com/contributionpolicy/answer/7400114?hl=fr",
        },
        {
          label:
            "Métriques de performances d’une fiche — Aide Google Business Profile",
          href: "https://support.google.com/business/answer/9918094?hl=fr",
        },
      ],
    },
  ],
  relatedArticles: [],
};
