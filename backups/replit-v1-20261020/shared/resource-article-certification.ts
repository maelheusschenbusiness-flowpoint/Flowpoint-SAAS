import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_CERTIFICATION: ResourceArticle = {
  slug: "certification-infrastructure-articles",
  title: "Article de certification technique | Flowpoint",
  metaDescription:
    "Contenu temporaire utilisé uniquement pour vérifier l’infrastructure des articles et ressources Flowpoint.",
  h1: "Article de certification de l’infrastructure éditoriale",
  cluster: "Certification technique",
  parentLanding: "/seo-audit",
  datePublished: "2026-10-07",
  dateModified: "2026-10-07",
  author: "Équipe Flowpoint",
  published: true,
  testOnly: true,
  content: [
    {
      paragraphs: [
        "Cet article court est un contenu technique temporaire. Il sert à vérifier le routage dynamique, le rendu SSR, les métadonnées, les données structurées et le sitemap.",
      ],
    },
    {
      heading: "Vérifications de la page",
      paragraphs: [
        "Cette page de certification n’est destinée qu’à l’environnement local. Elle ne fait pas partie des contenus éditoriaux à publier.",
      ],
    },
  ],
  relatedArticles: [],
};

export const RESOURCE_ARTICLE_DRAFT_FIXTURE: ResourceArticle = {
  slug: "brouillon-test-non-publie",
  title: "Brouillon de test non publié | Flowpoint",
  metaDescription: "Fixture locale pour vérifier le rejet des articles non publiés.",
  h1: "Brouillon de test non publié",
  cluster: "Fixture de test",
  parentLanding: "/seo-audit",
  datePublished: "2026-10-07",
  dateModified: "2026-10-07",
  author: "Équipe Flowpoint",
  published: false,
  testOnly: true,
  content: [],
  relatedArticles: [],
};
