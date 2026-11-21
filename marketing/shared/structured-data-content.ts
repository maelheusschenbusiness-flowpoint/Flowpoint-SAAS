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
    question: "Can I change plans at any time?",
    answer:
      "Yes. You can upgrade or downgrade at any time. The change will take effect at the start of your next billing period.",
  },
  {
    question: "Is there a minimum commitment?",
    answer:
      "No. All plans are flexible, and you can cancel at any time without a cancellation fee.",
  },
  {
    question: "What happens after the 14-day trial?",
    answer:
      "All plans include a free 14-day trial with full access. You choose your plan before you start, and a credit card is required at sign-up. Nothing is charged during the trial. When the 14 days end, your subscription to the chosen plan starts and your card is charged automatically, unless you cancel before that date. You can cancel at any time before the trial ends, at no cost.",
  },
  {
    question: "Which payment methods do you accept?",
    answer:
      "We accept Visa, Mastercard and American Express through our payment partner, Stripe.",
  },
  {
    question: "Can I get an invoice?",
    answer:
      "Yes. An invoice is generated and emailed after each payment. You can also find invoices in your account.",
  },
];

export const PRICING_TRIAL_FAQ_ANSWER_FR =
  "Tous les plans incluent 14 jours d'essai gratuit avec accès complet. Vous choisissez votre plan avant de commencer, et une carte bancaire est requise à l'inscription. Rien n'est débité pendant l'essai. À la fin des 14 jours, l'abonnement au plan choisi démarre et la carte est débitée automatiquement, sauf si vous annulez avant cette date. Vous pouvez annuler à tout moment avant la fin de l'essai, sans frais.";

export function getPricingFaqs(language: string): readonly SharedFaq[] {
  if (language.toLowerCase() !== "fr") return PRICING_FAQS;
  return PRICING_FAQS.map((faq) =>
    faq.question === "What happens after the 14-day trial?"
      ? { ...faq, answer: PRICING_TRIAL_FAQ_ANSWER_FR }
      : faq,
  );
}

export const SEO_AUDIT_FAQS: readonly SharedFaq[] = [
  {
    question: "What is an SEO audit?",
    answer:
      "An SEO audit is a structured analysis of a website that identifies elements that facilitate or hinder its visibility in search engines. It helps to understand the issues to be addressed and the optimizations to prioritize.",
  },
  {
    question: "What does a website SEO audit check?",
    answer:
      "Flowpoint analyzes meta tags and titles, loading speed, technical errors, site performance, and keyword-related opportunities. This information is consolidated to make next steps clearer.",
  },
  {
    question: "Why perform a regular SEO audit?",
    answer:
      "A site evolves, its performance can change, and new issues can appear. Regular audits allow you to track results, spot important changes, and focus efforts on the most useful improvements.",
  },
  {
    question: "Do I need to be an SEO expert to use Flowpoint?",
    answer:
      "No. Flowpoint presents results in clear dashboards and provides personalized recommendations. The goal is to turn technical findings into understandable actions, even without advanced SEO expertise.",
  },
  {
    question: "How do I start an audit with Flowpoint?",
    answer:
      "Create your Flowpoint account, add your website, and launch the analysis from your dashboard. You can then review the results and use the recommendations to plan your next actions.",
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
  name: "Flowpoint Resource Center",
  description:
    "Content library dedicated to digital growth: SEO, AI, monitoring, analytics, automated reports and best practices.",
  url: "https://flowpoint.pro/resources",
  inLanguage: "en-US",
} as const;

export const RESOURCE_CHAPTER_TITLES = [
  "SEO & visibility — The fundamentals",
  "Artificial intelligence for your growth",
  "Monitoring & uptime — Don't miss a thing",
  "Google Business Profile — Your local identity card",
  "Web performance — Speed is a competitive advantage",
  "Analytics & data — Decide with discernment",
  "Reporting & automation — Save time every week",
  "FlowPoint news — Stay at the forefront",
  "Practical guides — Getting started with FlowPoint",
  "Use cases — How FlowPoint adapts to your business",
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
