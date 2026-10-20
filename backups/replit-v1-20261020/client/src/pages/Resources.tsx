import { usePageTitle } from "@/hooks/use-page-title";
import { useJsonLd } from "@/hooks/use-json-ld";
import type { ReactNode } from "react";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import {
  BookOpen,
  Search,
  Bot,
  Monitor,
  MapPin,
  Gauge,
  BarChart3,
  FileText,
  Sparkles,
  Lightbulb,
  CaseSensitive,
  CheckCircle,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  buildResourcesItemListJsonLd,
  RESOURCE_CHAPTER_TITLES,
} from "@shared/structured-data-content";
import { getPublishedResourceArticles } from "@shared/resource-articles";

const fadeInUp = {
  // The initial state must remain visible in SSR and without JavaScript.
  hidden: { opacity: 1, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

function renderResourceLink(
  text: string,
  rule?: { phrase: string; href: string },
): ReactNode {
  if (!rule) {
    return text;
  }

  const start = text.indexOf(rule.phrase);
  if (start === -1) {
    return text;
  }

  const end = start + rule.phrase.length;
  return (
    <>
      {text.slice(0, start)}
      <a
        href={rule.href}
        className="text-blue-700 dark:text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
      >
        {rule.phrase}
      </a>
      {text.slice(end)}
    </>
  );
}

export default function Resources() {
  usePageTitle("Centre de ressources | Flowpoint");
  useJsonLd(buildResourcesItemListJsonLd());
  const publishedArticles = getPublishedResourceArticles();
  const articlesByCluster = publishedArticles.reduce<Record<string, typeof publishedArticles>>(
    (groups, article) => {
      (groups[article.cluster] ??= []).push(article);
      return groups;
    },
    {},
  );

  const categories = [
    { icon: Search, title: "SEO & visibilité", href: "/seo-audit", description: "Améliorez votre positionnement sur Google et attirez plus de clients qualifiés." },
    { icon: Bot, title: "Intelligence artificielle", description: "Découvrez comment l'IA automatise vos analyses et génère des recommandations." },
    { icon: Monitor, title: "Monitoring & disponibilité", href: "/website-monitoring", description: "Surveillez votre site 24h/24 et soyez alerté avant vos clients en cas d'incident." },
    { icon: MapPin, title: "Google Business Profile", href: "/local-seo", description: "Optimisez votre fiche Google pour capter les recherches locales." },
    { icon: Gauge, title: "Performance web", description: "Maîtrisez vos Core Web Vitals et offrez une expérience utilisateur fluide." },
    { icon: BarChart3, title: "Analytics & données", description: "Centralisez vos données et prenez des décisions basées sur des indicateurs concrets." },
    { icon: FileText, title: "Rapports & automatisation", href: "/seo-reporting", description: "Générez des rapports professionnels automatiquement, sans effort manuel." },
    { icon: Sparkles, title: "Nouveautés FlowPoint", description: "Restez informé des dernières fonctionnalités et évolutions de la plateforme." },
    { icon: Lightbulb, title: "Guides pratiques", description: "Tutoriels pas à pas pour tirer le meilleur parti de chaque outil." },
    { icon: CaseSensitive, title: "Cas d'usage", description: "Découvrez comment FlowPoint s'adapte à différents types d'entreprises." },
  ];

  const chapters = [
    {
      icon: Search,
      title: RESOURCE_CHAPTER_TITLES[0],
      content: `Le référencement naturel reste le canal d'acquisition le plus rentable pour les entreprises. Contrairement aux campagnes publicitaires, un bon positionnement sur Google génère du trafic qualifié de façon durable et sans coût marginal par visite.

Les piliers d'une stratégie SEO efficace :

1. Optimisez votre site technique (vitesse, mobile, structure)
2. Produisez du contenu répondant aux intentions de recherche de vos clients
3. Maîtrisez la structure technique de votre site (balises, maillage interne, schémas)
4. Ciblez les recherches géographiques avec un SEO local structuré
5. Surveillez régulièrement vos positions et celles de vos concurrents

Le SEO n'est pas une course rapide. Les premiers résultats apparaissent après quelques semaines, mais une présence durable demande une stratégie sur le long terme.

FlowPoint centralise vos positions, performances techniques, Core Web Vitals, données Google Business Profile et indicateurs clés dans un tableau de bord unique.`,
    },
    {
      icon: Bot,
      title: RESOURCE_CHAPTER_TITLES[1],
      content: `L'intelligence artificielle transforme profondément la façon dont les entreprises analysent leurs données et prennent des décisions. Elle n'est plus réservée aux grandes entreprises : des outils accessibles permettent aujourd'hui aux indépendants et aux PME d'automatiser des tâches complexes.

Voici comment l'IA peut amplifier vos résultats :

- Analyse automatique de vos performances : l'IA détecte les tendances, les anomalies et les opportunités dans vos données
- Recommandations personnalisées : au lieu de listes génériques, vous recevez des actions adaptées à votre secteur et votre zone géographique
- Priorisation intelligente : l'IA estime l'impact et l'effort de chaque action pour vous aider à choisir où investir votre temps
- Génération de rapports : des rapports exécutifs rédigés automatiquement, prêts à être partagés avec votre équipe ou vos clients
- Prévisions de performance : anticipez les évolutions de votre trafic et de votre visibilité

L'IA de FlowPoint analyse vos propres données afin de proposer des recommandations concrètes adaptées à votre activité.

L'objectif n'est pas de remplacer votre expertise, mais de vous donner plus de temps pour les décisions stratégiques en automatisant l'analyse.`,
    },
    {
      icon: Monitor,
      title: RESOURCE_CHAPTER_TITLES[2],
      content: `Votre site web est votre vitrine digitale. Un temps d'arrêt, une erreur SSL expirée ou une page lente peuvent coûter des clients et nuire à votre crédibilité. Le monitoring vous permet d'être proactif plutôt que réactif.

Ce qu'il faut surveiller en permanence :

1. Disponibilité de votre site (uptime) avec des checks réguliers
2. Validité de vos certificats SSL
3. Temps de réponse de vos pages clés
4. Endpoints API et webhooks si vous utilisez des intégrations
5. Changements inattendus sur votre site (contenu modifié, balises alt manquantes)

Les conséquences d'un site inaccessible :

- Perte immédiate de revenus pour les sites e-commerce
- Dégradation de votre référencement (Google pénalise les sites instables)
- Perte de confiance des clients qui tombent sur une erreur
- Difficulté à identifier la cause sans historique de surveillance

Un outil de monitoring efficace vous alerte par email, Slack ou d'autres canaux configurés dès qu'un incident est détecté, vous donnant le temps de réagir avant que vos clients ne le remarquent.`,
    },
    {
      icon: MapPin,
      title: RESOURCE_CHAPTER_TITLES[3],
      content: `Google Business Profile (GBP) est la pierre angulaire de votre visibilité locale. C'est elle qui apparaît sur Google Maps, dans le Pack Local et dans les résultats de recherche géolocalisés. Une fiche optimisée peut générer des dizaines de contacts qualifiés chaque mois.

Les éléments clés d'une fiche performante :

1. Informations complètes et à jour (nom, adresse, téléphone, horaires, site)
2. Catégories précises correspondant exactement à votre activité
3. Description détaillée avec vos mots-clés stratégiques
4. Photos régulières de qualité (intérieur, extérieur, produits, équipe)
5. Publications fréquentes pour montrer votre activité à Google
6. Réponses à tous les avis, positifs comme négatifs

Les avis clients sont un facteur de classement majeur. Une entreprise avec 50 avis à 4,7 étoiles aura plus de chances d'apparaître dans le Pack Local qu'une entreprise avec 5 avis à 5 étoiles.

Des photos de qualité améliorent l'engagement des utilisateurs et augmentent les interactions avec votre fiche Google Business Profile. Investir dans votre contenu visuel sur GBP est l'une des actions à plus fort impact.`,
    },
    {
      icon: Gauge,
      title: RESOURCE_CHAPTER_TITLES[4],
      content: `La vitesse de chargement de votre site influence directement votre taux de conversion, votre positionnement Google et la satisfaction de vos visiteurs. Google utilise les Core Web Vitals (LCP, CLS, INP) comme facteurs de classement depuis 2021.

Les trois métriques essentielles :

- LCP (Largest Contentful Paint) : temps d'affichage du plus grand élément visible. Objectif : moins de 2,5 secondes.
- CLS (Cumulative Layout Shift) : stabilité visuelle de la page. Objectif : moins de 0,1.
- INP (Interaction to Next Paint) : réactivité aux interactions utilisateur. Objectif : moins de 200 ms.

Comment améliorer vos performances :

1. Optimisez vos images (format WebP, compression, lazy loading)
2. Utilisez un CDN pour distribuer vos contenus statiques
3. Minifiez vos fichiers CSS et JavaScript
4. Réduisez le nombre de requêtes serveur
5. Activez la mise en cache du navigateur
6. Choisissez un hébergeur performant proche de vos clients

Une amélioration de la vitesse de chargement peut avoir un impact direct sur le taux de conversion, l'expérience utilisateur et le référencement naturel.`,
    },
    {
      icon: BarChart3,
      title: RESOURCE_CHAPTER_TITLES[5],
      content: `Les données sont le carburant de toute stratégie digitale efficace. Mais posséder des données ne suffit pas : il faut les centraliser, les interpréter et en tirer des actions concrètes.

Les indicateurs incontournables à suivre :

1. Trafic organique : évolution du nombre de visiteurs depuis Google
2. Taux de conversion : pourcentage de visiteurs qui effectuent une action (appel, formulaire, achat)
3. Positionnement mots-clés : où vous apparaissez pour vos requêtes stratégiques
4. Sources de trafic : quels canaux génèrent le plus de visiteurs qualifiés
5. Comportement utilisateur : pages consultées, engagement des visiteurs, temps passé sur le site
6. Coût d'acquisition client (CAC) : combien vous coûte chaque nouveau client

Les erreurs à éviter :

- Se concentrer sur la quantité de trafic plutôt que sur la qualité
- Ignorer les données locales si vous avez un établissement physique
- Ne pas segmenter vos analyses (appareil, zone géographique, source)
- Surveiller trop d'indicateurs au lieu de se focaliser sur 3-5 KPIs clés

Un tableau de bord bien conçu vous montre d'un coup d'œil ce qui fonctionne, ce qui ne fonctionne pas, et où investir votre prochaine heure de travail.`,
    },
    {
      icon: FileText,
      title: RESOURCE_CHAPTER_TITLES[6],
      content: `Les rapports manuels sont l'une des tâches les plus chronophages pour les équipes marketing et les agences. Automatiser cette partie libère des heures précieuses pour des activités à plus forte valeur ajoutée.

Ce que l'automatisation des rapports vous apporte :

- Des rapports générés automatiquement à la fréquence de votre choix (hebdomadaire, mensuelle)
- Des données toujours à jour, sans risque d'erreur de copier-coller
- Des rapports partageables avec votre équipe, vos clients ou vos investisseurs
- Des alertes automatiques lorsqu'un indicateur dépasse un seuil critique
- Un historique consultable pour suivre votre évolution dans le temps

Pour les agences, les rapports white-label permettent de personnaliser le branding (logo client, couleurs) et de livrer des rapports professionnels sans effort supplémentaire.

L'automatisation ne remplace pas l'analyse humaine : elle vous donne la base de données propre et structurée sur laquelle vous pouvez construire vos recommandations stratégiques.`,
    },
    {
      icon: Sparkles,
      title: RESOURCE_CHAPTER_TITLES[7],
      content: `FlowPoint évolue constamment pour intégrer les meilleures pratiques du digital et les nouvelles capacités de l'intelligence artificielle. Le développement de FlowPoint est guidé par les retours de nos utilisateurs et les évolutions du marché.

Les axes d'innovation prioritaires :

- Intelligence artificielle : plans d'action toujours plus personnalisés, prédictions de performance, génération de contenu
- Intégrations : connexions toujours plus riches avec Google Analytics, Search Console, les réseaux sociaux et les outils tiers
- Monitoring : surveillance plus fine, alertes multicanaux (email, Slack, d'autres canaux configurés), détection d'anomalies
- Collaboration : workspaces partagés, gestion des permissions, commentaires sur les rapports
- Mobilité : application mobile pour suivre vos indicateurs où que vous soyez

Chaque nouvelle fonctionnalité est testée avec un groupe d'utilisateurs avant son déploiement général. Vous pouvez suivre les mises à jour sur notre page dédiée et proposer des idées via notre support.`,
    },
    {
      icon: Lightbulb,
      title: RESOURCE_CHAPTER_TITLES[8],
      content: `FlowPoint est conçu pour être opérationnel en quelques minutes, même sans expertise technique. Voici les étapes clés pour tirer le maximum de la plateforme dès le premier jour.

Premiers pas recommandés :

1. Connectez votre Google Business Profile pour importer vos données locales
2. Ajoutez votre site web pour lancer l'audit SEO automatique
3. Configurez le monitoring uptime pour surveiller votre disponibilité
4. Définissez vos mots-clés stratégiques pour suivre votre positionnement
5. Connectez les services disponibles dans votre espace FlowPoint pour enrichir vos données de trafic
6. Activez les alertes pour être notifié des évolutions importantes

Conseils pour aller plus loin :

- Explorez le tableau de bord IA pour découvrir vos actions prioritaires
- Personnalisez vos rapports pour les partager avec votre équipe
- Utilisez les missions IA pour planifier votre travail sur les semaines à venir
- Consultez régulièrement l'analyse concurrentielle pour rester compétitif
- Activez le white-label si vous gérez des clients en tant qu'agence

Notre support est disponible par email pour vous accompagner dans la prise en main. La plupart des utilisateurs sont autonomes en moins d'une heure.`,
    },
    {
      icon: CaseSensitive,
      title: RESOURCE_CHAPTER_TITLES[9],
      content: `FlowPoint s'adapte à différents types d'entreprises et d'organisations. Voici comment la plateforme peut vous aider selon votre profil, sans chiffres inventés.

Commerce local

Suivez votre visibilité Google Business Profile, recevez des recommandations IA et surveillez votre réputation en ligne depuis une seule plateforme. Le monitoring uptime vous alerte si votre site est inaccessible pendant les heures d'ouverture.

Agence marketing

Gérez plusieurs clients depuis un tableau de bord unique, générez des rapports white-label et suivez les performances de chaque site sans jongler entre les outils. L'intelligence concurrentielle vous aide à identifier les opportunités pour chaque client.

E-commerce

Surveillez la disponibilité de votre boutique 24h/24, suivez vos Core Web Vitals pour garantir une expérience d'achat fluide, et recevez des alertes avant que vos clients ne remarquent un problème technique.

PME

Centralisez vos indicateurs clés dans un tableau de bord simple : positions Google, performances techniques, données Google Business Profile. Les missions IA vous guident pas à pas dans les actions à prioriser.

Multi-sites

Gérez la visibilité de plusieurs établissements ou sites web depuis une interface unique. Comparez les performances entre sites et appliquez les meilleures pratiques identifiées sur l'un à l'ensemble.

Franchise

Assurez la cohérence de la présence en ligne de vos points de vente. Suivez les avis clients, les positions locales et les performances techniques de chaque établissement dans un seul espace de travail.

Chaque profil a des besoins spécifiques, mais les fondamentaux restent les mêmes : centraliser ses données, identifier les actions à fort impact, et agir avec constance.`,
    },
  ];

  const quickTips = [
    "Auditez gratuitement votre site avec FlowPoint",
    "Optimisez votre fiche Google Business Profile",
    "Définissez 5 mots-clés stratégiques à suivre",
    "Activez le monitoring de votre site web",
    "Configurez vos alertes personnalisées",
    "Consultez vos recommandations IA hebdomadaires",
  ];

  const quickTipLinks: Record<string, string> = {
    "Auditez gratuitement votre site avec FlowPoint": "/seo-audit",
    "Activez le monitoring de votre site web": "/website-monitoring",
  };

  const resourceTextLinks: Record<number, { phrase: string; href: string }> = {
    8: {
      phrase: "Consultez régulièrement l'analyse concurrentielle",
      href: "/competitor-analysis",
    },
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <Navigation />

      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-indigo-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent dark:from-slate-900" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.div variants={fadeInUp} className="mb-6">
              <Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100">
                <BookOpen className="h-3 w-3 mr-1" />
                Centre de ressources
              </Badge>
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Tout pour développer votre entreprise
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Guides, bonnes pratiques et cas d'usage pour maîtriser la croissance digitale, du SEO à l'intelligence artificielle.
            </motion.p>
          </motion.div>
        </div>
      </section>

      <section className="py-12 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <Card className="p-6 border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-900">
              <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 mb-4">
                Parcourir par catégorie
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {categories.map((cat, index) => (
                  <div key={index} className="flex items-start gap-3 text-slate-600 dark:text-slate-300">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <cat.icon className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-slate-900 dark:text-slate-100">
                        {cat.href ? (
                          <a
                            href={cat.href}
                            className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                          >
                            {cat.title}
                          </a>
                        ) : (
                          cat.title
                        )}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{cat.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      </section>

      {publishedArticles.length > 0 && (
        <section
          className="py-16 bg-slate-50 dark:bg-slate-800/20"
          aria-labelledby="published-articles-heading"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-10">
              <h2
                id="published-articles-heading"
                className="text-3xl font-display font-bold text-slate-900 dark:text-slate-100"
              >
                Articles et guides
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300">
                Des ressources éditoriales organisées par thématique.
              </p>
            </div>

            <div className="space-y-10">
              {Object.entries(articlesByCluster).map(([cluster, articles]) => (
                <section key={cluster} aria-labelledby={`article-cluster-${cluster}`}>
                  <h3
                    id={`article-cluster-${cluster}`}
                    className="mb-4 text-xl font-display font-semibold text-slate-900 dark:text-slate-100"
                  >
                    {cluster}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {articles.map((article) => (
                      <a
                        key={article.slug}
                        href={`/ressources/${encodeURIComponent(article.slug)}`}
                        className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                      >
                        <Card className="h-full p-6 transition-colors group-hover:border-blue-400 dark:group-hover:border-blue-500">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <Badge>{article.cluster}</Badge>
                            {article.testOnly && (
                              <Badge variant="outline">Certification locale temporaire</Badge>
                            )}
                          </div>
                          <h4 className="text-lg font-semibold text-slate-900 group-hover:text-blue-700 dark:text-slate-100 dark:group-hover:text-blue-300">
                            {article.h1}
                          </h4>
                          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                            {article.metaDescription}
                          </p>
                        </Card>
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-12 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <Card className="p-6 border-green-200 dark:border-green-700 bg-white dark:bg-slate-900">
              <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 mb-4">
                Actions rapides pour démarrer
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {quickTips.map((tip, index) => (
                  <div key={index} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span className="text-sm">
                      {quickTipLinks[tip] ? (
                        <a
                          href={quickTipLinks[tip]}
                          className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm"
                        >
                          {tip}
                        </a>
                      ) : (
                        tip
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="space-y-16"
          >
            {chapters.map((chapter, index) => (
              <motion.div key={index} variants={fadeInUp} id={`chapter-${index + 1}`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
                    <chapter.icon className="h-5 w-5 text-blue-600" />
                  </div>
                  <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
                    {index + 1}. {chapter.title}
                  </h2>
                </div>
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  {(() => {
                    type Segment =
                      | { type: 'p'; text: string }
                      | { type: 'ol'; items: string[] }
                      | { type: 'ul'; items: string[] }
                      | { type: 'checklist'; items: string[] };

                    const segments: Segment[] = [];
                    const allLines = chapter.content.split('\n');
                    let i = 0;
                    while (i < allLines.length) {
                      const raw = allLines[i];
                      const trimmed = raw.trim();
                      if (trimmed === '') { i++; continue; }
                      if (/^\d+\.\s/.test(trimmed)) {
                        const items: string[] = [];
                        while (i < allLines.length && /^\d+\.\s/.test(allLines[i].trim())) {
                          items.push(allLines[i].trim().replace(/^\d+\.\s*/, ''));
                          i++;
                        }
                        segments.push({ type: 'ol', items });
                      } else if (/^-\s/.test(trimmed)) {
                        const items: string[] = [];
                        while (i < allLines.length && /^-\s/.test(allLines[i].trim())) {
                          items.push(allLines[i].trim().replace(/^-\s*/, ''));
                          i++;
                        }
                        segments.push({ type: 'ul', items });
                      } else if (trimmed.startsWith('☐')) {
                        const items: string[] = [];
                        while (i < allLines.length && allLines[i].trim().startsWith('☐')) {
                          items.push(allLines[i].trim().replace(/^☐\s*/, ''));
                          i++;
                        }
                        segments.push({ type: 'checklist', items });
                      } else {
                        const textLines: string[] = [];
                        while (
                          i < allLines.length &&
                          allLines[i].trim() !== '' &&
                          !/^\d+\.\s/.test(allLines[i].trim()) &&
                          !/^-\s/.test(allLines[i].trim()) &&
                          !allLines[i].trim().startsWith('☐')
                        ) {
                          textLines.push(allLines[i]);
                          i++;
                        }
                        segments.push({ type: 'p', text: textLines.join('\n') });
                      }
                    }

                    return segments.map((seg, idx) => {
                      if (seg.type === 'ol') {
                        return (
                          <ol key={idx} className="list-decimal list-outside ml-6 mb-4 space-y-1">
                            {seg.items.map((item, j) => (
                              <li key={j} className="dark:text-slate-100 leading-relaxed">{item}</li>
                            ))}
                          </ol>
                        );
                      }
                      if (seg.type === 'ul') {
                        return (
                          <ul key={idx} className="list-disc list-outside ml-6 mb-4 space-y-1">
                            {seg.items.map((item, j) => (
                              <li key={j} className="dark:text-slate-100 leading-relaxed">{item}</li>
                            ))}
                          </ul>
                        );
                      }
                      if (seg.type === 'checklist') {
                        return (
                          <ul key={idx} className="list-none mb-4 space-y-1">
                            {seg.items.map((item, j) => (
                              <li key={j} className="dark:text-slate-100 leading-relaxed flex items-start gap-2">
                                <span aria-hidden="true">☐</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        );
                      }
                      return (
                        <p key={idx} className="dark:text-slate-100 leading-relaxed mb-4 whitespace-pre-line">
                          {renderResourceLink(seg.text, resourceTextLinks[index])}
                        </p>
                      );
                    });
                  })()}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-slate-900 dark:to-blue-950 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.h2
              variants={fadeInUp}
              className="text-3xl font-display font-bold mb-4"
            >
              Prêt à passer à l'action ?
            </motion.h2>
            <motion.p variants={fadeInUp} className="text-blue-100 mb-8 max-w-xl mx-auto">
              Créez votre compte gratuitement et appliquez ces bonnes pratiques dès aujourd'hui avec FlowPoint.
            </motion.p>
            <motion.a
              variants={fadeInUp}
              href="https://app.flowpoint.pro/index.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white text-blue-600 px-8 py-4 rounded-full font-semibold hover:bg-blue-50 transition-colors"
            >
              Créer mon compte gratuitement
              <ArrowRight className="h-4 w-4" />
            </motion.a>
          </motion.div>
        </div>
      </section>

      <Footer />
      <SupportChat />
    </div>
  );
}
