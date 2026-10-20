import {
  RESOURCE_ARTICLE_CERTIFICATION,
  RESOURCE_ARTICLE_DRAFT_FIXTURE,
} from "./resource-article-certification";
import { RESOURCE_ARTICLE_CHECKLIST } from "./resource-article-checklist";
import { RESOURCE_ARTICLE_AUDIT_FREQUENCY } from "./resource-article-audit-frequency";
import { RESOURCE_ARTICLE_AUDIT_SEO_PME_PRIORITES } from "./resource-article-audit-seo-pme-priorites";
import { RESOURCE_ARTICLE_AUDIT_SEO_LOCAL } from "./resource-article-audit-seo-local";
import { RESOURCE_ARTICLE_AVIS_GOOGLE_SEO_LOCAL } from "./resource-article-avis-google-seo-local";
import { RESOURCE_ARTICLE_CONTENT_AUDIT } from "./resource-article-content-audit";
import { RESOURCE_ARTICLE_GUIDE_REFERENCEMENT_LOCAL } from "./resource-article-guide-referencement-local";
import { RESOURCE_ARTICLE_INTERPRETER_AUDIT } from "./resource-article-interpreter-audit";
import { RESOURCE_ARTICLE_MOTS_CLES_SEO_LOCAL } from "./resource-article-mots-cles-seo-local";
import { RESOURCE_ARTICLE_OPTIMISER_GOOGLE_BUSINESS_PROFILE } from "./resource-article-optimiser-google-business-profile";
import { RESOURCE_ARTICLE_PAGES_LOCALES_SEO } from "./resource-article-pages-locales-seo";
import { RESOURCE_ARTICLE_REFERENCEMENT_GOOGLE_MAPS } from "./resource-article-referencement-google-maps";
import { RESOURCE_ARTICLE_SUIVI_REFERENCEMENT_LOCAL } from "./resource-article-suivi-referencement-local";
import { RESOURCE_ARTICLE_ALERTES_MONITORING_SITE } from "./resource-article-alertes-monitoring-site";
import { RESOURCE_ARTICLE_AUDIT_SEO_VS_MONITORING } from "./resource-article-audit-seo-vs-monitoring";
import { RESOURCE_ARTICLE_CHOISIR_OUTIL_MONITORING_SEO } from "./resource-article-choisir-outil-monitoring-seo";
import { RESOURCE_ARTICLE_MONITORING_DISPONIBILITE_SITE } from "./resource-article-monitoring-disponibilite-site";
import { RESOURCE_ARTICLE_MONITORING_SEO_AUTOMATIQUE } from "./resource-article-monitoring-seo-automatique";
import { RESOURCE_ARTICLE_MONITORING_SEO_GUIDE } from "./resource-article-monitoring-seo-guide";
import { RESOURCE_ARTICLE_SUIVI_PERFORMANCES_SITE_WEB } from "./resource-article-suivi-performances-site-web";
import { RESOURCE_ARTICLE_SURVEILLANCE_SITE_WEB_INDICATEURS } from "./resource-article-surveillance-site-web-indicateurs";
import { RESOURCE_ARTICLE_CHOISIR_OUTIL_REPORTING_SEO } from "./resource-article-choisir-outil-reporting-seo";
import { RESOURCE_ARTICLE_RAPPORT_GOOGLE_SEARCH_CONSOLE } from "./resource-article-rapport-google-search-console";
import { RESOURCE_ARTICLE_RAPPORT_SEO_AUTOMATIQUE } from "./resource-article-rapport-seo-automatique";
import { RESOURCE_ARTICLE_RAPPORT_SEO_MENSUEL } from "./resource-article-rapport-seo-mensuel";
import { RESOURCE_ARTICLE_REPORTING_SEO_CLIENT } from "./resource-article-reporting-seo-client";
import { RESOURCE_ARTICLE_REPORTING_SEO_GUIDE } from "./resource-article-reporting-seo-guide";
import { RESOURCE_ARTICLE_REPORTING_SEO_PME } from "./resource-article-reporting-seo-pme";
import { RESOURCE_ARTICLE_TABLEAU_DE_BORD_SEO_KPI } from "./resource-article-tableau-de-bord-seo-kpi";
import { RESOURCE_ARTICLE_ANALYSE_BACKLINKS_CONCURRENTS } from "./resource-article-analyse-backlinks-concurrents";
import { RESOURCE_ARTICLE_ANALYSE_CONCURRENTIELLE_SEO_GUIDE } from "./resource-article-analyse-concurrentielle-seo-guide";
import { RESOURCE_ARTICLE_ANALYSE_CONTENU_CONCURRENTS } from "./resource-article-analyse-contenu-concurrents";
import { RESOURCE_ARTICLE_ANALYSE_MOTS_CLES_CONCURRENTS } from "./resource-article-analyse-mots-cles-concurrents";
import { RESOURCE_ARTICLE_BENCHMARK_SEO_INDICATEURS } from "./resource-article-benchmark-seo-indicateurs";
import { RESOURCE_ARTICLE_CHOISIR_OUTIL_ANALYSE_CONCURRENTIELLE_SEO } from "./resource-article-choisir-outil-analyse-concurrentielle-seo";
import { RESOURCE_ARTICLE_IDENTIFIER_CONCURRENTS_SEO } from "./resource-article-identifier-concurrents-seo";
import { RESOURCE_ARTICLE_OPPORTUNITES_SEO_CONCURRENCE } from "./resource-article-opportunites-seo-concurrence";

export const RESOURCE_SITE_URL = "https://flowpoint.pro";
export const RESOURCE_HUB_PATH = "/ressources";

export interface ResourceArticleLink {
  label: string;
  href: string;
}

export type ResourceArticleParagraph =
  | string
  | readonly (string | ResourceArticleLink)[];

export interface ResourceArticleTable {
  caption: string;
  description: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface ResourceArticleCta {
  heading: string;
  description: string;
  label: string;
}

export interface ResourceArticleSection {
  heading?: string;
  headingLevel?: 2 | 3;
  paragraphs?: readonly ResourceArticleParagraph[];
  bullets?: readonly string[];
  table?: ResourceArticleTable;
  links?: readonly ResourceArticleLink[];
}

export interface ResourceArticle {
  slug: string;
  title: string;
  metaDescription: string;
  h1: string;
  cluster: string;
  parentLanding: string;
  datePublished: string;
  dateModified: string;
  author: string;
  parentLandingCta?: ResourceArticleCta | null;
  published: boolean;
  testOnly?: boolean;
  content: readonly ResourceArticleSection[];
  relatedArticles: readonly string[];
}

const EDITORIAL_ARTICLES: readonly ResourceArticle[] = [
  {
    slug: "comment-faire-audit-seo-site-web",
    title: "Comment faire un audit SEO de son site web ? | Flowpoint",
    metaDescription:
      "Apprenez à faire un audit SEO de votre site : cadrer les objectifs, vérifier la technique et les pages, lire les données puis prioriser les actions.",
    h1: "Comment faire un audit SEO de son site web ? Méthode pas à pas",
    cluster: "Audit SEO",
    parentLanding: "/seo-audit",
    parentLandingCta: {
      heading: "Vous voulez un diagnostic plus guidé ?",
      description:
        "Découvrez la page Audit SEO de Flowpoint et les contrôles, indicateurs et recommandations présentés pour votre site.",
      label: "Découvrir la page Audit SEO",
    },
    datePublished: "2026-10-07",
    dateModified: "2026-10-07",
    author: "Équipe Flowpoint",
    published: true,
    content: [
      {
        paragraphs: [
          "Un audit SEO utile ne se résume pas à obtenir un score ou à accumuler des alertes. Il consiste à examiner des preuves, à comprendre ce qui concerne les pages importantes de votre site, puis à choisir des actions que vous pourrez vérifier. Cette méthode s’adresse aux personnes qui veulent réaliser un premier audit, avec les outils auxquels elles ont accès.",
          "L’ordre compte : commencez par vous assurer que les pages stratégiques peuvent être explorées et indexées, puis examinez leur pertinence, leur qualité et leur fonctionnement. Terminez par un plan d’action. Si vous n’avez pas accès à une source de données, notez cette limite au lieu de combler le manque avec une supposition.",
        ],
      },
      {
        heading: "Avant de commencer : cadrer le périmètre",
        paragraphs: [
          "Définissez d’abord l’objectif de l’audit. Cherchez-vous à comprendre pourquoi une page importante reçoit peu de visites, à vérifier une migration, à repérer des erreurs techniques ou à clarifier les prochaines priorités ? Une question précise évite de parcourir des indicateurs qui ne changent aucune décision.",
          "Choisissez ensuite le périmètre : un site entier, une section, un type de page ou quelques URL prioritaires. Notez la date, le domaine canonique attendu, les changements récents et les personnes qui pourront vérifier ou corriger les constats. Pour un grand site, un échantillon représentatif peut aider à commencer, mais il ne remplace pas un contrôle des URL critiques.",
          "Réunissez les données disponibles. Le rapport sur les performances de Google Search Console peut montrer les requêtes et pages qui apparaissent dans la recherche, ainsi que leurs impressions et clics. Un crawl peut inventorier les URL et leurs liens. Des données d’analytics, si elles sont configurées, peuvent aider à relier les visites à des actions métier. Chaque source répond à une question différente ; aucune ne décrit à elle seule toute la santé SEO du site.",
          "Gardez une colonne « source / limite » dans vos notes. Par exemple, une baisse de clics observée dans Search Console est un signal à examiner ; elle n’explique pas seule sa cause. Vérifiez le périmètre, la période et les pages concernées avant de conclure.",
          "Établissez une situation de départ avant de modifier quoi que ce soit : quelles pages sont incluses, quelle période vous observez et quels changements récents peuvent influencer les données ? Réutilisez ensuite un périmètre comparable pour vérifier les effets. Cela n’isole pas automatiquement la cause d’une évolution, mais aide à éviter les comparaisons entre périodes ou URL qui ne répondent pas à la même question.",
        ],
        links: [
          {
            label: "Documentation Google : rapport sur les performances de la recherche",
            href: "https://support.google.com/webmasters/answer/7576553?hl=fr",
          },
        ],
      },
      {
        heading: "Étape 1 : vérifier l’exploration et l’indexation",
        paragraphs: [
          "Commencez par les URL qui servent un objectif important : page de service, page de contact, page d’offre ou contenu qui répond à une recherche identifiée. Vérifiez leur réponse HTTP, leurs directives d’indexation et leur URL canonique. Si vous disposez de Search Console, le rapport d’indexation et l’outil d’inspection d’URL peuvent fournir des éléments supplémentaires sur la façon dont Google voit une page.",
          "Ne confondez pas les mécanismes. Le fichier robots.txt sert à gérer l’exploration ; une directive noindex demande de ne pas indexer une page lorsque le robot peut la lire. Une URL bloquée à l’exploration peut être difficile à contrôler et une règle robots.txt n’est pas une méthode fiable pour retirer une page déjà connue des moteurs. En cas de doute, vérifiez la configuration et la documentation plutôt que d’ajouter des directives en série.",
          "Consultez aussi le sitemap XML : les URL qui y figurent devraient correspondre aux pages que vous souhaitez faire découvrir et qui sont cohérentes avec vos canonicals. Il fournit aux moteurs des informations sur les URL importantes, sans remplacer les liens internes ni une configuration cohérente.",
          "Enfin, repérez les erreurs 404 internes, les redirections inutiles ou en chaîne, les pages importantes difficiles à atteindre et les versions concurrentes d’une même URL. Avant de corriger, vérifiez quelle version est réellement destinée à rester accessible.",
          "Traitez les incohérences comme un faisceau de signaux. Une URL dans le sitemap, un lien interne et une balise canonical qui désignent trois versions différentes méritent une vérification ; cela ne signifie pas qu’il faut changer les trois mécaniquement. Identifiez d’abord l’URL que l’entreprise souhaite réellement conserver, puis contrôlez les liens et les directives autour de cette décision.",
        ],
        bullets: [
          "La page répond-elle avec le statut attendu et sans redirection inattendue ?",
          "Est-elle accessible à l’exploration et porte-t-elle la directive d’indexation voulue ?",
          "La balise canonical pointe-t-elle vers la version préférée ?",
          "Les liens internes et le sitemap mènent-ils vers cette même version ?",
        ],
        links: [
          {
            label: "Checklist d’audit SEO technique : contrôles détaillés",
            href: "/ressources/checklist-audit-seo-technique",
          },
          {
            label: "Google Search Central : comprendre robots.txt",
            href: "https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=fr",
          },
          {
            label: "Google Search Central : créer et gérer un sitemap",
            href: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview?hl=fr",
          },
          {
            label: "Google Search Central : choisir une URL canonique",
            href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=fr",
          },
          {
            label: "Aide Search Console : outil d’inspection d’URL",
            href: "https://support.google.com/webmasters/answer/9012289?hl=fr",
          },
        ],
      },
      {
        heading: "Étape 2 : examiner les pages stratégiques",
        paragraphs: [
          "Associez les pages importantes aux besoins qu’elles doivent servir. Une page de service, un guide et une page de contact n’ont pas le même rôle. Pour chaque URL prioritaire, notez la requête ou le groupe de recherches visé, le public concerné et l’action que la page doit rendre possible.",
          "Lisez ensuite la page comme un visiteur : son titre décrit-il correctement son sujet ? Le H1 et les sections annoncent-ils ce que la page apporte ? Le contenu répond-il réellement à la question, ou se contente-t-il de répéter des termes ? Les liens internes aident-ils à poursuivre le parcours ? Une balise isolée ou un mot-clé absent ne suffit pas à conclure qu’une page est défaillante.",
          "Comparez les pages qui semblent viser la même intention. Si plusieurs pages se recouvrent, identifiez leur rôle et leurs différences avant de les modifier. Il peut être plus utile de préciser leur angle ou leur maillage que de fusionner immédiatement le contenu.",
          "Pour les requêtes déjà visibles dans Search Console, comparez les pages affichées et les recherches auxquelles elles répondent. Si vous n’avez pas ces données, construisez une hypothèse à partir du contenu et des besoins de vos visiteurs, puis marquez-la comme telle.",
          "Pour aller vite sans tirer de conclusions sur tout le site, choisissez une page représentative par modèle : par exemple une page de service, une fiche produit ou un guide. Vérifiez d’abord les modèles qui portent un objectif important. Si le même problème apparaît sur plusieurs URL construites de la même façon, examinez le gabarit commun avant de corriger chaque page séparément.",
        ],
      },
      {
        heading: "Étape 3 : vérifier la pertinence du contenu",
        paragraphs: [
          "Sur les pages prioritaires, vérifiez si le contenu apporte une réponse claire, suffisamment précise et adaptée à l’intention. Contrôlez les informations dépassées, les affirmations sans source, les sections qui ne servent pas le sujet et les pages dont le contenu se répète. La question n’est pas « combien de mots faut-il ajouter ? », mais « quelle information utile manque au lecteur ? »",
          "Si vous examinez un ensemble de contenus, créez un inventaire avec l’URL, son rôle, ses requêtes connues, ses liens internes et les données disponibles. Classez les décisions possibles : conserver, actualiser, rapprocher de contenu complémentaire ou étudier une suppression. Avant de retirer une page, vérifiez son trafic, ses liens et ses éventuelles fonctions métier ; prévoyez une redirection adaptée si elle est nécessaire.",
          "Cette étape reste un premier examen dans un audit général. Un audit éditorial complet nécessite un inventaire et une analyse propres aux contenus ; ne mélangez pas ce travail avec les seuls contrôles techniques.",
          "Une page récente ou peu consultée n’est pas automatiquement inutile. Tenez compte de son rôle dans le parcours, des requêtes auxquelles elle peut répondre, des liens qui y conduisent et des informations qu’elle apporte. Si les données sont trop limitées pour décider, consignez ce qui manque et reportez la décision plutôt que de supprimer le contenu par réflexe.",
        ],
        links: [
          {
            label: "Méthode d’audit du contenu SEO et des pages existantes",
            href: "/ressources/audit-contenu-seo",
          },
        ],
      },
      {
        heading: "Étape 4 : examiner les signaux techniques prioritaires",
        paragraphs: [
          "Vérifiez que le site est utilisable sur mobile et que les pages prioritaires se chargent correctement. Si vous consultez les Core Web Vitals, distinguez les données terrain, issues d’expériences réelles, des mesures de laboratoire produites pendant un test. Elles ne représentent pas le même type d’observation. Une variation de performance doit être examinée sur les pages et appareils concernés avant de choisir une correction.",
          "Repérez aussi les problèmes qui empêchent la consultation ou compliquent la compréhension des pages : ressources essentielles inaccessibles, erreurs répétées, navigation peu claire ou liens internes cassés. Notez le contexte, l’URL et la méthode de vérification. Un indicateur technique est un signal de diagnostic, pas une promesse de classement ; de bons Core Web Vitals ne garantissent pas à eux seuls une position donnée.",
          "Pour chaque problème, demandez-vous s’il affecte une page stratégique, s’il est reproductible et s’il a une cause identifiée. Ne lancez pas une modification globale à partir d’une capture isolée ou d’un score sans vérifier le résultat attendu.",
          "Mesurez plusieurs pages représentatives et séparez les résultats propres à une URL de ceux qui semblent partagés par un gabarit. Une page lente sur une connexion de test ne démontre pas à elle seule un problème général. Notez l’appareil, la méthode et la date de mesure, puis cherchez à reproduire le signal avant de recommander une intervention.",
        ],
        links: [
          {
            label: "Google Search Central : métriques Core Web Vitals",
            href: "https://developers.google.com/search/docs/appearance/core-web-vitals?hl=fr",
          },
          {
            label: "Google Search Central : expérience sur la page et résultats de recherche",
            href: "https://developers.google.com/search/docs/appearance/page-experience?hl=fr",
          },
        ],
      },
      {
        heading: "Étape 5 : lire les constats et choisir les premières actions",
        paragraphs: [
          "Avant de prioriser un constat, confirmez ce qui a été observé, sur quelles pages et avec quelle source. Distinguez le symptôme de sa cause possible : une page qui ne reçoit pas de clics peut avoir plusieurs explications, et changer son titre n’est pas forcément la bonne réponse. Écrivez une hypothèse vérifiable plutôt qu’une certitude que les données ne soutiennent pas.",
          "Estimez ensuite l’impact attendu selon le rôle de la page, l’effort, les dépendances et le risque d’une modification. Ces estimations doivent refléter le contexte du site, pas un score universel. Une correction facile n’est pas automatiquement prioritaire ; une action plus complexe peut être urgente si elle touche un parcours essentiel.",
          "Pour une PME avec peu de ressources, commencez par un petit nombre de pages importantes et des actions que l’équipe peut réellement mener. Définissez ce qui sera vérifié après chaque changement. Si vous ne connaissez pas encore l’impact ou l’effort, inscrivez « à vérifier » plutôt que d’inventer une valeur.",
          "Le tableau suivant montre la forme possible d’une ligne de suivi. Les champs « impact », « effort » et « responsable » restent à renseigner par l’équipe après vérification : l’exemple ne fournit pas de note prête à réutiliser.",
        ],
        table: {
          caption:
            "Tableau illustratif de priorisation d’un constat d’audit SEO.",
          description:
            "Exemple entièrement fictif ; il ne décrit ni un site client ni un résultat mesuré par Flowpoint.",
          headers: [
            "URL",
            "Constat",
            "Preuve à vérifier",
            "Impact",
            "Effort",
            "Action",
            "Responsable",
            "Mesure de suivi",
          ],
          rows: [
            [
              "/services/ (URL illustrative)",
              "Exemple fictif : le titre de la page pourrait mieux correspondre au besoin visé.",
              "Comparer le titre publié, le contenu, la requête visée et les données Search Console disponibles avant de conclure.",
              "À qualifier selon le rôle de la page et les objectifs du site.",
              "À estimer après vérification technique et éditoriale.",
              "Si l’hypothèse se confirme, proposer un titre plus fidèle au contenu et le faire valider.",
              "À désigner dans l’équipe.",
              "Vérifier le titre déployé ; comparer impressions, clics et taux de clic sur des périodes pertinentes, si les données sont disponibles.",
            ],
          ],
        },
        links: [
          {
            label: "Interpréter et prioriser les résultats d’un audit SEO",
            href: "/ressources/interpreter-resultats-audit-seo",
          },
          {
            label: "Audit SEO pour PME : quelles vérifications prioriser ?",
            href: "/ressources/audit-seo-pme-priorites",
          },
        ],
      },
      {
        heading: "Étape 6 : transformer l’audit en plan d’action",
        paragraphs: [
          "Un audit se termine par des décisions attribuées, pas par une liste laissée sans suite. Pour chaque action retenue, indiquez la page ou le groupe de pages concerné, la preuve, la modification prévue, la personne responsable, les dépendances et la façon de vérifier le résultat. Gardez aussi les points en attente de données ou d’expertise dans une liste distincte.",
          "Après une modification, vérifiez d’abord qu’elle a été déployée comme prévu. Selon le changement, contrôlez ensuite l’URL, le contenu, l’indexation ou les indicateurs associés. Comparez des périodes pertinentes et tenez compte des autres changements intervenus entre-temps ; une évolution temporelle ne démontre pas, à elle seule, qu’une modification en est la cause.",
          "Il n’existe pas une fréquence identique pour tous les sites. Une migration, un changement important ou un problème observé peuvent justifier un contrôle ciblé ; le suivi permanent des incidents relève plutôt du monitoring. Pour le premier audit, la priorité est de documenter une méthode reproductible que votre équipe pourra reprendre.",
          "Une fois les actions réparties, gardez une trace des éléments reportés et de la raison du report. Cette liste évite de confondre « non prioritaire aujourd’hui » avec « vérifié et sans problème ». Elle sert aussi de point de départ au prochain contrôle ciblé, sans imposer un calendrier identique à tous les sites.",
        ],
        links: [
          {
            label: "À quelle fréquence réaliser un audit SEO de son site ?",
            href: "/ressources/frequence-audit-seo-site",
          },
        ],
      },
      {
        heading: "Sources officielles",
        paragraphs: [
          "Les contrôles d’exploration, de canonicalisation, de performance et de données de recherche ci-dessus s’appuient sur la documentation de Google. Consultez les pages correspondantes pour vérifier les détails et les éventuelles mises à jour.",
        ],
        links: [
          {
            label: "Rapport sur les performances de la recherche — Aide Search Console",
            href: "https://support.google.com/webmasters/answer/7576553?hl=fr",
          },
          {
            label: "Introduction à robots.txt — Google Search Central",
            href: "https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=fr",
          },
          {
            label: "Sitemaps — Google Search Central",
            href: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview?hl=fr",
          },
          {
            label: "URL canonique — Google Search Central",
            href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=fr",
          },
          {
            label: "Core Web Vitals — Google Search Central",
            href: "https://developers.google.com/search/docs/appearance/core-web-vitals?hl=fr",
          },
          {
            label: "Expérience sur la page et résultats de recherche — Google Search Central",
            href: "https://developers.google.com/search/docs/appearance/page-experience?hl=fr",
          },
          {
            label: "Outil d’inspection d’URL — Aide Search Console",
            href: "https://support.google.com/webmasters/answer/9012289?hl=fr",
          },
        ],
      },
    ],
    relatedArticles: [],
  },
  RESOURCE_ARTICLE_CHECKLIST,
  RESOURCE_ARTICLE_INTERPRETER_AUDIT,
  RESOURCE_ARTICLE_CONTENT_AUDIT,
  RESOURCE_ARTICLE_AUDIT_SEO_PME_PRIORITES,
  RESOURCE_ARTICLE_AUDIT_FREQUENCY,
  RESOURCE_ARTICLE_GUIDE_REFERENCEMENT_LOCAL,
  RESOURCE_ARTICLE_OPTIMISER_GOOGLE_BUSINESS_PROFILE,
  RESOURCE_ARTICLE_AUDIT_SEO_LOCAL,
  RESOURCE_ARTICLE_REFERENCEMENT_GOOGLE_MAPS,
  RESOURCE_ARTICLE_MOTS_CLES_SEO_LOCAL,
  RESOURCE_ARTICLE_PAGES_LOCALES_SEO,
  RESOURCE_ARTICLE_AVIS_GOOGLE_SEO_LOCAL,
  RESOURCE_ARTICLE_SUIVI_REFERENCEMENT_LOCAL,
  RESOURCE_ARTICLE_MONITORING_SEO_GUIDE,
  RESOURCE_ARTICLE_SURVEILLANCE_SITE_WEB_INDICATEURS,
  RESOURCE_ARTICLE_MONITORING_DISPONIBILITE_SITE,
  RESOURCE_ARTICLE_ALERTES_MONITORING_SITE,
  RESOURCE_ARTICLE_SUIVI_PERFORMANCES_SITE_WEB,
  RESOURCE_ARTICLE_MONITORING_SEO_AUTOMATIQUE,
  RESOURCE_ARTICLE_AUDIT_SEO_VS_MONITORING,
  RESOURCE_ARTICLE_CHOISIR_OUTIL_MONITORING_SEO,
  RESOURCE_ARTICLE_REPORTING_SEO_GUIDE,
  RESOURCE_ARTICLE_RAPPORT_SEO_AUTOMATIQUE,
  RESOURCE_ARTICLE_TABLEAU_DE_BORD_SEO_KPI,
  RESOURCE_ARTICLE_RAPPORT_GOOGLE_SEARCH_CONSOLE,
  RESOURCE_ARTICLE_REPORTING_SEO_PME,
  RESOURCE_ARTICLE_RAPPORT_SEO_MENSUEL,
  RESOURCE_ARTICLE_REPORTING_SEO_CLIENT,
  RESOURCE_ARTICLE_CHOISIR_OUTIL_REPORTING_SEO,
  RESOURCE_ARTICLE_ANALYSE_CONCURRENTIELLE_SEO_GUIDE,
  RESOURCE_ARTICLE_IDENTIFIER_CONCURRENTS_SEO,
  RESOURCE_ARTICLE_ANALYSE_MOTS_CLES_CONCURRENTS,
  RESOURCE_ARTICLE_ANALYSE_CONTENU_CONCURRENTS,
  RESOURCE_ARTICLE_BENCHMARK_SEO_INDICATEURS,
  RESOURCE_ARTICLE_ANALYSE_BACKLINKS_CONCURRENTS,
  RESOURCE_ARTICLE_OPPORTUNITES_SEO_CONCURRENCE,
  RESOURCE_ARTICLE_CHOISIR_OUTIL_ANALYSE_CONCURRENTIELLE_SEO,
];

const LOCAL_TEST_ARTICLES: readonly ResourceArticle[] =
  process.env.NODE_ENV === "production"
    ? []
    : [RESOURCE_ARTICLE_CERTIFICATION, RESOURCE_ARTICLE_DRAFT_FIXTURE];

export const RESOURCE_ARTICLES: readonly ResourceArticle[] = [
  ...EDITORIAL_ARTICLES,
  ...LOCAL_TEST_ARTICLES,
];

export function getPublishedResourceArticles(): ResourceArticle[] {
  return RESOURCE_ARTICLES.filter((article) => article.published);
}

export function getProductionResourceArticles(): ResourceArticle[] {
  return RESOURCE_ARTICLES.filter(
    (article) => article.published && !article.testOnly,
  );
}

export function getResourceArticle(slug: string): ResourceArticle | undefined {
  return RESOURCE_ARTICLES.find(
    (article) => article.slug === slug && article.published,
  );
}

export function getResourceArticleFromPath(
  pathname: string,
): ResourceArticle | undefined {
  const prefix = `${RESOURCE_HUB_PATH}/`;
  if (!pathname.startsWith(prefix)) return undefined;

  const encodedSlug = pathname.slice(prefix.length);
  if (!encodedSlug || encodedSlug.includes("/")) return undefined;

  try {
    return getResourceArticle(decodeURIComponent(encodedSlug));
  } catch {
    return undefined;
  }
}

export function getResourceArticlePath(slug: string): string {
  return `${RESOURCE_HUB_PATH}/${encodeURIComponent(slug)}`;
}

export function getResourceArticleCanonical(slug: string): string {
  return `${RESOURCE_SITE_URL}${getResourceArticlePath(slug)}`;
}
