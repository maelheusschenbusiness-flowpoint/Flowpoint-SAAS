import { usePageTitle } from "@/hooks/use-page-title";
import { useJsonLd } from "@/hooks/use-json-ld";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { SupportChat } from "@/components/SupportChat";
import { motion } from "framer-motion";
import { BookOpen, MapPin, Star, Search, Globe, MessageSquare, Camera, Clock, CheckCircle, Users, Monitor, AlertTriangle, ClipboardList, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

export default function SeoGuide() {
  usePageTitle("Guide SEO Local | Flowpoint");
  useJsonLd({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "Guide complet du SEO local pour les entreprises",
    "description": "Découvrez comment améliorer la visibilité locale de votre entreprise sur Google grâce à notre guide SEO local complet : Google Business Profile, avis clients, citations, et bien plus.",
    "author": {
      "@type": "Organization",
      "name": "Flowpoint",
      "url": "https://flowpoint.pro/"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Flowpoint",
      "url": "https://flowpoint.pro/",
      "logo": {
        "@type": "ImageObject",
        "url": "https://flowpoint.pro/favicon.svg"
      }
    },
    "datePublished": "2025-01-01",
    "dateModified": "2026-01-01",
    "inLanguage": "fr-FR",
    "url": "https://flowpoint.pro/guide-seo-local",
    "about": {
      "@type": "Thing",
      "name": "SEO local"
    }
  });
  const chapters = [
    {
      icon: MapPin,
      title: "Qu'est-ce que le SEO local ?",
      content: `Le SEO local (Search Engine Optimization local) est l'ensemble des techniques visant à améliorer la visibilité de votre entreprise dans les résultats de recherche géolocalisés de Google.

Quand un utilisateur recherche "restaurant italien Paris" ou "plombier près de chez moi", Google affiche des résultats basés sur la proximité géographique. Le SEO local vous permet d'apparaître dans ces résultats, notamment dans le "Pack Local" (les 3 résultats avec la carte).

Pour une entreprise locale, être bien positionné dans ces recherches peut représenter une augmentation significative du nombre de clients.`,
    },
    {
      icon: Globe,
      title: "Google Business Profile : la base du SEO local",
      content: `Votre fiche Google Business Profile (GBP) est le pilier de votre stratégie SEO local. C'est cette fiche qui apparaît sur Google Maps et dans les résultats de recherche locaux.

Pour optimiser votre fiche, vous devez :

1. Remplir toutes les informations (nom, adresse, téléphone, horaires, site web)
2. Choisir les bonnes catégories pour votre activité
3. Rédiger une description détaillée incluant vos mots-clés
4. Ajouter des photos de qualité régulièrement
5. Répondre à tous les avis, positifs comme négatifs
6. Publier des posts régulièrement pour montrer votre activité

Une fiche complète et à jour envoie des signaux positifs à Google et améliore votre classement.`,
    },
    {
      icon: Star,
      title: "L'importance des avis clients",
      content: `Les avis Google sont un facteur de classement majeur en SEO local. Ils influencent à la fois votre position dans les résultats et la décision des clients potentiels.

Quelques statistiques importantes :

- Une grande majorité des consommateurs consulte les avis en ligne avant de choisir une entreprise locale
- Une note élevée, associée à un nombre important d'avis récents et authentiques, renforce la confiance des utilisateurs
- Le nombre d'avis compte autant que la note moyenne

Pour obtenir plus d'avis, vous pouvez :
- Demander directement à vos clients satisfaits
- Envoyer un email de suivi après un achat
- Afficher un QR code dans votre établissement
- Intégrer une demande d'avis dans votre signature email

Répondez toujours aux avis, surtout les négatifs. Une réponse professionnelle et empathique peut transformer une mauvaise expérience en opportunité.`,
    },
    {
      icon: Search,
      title: "Les mots-clés locaux",
      content: `Les mots-clés locaux combinent votre activité et votre zone géographique. Par exemple : "coiffeur Lyon 6ème", "dentiste urgence Bordeaux", "pizzeria livraison Marseille".

Pour identifier les bons mots-clés, vous devez :

1. Lister tous les services que vous proposez
2. Identifier les quartiers, villes et zones que vous couvrez
3. Penser aux termes utilisés par vos clients (pas le jargon professionnel)
4. Analyser ce que font vos concurrents

Pensez également à cibler des recherches vocales et conversationnelles ("où trouver un…", "près de moi", etc.), de plus en plus utilisées sur mobile.

Intégrez ces mots-clés naturellement dans :
- Le titre et la description de votre fiche Google
- Les pages de votre site web
- Vos publications sur les réseaux sociaux
- Les réponses aux avis

Attention à ne pas sur-optimiser : Google détecte le "keyword stuffing" et peut pénaliser votre site.`,
    },
    {
      icon: Camera,
      title: "Photos et contenu visuel",
      content: `Les photos jouent un rôle crucial dans le SEO local. Elles permettent aux clients de découvrir votre établissement avant de s'y rendre et augmentent l'engagement sur votre fiche.

Les types de photos à ajouter :
- Photo de couverture attractive et représentative
- Logo de votre entreprise
- Photos de l'intérieur et de l'extérieur
- Photos de vos produits ou services
- Photos de votre équipe
- Photos d'événements ou moments de vie

Conseils pour des photos efficaces :
- Utilisez un éclairage naturel quand c'est possible
- Montrez l'ambiance et l'atmosphère de votre lieu
- Mettez régulièrement à jour vos photos
- Ajoutez des photos de qualité (pas floues ou pixelisées)
- Ajoutez des photos prises récemment afin de refléter l'état actuel de votre établissement

Les entreprises avec des photos reçoivent 42% plus de demandes d'itinéraire et 35% plus de clics vers leur site web.`,
    },
    {
      icon: MessageSquare,
      title: "Citations et cohérence NAP",
      content: `NAP signifie Name, Address, Phone (Nom, Adresse, Téléphone). La cohérence de ces informations sur tous les sites web est un facteur de confiance pour Google.

Vos informations doivent être identiques sur :
- Votre site web
- Google Business Profile
- Pages Jaunes, Yelp, TripAdvisor
- Annuaires professionnels de votre secteur
- Réseaux sociaux (Facebook, Instagram, LinkedIn)
- Chambres de commerce locales

Les incohérences importantes — comme un mauvais numéro de téléphone, une ancienne adresse ou un nom d'entreprise différent selon les plateformes — peuvent créer de la confusion pour Google et nuire à votre classement. De légères variations d'abréviation (« Rue » / « R. ») sont généralement moins critiques mais restent à harmoniser par souci de rigueur.

Faites un audit régulier de vos citations et corrigez les erreurs. FlowPoint peut vous aider à identifier et corriger automatiquement ces incohérences depuis votre tableau de bord.`,
    },
    {
      icon: Clock,
      title: "Stratégie continue et patience",
      content: `Le SEO local est un marathon, pas un sprint. Les premiers résultats apparaissent souvent après quelques semaines, mais une amélioration durable demande généralement plusieurs mois de travail.

Actions à faire régulièrement :
- Publier des posts sur votre fiche Google (1-2 par semaine)
- Répondre aux nouveaux avis dans les 24-48h
- Ajouter de nouvelles photos chaque mois
- Mettre à jour vos informations si elles changent
- Surveiller vos positions et celles de vos concurrents

Métriques à suivre :
- Nombre de vues de votre fiche
- Nombre d'appels et de demandes d'itinéraire
- Évolution de votre note moyenne
- Position dans les résultats pour vos mots-clés cibles

Vous pouvez suivre tous ces indicateurs directement depuis votre tableau de bord FlowPoint. N'abandonnez pas si les résultats ne sont pas immédiats. La constance est la clé du succès en SEO local.`,
    },
    {
      icon: Users,
      title: "Analysez vos concurrents",
      content: `Observez les entreprises qui apparaissent devant vous dans Google Maps. Comprendre pourquoi Google les met en avant vous aide à identifier les opportunités pour vous différencier.

Analysez :
- leur nombre d'avis et leur note moyenne
- leurs catégories Google Business Profile
- leur fréquence de publication
- la qualité et la quantité de leurs photos
- leurs réponses aux avis

L'objectif n'est pas de copier vos concurrents, mais de comprendre les signaux que Google valorise et d'identifier les axes où vous pouvez les surpasser.

Surveillez également les nouveaux avis de vos concurrents afin d'identifier leurs points forts et leurs points faibles.

FlowPoint surveille automatiquement vos concurrents et vous alerte lorsqu'une opportunité de différenciation est identifiée.`,
    },
    {
      icon: Monitor,
      title: "Optimisez également votre site web",
      content: `Même avec une excellente fiche Google Business Profile, votre site web reste un facteur de classement important en SEO local.

Veillez notamment à :
- optimiser la vitesse de chargement (Core Web Vitals)
- avoir un site parfaitement adapté aux mobiles
- créer une page dédiée pour chaque zone géographique importante
- afficher clairement vos coordonnées (nom, adresse, téléphone)
- intégrer une carte Google Maps
- utiliser des données structurées LocalBusiness (schema.org)
- optimiser les balises Title et Meta Description de vos pages locales

FlowPoint audite automatiquement vos Core Web Vitals (LCP, CLS, INP) et vous alerte lorsqu'une optimisation technique est recommandée.`,
    },
    {
      icon: AlertTriangle,
      title: "Les erreurs qui empêchent de bien se positionner",
      content: `Évitez ces erreurs fréquentes qui freinent votre visibilité locale :

- Utiliser une catégorie Google Business Profile incorrecte ou trop générique
- Avoir des horaires inexacts ou non mis à jour (jours fériés, congés)
- Laisser des avis sans réponse, surtout les négatifs
- Créer des fiches Google en double (Google peut pénaliser les doublons)
- Publier très rarement ou de façon irrégulière
- Utiliser des informations NAP différentes selon les plateformes
- Négliger la version mobile du site
- Avoir un site trop lent (mauvais Core Web Vitals)
- Ignorer les recommandations de Google Business Profile (catégories, attributs, services, produits…)

FlowPoint surveille automatiquement ces éléments et vous alerte lorsqu'une correction est recommandée.`,
    },
    {
      icon: ClipboardList,
      title: "Checklist SEO Local",
      content: `Utilisez cette checklist pour évaluer votre niveau de préparation :

☐ Ma fiche Google Business Profile est complète à 100 %
☐ Mes horaires sont corrects et à jour
☐ Mon site est accessible et rapide sur mobile
☐ J'ai obtenu au moins 10 avis récents
☐ Je réponds à tous les avis (positifs et négatifs)
☐ Je publie régulièrement des actualités sur ma fiche Google
☐ Mon NAP (nom, adresse, téléphone) est identique sur toutes les plateformes
☐ Mes photos sont récentes et de qualité
☐ Je surveille mes positions sur les mots-clés locaux cibles
☐ J'analyse régulièrement mes concurrents
☐ Je surveille régulièrement les performances de mon site (Core Web Vitals)

Vous pouvez suivre et automatiser la plupart de ces points directement depuis FlowPoint.`,
    },
    {
      icon: TrendingUp,
      title: "Analysez vos résultats et améliorez-vous",
      content: `Le SEO local est un processus d'amélioration continue. Utilisez les données pour progresser.

Analysez régulièrement :
- vos positions Google
- votre évolution dans Google Maps
- le nombre d'appels générés
- les clics vers votre site
- les demandes d'itinéraire
- les nouveaux avis reçus
- les performances de vos concurrents

L'objectif n'est pas uniquement d'obtenir une meilleure position, mais d'attirer davantage de clients qualifiés dans votre zone géographique.

FlowPoint centralise automatiquement ces indicateurs afin de vous permettre de suivre vos progrès dans le temps et d'ajuster votre stratégie en conséquence.`,
    },
  ];

  const quickTips = [
    "Vérifiez votre fiche Google Business Profile",
    "Demandez 3 nouveaux avis Google cette semaine",
    "Ajoutez de nouvelles photos à votre fiche Google",
    "Répondez à tous vos avis en attente",
    "Publiez une actualité sur votre fiche Google",
    "Vérifiez la cohérence de vos informations NAP",
  ];

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
                Guide complet
              </Badge>
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl font-display font-bold text-slate-900 dark:text-slate-100 mb-6"
            >
              Le guide du SEO local
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
              Tout ce que vous devez savoir pour améliorer la visibilité de votre entreprise sur Google et attirer plus de clients locaux.
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
              <h3 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 mb-4">
                Actions rapides pour commencer
              </h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {quickTips.map((tip, index) => (
                  <div key={index} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span className="text-sm">{tip}</span>
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
                          {seg.text}
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
              Flowpoint analyse automatiquement votre présence en ligne et vous donne des recommandations personnalisées pour améliorer votre SEO local.
            </motion.p>
            <motion.a
              variants={fadeInUp}
              href="https://app.flowpoint.pro/index.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white text-blue-600 px-8 py-4 rounded-full font-semibold hover:bg-blue-50 transition-colors"
            >
              Analyser mon entreprise gratuitement
            </motion.a>
          </motion.div>
        </div>
      </section>

      <Footer />
      <SupportChat />
    </div>
  );
}
