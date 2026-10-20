export type SeoClusterPath =
  | "/local-seo"
  | "/website-monitoring"
  | "/seo-reporting"
  | "/competitor-analysis";

export type SeoClusterIcon =
  | "activity"
  | "barChart"
  | "bell"
  | "building"
  | "fileText"
  | "gauge"
  | "globe"
  | "lineChart"
  | "map"
  | "search"
  | "share"
  | "shield"
  | "sparkles"
  | "star"
  | "target"
  | "trophy"
  | "users";

export interface SeoClusterFaq {
  question: string;
  answer: string;
}

export interface SeoClusterCard {
  icon: SeoClusterIcon;
  title: string;
  description: string;
}

export interface SeoClusterContent {
  path: SeoClusterPath;
  title: string;
  description: string;
  badge: string;
  heroH1: string;
  heroDescription: string;
  introHeading: string;
  introDescription: string;
  checks: readonly SeoClusterCard[];
  overviewHeading: string;
  overviewDescription: string;
  overviewItems: readonly string[];
  actionHeading: string;
  actionDescription: string;
  actionSteps: readonly SeoClusterCard[];
  educationHeading: string;
  educationDescription: string;
  audienceHeading: string;
  audienceDescription: string;
  audiences: readonly SeoClusterCard[];
  faqs: readonly SeoClusterFaq[];
  finalCtaHeading: string;
  finalCtaDescription: string;
}

export const SEO_CLUSTER_CONTENT: Record<SeoClusterPath, SeoClusterContent> = {
  "/local-seo": {
    path: "/local-seo",
    title: "Outil SEO local pour améliorer votre référencement | Flowpoint",
    description:
      "Améliorez votre référencement local avec Flowpoint. Analysez votre présence locale, identifiez les optimisations prioritaires et suivez votre visibilité depuis une seule plateforme.",
    badge: "Outil SEO local",
    heroH1: "Améliorez votre référencement avec un outil SEO local",
    heroDescription:
      "Flowpoint rassemble les informations utiles à votre visibilité locale pour vous aider à mieux suivre votre présence sur Google, repérer les priorités et avancer avec des recommandations concrètes.",
    introHeading: "Votre visibilité locale repose sur plusieurs signaux",
    introDescription:
      "Une fiche Google Business Profile, des positions sur Maps, des avis et des mots-clés cohérents contribuent ensemble à votre présence locale. Flowpoint vous aide à lire ces éléments depuis une seule plateforme.",
    checks: [
      {
        icon: "map",
        title: "Google Business Profile",
        description:
          "Suivez les éléments importants de votre fiche Google et les optimisations qui peuvent renforcer votre présence locale.",
      },
      {
        icon: "globe",
        title: "Google Maps et positions locales",
        description:
          "Observez l'évolution de votre visibilité locale et repérez les zones où votre présence mérite d'être travaillée.",
      },
      {
        icon: "star",
        title: "Avis et présence locale",
        description:
          "Gardez une vue d'ensemble de vos avis et des signaux qui participent à la confiance autour de votre établissement.",
      },
      {
        icon: "target",
        title: "Mots-clés et opportunités",
        description:
          "Identifiez les mots-clés locaux à suivre et les opportunités à prioriser selon votre activité.",
      },
    ],
    overviewHeading: "Ce que vous pouvez suivre avec Flowpoint",
    overviewDescription:
      "L'outil SEO local Flowpoint relie les données de présence locale, les mots-clés et les recommandations pour rendre votre suivi plus lisible.",
    overviewItems: [
      "Suivi des positions Google Maps et de la présence géographique",
      "Optimisation de la fiche Google Business Profile et de ses informations clés",
      "Mots-clés locaux, analyse des concurrents et recommandations personnalisées",
    ],
    actionHeading: "Passez d'une présence locale dispersée à un plan clair",
    actionDescription:
      "L'intérêt d'un logiciel SEO local est de transformer plusieurs signaux en décisions simples à prendre.",
    actionSteps: [
      {
        icon: "search",
        title: "Faire le point",
        description:
          "Rassemblez les informations qui décrivent votre visibilité locale et les points à surveiller.",
      },
      {
        icon: "barChart",
        title: "Repérer les priorités",
        description:
          "Comparez vos indicateurs pour distinguer les optimisations les plus utiles pour votre établissement.",
      },
      {
        icon: "sparkles",
        title: "Améliorer progressivement",
        description:
          "Utilisez les recommandations Flowpoint pour organiser vos prochaines actions sans perdre de vue vos résultats.",
      },
    ],
    educationHeading: "Pourquoi utiliser un outil de référencement local ?",
    educationDescription:
      "Le référencement local évolue avec votre activité, vos concurrents et les recherches de vos clients. Un outil dédié vous donne une méthode régulière pour suivre votre fiche Google Business Profile, vos positions et vos opportunités. Flowpoint centralise ces éléments avec le suivi des mots-clés, de la concurrence et des recommandations IA afin de vous aider à conserver une vue cohérente de votre présence locale. Pour comparer les écarts dans votre zone, consultez aussi notre [analyse de la concurrence SEO](/competitor-analysis). Pour approfondir les bases, lisez notre [guide du référencement local](/ressources/guide-referencement-local), puis la méthode d’[optimisation Google Business Profile](/ressources/optimiser-google-business-profile) et notre [audit SEO local](/ressources/audit-seo-local).",
    audienceHeading: "Pour qui ?",
    audienceDescription:
      "Flowpoint accompagne les équipes qui veulent développer leur visibilité locale avec un suivi concret et compréhensible.",
    audiences: [
      {
        icon: "building",
        title: "Entreprises locales",
        description:
          "Suivez la présence de votre établissement et concentrez vos efforts sur les optimisations qui comptent pour votre zone.",
      },
      {
        icon: "globe",
        title: "Réseaux et multi-sites",
        description:
          "Gardez une lecture structurée de plusieurs établissements et de leurs performances locales.",
      },
      {
        icon: "users",
        title: "Agences digitales",
        description:
          "Appuyez vos recommandations clients sur une analyse locale regroupée et des indicateurs faciles à partager.",
      },
    ],
    faqs: [
      {
        question: "Qu'est-ce qu'un outil SEO local ?",
        answer:
          "Un outil SEO local aide à suivre les signaux qui influencent la visibilité d'une entreprise dans une zone donnée, comme sa fiche Google Business Profile, ses positions locales, ses mots-clés et ses concurrents.",
      },
      {
        question: "Que peut-on suivre avec Flowpoint pour le référencement local ?",
        answer:
          "Flowpoint regroupe notamment le suivi de Google Maps, la présence géographique, les informations de votre fiche Google Business Profile, les avis, les mots-clés et l'analyse des concurrents.",
      },
      {
        question: "Flowpoint convient-il à une entreprise avec un seul établissement ?",
        answer:
          "Oui. Une entreprise locale peut utiliser Flowpoint pour comprendre sa visibilité, repérer ses priorités et suivre les évolutions de sa présence en ligne depuis un seul espace.",
      },
      {
        question: "Quelle est la différence entre SEO local et SEO classique ?",
        answer:
          "Le SEO local s'intéresse particulièrement à la visibilité d'une entreprise dans une zone géographique, notamment sur Google Maps et Google Business Profile. Il complète le travail réalisé sur le site et les mots-clés.",
      },
      {
        question: "Comment commencer à améliorer son référencement local ?",
        answer:
          "Commencez par ajouter votre site et vos informations d'entreprise dans Flowpoint, consultez vos indicateurs locaux puis utilisez les recommandations pour organiser vos premières actions.",
      },
    ],
    finalCtaHeading: "Prêt à améliorer votre visibilité locale ?",
    finalCtaDescription:
      "Lancez votre essai Flowpoint et rassemblez votre suivi SEO local dans un espace clair. Vous pourrez ensuite structurer vos résultats dans un [reporting SEO](/seo-reporting).",
  },
  "/website-monitoring": {
    path: "/website-monitoring",
    title: "Monitoring SEO : surveillez votre site automatiquement | Flowpoint",
    description:
      "Surveillez votre site avec le monitoring SEO Flowpoint. Suivez sa disponibilité et ses signaux techniques pour détecter rapidement les problèmes pouvant affecter votre activité.",
    badge: "Monitoring SEO",
    heroH1: "Surveillez votre site avec un monitoring SEO automatisé",
    heroDescription:
      "Flowpoint vous aide à suivre la disponibilité, les signaux techniques et les performances de votre site afin de repérer plus rapidement les problèmes qui peuvent perturber votre activité.",
    introHeading: "Un site visible doit aussi rester disponible",
    introDescription:
      "Une indisponibilité, un certificat qui arrive à échéance ou une dégradation des performances peuvent affecter l'expérience de navigation. Le monitoring SEO rassemble ces signaux pour faciliter votre suivi.",
    checks: [
      {
        icon: "activity",
        title: "Disponibilité et uptime",
        description:
          "Suivez la disponibilité de votre site et gardez un historique des changements importants.",
      },
      {
        icon: "shield",
        title: "SSL et points techniques",
        description:
          "Surveillez vos certificats SSL, la latence et les endpoints importants de votre présence en ligne.",
      },
      {
        icon: "gauge",
        title: "Core Web Vitals",
        description:
          "Consultez les indicateurs de performance comme LCP, CLS et INP pour repérer les axes d'amélioration.",
      },
      {
        icon: "bell",
        title: "Alertes et incidents",
        description:
          "Recevez des alertes lorsqu'un changement ou un incident mérite votre attention.",
      },
    ],
    overviewHeading: "Ce que le monitoring Flowpoint vous aide à surveiller",
    overviewDescription:
      "Le suivi technique s'intègre aux autres données Flowpoint pour relier la santé du site à vos performances SEO et à vos actions prioritaires. Pour établir un état des lieux complet, complétez ce suivi avec un [audit SEO](/seo-audit).",
    overviewItems: [
      "Disponibilité, contrôles réguliers et suivi des certificats SSL",
      "LCP, CLS, INP et audits planifiés des Core Web Vitals",
      "Alertes de changement et notifications pour réagir plus rapidement",
    ],
    actionHeading: "Réduisez le temps entre un incident et votre réaction",
    actionDescription:
      "Un monitoring SEO utile ne se limite pas à constater un problème : il vous aide à comprendre son importance et à décider quoi faire.",
    actionSteps: [
      {
        icon: "activity",
        title: "Observer les signaux",
        description:
          "Centralisez les contrôles de disponibilité, de performance et de sécurité qui concernent votre site.",
      },
      {
        icon: "bell",
        title: "Être alerté au bon moment",
        description:
          "Repérez les changements importants grâce aux alertes et aux notifications disponibles dans votre suivi.",
      },
      {
        icon: "sparkles",
        title: "Prioriser la correction",
        description:
          "Utilisez les recommandations Flowpoint pour transformer les constats techniques en actions compréhensibles.",
      },
    ],
    educationHeading: "Pourquoi mettre en place une surveillance SEO ?",
    educationDescription:
      "Les performances d'un site ne sont pas figées. Une mise à jour, un certificat, une API ou une évolution technique peuvent changer la qualité d'une visite. Le monitoring SEO Flowpoint donne un cadre régulier pour suivre la disponibilité, les performances et les incidents, puis relier ces informations à vos indicateurs SEO et à vos recommandations. Pour approfondir, lisez le [guide du monitoring SEO](/ressources/monitoring-seo-guide), le repère sur les [indicateurs de surveillance](/ressources/surveillance-site-web-indicateurs) et la méthode pour traiter les [alertes de monitoring](/ressources/alertes-monitoring-site).",
    audienceHeading: "Pour qui ?",
    audienceDescription:
      "Le monitoring s'adresse aux équipes qui veulent détecter plus tôt les problèmes susceptibles d'affecter leur présence en ligne.",
    audiences: [
      {
        icon: "building",
        title: "Entreprises et PME",
        description:
          "Gardez un œil sur votre site sans devoir vérifier manuellement chaque signal technique au quotidien.",
      },
      {
        icon: "users",
        title: "Équipes marketing",
        description:
          "Reliez les changements techniques à vos performances et facilitez la coordination avec les personnes qui interviennent sur le site.",
      },
      {
        icon: "globe",
        title: "Agences et équipes web",
        description:
          "Suivez plusieurs sites, centralisez les alertes et partagez une lecture claire de leur état.",
      },
    ],
    faqs: [
      {
        question: "Qu'est-ce que le monitoring SEO ?",
        answer:
          "Le monitoring SEO consiste à surveiller régulièrement la disponibilité, les performances et certains signaux techniques d'un site afin de détecter les changements pouvant affecter sa visibilité ou son activité.",
      },
      {
        question: "Que surveille Flowpoint sur un site web ?",
        answer:
          "Flowpoint met notamment en avant le suivi de la disponibilité, des certificats SSL, de la latence, des endpoints API, des Core Web Vitals et des alertes liées aux changements importants.",
      },
      {
        question: "Pourquoi surveiller les Core Web Vitals ?",
        answer:
          "Les Core Web Vitals donnent des repères sur l'expérience de chargement et d'interaction d'un site. Les suivre aide à repérer les axes techniques qui méritent une amélioration.",
      },
      {
        question: "Comment suis-je informé lorsqu'un problème est détecté ?",
        answer:
          "Flowpoint regroupe les alertes et notifications disponibles pour vous signaler les incidents ou changements qui nécessitent votre attention.",
      },
      {
        question: "Le monitoring SEO remplace-t-il un audit SEO ?",
        answer:
          "Non. L'audit aide à dresser un état des lieux, tandis que le monitoring suit l'évolution du site dans le temps. Les deux approches sont complémentaires.",
      },
    ],
    finalCtaHeading: "Ne découvrez pas un incident trop tard",
    finalCtaDescription:
      "Lancez votre essai Flowpoint et suivez les signaux importants de votre site depuis un seul tableau de bord, puis partagez les évolutions dans un [reporting SEO](/seo-reporting).",
  },
  "/seo-reporting": {
    path: "/seo-reporting",
    title: "Rapports SEO automatiques et reporting | Flowpoint",
    description:
      "Centralisez votre reporting avec les rapports SEO Flowpoint. Transformez vos données en rapports clairs, partageables et adaptés au suivi de vos performances.",
    badge: "Reporting SEO",
    heroH1: "Automatisez vos rapports et votre reporting SEO",
    heroDescription:
      "Flowpoint centralise vos indicateurs SEO et vos recommandations pour vous aider à produire des rapports plus clairs, à suivre vos progrès et à partager les prochaines actions.",
    introHeading: "Un bon rapport SEO doit aider à décider",
    introDescription:
      "Accumuler des données ne suffit pas. Un reporting utile met en avant les évolutions, les priorités et les éléments que vos équipes ou vos clients doivent comprendre.",
    checks: [
      {
        icon: "barChart",
        title: "Données regroupées",
        description:
          "Rassemblez les indicateurs de visibilité, de performance, de mots-clés et de concurrence dans des tableaux de bord lisibles.",
      },
      {
        icon: "fileText",
        title: "Rapports structurés",
        description:
          "Transformez vos analyses en rapports clairs pour conserver un historique et présenter les résultats essentiels.",
      },
      {
        icon: "share",
        title: "Partage et marque blanche",
        description:
          "Présentez vos rapports avec les options de partage, de personnalisation et de présentation prévues par Flowpoint.",
      },
      {
        icon: "sparkles",
        title: "Recommandations IA",
        description:
          "Ajoutez une lecture actionnable à vos données grâce aux recommandations et aux missions IA personnalisées.",
      },
    ],
    overviewHeading: "Les éléments d'un reporting SEO exploitable",
    overviewDescription:
      "Le reporting Flowpoint relie les chiffres au contexte et aux actions afin de faciliter le suivi d'une entreprise, d'un site ou d'un portefeuille client.",
    overviewItems: [
      "Rapports exécutifs et indicateurs regroupés dans un tableau de bord centralisé",
      "Templates et missions pour organiser les sujets techniques, locaux, contenu et growth",
      "Rapports PDF, partage public et options white-label selon les capacités de votre espace",
    ],
    actionHeading: "Transformez vos données en rendez-vous plus utiles",
    actionDescription:
      "Un logiciel de reporting SEO vous fait gagner du temps lorsqu'il rend la progression et les prochaines décisions immédiatement compréhensibles.",
    actionSteps: [
      {
        icon: "lineChart",
        title: "Rassembler les évolutions",
        description:
          "Suivez les indicateurs importants dans le temps au lieu de reconstruire votre analyse à chaque rapport.",
      },
      {
        icon: "fileText",
        title: "Mettre en forme l'essentiel",
        description:
          "Organisez vos résultats autour des progrès, des problèmes détectés et des priorités à présenter.",
      },
      {
        icon: "share",
        title: "Partager les prochaines actions",
        description:
          "Donnez à vos équipes ou à vos clients une lecture claire des recommandations à mettre en œuvre.",
      },
    ],
    educationHeading: "Pourquoi automatiser son reporting SEO ?",
    educationDescription:
      "Le reporting récurrent devient plus fiable lorsque la collecte, la lecture et la présentation suivent une méthode constante. Flowpoint rapproche les données de visibilité, de performance, de concurrence et de recommandations afin de vous aider à produire des rapports qui ne se contentent pas de décrire le passé, mais qui clarifient les actions à venir. Pour approfondir, consultez le [guide du reporting SEO](/ressources/reporting-seo-guide), la sélection des [KPI SEO](/ressources/tableau-de-bord-seo-kpi) et l’interprétation des données de [Google Search Console](/ressources/rapport-google-search-console).",
    audienceHeading: "Pour qui ?",
    audienceDescription:
      "Flowpoint aide les équipes qui doivent suivre des résultats SEO et les expliquer à d'autres personnes.",
    audiences: [
      {
        icon: "building",
        title: "Équipes marketing",
        description:
          "Conservez une vue d'ensemble des performances et des priorités sans multiplier les fichiers de suivi.",
      },
      {
        icon: "users",
        title: "Agences digitales",
        description:
          "Présentez vos analyses clients avec des rapports structurés, partageables et adaptés à votre contexte.",
      },
      {
        icon: "globe",
        title: "Entreprises multi-sites",
        description:
          "Comparez les évolutions de plusieurs projets et gardez une base de reporting commune.",
      },
    ],
    faqs: [
      {
        question: "Qu'est-ce qu'un rapport SEO automatique ?",
        answer:
          "Un rapport SEO automatique rassemble régulièrement les indicateurs et recommandations d'un site pour présenter ses évolutions, ses problèmes et ses prochaines actions avec moins de travail manuel.",
      },
      {
        question: "Quels éléments peut-on retrouver dans le reporting Flowpoint ?",
        answer:
          "Flowpoint regroupe notamment les performances, les mots-clés, la visibilité locale, la concurrence, les recommandations et les missions IA dans des tableaux de bord et des rapports.",
      },
      {
        question: "Les rapports SEO peuvent-ils être partagés ?",
        answer:
          "Flowpoint met en avant des options de partage public et de présentation client, ainsi que des possibilités de personnalisation et de marque blanche selon les capacités de votre espace.",
      },
      {
        question: "Le reporting SEO est-il utile pour une agence ?",
        answer:
          "Oui. Une agence peut utiliser un reporting structuré pour suivre plusieurs clients, présenter les résultats plus clairement et relier chaque constat aux actions recommandées.",
      },
      {
        question: "Comment commencer à créer des rapports avec Flowpoint ?",
        answer:
          "Ajoutez votre site dans Flowpoint, consultez les tableaux de bord disponibles puis utilisez les rapports et recommandations pour structurer votre prochain suivi.",
      },
    ],
    finalCtaHeading: "Prêt à simplifier votre reporting SEO ?",
    finalCtaDescription:
      "Lancez votre essai Flowpoint pour centraliser vos données et vos rapports dans un seul espace.",
  },
  "/competitor-analysis": {
    path: "/competitor-analysis",
    title: "Analyse de la concurrence SEO et suivi des concurrents | Flowpoint",
    description:
      "Analysez votre concurrence SEO avec Flowpoint. Suivez vos concurrents, comparez leur présence digitale et identifiez des opportunités pour renforcer votre visibilité.",
    badge: "Analyse concurrentielle SEO",
    heroH1: "Analysez votre concurrence SEO avec Flowpoint",
    heroDescription:
      "Flowpoint vous aide à comparer votre présence digitale à celle de vos concurrents, à suivre les mots-clés importants et à repérer les opportunités sur lesquelles agir.",
    introHeading: "Comprendre vos concurrents pour mieux prioriser",
    introDescription:
      "L'analyse concurrentielle ne consiste pas à copier les autres sites. Elle sert à comprendre votre environnement, à mesurer les écarts et à identifier les sujets qui peuvent renforcer votre visibilité.",
    checks: [
      {
        icon: "search",
        title: "Identifier les concurrents",
        description:
          "Structurez votre suivi autour des entreprises et acteurs locaux qui influencent votre visibilité.",
      },
      {
        icon: "barChart",
        title: "Comparer les positions",
        description:
          "Comparez les positions et les tendances pour mieux comprendre les écarts de présence sur les recherches importantes.",
      },
      {
        icon: "target",
        title: "Analyser les mots-clés",
        description:
          "Repérez les mots-clés concurrents et les opportunités qui méritent d'être travaillées en priorité.",
      },
      {
        icon: "trophy",
        title: "Suivre l'indice de concurrence",
        description:
          "Utilisez les indicateurs de concurrence et les recommandations pour donner un contexte à vos décisions SEO.",
      },
    ],
    overviewHeading: "Ce que vous pouvez comparer avec Flowpoint",
    overviewDescription:
      "L'outil d'analyse de la concurrence Flowpoint relie le suivi des concurrents aux mots-clés, à la visibilité locale et aux recommandations.",
    overviewItems: [
      "Positions, tendances et présence digitale de vos concurrents",
      "Mots-clés concurrents et opportunités de visibilité à travailler",
      "Analyse des concurrents locaux, indice de concurrence et recommandations personnalisées",
    ],
    actionHeading: "Passez de l'observation à une stratégie plus ciblée",
    actionDescription:
      "Une analyse concurrentielle SEO devient utile lorsqu'elle vous aide à choisir vos prochaines actions plutôt qu'à accumuler des comparaisons.",
    actionSteps: [
      {
        icon: "search",
        title: "Définir votre paysage",
        description:
          "Identifiez les concurrents et les recherches qui comptent réellement pour votre activité.",
      },
      {
        icon: "lineChart",
        title: "Comparer les évolutions",
        description:
          "Suivez les positions et les tendances pour distinguer un écart ponctuel d'une évolution durable.",
      },
      {
        icon: "sparkles",
        title: "Choisir vos opportunités",
        description:
          "Appuyez-vous sur les recommandations Flowpoint pour concentrer vos efforts sur les sujets les plus pertinents.",
      },
    ],
    educationHeading: "Pourquoi suivre la concurrence SEO ?",
    educationDescription:
      "Votre visibilité dépend aussi des entreprises qui ciblent les mêmes clients et les mêmes recherches. Un suivi régulier de la concurrence vous aide à contextualiser vos résultats, à repérer de nouvelles opportunités et à éviter de prendre des décisions sur la seule évolution de vos propres indicateurs. Flowpoint rapproche cette analyse du suivi des mots-clés, du SEO local et des recommandations. Présentez ensuite ces écarts dans un [reporting SEO](/seo-reporting) lisible. Pour préciser la méthode, consultez le [guide d’analyse concurrentielle SEO](/ressources/analyse-concurrentielle-seo-guide), la distinction entre concurrents commerciaux et SEO dans [l’identification des concurrents](/ressources/identifier-concurrents-seo) et la méthode pour [repérer des opportunités](/ressources/opportunites-seo-concurrence).",
    audienceHeading: "Pour qui ?",
    audienceDescription:
      "L'analyse concurrentielle s'adresse aux équipes qui veulent prendre des décisions SEO avec une meilleure compréhension de leur marché.",
    audiences: [
      {
        icon: "building",
        title: "Entreprises en croissance",
        description:
          "Comprenez les écarts avec les acteurs qui ciblent les mêmes clients et choisissez vos prochains sujets.",
      },
      {
        icon: "users",
        title: "Équipes SEO et marketing",
        description:
          "Suivez les positions, les mots-clés et les tendances concurrentielles dans un tableau de bord centralisé.",
      },
      {
        icon: "globe",
        title: "Agences digitales",
        description:
          "Enrichissez vos recommandations clients avec un contexte concurrentiel local et des comparaisons lisibles.",
      },
    ],
    faqs: [
      {
        question: "Qu'est-ce qu'une analyse de la concurrence SEO ?",
        answer:
          "Une analyse de la concurrence SEO compare la présence de votre site à celle d'autres acteurs sur les positions, les mots-clés et les opportunités qui comptent pour votre visibilité.",
      },
      {
        question: "Que peut-on comparer avec Flowpoint ?",
        answer:
          "Flowpoint met notamment en avant la comparaison des positions, l'analyse des mots-clés concurrents, le suivi des concurrents locaux et des indicateurs de concurrence.",
      },
      {
        question: "L'analyse concurrentielle remplace-t-elle une stratégie SEO ?",
        answer:
          "Non. Elle apporte un contexte à votre stratégie. Les comparaisons servent à choisir de meilleures priorités, mais les actions doivent rester adaptées à votre activité et à vos ressources.",
      },
      {
        question: "Le suivi des concurrents est-il utile pour une entreprise locale ?",
        answer:
          "Oui. Les concurrents visibles dans votre zone peuvent évoluer rapidement. Suivre leur présence locale et leurs mots-clés aide à mieux comprendre les opportunités de votre marché.",
      },
      {
        question: "Comment commencer à analyser ses concurrents ?",
        answer:
          "Ajoutez votre site dans Flowpoint, définissez les concurrents pertinents puis consultez les positions, mots-clés et recommandations disponibles pour organiser votre suivi.",
      },
    ],
    finalCtaHeading: "Prêt à mieux comprendre votre concurrence ?",
    finalCtaDescription:
      "Lancez votre essai Flowpoint et donnez un contexte plus précis à vos décisions SEO.",
  },
};