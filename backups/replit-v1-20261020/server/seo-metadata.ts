import {
  SEO_CLUSTER_CONTENT,
  type SeoClusterPath,
} from "@shared/seo-cluster-content";
import {
  getResourceArticleCanonical,
  getResourceArticleFromPath,
  RESOURCE_SITE_URL,
  type ResourceArticle,
} from "@shared/resource-articles";
import {
  buildFaqPageJsonLd,
  buildResourcesItemListJsonLd,
  PRICING_FAQS,
} from "@shared/structured-data-content";
import { HOME_PAGE_TITLE } from "@shared/site-metadata";

export interface RouteMetadata {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
  ogType?: "website" | "article";
  noindex?: boolean;
}

const BASE_URL = RESOURCE_SITE_URL;
const DEFAULT_OG_IMAGE = `${BASE_URL}/social-cover.png`;
const SITE_NAME = "Flowpoint";

export const ROUTE_METADATA: Record<string, RouteMetadata> = {
  "/": {
    title: HOME_PAGE_TITLE,
    description:
      "Flowpoint combine SEO local, monitoring uptime, missions IA, analytics GA4 et détection de fuites de revenus — tout depuis un seul dashboard. Essai gratuit 14 jours.",
    canonical: `${BASE_URL}/`,
  },
  "/fonctionnalites": {
    title: "Fonctionnalités | Flowpoint",
    description:
      "Découvrez toutes les fonctionnalités Flowpoint : SEO local, monitoring uptime, missions IA, analytics GA4 et détection de fuites de revenus pour dominer votre marché local.",
    canonical: `${BASE_URL}/fonctionnalites`,
  },
  "/seo-audit": {
    title: "Outil d'audit SEO pour analyser votre site | Flowpoint",
    description:
      "Analysez votre site avec l'outil d'audit SEO Flowpoint. Détectez les problèmes techniques, identifiez les optimisations prioritaires et améliorez votre référencement.",
    canonical: `${BASE_URL}/seo-audit`,
  },
  "/local-seo": {
    title: "Outil SEO local pour améliorer votre référencement | Flowpoint",
    description:
      "Améliorez votre référencement local avec Flowpoint. Analysez votre présence locale, identifiez les optimisations prioritaires et suivez votre visibilité depuis une seule plateforme.",
    canonical: `${BASE_URL}/local-seo`,
  },
  "/website-monitoring": {
    title: "Monitoring SEO : surveillez votre site automatiquement | Flowpoint",
    description:
      "Surveillez votre site avec le monitoring SEO Flowpoint. Suivez sa disponibilité et ses signaux techniques pour détecter rapidement les problèmes pouvant affecter votre activité.",
    canonical: `${BASE_URL}/website-monitoring`,
  },
  "/seo-reporting": {
    title: "Rapports SEO automatiques et reporting | Flowpoint",
    description:
      "Centralisez votre reporting avec les rapports SEO Flowpoint. Transformez vos données en rapports clairs, partageables et adaptés au suivi de vos performances.",
    canonical: `${BASE_URL}/seo-reporting`,
  },
  "/competitor-analysis": {
    title: "Analyse de la concurrence SEO et suivi des concurrents | Flowpoint",
    description:
      "Analysez votre concurrence SEO avec Flowpoint. Suivez vos concurrents, comparez leur présence digitale et identifiez des opportunités pour renforcer votre visibilité.",
    canonical: `${BASE_URL}/competitor-analysis`,
  },
  "/tarifs": {
    title: "Tarifs | Flowpoint",
    description:
      "Choisissez l'offre Flowpoint adaptée à vos besoins. Starter, Pro et Agence — sans engagement, annulation à tout moment. Essai gratuit 14 jours inclus.",
    canonical: `${BASE_URL}/tarifs`,
  },
  "/avantages": {
    title: "Avantages | Flowpoint",
    description:
      "Découvrez comment Flowpoint transforme la visibilité locale de votre entreprise et booste votre croissance grâce au SEO local automatisé.",
    canonical: `${BASE_URL}/avantages`,
  },
  "/ressources": {
    title: "Centre de ressources | Flowpoint",
    description:
      "Bibliothèque de guides, bonnes pratiques et études de cas pour maîtriser la croissance digitale : SEO, IA, monitoring, analytics et rapports automatiques.",
    canonical: `${BASE_URL}/ressources`,
  },
  "/a-propos": {
    title: "À propos | Flowpoint",
    description:
      "Flowpoint est une plateforme tout-en-un conçue pour aider les entreprises locales à piloter leur visibilité en ligne et attirer plus de clients.",
    canonical: `${BASE_URL}/a-propos`,
  },
  "/contact": {
    title: "Contact | Flowpoint",
    description:
      "Une question ou un projet ? Contactez l'équipe Flowpoint. Nous sommes là pour vous accompagner dans votre développement digital local.",
    canonical: `${BASE_URL}/contact`,
  },
  "/carrieres": {
    title: "Carrières | Flowpoint",
    description:
      "Rejoignez Flowpoint et participez à la révolution du SEO local. Aidez les entreprises belges à prospérer dans le monde digital.",
    canonical: `${BASE_URL}/carrieres`,
  },
  "/mentions-legales": {
    title: "Mentions légales | Flowpoint",
    description:
      "Mentions légales de Flowpoint : éditeur du site, hébergement, propriété intellectuelle et données personnelles.",
    canonical: `${BASE_URL}/mentions-legales`,
  },
  "/informations-legales": {
    title: "Informations légales | Flowpoint",
    description:
      "Conditions d'utilisation, politique de confidentialité et informations légales de Flowpoint réunies en un seul endroit.",
    canonical: `${BASE_URL}/informations-legales`,
  },
  "/mises-a-jour": {
    title: "Mises à jour | Flowpoint",
    description:
      "Découvrez les dernières fonctionnalités et améliorations de Flowpoint. Nous travaillons constamment pour vous offrir le meilleur outil SEO local.",
    canonical: `${BASE_URL}/mises-a-jour`,
  },
  "/merci": {
    title: "Merci | Flowpoint",
    description:
      "Merci pour votre inscription à Flowpoint. Découvrez comment notre plateforme va transformer votre visibilité locale.",
    noindex: true,
  },
};

function buildClusterFaqJsonLd(path: SeoClusterPath): object {
  const content = SEO_CLUSTER_CONTENT[path];

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

function buildResourceArticleJsonLd(article: ResourceArticle): object {
  const canonical = getResourceArticleCanonical(article.slug);

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.h1,
    description: article.metaDescription,
    image: DEFAULT_OG_IMAGE,
    author: {
      "@type": "Organization",
      name: article.author,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: `${BASE_URL}/`,
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/favicon.svg?v=2`,
      },
    },
    datePublished: article.datePublished,
    dateModified: article.dateModified,
    articleSection: article.cluster,
    inLanguage: "fr-FR",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonical,
    },
  };
}

function buildResourceArticleBreadcrumbJsonLd(
  article: ResourceArticle,
): object {
  const canonical = getResourceArticleCanonical(article.slug);

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Accueil",
        item: `${BASE_URL}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Ressources",
        item: `${BASE_URL}/ressources`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: article.h1,
        item: canonical,
      },
    ],
  };
}

export const ROUTE_JSON_LD: Record<string, object> = {
  "/": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Combien de temps avant de voir des résultats ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Les premiers indicateurs et recommandations sont disponibles dès les premières analyses. Les résultats concrets dépendent de nombreux facteurs, comme votre secteur d'activité, la concurrence et les actions mises en œuvre. En référencement naturel, des améliorations peuvent être observées progressivement sur plusieurs semaines ou plusieurs mois."
        }
      },
      {
        "@type": "Question",
        "name": "Est-ce que je dois avoir des connaissances techniques ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Absolument pas ! Flowpoint est conçu pour être simple d'utilisation. Nous vous guidons étape par étape avec des recommandations claires et actionnables."
        }
      },
      {
        "@type": "Question",
        "name": "Puis-je annuler à tout moment ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Oui, tous nos abonnements sont sans engagement. Vous pouvez annuler à tout moment depuis votre espace client."
        }
      },
      {
        "@type": "Question",
        "name": "Quel support est disponible ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Tous les plans incluent un support par email. Les plans Pro et Ultra bénéficient d'un support prioritaire avec réponse sous 24h. Un support IA est également disponible 24h/24 et 7j/7 directement sur le site, sans attente."
        }
      },
      {
        "@type": "Question",
        "name": "Flowpoint fonctionne-t-il pour mon secteur d'activité ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Oui. FlowPoint est conçu pour s'adapter à de nombreux secteurs d'activité, tels que la restauration, l'artisanat, les commerces, les professions libérales et bien d'autres. Les analyses et recommandations sont adaptées aux données de votre entreprise."
        }
      },
      {
        "@type": "Question",
        "name": "Mes données sont-elles sécurisées ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Oui. La sécurité de vos données est une priorité. Les communications sont chiffrées et vos informations sont stockées de manière sécurisée. FlowPoint ne partage jamais vos données avec des tiers sans votre autorisation."
        }
      },
      {
        "@type": "Question",
        "name": "Puis-je changer de formule plus tard ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Oui. Vous pouvez passer à une formule supérieure ou inférieure à tout moment selon l'évolution de vos besoins."
        }
      },
      {
        "@type": "Question",
        "name": "Comment tester Flowpoint avant de m'engager ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "C'est simple : profitez de notre essai gratuit de 14 jours, sans engagement et sans carte bancaire. Vous accédez à l'ensemble de la plateforme pour tester toutes les fonctionnalités à votre rythme."
        }
      }
    ]
  },
  "/seo-audit": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Qu'est-ce qu'un audit SEO ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Un audit SEO est une analyse structurée d'un site web qui permet d'identifier les éléments qui facilitent ou freinent sa visibilité dans les moteurs de recherche. Il aide à comprendre les problèmes à traiter et les optimisations à prioriser."
        }
      },
      {
        "@type": "Question",
        "name": "Que vérifie un audit SEO de site web ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Flowpoint analyse notamment les balises meta et les titres, la vitesse de chargement, les erreurs techniques, les performances du site et les opportunités liées aux mots-clés. Ces informations sont regroupées pour rendre les prochaines actions plus claires."
        }
      },
      {
        "@type": "Question",
        "name": "Pourquoi réaliser régulièrement un audit SEO ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Un site évolue, ses performances peuvent changer et de nouveaux problèmes peuvent apparaître. Des audits réguliers permettent de suivre les résultats, de repérer les changements importants et de concentrer les efforts sur les améliorations les plus utiles."
        }
      },
      {
        "@type": "Question",
        "name": "Faut-il être expert SEO pour utiliser Flowpoint ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Non. Flowpoint présente les résultats dans des tableaux de bord clairs et fournit des recommandations personnalisées. L'objectif est de transformer les constats techniques en actions compréhensibles, même sans expertise SEO avancée."
        }
      },
      {
        "@type": "Question",
        "name": "Comment commencer un audit avec Flowpoint ?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Créez votre compte Flowpoint, ajoutez votre site web et lancez l'analyse depuis votre espace. Vous pourrez ensuite consulter les résultats et utiliser les recommandations pour planifier vos prochaines actions."
        }
      }
    ]
  },
  "/local-seo": buildClusterFaqJsonLd("/local-seo"),
  "/website-monitoring": buildClusterFaqJsonLd("/website-monitoring"),
  "/seo-reporting": buildClusterFaqJsonLd("/seo-reporting"),
  "/competitor-analysis": buildClusterFaqJsonLd("/competitor-analysis"),
  "/tarifs": buildFaqPageJsonLd(PRICING_FAQS),
  "/ressources": buildResourcesItemListJsonLd(),
};

export const NOT_FOUND_METADATA: RouteMetadata = {
  title: "Page introuvable | Flowpoint",
  description: "Cette page n'existe pas ou a été déplacée.",
  noindex: true,
};

function getRouteMetadata(pathname: string): RouteMetadata {
  const metadata = ROUTE_METADATA[pathname];
  if (metadata) return metadata;

  const article = getResourceArticleFromPath(pathname);
  if (!article) return NOT_FOUND_METADATA;

  return {
    title: article.title,
    description: article.metaDescription,
    canonical: getResourceArticleCanonical(article.slug),
    ogType: "article",
    noindex: article.testOnly,
  };
}

function getRouteJsonLd(pathname: string): object[] {
  const staticJsonLd = ROUTE_JSON_LD[pathname];
  if (staticJsonLd) return [staticJsonLd];

  const article = getResourceArticleFromPath(pathname);
  if (!article) return [];

  return [
    buildResourceArticleJsonLd(article),
    buildResourceArticleBreadcrumbJsonLd(article),
  ];
}

export function buildHeadTags(meta: RouteMetadata): string {
  const ogImage = meta.ogImage ?? DEFAULT_OG_IMAGE;
  const tags = [
    `<meta name="description" content="${escapeAttr(meta.description)}" />`,
  ];
  if (meta.noindex) {
    tags.push(`<meta name="robots" content="noindex,follow" />`);
  }
  if (meta.canonical) {
    tags.push(`<link rel="canonical" href="${escapeAttr(meta.canonical)}" />`);
  }
  tags.push(
    `<meta property="og:type" content="${meta.ogType ?? "website"}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="fr_FR" />`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
  );
  if (meta.canonical) {
    tags.push(`<meta property="og:url" content="${escapeAttr(meta.canonical)}" />`);
  }
  tags.push(
    `<meta property="og:image" content="${escapeAttr(ogImage)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(ogImage)}" />`,
  );
  if (meta.canonical) {
    tags.push(
      `<link rel="alternate" hreflang="fr" href="${escapeAttr(meta.canonical)}" />`,
      `<link rel="alternate" hreflang="x-default" href="${escapeAttr(meta.canonical)}" />`,
    );
  }
  return tags.join("\n    ");
}

export function injectMetadata(html: string, pathname: string): string {
  const meta = getRouteMetadata(pathname);

  const titleTag = `<title>${escapeHtml(meta.title)}</title>`;
  const headTags = buildHeadTags(meta);

  const result = html.replace(/<title>[^<]*<\/title>/, titleTag);

  const headCloseIdx = result.lastIndexOf("</head>");
  if (headCloseIdx === -1) return result;

  const jsonLdTags = getRouteJsonLd(pathname)
    .map(
      (jsonLd) =>
        `\n    <script type="application/ld+json" data-json-ld="true">${JSON.stringify(jsonLd)}</script>`,
    )
    .join("");

  return (
    result.slice(0, headCloseIdx) +
    `    ${headTags}${jsonLdTags}\n  </head>` +
    result.slice(headCloseIdx + 7)
  );
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
