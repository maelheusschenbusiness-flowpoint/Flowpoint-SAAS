import {
  getPublishedResourceArticles,
  getResourceArticleCanonical,
  type ResourceArticle,
} from "./resource-articles";

export interface SharedFaq {
  question: string;
  answer: string;
}

export const PRICING_FAQS: readonly SharedFaq[] = [
  {
    question: "Puis-je changer d'offre à tout moment ?",
    answer:
      "Oui, vous pouvez passer à une offre supérieure ou inférieure à tout moment. Le changement prendra effet à la prochaine période de facturation.",
  },
  {
    question: "Y a-t-il un engagement ?",
    answer:
      "Non, toutes nos offres sont sans engagement. Vous pouvez annuler à tout moment sans frais.",
  },
  {
    question: "Que se passe-t-il après les 14 jours d'essai ?",
    answer:
      "Après votre période d'essai de 14 jours, vous choisissez le plan qui correspond à vos besoins. Vos données sont conservées et vous pouvez reprendre exactement là où vous vous étiez arrêté. Pas de surprise, pas d'engagement.",
  },
  {
    question: "Quels moyens de paiement acceptez-vous ?",
    answer:
      "Nous acceptons toutes les cartes bancaires (Visa, Mastercard, American Express) via notre partenaire Stripe. Les paiements sont 100% sécurisés.",
  },
  {
    question: "Puis-je obtenir une facture ?",
    answer:
      "Oui, une facture est automatiquement générée et envoyée par email après chaque paiement. Vous pouvez également les retrouver dans votre espace client.",
  },
];

export function buildFaqPageJsonLd(faqs: readonly SharedFaq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export const RESOURCE_HUB = {
  name: "Centre de ressources Flowpoint",
  description:
    "Bibliothèque de contenus dédiée à la croissance digitale : SEO, IA, monitoring, analytics, rapports automatiques et bonnes pratiques.",
  url: "https://flowpoint.pro/ressources",
  inLanguage: "fr-FR",
} as const;

export const RESOURCE_CHAPTER_TITLES = [
  "SEO & visibilité — Les fondamentaux",
  "Intelligence artificielle au service de votre croissance",
  "Monitoring & disponibilité — Ne laissez rien échapper",
  "Google Business Profile — Votre carte d'identité locale",
  "Performance web — La vitesse est un avantage concurrentiel",
  "Analytics & données — Décidez avec discernement",
  "Rapports & automatisation — Gagnez du temps chaque semaine",
  "Nouveautés FlowPoint — Restez à la pointe",
  "Guides pratiques — Démarrer avec FlowPoint",
  "Cas d'usage — Comment FlowPoint s'adapte à votre activité",
] as const;

export function buildResourcesItemListJsonLd(
  articles: readonly ResourceArticle[] = getPublishedResourceArticles(),
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: RESOURCE_HUB.name,
    description: RESOURCE_HUB.description,
    url: RESOURCE_HUB.url,
    inLanguage: RESOURCE_HUB.inLanguage,
    numberOfItems: RESOURCE_CHAPTER_TITLES.length + articles.length,
    itemListElement: [
      ...RESOURCE_CHAPTER_TITLES.map((name, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name,
      })),
      ...articles.map((article, index) => ({
        "@type": "ListItem",
        position: RESOURCE_CHAPTER_TITLES.length + index + 1,
        item: {
          "@type": "Article",
          name: article.h1,
          url: getResourceArticleCanonical(article.slug),
        },
      })),
    ],
  };
}