import type { ResourceArticle } from "./resource-articles";

export const RESOURCE_ARTICLE_CHECKLIST: ResourceArticle = {
  slug: "checklist-audit-seo-technique",
  title: "Checklist d’audit SEO technique : vérifications et actions | Flowpoint",
  metaDescription:
    "Vérifiez l’exploration, l’indexation, les URL, le rendu JavaScript et les performances avec une checklist SEO technique fondée sur des preuves.",
  h1: "Checklist d’audit SEO technique : quoi vérifier et comment agir",
  cluster: "Audit SEO",
  parentLanding: "/seo-audit",
  parentLandingCta: {
    heading: "Pour aller plus loin",
    description:
      "Pour une vue d’ensemble des fonctions et contrôles présentés par Flowpoint, consultez la page Audit SEO.",
    label: "Consulter la page Audit SEO",
  },
  datePublished: "2026-10-07",
  dateModified: "2026-10-07",
  author: "Équipe Flowpoint",
  published: true,
  content: [
    {
      paragraphs: [
        "Le guide général sur l’audit SEO aide à cadrer un audit et à construire un plan d’action. Cette checklist se concentre sur les contrôles techniques d’URL et de gabarit : quoi inspecter, quelle preuve conserver et quelle action confirmer.",
        "Un signal isolé ne suffit pas à établir une anomalie : une 404 peut être volontaire et un test de laboratoire ne représente pas toutes les visites. Vérifiez l’état attendu et le contexte avant de corriger.",
      ],
      links: [
        {
          label: "Guide général : comment faire un audit SEO de son site web ?",
          href: "/ressources/comment-faire-audit-seo-site-web",
        },
      ],
    },
    {
      heading: "Comment utiliser cette checklist",
      paragraphs: [
        "Choisissez quelques URL stratégiques et une page représentative de chaque gabarit concerné. Pour chaque contrôle, consignez :",
      ],
      bullets: [
        "l’URL ou le gabarit et l’état attendu;",
        "la date, l’appareil, la méthode et la source;",
        "la preuve observée (réponse HTTP, en-tête, rendu, crawl ou donnée terrain);",
        "l’action envisagée et le résultat à contrôler après correction.",
      ],
    },
    {
      paragraphs: [
        "Priorisez selon l’effet observé, pas selon un score automatique ou le seul nombre d’URL :",
      ],
      bullets: [
        "Blocage possible de l’exploration ou de l’indexation : accès refusé par erreur, noindex inattendu, réponse serveur en erreur ou contenu essentiel absent après rendu. Confirmez d’abord que la page doit être accessible et indexable.",
        "Problème important, sans blocage établi : liens internes cassés, redirection ou canonical incohérente, ou usage mobile dégradé. Vérifiez les URL et le parcours concernés avant d’intervenir.",
        "Optimisation à mesurer : performance, données structurées ou présentation dans les résultats, si l’accès et l’usage de la page restent corrects. La priorité dépend de la page et de l’effet constaté.",
      ],
    },
    {
      paragraphs: [
        "Ces catégories orientent le contrôle; elles ne remplacent pas la vérification de l’état attendu pour chaque URL.",
      ],
    },
    {
      heading: "1. Vérifier l’accès et l’exploration",
    },
    {
      heading: "robots.txt laisse-t-il accéder aux pages importantes ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : le fichier robots.txt du bon domaine, les règles correspondant aux robots visés et les URL importantes auxquelles ces règles s’appliquent.",
        "Pourquoi : robots.txt sert principalement à gérer l’exploration. Il ne garantit pas qu’une URL bloquée restera absente des résultats : Google peut connaître une URL par des liens même sans en explorer le contenu. Pour demander qu’une page ne soit pas indexée, utilisez une directive adaptée plutôt qu’une règle robots.txt seule.",
        "Comment vérifier : ouvrez https://votre-domaine/robots.txt, puis confrontez les règles aux URL du périmètre. Pour une URL importante, utilisez l’inspection d’URL dans Search Console afin de vérifier si l’exploration est autorisée et ce que Google peut charger.",
        "Symptôme à examiner : une règle Disallow qui couvre une page devant être explorée, ou une ressource nécessaire au rendu de la page.",
        "Action : faites confirmer la règle par la personne responsable du site; ne retirez pas une directive avant d’avoir établi l’état attendu pour les URL touchées.",
      ],
      links: [
        {
          label: "Présentation de robots.txt — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=fr",
        },
        {
          label: "Bloquer l’indexation — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/block-indexing?hl=fr",
        },
      ],
    },
    {
      heading: "Que renvoient les URL et leurs redirections ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : la réponse HTTP de chaque URL importante, la cible finale des redirections, les erreurs serveur et le contenu réellement renvoyé.",
        "Pourquoi : Google traite différemment les réponses de succès, les redirections, les erreurs client et les erreurs serveur. Une page d’erreur affichée avec un statut 200 peut aussi être interprétée comme une soft 404.",
        "Comment vérifier : dans le navigateur ou avec un outil de crawl, suivez une URL jusqu’à sa destination finale et notez chaque code et en-tête Location. Si vous utilisez curl, vérifiez que la réponse GET correspond bien à ce qu’un visiteur voit; certains serveurs ne traitent pas HEAD et GET de la même façon.",
        "Symptôme à examiner : boucle ou chaîne de redirections, destination inattendue, réponse 5xx, lien interne vers une page 404, ou page d’erreur qui renvoie 200.",
        "Action : réparez les liens qui pointent vers la mauvaise URL; confirmez la destination voulue avant de modifier une redirection. Une 404 n’est pas à corriger automatiquement si la suppression est intentionnelle et si aucun parcours important ne dépend de cette URL.",
      ],
      links: [
        {
          label: "Codes HTTP et exploration — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors?hl=fr",
        },
      ],
    },
    {
      heading: "Les pages importantes sont-elles découvertes par des liens ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : les liens internes vers les pages du périmètre, les liens cassés et les pages qui ne reçoivent aucun lien pertinent.",
        "Pourquoi : le sitemap ne remplace pas une navigation cohérente. Les liens HTML comportant un href sont un moyen clair de rendre les URL explorables.",
        "Comment vérifier : lancez un crawl du site ou d’un périmètre représentatif, puis confrontez les pages importantes à la liste des URL atteintes par les liens. Vérifiez aussi que les liens de navigation fonctionnent au clavier et sur mobile.",
        "Symptôme à examiner : page importante sans lien interne, liens vers d’anciennes URL, ou URL disponible seulement après une interaction que le robot ne peut pas suivre comme un lien ordinaire.",
        "Action : ajoutez ou réparez un lien depuis une page pertinente. Il n’existe pas de nombre universel de clics qui rende automatiquement une page bonne ou mauvaise : la priorité dépend de son rôle et de la facilité avec laquelle un visiteur peut la trouver.",
      ],
      links: [
        {
          label: "Liens explorables — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/links-crawlable?hl=fr",
        },
      ],
    },
    {
      heading: "2. Vérifier l’indexation et les URL préférées",
    },
    {
      heading: "Une directive noindex exclut-elle une page par erreur ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : les balises meta robots ou Googlebot dans la page, ainsi que l’en-tête HTTP X-Robots-Tag.",
        "Pourquoi : une directive noindex indique à Google de ne pas inclure la page dans ses résultats lorsqu’il peut lire cette directive. Si robots.txt l’empêche d’accéder à la page, il peut ne pas voir le noindex.",
        "Comment vérifier : inspectez les en-têtes HTTP et le HTML livré par le serveur, puis le DOM rendu si le site ajoute des balises avec JavaScript. Comparez avec l’état attendu pour la page; l’inspection d’URL peut compléter cette vérification.",
        "Symptôme à examiner : une page censée être indexable comporte noindex, ou bien le HTML initial et la version rendue donnent des directives différentes.",
        "Action : ne retirez noindex que si la page doit réellement être indexable. Vérifiez que la directive est supprimée de toutes les couches concernées et que Google peut accéder à la page pour la constater. Cela ne garantit pas son indexation.",
      ],
      links: [
        {
          label: "Bloquer l’indexation avec noindex — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/block-indexing?hl=fr",
        },
      ],
    },
    {
      heading: "Le sitemap contient-il les URL que le site souhaite faire découvrir ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : que les URL du sitemap correspondent aux pages importantes, accessibles et prévues pour l’indexation, et qu’elles utilisent les versions préférées.",
        "Pourquoi : un sitemap aide les moteurs à découvrir des URL, notamment lorsque le maillage ne suffit pas à les faire repérer. Sa présence ne garantit ni l’exploration ni l’indexation.",
        "Comment vérifier : comparez quelques entrées du sitemap à leur statut HTTP, à leur canonical et à leurs directives d’indexation. Cherchez notamment les URL redirigées, non indexables, en erreur ou en doublon.",
        "Symptôme à examiner : le sitemap répertorie une ancienne URL, une version HTTP, une URL redirigée ou une page qui porte noindex.",
        "Action : gardez dans le sitemap les URL préférées que le site souhaite faire découvrir; corrigez les incohérences à leur source et vérifiez les liens internes qui pointent vers l’ancienne version. Ne considérez pas l’envoi d’un sitemap comme une demande d’indexation garantie.",
      ],
      links: [
        {
          label: "Sitemaps — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview?hl=fr",
        },
      ],
    },
    {
      heading: "Les canonicals, redirections et liens désignent-ils la même version ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : les doublons créés par les variantes HTTP/HTTPS, www/sans www, slash final, paramètres ou versions proches d’une même page; puis les balises rel=canonical.",
        "Pourquoi : les canonicals sont un signal de préférence parmi plusieurs signaux utilisés pour choisir une URL représentative. Google peut choisir une autre URL. La documentation recommande de garder cohérents les canonicals, redirections, liens internes et sitemaps.",
        "Comment vérifier : sur une page qui a des doublons possibles, comparez le contenu, la canonical déclarée, la cible de redirection, les liens internes et l’URL inscrite dans le sitemap. Utilisez l’inspection d’URL pour consulter l’URL canonique sélectionnée par Google lorsque cette donnée est disponible.",
        "Symptôme à examiner : la canonical vise une autre page sans raison claire, ou les redirections, le sitemap et les liens internes pointent vers des versions différentes.",
        "Action : définissez d’abord l’URL que le site veut conserver. Alignez les signaux autour de cette décision, puis revérifiez les variantes. Ne transformez pas un doublon apparent en redirection ou en noindex sans vérifier si les pages ont des usages distincts.",
      ],
      links: [
        {
          label: "Bonnes pratiques de canonisation — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=fr",
        },
      ],
    },
    {
      heading: "3. Vérifier l’architecture, le mobile et JavaScript",
    },
    {
      heading: "Le contenu essentiel est-il présent après rendu ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : le contenu principal, les liens, la canonical et les directives robots dans la page rendue, particulièrement si le site dépend de JavaScript.",
        "Pourquoi : Google sait traiter JavaScript, mais son exploration et son rendu ne sont pas identiques à une simple consultation dans un navigateur. Un contenu disponible après exécution ne doit pas être supposé visible sans vérification.",
        "Comment vérifier : comparez le HTML reçu avant JavaScript avec le DOM rendu dans le navigateur. Vérifiez ensuite l’aperçu de la page explorée dans l’inspection d’URL, les ressources bloquées et les erreurs JavaScript signalées.",
        "Symptôme à examiner : le contenu ou les liens n’apparaissent qu’après une interaction, une ressource nécessaire est bloquée, ou une page inexistante affiche une page d’erreur avec statut 200.",
        "Action : rendez les liens et informations essentielles accessibles de façon fiable; vérifiez les codes HTTP pour les routes valides et inexistantes. Corrigez la cause de rendu avant d’ajouter des directives SEO.",
      ],
      links: [
        {
          label: "Bases du SEO JavaScript — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics?hl=fr",
        },
      ],
    },
    {
      heading: "La version mobile conserve-t-elle les informations utiles ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : le contenu principal, les liens, les directives robots et les données structurées sur mobile, ainsi que l’usage réel de la page à petite largeur.",
        "Pourquoi : Google utilise la version mobile pour l’indexation et le classement. Les recommandations mobile-first de Google insistent notamment sur la cohérence du contenu et des données importantes entre les versions.",
        "Comment vérifier : testez les modèles importants sur un téléphone ou dans un navigateur en largeur mobile; vérifiez le contenu qui apparaît, les liens, les menus, les formulaires et la présence des informations indispensables dans le rendu inspecté.",
        "Symptôme à examiner : du contenu ou des liens importants manquent sur mobile, une ressource est bloquée ou la page ne peut pas être utilisée sans zoom ou défilement horizontal excessif.",
        "Action : corrigez le gabarit concerné puis contrôlez à nouveau le rendu et les chemins de navigation. Évitez de confondre un défaut d’ergonomie observé avec une conclusion automatique sur le classement.",
      ],
      links: [
        {
          label: "Bonnes pratiques d’indexation mobile — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing?hl=fr",
        },
      ],
    },
    {
      heading: "4. Contrôler HTTPS et les performances",
    },
    {
      heading: "Les variantes du site aboutissent-elles à une version HTTPS cohérente ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : le certificat TLS, les versions HTTP/HTTPS et www/sans www, les redirections et les ressources de page chargées en HTTP.",
        "Pourquoi : plusieurs variantes accessibles peuvent créer des incohérences d’URL et des problèmes de navigation ou de sécurité. La canonicalisation HTTPS fait partie des signaux de choix d’une URL canonique.",
        "Comment vérifier : ouvrez les variantes connues, notez chaque réponse et destination finale, puis inspectez les ressources signalées comme contenu mixte par le navigateur. Vérifiez le certificat dans les détails de connexion.",
        "Symptôme à examiner : certificat expiré ou non fiable, redirection incohérente, page importante accessible uniquement en HTTP ou ressource HTTPS bloquée par un chargement HTTP.",
        "Action : demandez une correction au responsable de l’hébergement ou du gabarit; alignez ensuite les liens, canonicals et URL du sitemap sur la version attendue.",
      ],
      links: [
        {
          label: "Signaux de choix d’une URL canonique — Google Search Central",
          href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=fr",
        },
      ],
    },
    {
      heading: "Les Core Web Vitals sont-ils mesurés avec la bonne méthode ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : LCP (chargement), INP (réactivité) et CLS (stabilité visuelle), ainsi que les pages et appareils concernés.",
        "Pourquoi : les Core Web Vitals décrivent le chargement, la réactivité et la stabilité visuelle. Pour les données terrain, les seuils d’une bonne expérience s’évaluent au 75e centile, séparément pour mobile et ordinateur : LCP ≤ 2,5 s, INP ≤ 200 ms et CLS ≤ 0,1. Un test de laboratoire aide à chercher une cause, mais ne remplace pas les données terrain.",
        "Comment vérifier : consultez les données terrain lorsqu’elles sont disponibles, segmentées par appareil et groupe d’URL; complétez-les avec un test de laboratoire pour chercher une cause reproductible. Notez l’outil, l’appareil et la page testée.",
        "Symptôme à examiner : les données terrain et laboratoire semblent contradictoires, ou un score unique est traité comme preuve que toutes les pages sont lentes.",
        "Action : identifiez le modèle et l’appareil concernés, reproduisez le problème, puis cherchez une cause technique vérifiable. Une amélioration des Core Web Vitals peut améliorer l’expérience, mais ne garantit pas une position particulière dans les résultats.",
      ],
      links: [
        {
          label: "Core Web Vitals — Google Search Central",
          href: "https://developers.google.com/search/docs/appearance/core-web-vitals?hl=fr",
        },
        {
          label: "Seuils des Web Vitals — web.dev",
          href: "https://web.dev/articles/vitals?hl=fr",
        },
      ],
    },
    {
      heading: "5. Vérifier les données structurées et les balises de page",
    },
    {
      heading: "Les données structurées décrivent-elles le contenu visible ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : le type de données structurées est-il approprié à la page, le JSON est-il valide, les propriétés correspondent-elles au contenu visible et les consignes Google sont-elles respectées ?",
        "Pourquoi : les données structurées peuvent rendre une page admissible à certaines présentations enrichies lorsqu’elle respecte les conditions applicables; leur présence ne garantit pas que Google affichera un résultat enrichi.",
        "Comment vérifier : validez la syntaxe et les avertissements avec l’outil adapté, puis confrontez chaque propriété à la page visible. Inspectez aussi les erreurs de rendu lorsque le balisage est généré par JavaScript.",
        "Symptôme à examiner : erreur de parsing, information balisée absente du contenu visible ou type choisi sans rapport avec la page.",
        "Action : corrigez ou retirez le balisage non conforme; ne créez pas une FAQ uniquement pour tenter d’obtenir un résultat enrichi.",
      ],
      links: [
        {
          label: "Introduction aux données structurées — Google Search Central",
          href: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data?hl=fr",
        },
        {
          label: "Test des résultats enrichis — Google",
          href: "https://search.google.com/test/rich-results",
        },
      ],
    },
    {
      heading: "Le title et la meta description correspondent-ils à la page rendue ?",
      headingLevel: 3,
      paragraphs: [
        "À vérifier : les éléments title et meta description sont-ils présents, exacts et cohérents avec le contenu de la page, y compris après rendu JavaScript ?",
        "Pourquoi : Google peut générer les liens de titre et extraits à partir de plusieurs signaux, et peut choisir un texte différent de celui déclaré.",
        "Comment vérifier : inspectez le HTML livré et la page rendue; recherchez les titres vides, dupliqués, génériques ou associés au mauvais gabarit. Vérifiez les requêtes et pages dans le rapport sur les performances de Search Console si vous y avez accès.",
        "Symptôme à examiner : un titre identique sur plusieurs gabarits, une description héritée par erreur ou des valeurs absentes après rendu.",
        "Action : corrigez le gabarit ou les métadonnées uniquement après avoir confirmé le problème sur les URL touchées. Évitez les seuils de longueur présentés comme des règles universelles : Google peut tronquer ou réécrire les éléments affichés.",
      ],
      links: [
        {
          label: "Liens de titre — Google Search Central",
          href: "https://developers.google.com/search/docs/appearance/title-link?hl=fr",
        },
        {
          label: "Extraits et meta descriptions — Google Search Central",
          href: "https://developers.google.com/search/docs/appearance/snippet?hl=fr",
        },
        {
          label: "Rapport sur les performances — Aide Search Console",
          href: "https://support.google.com/webmasters/answer/7576553?hl=fr",
        },
      ],
    },
    {
      heading: "Tableau de contrôle à remplir",
      table: {
        caption: "Tableau de contrôle opérationnel de l’audit SEO technique.",
        description:
          "La priorité dépend des URL et de l’effet observé; elle ne constitue pas un score universel.",
        headers: [
          "Priorité selon le contexte",
          "À vérifier",
          "Pourquoi",
          "Comment vérifier et quelle preuve noter",
          "Symptôme typique",
          "Action à entreprendre",
        ],
        rows: [
          [
            "À traiter d’abord si la page est stratégique",
            "Accès robots.txt",
            "Confirmer que le robot peut demander l’URL et les ressources utiles",
            "Règles du bon hôte, groupe applicable, test d’inspection d’URL",
            "Règle Disallow couvrant une page ou ressource essentielle",
            "Faire confirmer la règle puis ajuster son périmètre si elle est involontaire",
          ],
          [
            "À traiter d’abord si la page est stratégique",
            "Statut HTTP et redirections",
            "Vérifier que l’URL et sa destination peuvent être consultées",
            "Code de chaque réponse, en-têtes, URL finale et contenu livré",
            "Boucle, destination inattendue, 5xx, 404 interne ou page d’erreur en 200",
            "Corriger la route ou le lien selon l’état voulu; conserver les 404 intentionnelles",
          ],
          [
            "À traiter d’abord si l’indexation est voulue",
            "noindex et X-Robots-Tag",
            "S’assurer qu’une directive ne contredit pas l’état souhaité",
            "En-têtes, HTML initial, DOM rendu, inspection d’URL",
            "Page à indexer marquée noindex",
            "Retirer la directive seulement après validation de l’intention",
          ],
          [
            "À corriger si les URL ne concordent pas",
            "Sitemap XML",
            "Aider à faire découvrir les URL préférées",
            "Comparer sitemap, statut, canonical et directive robots",
            "URL redirigée, en erreur ou non indexable dans le sitemap",
            "Remplacer l’entrée par l’URL préférée ou l’enlever si elle n’est plus à découvrir",
          ],
          [
            "À corriger si les signaux divergent",
            "Canonical et variantes",
            "Exprimer une préférence claire pour les pages proches ou dupliquées",
            "Comparer canonical, redirection, liens internes, sitemap et variantes",
            "Signaux vers plusieurs URL concurrentes",
            "Choisir l’URL cible puis aligner les signaux",
          ],
          [
            "Selon l’importance de la page",
            "Architecture et liens internes",
            "Permettre aux visiteurs et robots de trouver les pages utiles",
            "Crawl des liens href, pages sans liens entrants, liens cassés",
            "Page importante isolée ou accessible seulement par interaction",
            "Ajouter ou réparer un lien depuis un contexte pertinent",
          ],
          [
            "À corriger si le contenu n’apparaît pas",
            "Rendu JavaScript",
            "Vérifier que contenu, liens et directives sont visibles après rendu",
            "Comparer HTML reçu, DOM rendu et page inspectée",
            "Contenu absent, ressource bloquée, erreur JS ou route inexistante en 200",
            "Corriger le rendu ou le statut HTTP, puis inspecter à nouveau",
          ],
          [
            "À corriger si un contenu ou un parcours essentiel est dégradé",
            "Version mobile",
            "Contrôler le contenu, les liens, les directives et l’usage à petite largeur",
            "Test sur téléphone ou navigateur mobile, comparaison du contenu et des liens rendus",
            "Contenu ou liens importants absents, menu inutilisable ou défilement horizontal excessif",
            "Corriger le gabarit concerné puis vérifier à nouveau le rendu et la navigation",
          ],
          [
            "À traiter si l’accès sécurisé ou les variantes sont incohérents",
            "HTTPS et variantes",
            "Vérifier le certificat, les redirections et les ressources chargées en HTTP",
            "Contrôler les versions HTTP/HTTPS et www/sans www, les destinations finales et le contenu mixte",
            "Certificat expiré, redirection incohérente ou ressource HTTP sur une page HTTPS",
            "Faire corriger la cause puis aligner liens, canonicals et sitemap sur la version attendue",
          ],
          [
            "À mesurer avant d’optimiser",
            "Core Web Vitals",
            "Séparer un signal terrain d’une mesure de laboratoire",
            "Données terrain au 75e centile par appareil et tests reproductibles",
            "Un score isolé est généralisé à toutes les pages",
            "Reproduire, identifier le gabarit concerné et mesurer après correction",
          ],
          [
            "Selon le type de page",
            "Données structurées",
            "Détecter les erreurs de syntaxe ou d’éligibilité",
            "Validateur ou test de résultats enrichis, comparaison au contenu visible",
            "Erreur, propriété non conforme ou balisage sans rapport",
            "Corriger ou retirer; ne pas promettre l’affichage enrichi",
          ],
          [
            "À corriger si les valeurs sont erronées",
            "Title et meta description",
            "Confirmer que les informations de page sont cohérentes",
            "HTML livré et rendu, comparaison entre gabarits et Search Console si disponible",
            "Valeurs vides, génériques, dupliquées ou périmées",
            "Corriger à la source et vérifier les URL concernées",
          ],
        ],
      },
    },
    {
      heading: "Exemple fictif : une page importante marquée noindex",
      paragraphs: [
        "L’URL fictive https://exemple.fr/guides/maintenance doit rester accessible aux visiteurs et peut être indexée. Elle répond en 200, figure dans le sitemap et reçoit des liens internes. Pourtant, son HTML contient meta name=\"robots\" content=\"noindex\".",
        "1. Preuve : noter le HTML livré et confirmer la directive dans le DOM rendu.",
        "2. Contexte : vérifier avec l’équipe si cette page doit réellement être indexable; une directive peut être voulue sur certaines pages.",
        "3. Action : si elle est involontaire, retirer noindex du gabarit ou de l’URL concernée sans bloquer l’accès au robot dans robots.txt.",
        "4. Contrôle : après mise en ligne de la correction, vérifier de nouveau la réponse, les directives rendues et l’inspection d’URL.",
        "Cet exemple est entièrement fictif; il ne décrit ni le site Flowpoint ni un résultat observé chez un client. La suppression d’un noindex ne garantit pas à elle seule l’indexation.",
      ],
    },
    {
      heading: "Après le contrôle",
      paragraphs: [
        "Après une correction, rejouez le même contrôle dans des conditions comparables et conservez les preuves avant/après. Si une donnée terrain ou Search Console manque, notez cette limite plutôt que de déduire un résultat d’un test de laboratoire isolé.",
      ],
      links: [
        {
          label: "Interpréter les résultats d’un audit SEO et choisir la suite",
          href: "/ressources/interpreter-resultats-audit-seo",
        },
      ],
    },
    {
      heading: "Sources officielles",
      paragraphs: [
        "Ces sources documentent les contrôles et les limites décrits dans la checklist.",
      ],
      links: [
        {
          label: "Google Search Central : robots.txt",
          href: "https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=fr",
        },
        {
          label: "Google Search Central : bloquer l’indexation avec noindex",
          href: "https://developers.google.com/search/docs/crawling-indexing/block-indexing?hl=fr",
        },
        {
          label: "Google Search Central : sitemaps",
          href: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview?hl=fr",
        },
        {
          label: "Google Search Central : URL canoniques",
          href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=fr",
        },
        {
          label: "Google Search Central : codes HTTP et exploration",
          href: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors?hl=fr",
        },
        {
          label: "Google Search Central : liens explorables",
          href: "https://developers.google.com/search/docs/crawling-indexing/links-crawlable?hl=fr",
        },
        {
          label: "Google Search Central : bases du SEO JavaScript",
          href: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics?hl=fr",
        },
        {
          label: "Google Search Central : indexation mobile",
          href: "https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing?hl=fr",
        },
        {
          label: "Google Search Central : Core Web Vitals",
          href: "https://developers.google.com/search/docs/appearance/core-web-vitals?hl=fr",
        },
        {
          label: "web.dev : seuils Core Web Vitals",
          href: "https://web.dev/articles/vitals?hl=fr",
        },
        {
          label: "Google Search Central : données structurées",
          href: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data?hl=fr",
        },
        {
          label: "Google : test des résultats enrichis",
          href: "https://search.google.com/test/rich-results",
        },
        {
          label: "Google Search Central : liens de titre",
          href: "https://developers.google.com/search/docs/appearance/title-link?hl=fr",
        },
        {
          label: "Google Search Central : extraits et meta descriptions",
          href: "https://developers.google.com/search/docs/appearance/snippet?hl=fr",
        },
        {
          label: "Search Console : inspection d’URL",
          href: "https://support.google.com/webmasters/answer/9012289?hl=fr",
        },
        {
          label: "Search Console : rapport sur les performances",
          href: "https://support.google.com/webmasters/answer/7576553?hl=fr",
        },
      ],
    },
  ],
  relatedArticles: [],
};
