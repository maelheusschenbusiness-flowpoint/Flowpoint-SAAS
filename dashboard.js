(() => {
  "use strict";

  const API_BASE = "";
  const TOKEN_KEY = "token";
  const REFRESH_TOKEN_KEY = "refreshToken";
  const REFRESH_ENDPOINT = "/api/auth/refresh";
  const ME_ENDPOINT = "/api/me";
  const LOGIN_URL = "/login.html";
  const PROACTIVE_REFRESH_MS = 4 * 60 * 1000;
  const SESSION_RECHECK_MS = 15000;

  const ROUTES = new Set([
    "#overview",
    "#missions",
    "#audits",
    "#monitors",
    "#reports",
    "#competitors",
    "#local-seo",
    "#tools",
    "#team",
    "#billing",
    "#settings",
  ]);

  const MISSIONS_STORAGE_KEY = "fp_dashboard_missions_v41";
  const MISSIONS_RESET_KEY = "fp_dashboard_missions_reset_v41";
  const UI_PREFS_STORAGE_KEY = "fp_dashboard_ui_prefs_v41";
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const LOGO_SRC = "/assets/flowpoint-logo.svg";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const els = {
    overlay: $("#fpOverlay"),
    sidebar: $("#sidebar"),
    pageContainer: $("#fpPageContainer"),
    main: $(".fpMain"),

    navItems: $$(".fpNavItem"),

    btnMenu: $("#fpMenuBtn"),
    btnRefresh: $("#fpRefreshBtn"),
    btnExportToggle: $("#fpExportToggle"),
    exportMenu: $("#fpExportMenu"),
    btnExportAudits: $("#fpExportAudits"),
    btnExportMonitors: $("#fpExportMonitors"),

    btnOpenBillingSide: $("#fpOpenBillingSide"),
    btnOpenSettingsSide: $("#fpOpenSettingsSide"),
    btnOpenInviteSide: $("#fpOpenInviteSide"),
    btnLogout: $("#fpLogoutBtn"),

    rangeSelect: $("#fpRangeSelect"),

    helloTitle: $("#fpHelloTitle"),
    helloSub: $(".fpHelloSub"),

    statusDot: $("#fpStatusDot"),
    statusText: $("#fpStatusText"),

    accPlan: $("#fpAccPlan"),
    accOrg: $("#fpAccOrg"),
    accRole: $("#fpAccRole"),
    accTrial: $("#fpAccTrial"),

    usageAudits: $("#fpUsageAudits"),
    usagePdf: $("#fpUsagePdf"),
    usageExports: $("#fpUsageExports"),
    usageMonitors: $("#fpUsageMonitors"),

    barAudits: $("#fpBarAudits"),
    barPdf: $("#fpBarPdf"),
    barExports: $("#fpBarExports"),
    barMonitors: $("#fpBarMonitors"),

    sidebarLogo: $("#fpSidebarLogo"),
  };

  const state = {
    route: ROUTES.has(location.hash) ? location.hash : "#overview",
    rangeDays: 30,
    me: null,
    overview: null,
    audits: [],
    monitors: [],
    orgSettings: {
      alertRecipients: "all",
      alertExtraEmails: [],
    },
    missions: [],
    controller: null,
    loading: false,
    lastLoadedAt: null,
    auth: {
      refreshInFlight: false,
      checkingSession: false,
      lastSessionCheckAt: 0,
      redirectScheduled: false,
    },
    uiPrefs: {
      themeAuto: true,
      liveStatus: true,
      compactLists: false,
      showAdvancedCards: true,
    },
    filters: {
      audits: {
        q: "",
        status: "all",
        sort: "date_desc",
      },
      monitors: {
        q: "",
        status: "all",
        sort: "date_desc",
      },
      missions: {
        q: "",
        status: "all",
      },
    },
    dailySeed: "",
  };

  const libraries = {
    feed: [
      {
        title: "Nouveau rapport généré",
        text: "Le rapport mensuel a été préparé avec la synthèse SEO, uptime et local.",
        time: "Il y a 12 min",
      },
      {
        title: "Alerte performance détectée",
        text: "Un site surveillé présente une latence inhabituelle sur mobile.",
        time: "Il y a 44 min",
      },
      {
        title: "Opportunité locale identifiée",
        text: "3 nouvelles pages géolocalisées peuvent être créées pour augmenter les leads.",
        time: "Aujourd’hui",
      },
      {
        title: "Nouvel export disponible",
        text: "Un export CSV a été préparé pour faciliter le suivi de performance.",
        time: "Aujourd’hui",
      },
      {
        title: "Signal concurrent détecté",
        text: "Un concurrent renforce ses pages services sur une zone à potentiel.",
        time: "Ce matin",
      },
      {
        title: "Monitor testé avec succès",
        text: "La couche monitoring a bien répondu et l’historique reste cohérent.",
        time: "Il y a 1 h",
      },
      {
        title: "Bloc local enrichi",
        text: "De nouvelles suggestions orientées Local SEO ont été calculées.",
        time: "Il y a 2 h",
      },
      {
        title: "Priorités revues",
        text: "La hiérarchie des actions a été recalculée sur la période choisie.",
        time: "Il y a 3 h",
      },
    ],

    overviewQuickWins: [
      {
        title: "Pages locales sous-exploitées",
        text: "Créer ou enrichir des pages géolocalisées peut rapidement améliorer la génération de leads.",
        tag: "Élevé",
        progress: 82,
      },
      {
        title: "Performance mobile",
        text: "Réduire la lenteur mobile peut améliorer SEO, confort utilisateur et conversion.",
        tag: "Priorité",
        progress: 71,
      },
      {
        title: "Rapports dirigeants",
        text: "Une version simplifiée des résultats augmente la valeur perçue côté client final.",
        tag: "Moyen",
        progress: 64,
      },
      {
        title: "Pages services trop courtes",
        text: "Allonger les pages commerciales principales augmente souvent la lisibilité et la conversion.",
        tag: "Élevé",
        progress: 76,
      },
      {
        title: "Signaux de confiance",
        text: "Ajouter des preuves, avis et éléments rassurants aide la vente et le SEO.",
        tag: "Impact",
        progress: 68,
      },
      {
        title: "Offres mal hiérarchisées",
        text: "Une structure plus nette des services rend l’offre plus simple à comprendre.",
        tag: "Clair",
        progress: 66,
      },
      {
        title: "Pages FAQ manquantes",
        text: "Une FAQ ciblée peut améliorer la compréhension, le maillage et la confiance.",
        tag: "Rapide",
        progress: 61,
      },
      {
        title: "Maillage interne local",
        text: "Lier les pages ville/service peut débloquer des signaux utiles rapidement.",
        tag: "SEO",
        progress: 74,
      },
      {
        title: "Résumé exécutif absent",
        text: "Un bloc synthèse plus haut de gamme rend le dashboard plus vendable.",
        tag: "Premium",
        progress: 69,
      },
    ],

    auditAxes: [
      {
        title: "Optimisation de structure",
        text: "Améliorer la hiérarchie des pages et le maillage peut débloquer de meilleurs signaux SEO.",
        tag: "SEO",
      },
      {
        title: "Contenu local",
        text: "Les pages locales ciblées donnent souvent un bon levier rapide sur des requêtes commerciales.",
        tag: "Local",
      },
      {
        title: "Expérience mobile",
        text: "La vitesse et la lisibilité mobile renforcent SEO, confiance et conversion.",
        tag: "UX",
      },
      {
        title: "Pages services premium",
        text: "Renforcer les pages d’offre améliore le potentiel business du trafic acquis.",
        tag: "Business",
      },
      {
        title: "Preuves de confiance",
        text: "Avis, garanties et éléments rassurants soutiennent la conversion et la crédibilité.",
        tag: "Trust",
      },
      {
        title: "Architecture de liens",
        text: "Un maillage mieux pensé peut redistribuer la valeur SEO vers les pages clés.",
        tag: "Links",
      },
      {
        title: "Intentions commerciales",
        text: "Mieux cibler les mots-clés de décision aide à faire monter la valeur perçue du service.",
        tag: "Intent",
      },
      {
        title: "Snippets mieux travaillés",
        text: "Titre et description mieux rédigés peuvent améliorer CTR et impact business.",
        tag: "CTR",
      },
    ],

    reportFormatTips: [
      {
        title: "PDF client-ready",
        text: "Idéal pour les livrables premium, les bilans mensuels et la présentation.",
        tag: "PDF",
      },
      {
        title: "CSV opérationnel",
        text: "Utile pour les traitements internes, le pilotage et les exports massifs.",
        tag: "CSV",
      },
      {
        title: "Résumé direction",
        text: "Version simple et vendeuse pour dirigeants non techniques.",
        tag: "Exec",
      },
      {
        title: "Version comparative",
        text: "Très utile pour montrer le avant / après et renforcer la rétention.",
        tag: "Delta",
      },
      {
        title: "Rapport d’incidents",
        text: "Le monitoring devient plus crédible quand les incidents sont relus proprement.",
        tag: "Uptime",
      },
      {
        title: "Bloc valeur business",
        text: "Un encart business rend le rapport moins technique et plus vendeur.",
        tag: "Value",
      },
      {
        title: "Plan d’action priorisé",
        text: "Le client comprend quoi faire en premier sans effort de lecture excessif.",
        tag: "Action",
      },
      {
        title: "Vue portefeuille",
        text: "Pratique quand plusieurs sites sont gérés dans une même structure.",
        tag: "Scale",
      },
    ],

    reportChecklist: [
      "Résumé exécutif clair",
      "Actions prioritaires",
      "Valeur business",
      "Preuve d’évolution",
      "Synthèse lisible pour non-tech",
      "Bloc risques / opportunités",
      "Lecture commerciale rapide",
      "Vision concrète des prochains gains",
    ],

    competitorWhy: [
      {
        title: "Écart visible",
        text: "Le benchmark rend les axes de rattrapage concrets et plus faciles à prioriser.",
        tag: "Clair",
      },
      {
        title: "Argumentaire commercial",
        text: "Comparer les concurrents aide à justifier les recommandations et le prix du service.",
        tag: "Vente",
      },
      {
        title: "Projection de valeur",
        text: "Le client comprend où il peut gagner en visibilité et en crédibilité.",
        tag: "Impact",
      },
      {
        title: "Retard lisible",
        text: "Le manque devient visible sans devoir expliquer trop longtemps.",
        tag: "Lisible",
      },
      {
        title: "Preuve d’investissement",
        text: "Le benchmark montre pourquoi continuer à investir reste logique.",
        tag: "Rétention",
      },
      {
        title: "Vision premium",
        text: "Un comparatif clair donne l’impression d’un accompagnement plus haut de gamme.",
        tag: "Premium",
      },
    ],

    competitorActions: [
      {
        title: "Contenu local",
        text: "Créer plus de pages à intention commerciale géolocalisée.",
      },
      {
        title: "Performance mobile",
        text: "Réduire la lenteur sur les pages stratégiques.",
      },
      {
        title: "Pages services",
        text: "Renforcer la structure et la lisibilité des offres.",
      },
      {
        title: "Confiance",
        text: "Ajouter davantage de preuves, avis et signaux rassurants.",
      },
      {
        title: "Maillage d’autorité",
        text: "Reconnecter les pages fortes vers les pages de service sous-traitées.",
      },
      {
        title: "Couverture locale",
        text: "Élargir la couverture sur les villes ou zones rentables voisines.",
      },
    ],

    localSeoAxes: [
      {
        title: "Optimiser Google Business Profile",
        text: "Amélioration concrète pour renforcer la visibilité locale et la confiance utilisateur.",
      },
      {
        title: "Uniformiser nom / adresse / téléphone",
        text: "Réduit les signaux contradictoires et renforce la cohérence locale.",
      },
      {
        title: "Développer les pages géolocalisées",
        text: "Permet de mieux couvrir les recherches locales à intention commerciale.",
      },
      {
        title: "Renforcer les avis et signaux de confiance",
        text: "Aide autant la conversion que la crédibilité perçue.",
      },
      {
        title: "Créer une FAQ locale",
        text: "Très utile pour répondre aux recherches de proximité plus précises.",
      },
      {
        title: "Mailler fiche et pages locales",
        text: "Donne une continuité plus forte entre la présence locale et le site principal.",
      },
      {
        title: "Structurer les pages villes",
        text: "Une même base cohérente permet de scaler plus proprement les implantations.",
      },
      {
        title: "Enrichir les pages zones de service",
        text: "Très bon levier pour les activités sans boutique unique.",
      },
    ],

    localBusiness: [
      {
        title: "Plus de visibilité locale",
        text: "Mieux apparaître sur les recherches proches de l’intention d’achat.",
        tag: "Leads",
      },
      {
        title: "Leads plus qualifiés",
        text: "Toucher des visiteurs déjà prêts à appeler, réserver ou acheter.",
        tag: "Qualité",
      },
      {
        title: "Meilleure conversion",
        text: "Les signaux locaux renforcent la confiance et l’action.",
        tag: "Conversion",
      },
      {
        title: "Différenciation immédiate",
        text: "Un meilleur ancrage local aide à se détacher visiblement de concurrents moins travaillés.",
        tag: "Diff",
      },
      {
        title: "Couverture géographique",
        text: "Le client voit plus clairement les zones fortes et les zones à gagner.",
        tag: "Zone",
      },
      {
        title: "Offre plus tangible",
        text: "Le local SEO se comprend très vite, donc se vend mieux.",
        tag: "Value",
      },
    ],

    tools: [
      {
        name: "Smart SEO Audit",
        tag: "Core",
        description: "Analyse technique, contenu, structure et opportunités immédiates.",
        features: [
          "Balises, maillage, structure",
          "Priorisation SEO actionnable",
          "Vision claire pour le client",
        ],
      },
      {
        name: "Uptime Monitoring",
        tag: "Premium",
        description: "Surveillance continue du site avec logique d’alerte et historique.",
        features: [
          "Disponibilité et latence",
          "Historique des incidents",
          "Justification forte de la valeur",
        ],
      },
      {
        name: "Local Visibility",
        tag: "Growth",
        description: "Module dédié au SEO local, réputation et présence Maps.",
        features: [
          "Google Business Profile",
          "Pages locales ciblées",
          "Signaux commerciaux locaux",
        ],
      },
      {
        name: "Competitor Watch",
        tag: "Premium",
        description: "Comparaison de visibilité et de structure face aux concurrents.",
        features: [
          "Écart concurrentiel lisible",
          "Axes d’amélioration clairs",
          "Meilleur argumentaire commercial",
        ],
      },
      {
        name: "Report Builder",
        tag: "Client-ready",
        description: "Création de rapports clairs, vendables et faciles à partager.",
        features: [
          "PDF et CSV",
          "Résumé dirigeant",
          "Livrables premium",
        ],
      },
      {
        name: "Team Workspace",
        tag: "Ultra",
        description: "Gestion des membres, rôles et accès pour scaler plus facilement.",
        features: [
          "Accès par rôle",
          "Collaboration simple",
          "Upsell naturel",
        ],
      },
      {
        name: "Benchmark Local",
        tag: "Growth",
        description: "Lecture rapide des écarts locaux les plus rentables.",
        features: [
          "Pages zones / villes",
          "Différenciation visible",
          "Support commercial plus fort",
        ],
      },
      {
        name: "Client Narrative",
        tag: "Premium",
        description: "Mise en avant de la valeur business dans chaque page du dashboard.",
        features: [
          "Conseils tournants",
          "Lecture simple",
          "Perception produit renforcée",
        ],
      },
    ],

    team: [
      {
        name: "Maël",
        role: "Owner",
        detail: "Accès complet au workspace, au billing et à la configuration globale.",
      },
      {
        name: "SEO Manager",
        role: "Manager",
        detail: "Peut lancer des audits, exporter des rapports et gérer les missions.",
      },
      {
        name: "Client Viewer",
        role: "Viewer",
        detail: "Peut consulter les rapports et la progression sans modifier les données.",
      },
      {
        name: "Tech Ops",
        role: "Editor",
        detail: "Peut gérer les monitors, vérifier la stabilité et corriger les alertes.",
      },
      {
        name: "Growth Lead",
        role: "Manager",
        detail: "Pilote les quick wins, le local SEO et la lecture business des recommandations.",
      },
      {
        name: "Ops Viewer",
        role: "Viewer",
        detail: "Observe les incidents et les rapports pour le suivi client ou interne.",
      },
    ],

    competitorBenchmarks: [
      { metric: "Pages locales", ours: "6", best: "14", gap: "À développer" },
      { metric: "Vitesse mobile", ours: "72/100", best: "91/100", gap: "Élevé" },
      { metric: "Pages services", ours: "8", best: "12", gap: "Modéré" },
      { metric: "Signaux de confiance", ours: "Bon", best: "Très fort", gap: "À renforcer" },
      { metric: "Fiches de contenu", ours: "4", best: "10", gap: "Visible" },
      { metric: "Couverture locale", ours: "3 zones", best: "9 zones", gap: "Important" },
      { metric: "Pages FAQ", ours: "1", best: "5", gap: "Rapide" },
      { metric: "Lisibilité offre", ours: "Correcte", best: "Très claire", gap: "À clarifier" },
    ],

    settingsInfoTips: [
      {
        title: "Thème automatique",
        text: "Utilise l’apparence système du navigateur. Effet surtout visuel.",
      },
      {
        title: "Statut temps réel",
        text: "Affiche et met à jour la barre d’état du dashboard.",
      },
      {
        title: "Listes compactes",
        text: "Réduit les espaces verticaux dans les lignes et cartes de listes.",
      },
      {
        title: "Cartes avancées",
        text: "Affiche davantage de blocs de lecture business et analytique.",
      },
    ],
  };

  function getDefaultMissions() {
    return [
      { id: "m1", title: "Créer ton premier monitor", meta: "Monitoring", done: false, action: "add_monitor", impact: "Élevé" },
      { id: "m2", title: "Lancer un audit SEO", meta: "Audits", done: false, action: "run_audit", impact: "Très élevé" },
      { id: "m3", title: "Exporter les audits CSV", meta: "Rapports", done: false, action: "export_audits", impact: "Moyen" },
      { id: "m4", title: "Exporter les monitors CSV", meta: "Rapports", done: false, action: "export_monitors", impact: "Moyen" },
      { id: "m5", title: "Ouvrir la facturation", meta: "Facturation", done: false, action: "open_billing", impact: "Moyen" },
      { id: "m6", title: "Configurer les alertes email", meta: "Paramètres", done: false, action: "goto_settings", impact: "Élevé" },
      { id: "m7", title: "Tester un monitor existant", meta: "Monitoring", done: false, action: "test_monitor", impact: "Élevé" },
      { id: "m8", title: "Ouvrir la page invitation", meta: "Équipe", done: false, action: "open_invite", impact: "Faible" },
      { id: "m9", title: "Relire les quick wins du jour", meta: "Overview", done: false, action: "goto_overview", impact: "Moyen" },
      { id: "m10", title: "Consulter les axes prioritaires", meta: "Audits", done: false, action: "goto_audits", impact: "Moyen" },
      { id: "m11", title: "Vérifier la logique des rapports", meta: "Rapports", done: false, action: "goto_reports", impact: "Faible" },
      { id: "m12", title: "Comparer le benchmark concurrent", meta: "Concurrents", done: false, action: "goto_competitors", impact: "Moyen" },
      { id: "m13", title: "Explorer les conseils Local SEO", meta: "Local SEO", done: false, action: "goto_local", impact: "Élevé" },
      { id: "m14", title: "Voir les outils premium", meta: "Outils", done: false, action: "goto_tools", impact: "Faible" },
    ];
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function cap(str) {
    const s = String(str || "").trim();
    if (!s) return "—";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function lower(v) {
    return String(v || "").toLowerCase();
  }

  function planLabel(plan) {
    const p = lower(plan);
    if (p === "standard") return "Standard";
    if (p === "pro") return "Pro";
    if (p === "ultra") return "Ultra";
    if (!p) return "Plan non synchronisé";
    return cap(p);
  }

  function planRank(plan) {
    const p = lower(plan);
    if (p === "standard") return 1;
    if (p === "pro") return 2;
    if (p === "ultra") return 3;
    return 0;
  }

  function hasPlan(minPlan) {
    return planRank(state.me?.plan) >= planRank(minPlan);
  }

  function featureGate(minPlan, okHtml, lockedTitle = "Fonction Premium", lockedText = "Disponible sur un plan supérieur.") {
    if (hasPlan(minPlan)) return okHtml;
    return `
      <div class="fpFeatureLock">
        <div class="fpFeatureLockTitle">${esc(lockedTitle)}</div>
        <div class="fpFeatureLockHint">
          ${esc(lockedText)}<br>
          Niveau requis : ${esc(planLabel(minPlan))}
        </div>
      </div>
    `;
  }

  function statusLabel(status) {
    const s = lower(status);
    if (!s) return "Statut en attente";
    if (s === "trialing") return "À l’essai";
    if (s === "active") return "Actif";
    if (s === "past_due") return "Paiement en retard";
    if (s === "canceled") return "Annulé";
    if (s === "incomplete") return "Incomplet";
    return cap(s.replaceAll("_", " "));
  }

  function recipientsLabel(mode) {
    return lower(mode) === "owner" ? "Owner uniquement" : "Toute l’équipe";
  }

  function formatDate(value) {
    if (!value) return "Récemment";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Récemment";
    return d.toLocaleString("fr-FR");
  }

  function formatShortDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("fr-FR");
  }

  function trialLabel(value) {
    const status = lower(state.me?.subscriptionStatus || state.me?.lastPaymentStatus || "");
    if (!value) {
      if (status === "trialing") return "Essai actif";
      return "Essai non défini";
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      if (status === "trialing") return "Essai actif";
      return "Essai non défini";
    }
    return d.getTime() >= Date.now() ? "Essai actif" : "Essai terminé";
  }

  function formatUsage(v) {
    if (v == null) return "0";
    if (typeof v === "number" || typeof v === "string") return String(v);
    if (typeof v === "object") {
      const used = v.used ?? 0;
      const limit = v.limit ?? null;
      if (limit == null) return String(used);
      return `${used}/${limit}`;
    }
    return "0";
  }

  function setBar(el, used, limit) {
    if (!el) return;
    const u = Number(used || 0);
    const l = Math.max(1, Number(limit || 0));
    const pct = clamp(Math.round((u / l) * 100), 0, 100);
    el.style.width = `${pct}%`;
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
  }

  function getRefreshToken() {
    return localStorage.getItem(REFRESH_TOKEN_KEY) || sessionStorage.getItem(REFRESH_TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (!token) return;
    localStorage.setItem(TOKEN_KEY, token);
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {}
  }

  function setRefreshToken(token) {
    if (!token) return;
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
    try {
      sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
    } catch {}
  }

  function hasAnyToken() {
    return !!(getToken() || getRefreshToken());
  }

  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  function loadUiPrefs() {
    try {
      const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.uiPrefs = {
        themeAuto: parsed?.themeAuto !== false,
        liveStatus: parsed?.liveStatus !== false,
        compactLists: parsed?.compactLists === true,
        showAdvancedCards: parsed?.showAdvancedCards !== false,
      };
    } catch (e) {
      console.error("Erreur lecture préférences UI :", e);
    }
  }

  function saveUiPrefs() {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(state.uiPrefs));
  }

  function toggleUiPref(key) {
    if (!(key in state.uiPrefs)) return;
    state.uiPrefs[key] = !state.uiPrefs[key];
    saveUiPrefs();

    if (key === "liveStatus") {
      if (state.uiPrefs.liveStatus) setStatus("Dashboard prêt", "ok");
      else if (els.statusText) els.statusText.textContent = "Statut masqué";
    }

    renderRoute({ preserveScroll: true });
  }

  function getFirstName(me) {
    const direct =
      me?.firstName ||
      me?.firstname ||
      me?.givenName ||
      me?.profile?.firstName ||
      "";

    if (direct) return String(direct).trim();

    const full = me?.name || me?.fullName || me?.email?.split("@")[0] || "";
    const clean = String(full).trim();
    if (clean) return clean.split(/\s+/)[0] || "";

    const org = me?.org?.name || me?.organization?.name || "";
    return String(org).trim();
  }

  function normalizeOrgName() {
    return state.me?.org?.name || state.me?.organization?.name || "Workspace principal";
  }

  function hydrateLogos() {
    if (els.sidebarLogo) els.sidebarLogo.src = LOGO_SRC;
  }

  function scrollPageTop() {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } catch {
      window.scrollTo(0, 0);
    }
    if (els.main) els.main.scrollTop = 0;
    if (els.pageContainer) els.pageContainer.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function shouldAutoScrollTop() {
    return window.innerWidth <= 1080;
  }

  function hashString(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i += 1) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function getDaySeed(extra = "") {
    const d = new Date();
    const dayKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    return `${dayKey}__${normalizeOrgName()}__${extra}__${state.rangeDays}`;
  }

  function rotateLibrary(list, seedText) {
    const arr = Array.isArray(list) ? [...list] : [];
    if (!arr.length) return [];
    const offset = hashString(seedText) % arr.length;
    return arr.slice(offset).concat(arr.slice(0, offset));
  }

  function pickLibrary(list, count, seedText) {
    return rotateLibrary(list, seedText).slice(0, count);
  }

  function refreshDailySeed() {
    state.dailySeed = getDaySeed("global");
  }

  function loadMissions() {
    try {
      const raw = localStorage.getItem(MISSIONS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (e) {
      console.error("Erreur lecture missions :", e);
    }
    return rotateLibrary(getDefaultMissions(), getDaySeed("missions_default"));
  }

  function saveMissions() {
    localStorage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(state.missions));
  }

  function resetMissionsIfNeeded(force = false) {
    const now = Date.now();
    const lastReset = Number(localStorage.getItem(MISSIONS_RESET_KEY) || 0);
    if (force || !lastReset || now - lastReset >= THREE_DAYS_MS) {
      state.missions = rotateLibrary(getDefaultMissions(), getDaySeed("missions_reset"));
      localStorage.setItem(MISSIONS_RESET_KEY, String(now));
      saveMissions();
    }
  }

  function toggleMission(id) {
    const mission = state.missions.find((m) => m.id === id);
    if (!mission) return;
    mission.done = !mission.done;
    saveMissions();
  }

  function setMissionDoneByAction(actionName, done = true) {
    const mission = state.missions.find((m) => m.action === actionName);
    if (!mission) return;
    mission.done = done;
    saveMissions();
  }

  function countDoneMissions() {
    return state.missions.filter((m) => m.done).length;
  }

  function hydrateSidebarAccount() {
    const me = state.me || {};
    const usage = me.usage || {};

    if (els.accPlan) els.accPlan.textContent = planLabel(me.plan);
    if (els.accOrg) els.accOrg.textContent = normalizeOrgName();
    if (els.accRole) els.accRole.textContent = cap(me.role || "owner");
    if (els.accTrial) els.accTrial.textContent = trialLabel(me.trialEndsAt);

    if (els.usageAudits) els.usageAudits.textContent = formatUsage(usage.audits);
    if (els.usagePdf) els.usagePdf.textContent = formatUsage(usage.pdf);
    if (els.usageExports) els.usageExports.textContent = formatUsage(usage.exports);
    if (els.usageMonitors) els.usageMonitors.textContent = formatUsage(usage.monitors);

    setBar(els.barAudits, usage.audits?.used, usage.audits?.limit);
    setBar(els.barPdf, usage.pdf?.used, usage.pdf?.limit);
    setBar(els.barExports, usage.exports?.used, usage.exports?.limit);
    setBar(els.barMonitors, usage.monitors?.used, usage.monitors?.limit);
  }

  function hydrateTopbar() {
    const me = state.me || {};
    const firstName = getFirstName(me);
    const orgName = normalizeOrgName();
    const helloName = firstName || orgName;

    if (els.helloTitle) {
      els.helloTitle.textContent = helloName ? `Bonjour, ${helloName}` : "Bonjour";
    }

    if (els.helloSub) {
      els.helloSub.textContent = "SEO · Monitoring · Rapports · Facturation";
    }

    if (els.rangeSelect) {
      const allowed = ["30", "7", "3"];
      const v = String(state.rangeDays);
      els.rangeSelect.value = allowed.includes(v) ? v : "30";
      if (!els.rangeSelect.value) els.rangeSelect.value = "30";
    }
  }

  function createBadge(status) {
    const s = lower(status);

    const label =
      s === "up" ? "UP" :
      s === "down" ? "DOWN" :
      s === "active" ? "Actif" :
      s === "trialing" ? "Essai" :
      s === "unknown" ? "Inactif" :
      s === "inactive" ? "Inactif" :
      s === "owner" ? "Owner" :
      s === "manager" ? "Manager" :
      s === "viewer" ? "Viewer" :
      s === "editor" ? "Editor" :
      cap(s);

    const cls =
      s === "up" || s === "active" || s === "owner" || s === "manager" || s === "viewer" || s === "editor"
        ? "up"
        : s === "down"
          ? "down"
          : s === "trialing"
            ? "warn"
            : "";

    return `
      <span class="fpBadge ${cls}" style="justify-content:center;min-width:108px">
        <span class="fpBadgeDot"></span>
        ${esc(label)}
      </span>
    `;
  }

  function createEmpty(message) {
    return `<div class="fpEmpty">${esc(message)}</div>`;
  }

  function createSectionCard(kicker, title, text, body = "", actions = "") {
    return `
      <section class="fpCard">
        <div class="fpCardHead">
          <div>
            ${kicker ? `<div class="fpCardKicker">${esc(kicker)}</div>` : ""}
            <h2 class="fpSectionTitle">${esc(title)}</h2>
            ${text ? `<p class="fpCardText">${esc(text)}</p>` : ""}
          </div>
          ${actions ? `<div class="fpCardActions">${actions}</div>` : ""}
        </div>
        ${body}
      </section>
    `;
  }

  function createInlineLinks(items = []) {
    const valid = items.filter((x) => x?.href && x?.label);
    if (!valid.length) return "";
    return `
      <div class="fpInlineLinks">
        ${valid.map((item) => `<a href="${esc(item.href)}">${esc(item.label)}</a>`).join("")}
      </div>
    `;
  }

  function createToolbar({ searchId, searchPlaceholder, searchValue, statusId, statusValue, sortId, sortValue, statuses = [], sorts = [] }) {
    return `
      <div class="fpTopActionsRow" style="margin-top:14px">
        <input
          id="${esc(searchId)}"
          class="fpInput fpToolbarInput"
          placeholder="${esc(searchPlaceholder)}"
          value="${esc(searchValue || "")}"
          autocomplete="off"
          spellcheck="false"
          style="min-width:220px"
        />
        <select id="${esc(statusId)}" class="fpInput fpToolbarSelect" style="min-width:180px">
          ${statuses.map((s) => `<option value="${esc(s.value)}" ${s.value === statusValue ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
        </select>
        <select id="${esc(sortId)}" class="fpInput fpToolbarSelect" style="min-width:220px">
          ${sorts.map((s) => `<option value="${esc(s.value)}" ${s.value === sortValue ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
        </select>
      </div>
    `;
  }

  function getAddonEntries() {
    const addons = state.me?.addons || {};
    const rawEntries = [
      ["whiteLabel", "White label"],
      ["monitorsPack50", "Monitors +50"],
      ["extraSeats", "Extra seats"],
      ["prioritySupport", "Priority support"],
      ["customDomain", "Custom domain"],
      ["retention90d", "Retention 90 jours"],
      ["retention365d", "Retention 365 jours"],
      ["auditsPack200", "Audits +200"],
      ["auditsPack1000", "Audits +1000"],
      ["pdfPack200", "PDF +200"],
      ["exportsPack1000", "Exports +1000"],
    ];

    return rawEntries.map(([key, label]) => {
      const value = addons[key];
      const enabled =
        typeof value === "boolean" ? value :
        typeof value === "number" ? value > 0 :
        !!value;

      return {
        key,
        label,
        enabled,
        text: typeof value === "number" && value > 1 ? `ON ×${value}` : enabled ? "ON" : "OFF",
      };
    });
  }

  function injectDashboardEnhancements() {
    if ($("#fpDashboardEnhancements")) return;
    const style = document.createElement("style");
    style.id = "fpDashboardEnhancements";
    style.textContent = `
      .fpMissionActions .fpBtnSmall{
        min-width:118px;
        justify-content:center;
      }

      .fpFeedTime{
        color:var(--fpTextSoft);
        font-size:13px;
        font-weight:800;
        white-space:nowrap;
      }

      .fpPriorityMain,
      .fpFeedMain{
        min-width:0;
        flex:1;
      }

      .fpBenchmarkCellPill{
        min-height:38px;
        padding:0 14px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.08);
        background:rgba(255,255,255,.035);
        display:inline-flex;
        align-items:center;
        justify-content:flex-start;
        font-weight:800;
        width:100%;
      }

      .fpBenchmarkRow > div{
        min-width:0;
      }

      .fpPriorityItem,
      .fpFeedItem{
        align-items:center;
      }

      .fpPriorityTag{
        align-self:center;
      }

      .fpToolbarInput,
      .fpToolbarSelect{
        box-shadow:var(--fpShadow);
      }

      .fpToolbarInput:focus,
      .fpToolbarSelect:focus,
      .fpInput:focus,
      .fpTextarea:focus{
        border-color:rgba(91,124,255,.42)!important;
        box-shadow:
          0 0 0 4px rgba(47,91,255,.12),
          var(--fpShadow);
      }

      .fpBtnGhost,
      .fpBtnSoft,
      .fpBtnPrimary,
      .fpBtnDanger{
        position:relative;
        overflow:hidden;
      }

      .fpBtnGhost::after,
      .fpBtnSoft::after,
      .fpBtnPrimary::after,
      .fpBtnDanger::after{
        content:"";
        position:absolute;
        inset:0;
        border-radius:inherit;
        pointer-events:none;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.12);
      }

      .fpRowCard,
      .fpInfoRow,
      .fpSettingsRow,
      .fpToggleRow,
      .fpQuotaRow,
      .fpAddonRow,
      .fpPriorityItem,
      .fpFeedItem,
      .fpBenchmarkRow{
        margin-top:0 !important;
      }

      .fpInfoList + .fpInfoList,
      .fpRows + .fpRows,
      .fpTimeline + .fpTimeline{
        margin-top:16px;
      }

      .fpAccountHero{
        display:grid;
        grid-template-columns:1fr auto;
        gap:16px;
        align-items:center;
        padding:18px;
        border-radius:22px;
        border:1px solid var(--fpBorderStrong);
        background:
          radial-gradient(120% 160% at 12% 0%, rgba(47,91,255,.22), transparent 54%),
          linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02));
      }

      .fpAccountHeroRight{
        display:flex;
        align-items:center;
        justify-content:center;
      }

      .fpAccountPlanChip{
        min-height:46px;
        padding:0 18px;
        border-radius:999px;
        background:linear-gradient(180deg,var(--fpBrand),var(--fpBrand2));
        box-shadow:var(--fpBrandGlow);
        color:#fff;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        font-size:14px;
        font-weight:900;
        letter-spacing:.10em;
        text-transform:uppercase;
      }

      .fpSettingImpact{
        margin-top:12px;
        padding:14px 16px;
        border-radius:16px;
        border:1px solid var(--fpBorder);
        background:rgba(255,255,255,.03);
      }

      .fpSettingImpactTitle{
        font-size:13px;
        font-weight:900;
        letter-spacing:.14em;
        text-transform:uppercase;
        color:var(--fpTextSoft);
      }

      .fpSettingImpactText{
        margin-top:8px;
        color:var(--fpTextSoft);
        font-size:14px;
        line-height:1.5;
        font-weight:700;
      }

      @media (prefers-color-scheme: light){
        .fpBenchmarkCellPill{
          background:linear-gradient(180deg, rgba(255,255,255,.86), rgba(244,248,255,.96))!important;
          border-color:rgba(59,78,130,.12)!important;
        }

        .fpAccountHero{
          background:
            radial-gradient(120% 160% at 12% 0%, rgba(47,91,255,.16), transparent 54%),
            linear-gradient(180deg, rgba(255,255,255,.82), rgba(241,246,255,.95))!important;
          border-color:rgba(59,78,130,.12)!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function openHtmlModal({ title, body, wide = false }) {
    const old = document.getElementById("fpModalOverlay");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "fpModalOverlay";
    overlay.className = "fpOverlay show";
    overlay.style.display = "grid";
    overlay.style.placeItems = "center";
    overlay.innerHTML = `
      <div class="fpCard" style="max-width:${wide ? "980px" : "640px"};width:calc(100% - 24px);max-height:88vh;overflow:auto;margin:auto">
        <div class="fpCardHead">
          <div><h2 class="fpSectionTitle" style="font-size:26px">${esc(title)}</h2></div>
          <div class="fpCardActions">
            <button type="button" class="fpBtn fpBtnGhost" id="fpModalCloseBtn">Fermer</button>
          </div>
        </div>
        <div style="margin-top:14px">${body}</div>
      </div>
    `;

    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
    }

    $("#fpModalCloseBtn", overlay)?.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    return { overlay, close };
  }

  function openTextModal({ title, placeholder = "", confirmText = "Valider", value = "" }) {
    return new Promise((resolve) => {
      const old = document.getElementById("fpModalOverlay");
      if (old) old.remove();

      const overlay = document.createElement("div");
      overlay.id = "fpModalOverlay";
      overlay.className = "fpOverlay show";
      overlay.style.display = "grid";
      overlay.style.placeItems = "center";
      overlay.innerHTML = `
        <div class="fpCard" style="max-width:560px;width:calc(100% - 24px);margin:auto">
          <div class="fpSectionTitle" style="font-size:24px">${esc(title)}</div>
          <div style="margin-top:14px">
            <input id="fpModalInput" class="fpInput" placeholder="${esc(placeholder)}" value="${esc(value)}" />
          </div>
          <div class="fpDetailActions" style="margin-top:16px">
            <button type="button" class="fpBtn fpBtnGhost" id="fpModalCancel">Annuler</button>
            <button type="button" class="fpBtn fpBtnPrimary" id="fpModalOk">${esc(confirmText)}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const input = $("#fpModalInput", overlay);
      const cancelBtn = $("#fpModalCancel", overlay);
      const okBtn = $("#fpModalOk", overlay);

      function close(val) {
        overlay.remove();
        resolve(val);
      }

      cancelBtn?.addEventListener("click", () => close(null));
      okBtn?.addEventListener("click", () => close(input?.value?.trim() || null));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null);
      });

      input?.focus();
    });
  }

  function goBillingPage() {
    setStatus("Ouverture de la facturation…", "warn");
    setMissionDoneByAction("open_billing", true);
    saveMissions();
    window.location.href = "/billing.html?return=%2Fdashboard.html%23overview";
    return true;
  }

  function goInvitePage() {
    setStatus("Ouverture de l’invitation…", "warn");
    setMissionDoneByAction("open_invite", true);
    saveMissions();
    window.location.href = "/invite-accept.html";
    return true;
  }

  async function safeExport(endpoint, filename) {
    setStatus("Préparation de l’export…", "warn");

    try {
      const r = await fetchWithAuth(endpoint, { method: "GET" });
      if (!r.ok) {
        const data = await parseJsonSafe(r);
        throw new Error(data?.error || "Export failed");
      }

      const blob = await r.blob();
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      if (endpoint.includes("audits")) setMissionDoneByAction("export_audits", true);
      if (endpoint.includes("monitors")) setMissionDoneByAction("export_monitors", true);

      setStatus("Export téléchargé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Export échoué", "danger");
      return false;
    }
  }

  async function safeRunAudit() {
    const url = await openTextModal({
      title: "URL à auditer",
      placeholder: "https://site.com",
      confirmText: "Lancer",
    });

    if (!url) return false;
    setStatus("Lancement de l’audit…", "warn");

    try {
      const r = await fetchWithAuth("/api/audits/run", {
        method: "POST",
        body: JSON.stringify({ url }),
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Audit failed");

      setMissionDoneByAction("run_audit", true);
      setStatus("Audit lancé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Audit échoué", "danger");
      return false;
    }
  }

  async function safeAddMonitor() {
    const url = await openTextModal({
      title: "URL à surveiller",
      placeholder: "https://site.com",
      confirmText: "Créer",
    });

    if (!url) return false;
    setStatus("Création du monitor…", "warn");

    try {
      const r = await fetchWithAuth("/api/monitors", {
        method: "POST",
        body: JSON.stringify({ url, intervalMinutes: 60 }),
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Monitor failed");

      setMissionDoneByAction("add_monitor", true);
      setStatus("Monitor créé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Création du monitor échouée", "danger");
      return false;
    }
  }

  async function safeTestMonitor(id) {
    if (!id) return false;
    setStatus("Test du monitor…", "warn");

    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/run`, {
        method: "POST",
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Monitor test failed");

      setMissionDoneByAction("test_monitor", true);
      setStatus("Test monitor — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Test monitor échoué", "danger");
      return false;
    }
  }

  async function safeDeleteMonitor(id) {
    if (!id) return false;
    if (!window.confirm("Supprimer ce monitor ?")) return false;

    setStatus("Suppression du monitor…", "warn");

    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Delete failed");

      setStatus("Monitor supprimé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Suppression échouée", "danger");
      return false;
    }
  }

  async function saveOrgSettings() {
    const mode = $("#fpSettingsRecipientsMode")?.value || "all";
    const raw = $("#fpSettingsExtraEmails")?.value || "";
    const extraEmails = raw.split(",").map((s) => s.trim()).filter(Boolean);

    setStatus("Sauvegarde des paramètres…", "warn");

    try {
      const r = await fetchWithAuth("/api/org/settings", {
        method: "POST",
        body: JSON.stringify({
          alertRecipients: mode,
          alertExtraEmails: extraEmails,
        }),
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Save settings failed");

      state.orgSettings = {
        alertRecipients: mode,
        alertExtraEmails: extraEmails,
      };

      setMissionDoneByAction("goto_settings", true);
      setStatus("Paramètres sauvegardés — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Erreur sauvegarde paramètres", "danger");
      return false;
    }
  }

  function getFilteredAudits() {
    const list = Array.isArray(state.audits) ? [...state.audits] : [];
    const q = lower(state.filters.audits.q);
    const status = state.filters.audits.status;
    const sort = state.filters.audits.sort;

    const filtered = list.filter((a) => {
      const matchesQ =
        !q ||
        lower(a.url).includes(q) ||
        lower(a.summary).includes(q) ||
        lower(a.status).includes(q);

      const matchesStatus =
        status === "all" ||
        (status === "ok" && a.status === "ok") ||
        (status === "error" && a.status !== "ok");

      return matchesQ && matchesStatus;
    });

    filtered.sort((a, b) => {
      if (sort === "score_desc") return Number(b.score || 0) - Number(a.score || 0);
      if (sort === "score_asc") return Number(a.score || 0) - Number(b.score || 0);
      if (sort === "date_asc") return new Date(a.createdAt) - new Date(b.createdAt);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return filtered;
  }

  function getFilteredMonitors() {
    const list = Array.isArray(state.monitors) ? [...state.monitors] : [];
    const q = lower(state.filters.monitors.q);
    const status = state.filters.monitors.status;
    const sort = state.filters.monitors.sort;

    const filtered = list.filter((m) => {
      const st = normalizeMonitorStatus(m);
      const matchesQ = !q || lower(m.url).includes(q);
      const matchesStatus = status === "all" || st === status;
      return matchesQ && matchesStatus;
    });

    filtered.sort((a, b) => {
      if (sort === "interval_asc") return Number(a.intervalMinutes || 0) - Number(b.intervalMinutes || 0);
      if (sort === "interval_desc") return Number(b.intervalMinutes || 0) - Number(a.intervalMinutes || 0);
      if (sort === "url_asc") return String(a.url || "").localeCompare(String(b.url || ""));
      if (sort === "date_asc") return new Date(a.createdAt) - new Date(b.createdAt);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return filtered;
  }

  function getFilteredMissions() {
    const list = Array.isArray(state.missions) ? [...state.missions] : [];
    const q = lower(state.filters.missions.q);
    const status = state.filters.missions.status;

    return list.filter((m) => {
      const matchesQ = !q || lower(`${m.title} ${m.meta} ${m.impact}`).includes(q);
      const matchesStatus =
        status === "all" ||
        (status === "done" && m.done) ||
        (status === "todo" && !m.done);
      return matchesQ && matchesStatus;
    });
  }

  function getOverviewFeed() {
    return pickLibrary(libraries.feed, 4, getDaySeed(`feed_${state.rangeDays}`));
  }

  function getOverviewQuickWins() {
    return pickLibrary(libraries.overviewQuickWins, 3, getDaySeed(`qw_${state.rangeDays}`));
  }

  function getAuditPriorityCards() {
    return pickLibrary(libraries.auditAxes, 3, getDaySeed(`audit_axes_${state.rangeDays}`));
  }

  function getReportFormatCards() {
    return pickLibrary(libraries.reportFormatTips, 3, getDaySeed(`report_formats_${state.rangeDays}`));
  }

  function getCompetitorWhyCards() {
    return pickLibrary(libraries.competitorWhy, 3, getDaySeed(`competitor_why_${state.rangeDays}`));
  }

  function getCompetitorActionCards() {
    return pickLibrary(libraries.competitorActions, 4, getDaySeed(`competitor_actions_${state.rangeDays}`));
  }

  function getLocalAxisCards() {
    return pickLibrary(libraries.localSeoAxes, 6, getDaySeed(`local_axes_${state.rangeDays}`));
  }

  function getLocalBusinessCards() {
    return pickLibrary(libraries.localBusiness, 4, getDaySeed(`local_business_${state.rangeDays}`));
  }

  function getToolCards() {
    return pickLibrary(libraries.tools, 6, getDaySeed(`tools_${state.rangeDays}`));
  }

  function getTeamCards() {
    return pickLibrary(libraries.team, 6, getDaySeed(`team_${state.rangeDays}`));
  }

  function getReportChecklistCards() {
    return pickLibrary(libraries.reportChecklist, 4, getDaySeed(`report_check_${state.rangeDays}`));
  }

  async function openAuditDetail(id) {
    if (!id) return;
    setStatus("Chargement du détail audit…", "warn");

    try {
      const r = await fetchWithAuth(`/api/audits/${encodeURIComponent(id)}`, { method: "GET" });
      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Audit detail failed");

      const audit = data?.audit || data;
      const recommendations = Array.isArray(audit?.recommendations) ? audit.recommendations : [];

      const body = `
        <div class="fpInfoList">
          <div class="fpInfoRow"><span>URL</span><strong>${esc(audit?.url || "—")}</strong></div>
          <div class="fpInfoRow"><span>Score</span><strong>${esc(audit?.score ?? 0)}</strong></div>
          <div class="fpInfoRow"><span>Statut</span><strong>${esc(audit?.status || "—")}</strong></div>
          <div class="fpInfoRow"><span>Date</span><strong>${esc(formatDate(audit?.createdAt))}</strong></div>
        </div>

        <div class="fpCardInner" style="margin-top:16px">
          <div class="fpCardInnerTitle" style="font-size:22px">Résumé</div>
          <div class="fpSmall">${esc(audit?.summary || "Aucun résumé")}</div>
        </div>

        <div class="fpCardInner" style="margin-top:16px">
          <div class="fpCardInnerTitle" style="font-size:22px">Recommandations</div>
          ${
            recommendations.length
              ? `<div class="fpRows">${recommendations.map((rec) => `<div class="fpRowCard"><div class="fpRowTitle">${esc(rec)}</div></div>`).join("")}</div>`
              : `<div class="fpEmpty">Aucune recommandation disponible.</div>`
          }
        </div>
      `;

      openHtmlModal({ title: "Détail audit", body, wide: true });
      setStatus("Détail audit chargé", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Erreur détail audit", "danger");
    }
  }

  async function openMonitorLogs(id) {
    if (!id) return;
    setStatus("Chargement des logs monitor…", "warn");

    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/logs`, { method: "GET" });
      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Logs failed");

      const logs = Array.isArray(data?.logs) ? data.logs : [];
      const body = logs.length
        ? `
          <div class="fpRows">
            ${logs.slice(0, 40).map((log) => `
              <div class="fpRowCard">
                <div class="fpRowMain">
                  <div class="fpRowTitle">${esc(log.url || "Monitor")}</div>
                  <div class="fpRowMeta">
                    ${esc(formatDate(log.checkedAt))} · HTTP ${esc(log.httpStatus ?? 0)} · ${esc(log.responseTimeMs ?? 0)} ms
                    ${log.error ? ` · ${esc(log.error)}` : ""}
                  </div>
                </div>
                <div class="fpRowRight">${createBadge(log.status)}</div>
              </div>
            `).join("")}
          </div>
        `
        : `<div class="fpEmpty">Aucun log disponible pour ce monitor.</div>`;

      openHtmlModal({ title: "Logs monitor", body, wide: true });
      setStatus("Logs monitor chargés", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Erreur logs monitor", "danger");
    }
  }

  async function openMonitorUptime(id) {
    if (!id) return;
    setStatus("Chargement uptime monitor…", "warn");

    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/uptime?days=${encodeURIComponent(state.rangeDays)}`, {
        method: "GET",
      });
      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Uptime failed");

      const uptime = data?.uptimePercent;
      const body = `
        <div class="fpStatsGrid fpStatsGridSingle">
          <div class="fpStatCard">
            <div class="fpStatLabel">Période</div>
            <div class="fpStatValue">${esc(data?.days ?? state.rangeDays)} j</div>
            <div class="fpStatMeta">Fenêtre analysée</div>
          </div>

          <div class="fpStatCard">
            <div class="fpStatLabel">Uptime</div>
            <div class="fpStatValue">${uptime == null ? "—" : `${esc(uptime)}%`}</div>
            <div class="fpStatMeta">Disponibilité calculée</div>
          </div>

          <div class="fpStatCard">
            <div class="fpStatLabel">Checks</div>
            <div class="fpStatValue">${esc(data?.totalChecks ?? 0)}</div>
            <div class="fpStatMeta">Nombre total de vérifications</div>
          </div>
        </div>
      `;

      openHtmlModal({ title: "Uptime monitor", body });
      setStatus("Uptime monitor chargé", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Erreur uptime monitor", "danger");
    }
  }

  function getAuditHealthBuckets() {
    const audits = Array.isArray(state.audits) ? state.audits : [];
    let strong = 0;
    let mid = 0;
    let weak = 0;

    audits.forEach((a) => {
      const s = Number(a.score || 0);
      if (s >= 75) strong += 1;
      else if (s >= 45) mid += 1;
      else weak += 1;
    });

    return { strong, mid, weak };
  }

  function getMonitorHealthBuckets() {
    const monitors = Array.isArray(state.monitors) ? state.monitors : [];
    let up = 0;
    let down = 0;
    let unknown = 0;

    monitors.forEach((m) => {
      const st = normalizeMonitorStatus(m);
      if (st === "up") up += 1;
      else if (st === "down") down += 1;
      else unknown += 1;
    });

    return { up, down, unknown };
  }

  function getOverviewInsight() {
    const chart =
      Array.isArray(state.overview?.chart) && state.overview.chart.length
        ? state.overview.chart.map((n) => Number(n || 0))
        : [];

    if (!chart.length) {
      return "Aucune donnée récente disponible. Lance un audit SEO pour générer une première courbe.";
    }

    const first = chart[0] || 0;
    const last = chart[chart.length - 1] || 0;
    const diff = Math.round(last - first);

    if (diff >= 12) return "La tendance est positive sur la période sélectionnée.";
    if (diff >= 1) return "La courbe reste orientée à la hausse.";
    if (diff <= -8) return "Le score est en baisse sur la période.";
    return "La performance reste relativement stable sur la période.";
  }

  function normalizeMonitorStatus(monitor) {
    const s = lower(monitor?.lastStatus || monitor?.status || monitor?.state || "unknown");
    return s === "inactive" ? "unknown" : s;
  }

  function normalizeMonitorId(monitor) {
    return monitor?._id || monitor?.id || "";
  }

  function normalizeAuditId(audit) {
    return audit?._id || audit?.id || "";
  }

  function drawOverviewChart() {
    const canvas = $("#fpOverviewChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(260, Math.round(rect.width || 760));
    const mobile = window.innerWidth <= 760;
    const height = mobile ? 220 : 320;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = "100%";
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const rawChart =
      Array.isArray(state.overview?.chart) && state.overview.chart.length
        ? state.overview.chart
        : [];

    const seoData = rawChart.length
      ? rawChart.map((n) => clamp(Number(n || 0), 0, 100))
      : [8, 16, 22, 20, 34, 41, 38, 48, 57, 61];

    const styles = getComputedStyle(document.documentElement);
    const brand = styles.getPropertyValue("--fpBrand").trim() || "#2f5bff";
    const brand2 = styles.getPropertyValue("--fpBrand2").trim() || "#1b45ff";
    const text = styles.getPropertyValue("--fpMuted").trim() || "#94a3b8";

    const padLeft = mobile ? 34 : 44;
    const padRight = mobile ? 14 : 20;
    const padTop = 18;
    const padBottom = mobile ? 26 : 34;

    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;
    const gridLines = 5;

    ctx.strokeStyle = "rgba(148,163,184,.20)";
    ctx.lineWidth = 1;

    for (let i = 0; i <= gridLines; i += 1) {
      const y = padTop + (chartH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
    }

    ctx.fillStyle = text;
    ctx.font = mobile ? "11px Inter, system-ui, sans-serif" : "12px Inter, system-ui, sans-serif";

    const labels = ["100", "80", "60", "40", "20", "0"];
    for (let i = 0; i < labels.length; i += 1) {
      const y = padTop + (chartH / 5) * i;
      ctx.fillText(labels[i], labels[i] === "100" ? 6 : 12, y + 4);
    }

    const stepX = seoData.length > 1 ? chartW / (seoData.length - 1) : chartW;
    const points = seoData.map((value, i) => ({
      x: padLeft + i * stepX,
      y: padTop + chartH - (value / 100) * chartH,
    }));

    const areaGradient = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    areaGradient.addColorStop(0, "rgba(47,91,255,.18)");
    areaGradient.addColorStop(1, "rgba(47,91,255,0)");

    ctx.beginPath();
    ctx.moveTo(points[0].x, padTop + chartH);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, padTop + chartH);
    ctx.closePath();
    ctx.fillStyle = areaGradient;
    ctx.fill();

    const strokeGradient = ctx.createLinearGradient(padLeft, 0, width - padRight, 0);
    strokeGradient.addColorStop(0, brand);
    strokeGradient.addColorStop(1, brand2);

    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = strokeGradient;
    ctx.lineWidth = mobile ? 3.2 : 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, mobile ? 4 : 5, 0, Math.PI * 2);
      ctx.fillStyle = brand;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, mobile ? 1.8 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    });
  }

  function renderPriorityList(items) {
    return `
      <div class="fpPriorityList">
        ${items.map((item) => `
          <div class="fpPriorityItem">
            <div class="fpPriorityMain">
              <div class="fpPriorityTitle">${esc(item.title)}</div>
              <div class="fpPriorityText">${esc(item.text)}</div>
              ${item.progress != null ? `<div class="fpMiniProgress"><div class="fpMiniProgressFill" style="width:${clamp(Number(item.progress || 0), 8, 100)}%"></div></div>` : ""}
            </div>
            ${item.tag ? `<div class="fpPriorityTag">${esc(item.tag)}</div>` : ""}
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderCheckGrid(items) {
    return `
      <div class="fpCheckGrid">
        ${items.map((item) => `
          <div class="fpCheckItem">
            <div class="fpCheckTitle">${esc(item.title || item)}</div>
            <div class="fpCheckText">${esc(item.text || "Ce point renforce la lisibilité, la valeur perçue et l’utilité du dashboard.")}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderOverviewPage() {
    const me = state.me || {};
    const ov = state.overview || {};
    const recentAudits = Array.isArray(state.audits) ? state.audits.slice(0, 5) : [];
    const recentMonitors = Array.isArray(state.monitors) ? state.monitors.slice(0, 5) : [];
    const done = countDoneMissions();
    const auditBuckets = getAuditHealthBuckets();
    const monitorBuckets = getMonitorHealthBuckets();
    const activeAddons = getAddonEntries().filter((a) => a.enabled).slice(0, 6);
    const feedItems = getOverviewFeed();
    const quickWins = getOverviewQuickWins();

    setPage(`
      ${createSectionCard(
        "FlowPoint",
        "Overview",
        "Suis tes performances, ton activité et les prochaines actions utiles depuis un seul dashboard.",
        `
          <div class="fpStatsGrid">
            <div class="fpStatCard">
              <div class="fpStatLabel">Organisation</div>
              <div class="fpStatValue">${esc(normalizeOrgName())}</div>
              <div class="fpStatMeta">Workspace actuellement chargé</div>
            </div>

            <div class="fpStatCard">
              <div class="fpStatLabel">Score SEO</div>
              <div class="fpStatValue">${esc(ov.seoScore ?? 0)}</div>
              <div class="fpStatMeta">${esc(ov.lastAuditAt ? `Dernier audit le ${formatShortDate(ov.lastAuditAt)}` : "Aucun audit récent")}</div>
            </div>

            <div class="fpStatCard">
              <div class="fpStatLabel">Abonnement</div>
              <div class="fpStatValue">${esc(planLabel(me.plan))}</div>
              <div class="fpStatMeta">${esc(statusLabel(me.subscriptionStatus || me.lastPaymentStatus))}</div>
            </div>
          </div>
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Performance",
            "Évolution SEO",
            "Lecture multi-indicateurs sur la période sélectionnée",
            `
              <div class="fpChartCard">
                <div class="fpChartBox">
                  <canvas id="fpOverviewChart"></canvas>
                </div>
                <div class="fpChartLegend">
                  <div class="fpLegendItem"><span class="fpLegendDot"></span> Score SEO</div>
                </div>
                <div class="fpChartInsight">${esc(getOverviewInsight())}</div>
              </div>
            `
          )}

          ${createSectionCard(
            "Quick setup",
            "Missions prioritaires",
            "Checklist utile et réellement changeante sur la rotation du dashboard.",
            `
              <div class="fpMissionStack">
                ${state.missions.slice(0, 4).map((m) => `
                  <div class="fpMissionCard">
                    <div class="fpMissionTop">
                      <button
                        class="fpMissionCheck ${m.done ? "done" : ""}"
                        data-mission-toggle="${esc(m.id)}"
                        type="button"
                        aria-checked="${m.done ? "true" : "false"}"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M6.5 12.5L10.2 16.2L17.5 8.8" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </button>

                      <div class="fpMissionInfo">
                        <div class="fpMissionTitle">${esc(m.title)}</div>
                        <div class="fpMissionMeta">${esc(m.meta)} · Impact ${esc(m.impact || "Moyen")}</div>
                      </div>
                    </div>

                    <div class="fpMissionActions">
                      <button class="fpBtn fpBtnPrimary fpBtnSmall" type="button" data-mission-do="${esc(m.id)}">Faire</button>
                      <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-mission-open="${esc(m.id)}">Voir</button>
                    </div>
                  </div>
                `).join("")}
              </div>
            `
          )}

          ${createSectionCard(
            "Santé globale",
            "Répartition des scores et états",
            "Vue plus scalable pour piloter plusieurs sites plus clairement",
            `
              <div class="fpHealthGrid">
                <div class="fpHealthCard">
                  <div class="fpHealthTitle">Audits forts</div>
                  <div class="fpHealthValue">${auditBuckets.strong}</div>
                  <div class="fpHealthMeta">Score ≥ 75</div>
                </div>

                <div class="fpHealthCard">
                  <div class="fpHealthTitle">Audits moyens</div>
                  <div class="fpHealthValue">${auditBuckets.mid}</div>
                  <div class="fpHealthMeta">45 à 74</div>
                </div>

                <div class="fpHealthCard">
                  <div class="fpHealthTitle">Monitors UP</div>
                  <div class="fpHealthValue">${monitorBuckets.up}</div>
                  <div class="fpHealthMeta">Disponibles</div>
                </div>

                <div class="fpHealthCard">
                  <div class="fpHealthTitle">Monitors DOWN</div>
                  <div class="fpHealthValue">${monitorBuckets.down}</div>
                  <div class="fpHealthMeta">Incidents détectés</div>
                </div>
              </div>
            `
          )}

          ${createSectionCard(
            "Opportunités business",
            "Quick wins rentables",
            "Des recommandations faciles à comprendre et faciles à vendre.",
            renderPriorityList(quickWins)
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Organisation",
            "Résumé chargé",
            "Vue synthétique du compte actif",
            `
              <div class="fpInfoList">
                <div class="fpInfoRow"><span>Plan</span><strong>${esc(planLabel(me.plan))}</strong></div>
                <div class="fpInfoRow"><span>Organisation</span><strong>${esc(normalizeOrgName())}</strong></div>
                <div class="fpInfoRow"><span>Statut</span><strong>${esc(statusLabel(me.subscriptionStatus || me.lastPaymentStatus))}</strong></div>
                <div class="fpInfoRow"><span>Essai</span><strong>${esc(trialLabel(me.trialEndsAt))}</strong></div>
                <div class="fpInfoRow"><span>Monitors actifs</span><strong>${esc(ov.monitors?.active ?? 0)}/${esc(me.usage?.monitors?.limit ?? 0)}</strong></div>
                <div class="fpInfoRow"><span>Incidents</span><strong>${esc(ov.monitors?.down ?? 0)}</strong></div>
                <div class="fpInfoRow"><span>Missions faites</span><strong>${done}/${state.missions.length}</strong></div>
              </div>
            `
          )}

          ${createSectionCard(
            "Add-ons actifs",
            "Modules détectés",
            "Vérification visuelle des options réellement actives",
            activeAddons.length
              ? `
                <div class="fpRows">
                  ${activeAddons.map((a) => `
                    <div class="fpRowCard">
                      <div class="fpRowMain">
                        <div class="fpRowTitle">${esc(a.label)}</div>
                        <div class="fpRowMeta">État détecté depuis /api/me</div>
                      </div>
                      <div class="fpRowRight"><div class="fpAddonPill on">${esc(a.text)}</div></div>
                    </div>
                  `).join("")}
                </div>
              `
              : createEmpty("Aucun add-on actif détecté pour le moment.")
          )}

          ${createSectionCard(
            "Activité récente",
            "Feed dashboard",
            "Ce qui s’est passé récemment sur l’espace client.",
            `
              <div class="fpFeedList">
                ${feedItems.map((item) => `
                  <div class="fpFeedItem">
                    <div class="fpFeedTop">
                      <div class="fpFeedTitle">${esc(item.title)}</div>
                      <div class="fpFeedTime">${esc(item.time)}</div>
                    </div>
                    <div class="fpFeedText">${esc(item.text)}</div>
                  </div>
                `).join("")}
              </div>
            `
          )}

          ${createSectionCard(
            "Audits récents",
            "Historique rapide",
            "Derniers audits chargés depuis l’API.",
            recentAudits.length
              ? `
                <div class="fpRows">
                  ${recentAudits.map((a) => `
                    <div class="fpRowCard">
                      <div class="fpRowMain">
                        <div class="fpRowTitle">${esc(a.url || "Audit SEO")}</div>
                        <div class="fpRowMeta">${esc(formatDate(a.createdAt))}</div>
                      </div>
                      <div class="fpRowRight"><div class="fpScore">${esc(a.score ?? 0)}</div></div>
                    </div>
                  `).join("")}
                </div>
              `
              : createEmpty("Aucun audit disponible pour le moment.")
          )}

          ${createSectionCard(
            "Monitors live",
            "État rapide",
            "Surveillance en direct des URLs.",
            recentMonitors.length
              ? `
                <div class="fpRows">
                  ${recentMonitors.map((m) => `
                    <div class="fpRowCard">
                      <div class="fpRowMain">
                        <div class="fpRowTitle">${esc(m.url || "Monitor")}</div>
                        <div class="fpRowMeta">${esc(m.intervalMinutes ?? 60)} min · ${esc(formatDate(m.lastCheckedAt))}</div>
                      </div>
                      <div class="fpRowRight">${createBadge(normalizeMonitorStatus(m))}</div>
                    </div>
                  `).join("")}
                </div>
              `
              : createEmpty("Aucun monitor disponible pour le moment.")
          )}
        </div>
      </div>
    `);

    requestAnimationFrame(drawOverviewChart);
  }
    function renderMissionsPage() {
    const done = countDoneMissions();
    const missions = getFilteredMissions();

    setPage(`
      ${createSectionCard(
        "Missions",
        "Checklist d’activation",
        "Les missions se réinitialisent automatiquement tous les 3 jours et la bibliothèque tourne pour ne pas rester décorative.",
        `
          ${createToolbar({
            searchId: "fpMissionsSearch",
            searchPlaceholder: "Rechercher une mission…",
            searchValue: state.filters.missions.q,
            statusId: "fpMissionsStatus",
            statusValue: state.filters.missions.status,
            sortId: "fpMissionsDummySort",
            sortValue: "default",
            statuses: [
              { value: "all", label: "Toutes" },
              { value: "todo", label: "À faire" },
              { value: "done", label: "Terminées" },
            ],
            sorts: [
              { value: "default", label: "Ordre actuel" }
            ],
          })}

          <div class="fpMissionPageGrid">
            <div class="fpMissionPageMain">
              <div class="fpMissionStack">
                ${missions.map((m) => `
                  <div class="fpMissionCard fpMissionCardLarge">
                    <div class="fpMissionTop">
                      <button
                        class="fpMissionCheck ${m.done ? "done" : ""}"
                        data-mission-toggle="${esc(m.id)}"
                        type="button"
                        aria-checked="${m.done ? "true" : "false"}"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M6.5 12.5L10.2 16.2L17.5 8.8" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </button>

                      <div class="fpMissionInfo">
                        <div class="fpMissionTitle">${esc(m.title)}</div>
                        <div class="fpMissionMeta">${esc(m.meta)} · Impact ${esc(m.impact || "Moyen")}</div>
                      </div>
                    </div>

                    <div class="fpMissionActions">
                      <button class="fpBtn fpBtnPrimary fpBtnSmall" type="button" data-mission-do="${esc(m.id)}">Faire</button>
                      <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-mission-open="${esc(m.id)}">Ouvrir</button>
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>

            <div class="fpMissionPageSide">
              <div class="fpStatsGrid">
                <div class="fpStatCard">
                  <div class="fpStatLabel">Terminées</div>
                  <div class="fpStatValue">${done}/${state.missions.length}</div>
                  <div class="fpStatMeta">Missions complétées</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">Reset auto</div>
                  <div class="fpStatValue">3 jours</div>
                  <div class="fpStatMeta">Remise à zéro automatique</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">Résultats</div>
                  <div class="fpStatValue">${missions.length}</div>
                  <div class="fpStatMeta">Après filtre</div>
                </div>
              </div>

              <div class="fpTextPanel">
                Commence par monitor + audit + paramètres. C’est le trio le plus utile pour activer le dashboard.
              </div>

              <div class="fpTimeline">
                <div class="fpTimelineItem">
                  <div class="fpTimelineTitle">Étape 1 — Monitoring</div>
                  <div class="fpTimelineMeta">Créer puis tester un monitor pour valider la couche uptime.</div>
                </div>
                <div class="fpTimelineItem">
                  <div class="fpTimelineTitle">Étape 2 — Audit</div>
                  <div class="fpTimelineMeta">Lancer un audit pour alimenter le reporting et les opportunités.</div>
                </div>
                <div class="fpTimelineItem">
                  <div class="fpTimelineTitle">Étape 3 — Paramètres</div>
                  <div class="fpTimelineMeta">Configurer les alertes email et l’organisation du workspace.</div>
                </div>
              </div>
            </div>
          </div>
        `
      )}
    `);

    bindInputPreserve("#fpMissionsSearch", "input", (e) => {
      state.filters.missions.q = e.target.value || "";
      renderRoute({ preserveScroll: true });
    });

    bindInputPreserve("#fpMissionsStatus", "change", (e) => {
      state.filters.missions.status = e.target.value || "all";
      renderRoute({ preserveScroll: true });
    });
  }

  function renderAuditsPage() {
    const audits = getFilteredAudits();
    const allAudits = Array.isArray(state.audits) ? state.audits : [];
    const avgScore = allAudits.length
      ? Math.round(allAudits.reduce((sum, a) => sum + Number(a.score || 0), 0) / allAudits.length)
      : 0;
    const axes = getAuditPriorityCards();
    const sellingChecks = pickLibrary(
      [
        { title: "Diagnostic clair", text: "Le client comprend où il perd de la visibilité." },
        { title: "Priorités simples", text: "Les actions sont hiérarchisées, donc plus faciles à vendre." },
        { title: "Preuve de suivi", text: "L’historique renforce la crédibilité du produit." },
        { title: "Livrables exploitables", text: "Les exports servent autant en interne qu’en client final." },
        { title: "Lecture business", text: "Le discours devient moins technique et plus convaincant." },
        { title: "Projection de gains", text: "Le client voit ce qu’il peut gagner, pas seulement ce qui manque." },
      ],
      4,
      getDaySeed("audit_selling")
    );

    setPage(`
      ${createSectionCard(
        "Audits",
        "Centre SEO",
        "Lance des audits, consulte l’historique et identifie rapidement les priorités.",
        `
          <div class="fpTopActionsRow">
            <button class="fpBtn fpBtnPrimary" id="fpAuditsRunBtn" type="button">Lancer un audit SEO</button>
            <button class="fpBtn fpBtnGhost" id="fpAuditsExportBtn" type="button">Exporter en CSV</button>
            <button class="fpBtn fpBtnGhost" type="button" data-go-billing>Billing</button>
            <a class="fpBtn fpBtnGhost" href="/addons.html">Add-ons</a>
          </div>

          ${createToolbar({
            searchId: "fpAuditsSearch",
            searchPlaceholder: "Rechercher une URL ou un résumé…",
            searchValue: state.filters.audits.q,
            statusId: "fpAuditsStatus",
            statusValue: state.filters.audits.status,
            sortId: "fpAuditsSort",
            sortValue: state.filters.audits.sort,
            statuses: [
              { value: "all", label: "Tous les statuts" },
              { value: "ok", label: "OK" },
              { value: "error", label: "À corriger" },
            ],
            sorts: [
              { value: "date_desc", label: "Date décroissante" },
              { value: "date_asc", label: "Date croissante" },
              { value: "score_desc", label: "Score décroissant" },
              { value: "score_asc", label: "Score croissant" },
            ],
          })}
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Historique",
            "Liste des audits",
            "Derniers audits disponibles sur ton organisation.",
            audits.length
              ? `
                <div class="fpTable">
                  <div class="fpTableHead">
                    <div>URL</div>
                    <div>Score</div>
                    <div>Date</div>
                    <div>Statut</div>
                    <div>Action</div>
                  </div>

                  ${audits.map((a) => `
                    <div class="fpTableRow">
                      <div class="fpTableUrl">${esc(a.url || "Audit SEO")}</div>
                      <div>${esc(a.score ?? 0)}</div>
                      <div>${esc(formatDate(a.createdAt))}</div>
                      <div>${createBadge(a.status === "ok" ? "up" : "down")}</div>
                      <div class="fpTableActions">
                        <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-audit-detail="${esc(normalizeAuditId(a))}">Détail</button>
                        ${
                          hasPlan("pro")
                            ? `<a class="fpBtn fpBtnSoft fpBtnSmall" href="/api/audits/${esc(normalizeAuditId(a))}/pdf" target="_blank" rel="noopener">PDF</a>`
                            : `<button class="fpBtn fpBtnGhost fpBtnSmall" type="button" disabled>PDF Pro</button>`
                        }
                      </div>
                    </div>
                  `).join("")}
                </div>
              `
              : createEmpty("Aucun audit pour le moment.")
          )}

          ${createSectionCard(
            "Opportunités",
            "Axes de progression prioritaires",
            "Recommandations qui renforcent la valeur du produit.",
            renderPriorityList(axes)
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Résumé",
            "Vue synthétique",
            "Indicateurs rapides de la partie audit.",
            `
              <div class="fpStatsGrid fpStatsGridSingle">
                <div class="fpStatCard">
                  <div class="fpStatLabel">Total</div>
                  <div class="fpStatValue">${allAudits.length}</div>
                  <div class="fpStatMeta">Audits chargés</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">Score moyen</div>
                  <div class="fpStatValue">${avgScore}</div>
                  <div class="fpStatMeta">Moyenne actuelle</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">Résultats filtrés</div>
                  <div class="fpStatValue">${audits.length}</div>
                  <div class="fpStatMeta">Après recherche / tri</div>
                </div>
              </div>
            `
          )}

          ${createSectionCard(
            "Lecture premium",
            "Pourquoi l’audit est vendeur",
            "Une bonne restitution augmente la confiance client.",
            renderCheckGrid(sellingChecks)
          )}
        </div>
      </div>
    `);

    $("#fpAuditsRunBtn")?.addEventListener("click", async () => {
      const ok = await safeRunAudit();
      if (ok) loadData({ silent: true });
    });

    $("#fpAuditsExportBtn")?.addEventListener("click", async () => {
      await safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    });

    bindInputPreserve("#fpAuditsSearch", "input", (e) => {
      state.filters.audits.q = e.target.value || "";
      renderRoute({ preserveScroll: true });
    });

    bindInputPreserve("#fpAuditsStatus", "change", (e) => {
      state.filters.audits.status = e.target.value || "all";
      renderRoute({ preserveScroll: true });
    });

    bindInputPreserve("#fpAuditsSort", "change", (e) => {
      state.filters.audits.sort = e.target.value || "date_desc";
      renderRoute({ preserveScroll: true });
    });

    $$("[data-audit-detail]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openAuditDetail(btn.getAttribute("data-audit-detail"));
      });
    });
  }

  function renderMonitorsPage() {
    const allMonitors = Array.isArray(state.monitors) ? state.monitors : [];
    const monitors = getFilteredMonitors();
    const health = getMonitorHealthBuckets();
    const monitoringWhyCards = pickLibrary(
      [
        { title: "Prévention", text: "Détecter un problème avant qu’il ne coûte du trafic ou des leads." },
        { title: "Réactivité", text: "Les alertes donnent une impression de service vivant et sérieux." },
        { title: "Justification du prix", text: "Une surveillance visible aide à défendre la valeur du SaaS." },
        { title: "Scalabilité", text: "La même logique peut ensuite s’appliquer à plus de clients et plus de sites." },
        { title: "Tranquillité client", text: "Le client se sent suivi même hors des audits ponctuels." },
        { title: "Service premium", text: "Le monitoring donne une vraie épaisseur opérationnelle au produit." },
      ],
      4,
      getDaySeed("monitoring_why")
    );

    setPage(`
      ${createSectionCard(
        "Monitoring",
        "Surveillance des sites",
        "Ajoute des URLs, contrôle leur disponibilité et pilote les incidents plus rapidement.",
        `
          <div class="fpTopActionsRow">
            <button class="fpBtn fpBtnPrimary" id="fpAddMonitorBtn" type="button">Ajouter un monitor</button>
            <button class="fpBtn fpBtnGhost" id="fpExportMonitorsBtn" type="button">Exporter en CSV</button>
            <button class="fpBtn fpBtnGhost" type="button" data-go-billing>Billing</button>
            <a class="fpBtn fpBtnGhost" href="/addons.html">Add-ons</a>
          </div>

          ${createToolbar({
            searchId: "fpMonitorsSearch",
            searchPlaceholder: "Rechercher une URL…",
            searchValue: state.filters.monitors.q,
            statusId: "fpMonitorsStatus",
            statusValue: state.filters.monitors.status,
            sortId: "fpMonitorsSort",
            sortValue: state.filters.monitors.sort,
            statuses: [
              { value: "all", label: "Tous les statuts" },
              { value: "up", label: "UP" },
              { value: "down", label: "DOWN" },
              { value: "unknown", label: "Inactif" },
            ],
            sorts: [
              { value: "date_desc", label: "Date décroissante" },
              { value: "date_asc", label: "Date croissante" },
              { value: "interval_asc", label: "Intervalle croissant" },
              { value: "interval_desc", label: "Intervalle décroissant" },
              { value: "url_asc", label: "URL A → Z" },
            ],
          })}
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Monitors",
            "Liste active",
            "Tous les monitors actuellement chargés depuis ton backend.",
            monitors.length
              ? `
                <div class="fpTable">
                  <div class="fpTableHead">
                    <div>URL</div>
                    <div>Statut</div>
                    <div>Intervalle</div>
                    <div>Dernier check</div>
                    <div>Actions</div>
                  </div>

                  ${monitors.map((m) => `
                    <div class="fpTableRow">
                      <div class="fpTableUrl">${esc(m.url || "Monitor")}</div>
                      <div>${createBadge(normalizeMonitorStatus(m))}</div>
                      <div>${esc(m.intervalMinutes ?? 60)} min</div>
                      <div>${esc(formatDate(m.lastCheckedAt))}</div>
                      <div class="fpTableActions">
                        <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-monitor-test="${esc(normalizeMonitorId(m))}">Tester</button>
                        <button class="fpBtn fpBtnSoft fpBtnSmall" type="button" data-monitor-logs="${esc(normalizeMonitorId(m))}">Logs</button>
                        ${
                          hasPlan("pro")
                            ? `<button class="fpBtn fpBtnSoft fpBtnSmall" type="button" data-monitor-uptime="${esc(normalizeMonitorId(m))}">Uptime</button>`
                            : `<button class="fpBtn fpBtnGhost fpBtnSmall" type="button" disabled>Uptime Pro</button>`
                        }
                        <button class="fpBtn fpBtnDanger fpBtnSmall" type="button" data-monitor-delete="${esc(normalizeMonitorId(m))}">Supprimer</button>
                      </div>
                    </div>
                  `).join("")}
                </div>
              `
              : createEmpty("Aucun monitor actif pour le moment.")
          )}

          ${createSectionCard(
            "Valeur perçue",
            "Pourquoi le monitoring rassure",
            "Le module uptime améliore fortement la crédibilité du produit.",
            `
              <div class="fpInlineStats">
                <div class="fpInlineStat">
                  <div class="fpBigValue">${health.up}</div>
                  <div class="fpInlineStatText">Monitors actuellement stables</div>
                </div>
                <div class="fpInlineStat">
                  <div class="fpBigValue">${health.down}</div>
                  <div class="fpInlineStatText">Incidents nécessitant attention</div>
                </div>
                <div class="fpInlineStat">
                  <div class="fpBigValue">${health.unknown}</div>
                  <div class="fpInlineStatText">Monitors sans statut exploitable</div>
                </div>
              </div>
            `
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Résumé",
            "État du monitoring",
            "Vue rapide de la surveillance active.",
            `
              <div class="fpStatsGrid fpStatsGridSingle">
                <div class="fpStatCard">
                  <div class="fpStatLabel">Total</div>
                  <div class="fpStatValue">${allMonitors.length}</div>
                  <div class="fpStatMeta">Monitors chargés</div>
                </div>
              </div>
            `
          )}

          ${createSectionCard(
            "Alertes",
            "Réception email",
            "Résumé de la configuration courante.",
            `
              <div class="fpInfoList">
                <div class="fpInfoRow"><span>Mode</span><strong>${esc(recipientsLabel(state.orgSettings?.alertRecipients))}</strong></div>
                <div class="fpInfoRow"><span>Emails extra</span><strong>${esc((state.orgSettings?.alertExtraEmails || []).join(", ") || "Aucun")}</strong></div>
              </div>
            `
          )}

          ${createSectionCard(
            "Justification",
            "Pourquoi ce module compte",
            "Le client voit une vraie couche opérationnelle.",
            renderCheckGrid(monitoringWhyCards)
          )}
        </div>
      </div>
    `);

    $("#fpAddMonitorBtn")?.addEventListener("click", async () => {
      const ok = await safeAddMonitor();
      if (ok) loadData({ silent: true });
    });

    $("#fpExportMonitorsBtn")?.addEventListener("click", async () => {
      await safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    });

    bindInputPreserve("#fpMonitorsSearch", "input", (e) => {
      state.filters.monitors.q = e.target.value || "";
      renderRoute({ preserveScroll: true });
    });

    bindInputPreserve("#fpMonitorsStatus", "change", (e) => {
      state.filters.monitors.status = e.target.value || "all";
      renderRoute({ preserveScroll: true });
    });

    bindInputPreserve("#fpMonitorsSort", "change", (e) => {
      state.filters.monitors.sort = e.target.value || "date_desc";
      renderRoute({ preserveScroll: true });
    });

    $$("[data-monitor-test]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-monitor-test");
        const ok = await safeTestMonitor(id);
        if (ok) loadData({ silent: true });
      });
    });

    $$("[data-monitor-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-monitor-delete");
        const ok = await safeDeleteMonitor(id);
        if (ok) loadData({ silent: true });
      });
    });

    $$("[data-monitor-logs]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openMonitorLogs(btn.getAttribute("data-monitor-logs"));
      });
    });

    $$("[data-monitor-uptime]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openMonitorUptime(btn.getAttribute("data-monitor-uptime"));
      });
    });
  }

  function renderReportsPage() {
    const auditsCount = Array.isArray(state.audits) ? state.audits.length : 0;
    const monitorsCount = Array.isArray(state.monitors) ? state.monitors.length : 0;
    const usage = state.me?.usage || {};
    const checklist = getReportChecklistCards().map((t) => ({ title: t, text: "Ce point rend le livrable plus compréhensible, plus premium et plus vendable." }));
    const formatCards = getReportFormatCards();

    setPage(`
      ${createSectionCard(
        "Rapports",
        "Exports et historiques",
        "Télécharge les données importantes du dashboard.",
        `
          <div class="fpReportsGrid">
            <div class="fpReportCard">
              <div class="fpReportTitle">Export audits</div>
              <div class="fpReportMeta">Télécharge tous les audits SEO en CSV.</div>
              <div class="fpDetailActions">
                <button class="fpBtn fpBtnPrimary" id="fpExportAuditsBtnPage" type="button">Exporter audits</button>
              </div>
            </div>

            <div class="fpReportCard">
              <div class="fpReportTitle">Export monitors</div>
              <div class="fpReportMeta">Télécharge les données de monitoring en CSV.</div>
              <div class="fpDetailActions">
                <button class="fpBtn fpBtnPrimary" id="fpExportMonitorsBtnPage" type="button">Exporter monitors</button>
              </div>
            </div>

            <div class="fpReportCard">
              <div class="fpReportTitle">Facturation</div>
              <div class="fpReportMeta">Ouvre la gestion du compte.</div>
              <div class="fpDetailActions">
                <a class="fpBtn fpBtnGhost" href="/billing.html">Billing</a>
              </div>
            </div>

            <div class="fpReportCard">
              <div class="fpReportTitle">Add-ons</div>
              <div class="fpReportMeta">Ajuste les options de l’abonnement.</div>
              <div class="fpDetailActions">
                <a class="fpBtn fpBtnGhost" href="/addons.html">Add-ons</a>
              </div>
            </div>
          </div>
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Historique",
            "Données exportables",
            "Résumé rapide des volumes actuellement disponibles.",
            `
              <div class="fpStatsGrid">
                <div class="fpStatCard">
                  <div class="fpStatLabel">Audits</div>
                  <div class="fpStatValue">${auditsCount}</div>
                  <div class="fpStatMeta">Lignes exportables</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">Monitors</div>
                  <div class="fpStatValue">${monitorsCount}</div>
                  <div class="fpStatMeta">Lignes exportables</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">Exports restants</div>
                  <div class="fpStatValue">${esc(formatUsage(usage.exports))}</div>
                  <div class="fpStatMeta">Quota actuel</div>
                </div>
              </div>
            `
          )}

          ${createSectionCard(
            "Checklist premium",
            "Ce qu’un bon rapport doit contenir",
            "Une structure plus claire augmente la perception de valeur.",
            renderCheckGrid(checklist)
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Conseil",
            "Usage commercial",
            "Transforme les données en livrables.",
            `
              <div class="fpTextPanel">
                Utilise les exports pour les comptes-rendus, suivis mensuels, comparatifs avant/après et reporting interne.
              </div>
            `
          )}

          ${createSectionCard(
            "Formats",
            "Pourquoi ils servent",
            "Chaque format a un rôle précis dans la vente et le suivi client.",
            renderPriorityList(formatCards)
          )}
        </div>
      </div>
    `);

    $("#fpExportAuditsBtnPage")?.addEventListener("click", async () => {
      await safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    });

    $("#fpExportMonitorsBtnPage")?.addEventListener("click", async () => {
      await safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    });
  }

  function renderCompetitorsPage() {
    const benchmarkRows = pickLibrary(libraries.competitorBenchmarks, 4, getDaySeed(`benchmark_${state.rangeDays}`));
    const whyCards = getCompetitorWhyCards();
    const actionCards = getCompetitorActionCards();

    setPage(`
      ${createSectionCard(
        "Concurrents",
        "Benchmark concurrentiel",
        "Visualise rapidement les écarts les plus importants face au marché.",
        `
          <div class="fpBenchmarkTable">
            <div class="fpBenchmarkHead">
              <div>Critère</div>
              <div>Votre site</div>
              <div>Meilleur</div>
              <div>Écart</div>
            </div>

            ${benchmarkRows.map((row) => `
              <div class="fpBenchmarkRow">
                <div class="fpBenchmarkStrong">${esc(row.metric)}</div>
                <div><div class="fpBenchmarkCellPill">${esc(row.ours)}</div></div>
                <div><div class="fpBenchmarkCellPill">${esc(row.best)}</div></div>
                <div><div class="fpBenchmarkCellPill">${esc(row.gap)}</div></div>
              </div>
            `).join("")}
          </div>
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Lecture business",
            "Pourquoi ce benchmark est utile",
            "Le client voit pourquoi il doit continuer à investir.",
            renderPriorityList(whyCards)
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Actions",
            "Pistes immédiates",
            "Des écarts exploitables rapidement.",
            renderCheckGrid(actionCards)
          )}
        </div>
      </div>
    `);
  }

  function renderLocalSeoPage() {
    const axes = getLocalAxisCards();
    const businessCards = getLocalBusinessCards();
    const simpleCards = pickLibrary(
      [
        { title: "Visibilité concrète", text: "Le client comprend tout de suite ce que le local SEO change." },
        { title: "Signal premium", text: "La présence locale donne un effet très tangible au service." },
        { title: "Levier rétention", text: "Un client qui voit ses zones progresser a moins envie d’arrêter." },
        { title: "Facile à vendre", text: "Le local se comprend plus vite que beaucoup d’optimisations abstraites." },
      ],
      3,
      getDaySeed("local_simple")
    );

    setPage(`
      ${createSectionCard(
        "Local SEO",
        "Visibilité locale",
        "Optimise la présence locale et les signaux business pour générer plus de leads qualifiés.",
        renderCheckGrid(axes)
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Impact business",
            "Pourquoi le local est très vendeur",
            "Particulièrement utile pour PME, commerces et indépendants.",
            renderPriorityList(businessCards)
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Lecture simple",
            "Ce que le client comprend vite",
            "Le local SEO est une brique très facile à valoriser.",
            renderCheckGrid(simpleCards)
          )}
        </div>
      </div>
    `);
  }

  function renderToolsPage() {
    const tools = getToolCards();
    const benefits = pickLibrary(
      [
        { title: "Centralisation", text: "SEO, monitoring, local, reporting et équipe au même endroit." },
        { title: "Scalabilité", text: "La structure est prête à accueillir plus de sites, plus de clients et plus de données." },
        { title: "Vente facilitée", text: "Des modules clairs et premium rendent l’offre plus simple à défendre." },
        { title: "Perception produit", text: "Plus de briques utiles donnent un effet SaaS plus fort." },
        { title: "Upsell naturel", text: "Les modules aident à pousser plan et add-ons sans forcer." },
      ],
      3,
      getDaySeed("tools_benefits")
    );

    setPage(`
      ${createSectionCard(
        "Outils",
        "Hub premium",
        "Les modules les plus utiles pour rendre FlowPoint plus puissant, plus vendable et plus rassurant.",
        `
          <div class="fpReportsGrid">
            ${tools.map((tool, idx) => `
              <div class="fpReportCard">
                <div class="fpAddonPill on">${esc(tool.tag)}</div>
                <div class="fpReportTitle" style="margin-top:14px">${esc(tool.name)}</div>
                <div class="fpReportMeta">${esc(tool.description)}</div>
                <div class="fpToolFeatureList">
                  ${tool.features.map((f) => `<div class="fpToolFeature">• ${esc(f)}</div>`).join("")}
                </div>
                <div class="fpDetailActions">
                  <button class="fpBtn fpBtnGhost" type="button" data-tool-activate="${idx}">Activer</button>
                </div>
              </div>
            `).join("")}
          </div>
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Pourquoi ces outils comptent",
            "Valeur perçue plus forte",
            "Ils donnent l’impression d’un SaaS plus complet et plus premium.",
            `
              <div class="fpPlanBenefits">
                ${benefits.map((item) => `
                  <div class="fpPlanBenefit">
                    <div class="fpPlanBenefitTitle">${esc(item.title)}</div>
                    <div class="fpPlanBenefitText">${esc(item.text)}</div>
                  </div>
                `).join("")}
              </div>
            `
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Projection",
            "Ce que ressent le client",
            "Une plateforme plus riche inspire plus de confiance.",
            `
              <div class="fpTextPanel">
                Plus le client voit des briques utiles, plus il ressent qu’il fait une bonne affaire et qu’il serait difficile de remplacer l’outil.
              </div>
            `
          )}
        </div>
      </div>
    `);

    $$("[data-tool-activate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setStatus("Module simulé comme activé côté interface", "ok");
        btn.textContent = "Activé";
        btn.classList.remove("fpBtnGhost");
        btn.classList.add("fpBtnPrimary");
      });
    });
  }

  function renderTeamPage() {
    const team = getTeamCards();
    const reasons = pickLibrary(
      [
        { title: "Collaboration", text: "Plusieurs profils peuvent travailler sur le même espace client." },
        { title: "Rôles", text: "Contrôle propre des accès, vues et actions." },
        { title: "Upsell naturel", text: "Le multi-user pousse naturellement vers les plans plus élevés." },
        { title: "Rétention", text: "Une équipe intégrée a moins envie de quitter l’outil." },
        { title: "Organisation propre", text: "Le dashboard paraît plus structuré et plus crédible." },
        { title: "Scalabilité", text: "Très utile quand le nombre de sites ou d’intervenants monte." },
      ],
      4,
      getDaySeed("team_reasons")
    );

    setPage(`
      ${createSectionCard(
        "Équipe",
        "Collaboration",
        "Gère les accès, les rôles et la collaboration sans alourdir l’expérience.",
        `
          <div class="fpRows">
            ${team.map((member) => `
              <div class="fpRowCard">
                <div class="fpRowMain">
                  <div class="fpRowTitle">${esc(member.name)}</div>
                  <div class="fpRowMeta">${esc(member.detail)}</div>
                </div>
                <div class="fpRowRight">${createBadge(member.role)}</div>
              </div>
            `).join("")}
          </div>
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Pourquoi c’est premium",
            "Valeur multi-utilisateur",
            "Très utile pour pousser vers les plans élevés.",
            renderCheckGrid(reasons)
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Accès",
            "Logique d’organisation",
            "Une structure simple mais crédible.",
            `
              <div class="fpTextPanel">
                Owner, manager, editor et viewer suffisent déjà à donner une impression SaaS sérieuse et scalable.
              </div>
            `
          )}
        </div>
      </div>
    `);
  }

  function renderBillingPage() {
    window.location.href = "/billing.html?return=%2Fdashboard.html%23overview";
  }

  function renderSettingsPage() {
    const s = state.orgSettings || {};
    const me = state.me || {};
    const extraEmails = Array.isArray(s.alertExtraEmails) ? s.alertExtraEmails.join(", ") : "";
    const addons = getAddonEntries();
    const settingTips = libraries.settingsInfoTips;

    setPage(`
      ${createSectionCard(
        "Paramètres",
        "Préférences du workspace",
        "Configure les alertes, l’interface et les accès rapides.",
        `
          <div class="fpGrid fpGridMain">
            <div class="fpCol fpColMain">
              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Alertes email</div>
                <div class="fpSmall">Définis qui reçoit les alertes monitoring.</div>

                <div class="fpField">
                  <label class="fpLabel" for="fpSettingsRecipientsMode">Mode destinataires</label>
                  <select id="fpSettingsRecipientsMode" class="fpInput">
                    <option value="all" ${String(s.alertRecipients || "all") === "all" ? "selected" : ""}>Toute l'équipe</option>
                    <option value="owner" ${String(s.alertRecipients || "all") === "owner" ? "selected" : ""}>Owner uniquement</option>
                  </select>
                </div>

                <div class="fpField">
                  <label class="fpLabel" for="fpSettingsExtraEmails">Emails supplémentaires</label>
                  <input
                    id="fpSettingsExtraEmails"
                    class="fpInput"
                    placeholder="mail@site.com, mail2@site.com"
                    value="${esc(extraEmails)}"
                    autocomplete="off"
                    spellcheck="false"
                  />
                </div>

                <div class="fpDetailActions">
                  <button class="fpBtn fpBtnPrimary" id="fpSaveSettingsBtn" type="button">Sauvegarder</button>
                </div>
              </div>

              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Préférences interface</div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Thème automatique</div>
                    <div class="fpToggleHint">Basé sur les préférences système du navigateur</div>
                    <div class="fpSettingImpact">
                      <div class="fpSettingImpactTitle">Effet</div>
                      <div class="fpSettingImpactText">${esc(settingTips[0].text)}</div>
                    </div>
                  </div>
                  <button type="button" class="fpSwitch ${state.uiPrefs.themeAuto ? "on" : ""}" id="fpThemeAutoToggle"></button>
                </div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Statut temps réel</div>
                    <div class="fpToggleHint">Affichage de l’état courant du dashboard</div>
                    <div class="fpSettingImpact">
                      <div class="fpSettingImpactTitle">Effet</div>
                      <div class="fpSettingImpactText">${esc(settingTips[1].text)}</div>
                    </div>
                  </div>
                  <button type="button" class="fpSwitch ${state.uiPrefs.liveStatus ? "on" : ""}" id="fpLiveStatusToggle"></button>
                </div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Listes compactes</div>
                    <div class="fpToggleHint">Réduit un peu la densité visuelle</div>
                    <div class="fpSettingImpact">
                      <div class="fpSettingImpactTitle">Effet</div>
                      <div class="fpSettingImpactText">${esc(settingTips[2].text)}</div>
                    </div>
                  </div>
                  <button type="button" class="fpSwitch ${state.uiPrefs.compactLists ? "on" : ""}" id="fpCompactListsToggle"></button>
                </div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Cartes avancées</div>
                    <div class="fpToggleHint">Affiche plus de blocs analytiques</div>
                    <div class="fpSettingImpact">
                      <div class="fpSettingImpactTitle">Effet</div>
                      <div class="fpSettingImpactText">${esc(settingTips[3].text)}</div>
                    </div>
                  </div>
                  <button type="button" class="fpSwitch ${state.uiPrefs.showAdvancedCards ? "on" : ""}" id="fpAdvancedCardsToggle"></button>
                </div>
              </div>

              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Équipe / invitation</div>
                <div class="fpSmall">Accès direct aux pages utiles.</div>
                ${createInlineLinks([
                  { href: "/invite-accept.html", label: "Invite accept" },
                  { href: "/billing.html", label: "Billing" },
                  { href: "/addons.html", label: "Add-ons" },
                ])}
              </div>
            </div>

            <div class="fpCol fpColSide">
              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Informations du compte</div>

                <div class="fpAccountHero" style="margin-top:16px">
                  <div class="fpAccountHeroLeft">
                    <div class="fpCardKicker" style="margin-bottom:8px">Compte actif</div>
                    <div class="fpBigValue">${esc(normalizeOrgName())}</div>
                    <div class="fpSmall">Synchronisation live du workspace, du rôle et du plan courant.</div>
                  </div>
                  <div class="fpAccountHeroRight">
                    <div class="fpAccountPlanChip">${esc(planLabel(me.plan))}</div>
                  </div>
                </div>

                <div class="fpSettingsList" style="margin-top:18px">
                  <div class="fpSettingsRow"><span>Organisation</span><strong>${esc(normalizeOrgName())}</strong></div>
                  <div class="fpSettingsRow"><span>Plan</span><strong>${esc(planLabel(me.plan))}</strong></div>
                  <div class="fpSettingsRow"><span>Rôle</span><strong>${esc(cap(me.role || "owner"))}</strong></div>
                  <div class="fpSettingsRow"><span>Destinataires</span><strong>${esc(recipientsLabel(s.alertRecipients))}</strong></div>
                  <div class="fpSettingsRow"><span>Essai</span><strong>${esc(trialLabel(me.trialEndsAt))}</strong></div>
                  <div class="fpSettingsRow"><span>Dernière synchro</span><strong>${esc(state.lastLoadedAt ? formatDate(state.lastLoadedAt) : "Récente")}</strong></div>
                </div>
              </div>

              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Add-ons détectés</div>
                ${
                  addons.length
                    ? `<div class="fpRows">
                        ${addons.map((a) => `
                          <div class="fpRowCard">
                            <div class="fpRowMain">
                              <div class="fpRowTitle">${esc(a.label)}</div>
                            </div>
                            <div class="fpRowRight">
                              <div class="fpAddonPill ${a.enabled ? "on" : "off"}">${esc(a.text)}</div>
                            </div>
                          </div>
                        `).join("")}
                      </div>`
                    : `<div class="fpEmpty">Aucun add-on détecté.</div>`
                }
              </div>

              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Session / stabilité</div>
                <div class="fpSmall">
                  Le dashboard tente un refresh token proactif, vérifie la session au retour au premier plan
                  et évite une redirection brutale trop rapide vers login.
                </div>
              </div>
            </div>
          </div>
        `
      )}
    `);

    $("#fpSaveSettingsBtn")?.addEventListener("click", async () => {
      const ok = await saveOrgSettings();
      if (ok) loadData({ silent: true });
    });

    $("#fpThemeAutoToggle")?.addEventListener("click", () => toggleUiPref("themeAuto"));
    $("#fpLiveStatusToggle")?.addEventListener("click", () => toggleUiPref("liveStatus"));
    $("#fpCompactListsToggle")?.addEventListener("click", () => toggleUiPref("compactLists"));
    $("#fpAdvancedCardsToggle")?.addEventListener("click", () => toggleUiPref("showAdvancedCards"));
  }

  function openMissionPage(id) {
    const mission = state.missions.find((m) => m.id === id);
    if (!mission) return;

    if (mission.action === "run_audit" || mission.action === "goto_audits") {
      location.hash = "#audits";
      return;
    }

    if (mission.action === "add_monitor" || mission.action === "test_monitor") {
      location.hash = "#monitors";
      return;
    }

    if (mission.action === "export_audits" || mission.action === "export_monitors" || mission.action === "goto_reports") {
      location.hash = "#reports";
      return;
    }

    if (mission.action === "open_billing") {
      goBillingPage();
      return;
    }

    if (mission.action === "open_invite") {
      goInvitePage();
      return;
    }

    if (mission.action === "goto_settings") {
      location.hash = "#settings";
      return;
    }

    if (mission.action === "goto_overview") {
      location.hash = "#overview";
      return;
    }

    if (mission.action === "goto_competitors") {
      location.hash = "#competitors";
      return;
    }

    if (mission.action === "goto_local") {
      location.hash = "#local-seo";
      return;
    }

    if (mission.action === "goto_tools") {
      location.hash = "#tools";
    }
  }

  async function runMission(id) {
    const mission = state.missions.find((m) => m.id === id);
    if (!mission) return false;

    if (mission.action === "run_audit") {
      const ok = await safeRunAudit();
      if (ok) await loadData({ silent: true });
      return ok;
    }

    if (mission.action === "add_monitor") {
      const ok = await safeAddMonitor();
      if (ok) await loadData({ silent: true });
      return ok;
    }

    if (mission.action === "export_audits") {
      return safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    }

    if (mission.action === "export_monitors") {
      return safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    }

    if (mission.action === "open_billing") {
      return goBillingPage();
    }

    if (mission.action === "open_invite") {
      return goInvitePage();
    }

    if (mission.action === "goto_settings") {
      location.hash = "#settings";
      setMissionDoneByAction("goto_settings", true);
      saveMissions();
      renderRoute({ scrollTop: true });
      return true;
    }

    if (mission.action === "goto_overview") {
      location.hash = "#overview";
      setMissionDoneByAction("goto_overview", true);
      saveMissions();
      return true;
    }

    if (mission.action === "goto_audits") {
      location.hash = "#audits";
      setMissionDoneByAction("goto_audits", true);
      saveMissions();
      return true;
    }

    if (mission.action === "goto_reports") {
      location.hash = "#reports";
      setMissionDoneByAction("goto_reports", true);
      saveMissions();
      return true;
    }

    if (mission.action === "goto_competitors") {
      location.hash = "#competitors";
      setMissionDoneByAction("goto_competitors", true);
      saveMissions();
      return true;
    }

    if (mission.action === "goto_local") {
      location.hash = "#local-seo";
      setMissionDoneByAction("goto_local", true);
      saveMissions();
      return true;
    }

    if (mission.action === "goto_tools") {
      location.hash = "#tools";
      setMissionDoneByAction("goto_tools", true);
      saveMissions();
      return true;
    }

    if (mission.action === "test_monitor") {
      const firstMonitor = Array.isArray(state.monitors) ? state.monitors[0] : null;
      if (!firstMonitor) {
        setStatus("Aucun monitor à tester", "danger");
        return false;
      }

      const ok = await safeTestMonitor(normalizeMonitorId(firstMonitor));
      if (ok) await loadData({ silent: true });
      return ok;
    }

    return false;
  }

  function captureFocusState() {
    const active = document.activeElement;
    if (!active || !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) {
      return null;
    }
    const id = active.id;
    if (!id) return null;
    return {
      id,
      value: active.value,
      start: active.selectionStart ?? null,
      end: active.selectionEnd ?? null,
      type: active.tagName.toLowerCase(),
    };
  }

  function restoreFocusState(snapshot) {
    if (!snapshot?.id) return;
    const el = document.getElementById(snapshot.id);
    if (!el) return;
    el.focus();
    if (typeof snapshot.start === "number" && typeof snapshot.end === "number" && typeof el.setSelectionRange === "function") {
      try {
        el.setSelectionRange(snapshot.start, snapshot.end);
      } catch {}
    }
  }

  function bindInputPreserve(selector, eventName, handler) {
    const node = $(selector);
    if (!node) return;
    node.addEventListener(eventName, (e) => {
      const snap = captureFocusState();
      handler(e);
      requestAnimationFrame(() => {
        restoreFocusState(snap);
      });
    });
  }

  function renderRoute(options = {}) {
    const {
      scrollTop = false,
      preserveScroll = false,
    } = options;

    const previousWindowY = window.scrollY || 0;
    const previousMainY = els.main?.scrollTop || 0;
    const previousPageY = els.pageContainer?.scrollTop || 0;

    setActiveNav();
    document.body.classList.toggle("fpCompactMode", !!state.uiPrefs.compactLists);

    switch (state.route) {
      case "#overview":
        renderOverviewPage();
        break;
      case "#missions":
        renderMissionsPage();
        break;
      case "#audits":
        renderAuditsPage();
        break;
      case "#monitors":
        renderMonitorsPage();
        break;
      case "#reports":
        renderReportsPage();
        break;
      case "#competitors":
        renderCompetitorsPage();
        break;
      case "#local-seo":
        renderLocalSeoPage();
        break;
      case "#tools":
        renderToolsPage();
        break;
      case "#team":
        renderTeamPage();
        break;
      case "#billing":
        renderBillingPage();
        return;
      case "#settings":
        renderSettingsPage();
        break;
      default:
        renderOverviewPage();
        break;
    }

    if (preserveScroll) {
      requestAnimationFrame(() => {
        window.scrollTo(0, previousWindowY);
        if (els.main) els.main.scrollTop = previousMainY;
        if (els.pageContainer) els.pageContainer.scrollTop = previousPageY;
      });
      return;
    }

    if (scrollTop) {
      requestAnimationFrame(() => {
        scrollPageTop();
      });
    }
  }

  async function refreshTokenIfPossible() {
    if (state.auth.refreshInFlight) return true;

    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error("No refresh token");

    state.auth.refreshInFlight = true;

    try {
      const r = await fetch(`${API_BASE}${REFRESH_ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ refreshToken }),
      });

      if (!r.ok) throw new Error("Refresh failed");

      const data = await r.json().catch(() => ({}));
      if (data?.token) setToken(data.token);
      if (data?.accessToken) setToken(data.accessToken);
      if (data?.refreshToken) setRefreshToken(data.refreshToken);

      return true;
    } finally {
      state.auth.refreshInFlight = false;
    }
  }

  async function fetchWithAuth(path, options = {}) {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const headers = new Headers(options.headers || {});
    const token = getToken();

    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const doFetch = () =>
      fetch(url, {
        ...options,
        headers,
        credentials: "include",
        signal: options.signal,
      });

    let res = await doFetch();

    if (res.status === 401) {
      try {
        const refreshed = await refreshTokenIfPossible();
        if (refreshed) {
          const newToken = getToken();
          if (newToken) headers.set("Authorization", `Bearer ${newToken}`);
          res = await doFetch();
        }
      } catch (e) {
        scheduleLoginRedirect();
        throw e;
      }
    }

    if (res.status === 429) {
      await sleep(400);
      res = await doFetch();
    }

    return res;
  }

  async function parseJsonSafe(res) {
    if (!res) return {};
    return res.json().catch(() => ({}));
  }

  function setStatus(text, mode = "ok") {
    if (!state.uiPrefs.liveStatus) {
      if (els.statusText) els.statusText.textContent = "Statut masqué";
      return;
    }

    if (els.statusText) els.statusText.textContent = text || "";
    if (!els.statusDot) return;

    els.statusDot.classList.remove("warn", "danger");
    if (mode === "warn") els.statusDot.classList.add("warn");
    if (mode === "danger") els.statusDot.classList.add("danger");
  }

  function scheduleLoginRedirect() {
    if (state.auth.redirectScheduled) return;
    state.auth.redirectScheduled = true;
    setStatus("Session expirée, reconnexion…", "warn");

    setTimeout(() => {
      clearAuth();
      window.location.replace(LOGIN_URL);
    }, 1200);
  }

  async function verifySessionOnResume(force = false) {
    if (!hasAnyToken()) return;
    if (state.auth.checkingSession) return;

    const now = Date.now();
    if (!force && now - state.auth.lastSessionCheckAt < SESSION_RECHECK_MS) return;

    state.auth.checkingSession = true;
    state.auth.lastSessionCheckAt = now;

    try {
      const r = await fetchWithAuth(ME_ENDPOINT, { method: "GET" });
      if (r.status === 401) scheduleLoginRedirect();
    } catch (e) {
      console.warn("Session check skipped:", e);
    } finally {
      state.auth.checkingSession = false;
    }
  }

  function startProactiveRefreshLoop() {
    setInterval(async () => {
      if (!hasAnyToken()) return;
      try {
        await refreshTokenIfPossible();
      } catch (e) {
        console.warn("Proactive refresh failed:", e);
      }
    }, PROACTIVE_REFRESH_MS);
  }

  function openSidebar() {
    els.sidebar?.classList.add("open");
    els.overlay?.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeSidebar() {
    els.sidebar?.classList.remove("open");
    els.overlay?.classList.remove("show");
    document.body.style.overflow = "";
  }

  function toggleExportMenu(force) {
    if (!els.exportMenu) return;
    const current = els.exportMenu.classList.contains("show");
    const next = typeof force === "boolean" ? force : !current;
    els.exportMenu.classList.toggle("show", next);
  }

  function setActiveNav() {
    const key = state.route.replace("#", "");
    els.navItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.route === key);
    });
  }

  function setPage(html) {
    if (els.pageContainer) els.pageContainer.innerHTML = html;
  }

  async function loadData({ silent = false } = {}) {
    if (state.loading) return;

    state.loading = true;
    if (!silent) setStatus("Chargement des données…", "warn");

    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    const signal = state.controller.signal;

    try {
      const [meRes, ovRes, audRes, monRes, setRes] = await Promise.all([
        fetchWithAuth("/api/me", { signal }).catch(() => null),
        fetchWithAuth(`/api/overview?days=${encodeURIComponent(state.rangeDays)}`, { signal }).catch(() => null),
        fetchWithAuth("/api/audits", { signal }).catch(() => null),
        fetchWithAuth("/api/monitors", { signal }).catch(() => null),
        fetchWithAuth("/api/org/settings", { signal }).catch(() => null),
      ]);

      if (meRes?.ok) {
        state.me = await parseJsonSafe(meRes);
      } else {
        state.me = null;
      }

      if (ovRes?.ok) {
        state.overview = await parseJsonSafe(ovRes);
      } else {
        state.overview = {
          seoScore: 0,
          chart: [],
          monitors: { active: 0, down: 0 },
        };
      }

      if (audRes?.ok) {
        const auditsData = await parseJsonSafe(audRes);
        state.audits = Array.isArray(auditsData?.audits)
          ? auditsData.audits
          : Array.isArray(auditsData)
            ? auditsData
            : [];
      } else {
        state.audits = [];
      }

      if (monRes?.ok) {
        const monitorsData = await parseJsonSafe(monRes);
        state.monitors = Array.isArray(monitorsData?.monitors)
          ? monitorsData.monitors
          : Array.isArray(monitorsData)
            ? monitorsData
            : [];
      } else {
        state.monitors = [];
      }

      if (setRes?.ok) {
        const settingsData = await parseJsonSafe(setRes);
        state.orgSettings = settingsData?.settings || settingsData || state.orgSettings;
      }

      state.lastLoadedAt = new Date().toISOString();
      refreshDailySeed();

      hydrateLogos();
      hydrateSidebarAccount();
      hydrateTopbar();
      renderRoute();
      setStatus("Dashboard prêt", "ok");
    } catch (e) {
      if (e?.name !== "AbortError") {
        console.error(e);
        setStatus("Erreur chargement dashboard", "danger");
      }
    } finally {
      state.loading = false;
    }
  }

  function bindGlobalActions() {
    document.addEventListener("click", async (e) => {
      const toggleBtn = e.target.closest("[data-mission-toggle]");
      if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleMission(toggleBtn.getAttribute("data-mission-toggle"));
        renderRoute({ preserveScroll: true });
        return;
      }

      const runBtn = e.target.closest("[data-mission-do]");
      if (runBtn) {
        e.preventDefault();
        e.stopPropagation();
        await runMission(runBtn.getAttribute("data-mission-do"));
        renderRoute({ preserveScroll: true });
        return;
      }

      const openBtn = e.target.closest("[data-mission-open]");
      if (openBtn) {
        e.preventDefault();
        e.stopPropagation();
        openMissionPage(openBtn.getAttribute("data-mission-open"));
        return;
      }

      const billingBtn = e.target.closest("[data-go-billing]");
      if (billingBtn) {
        e.preventDefault();
        e.stopPropagation();
        goBillingPage();
        return;
      }
    });
  }

  function logout() {
    clearAuth();
    window.location.replace(LOGIN_URL);
  }

  function initEvents() {
    window.addEventListener("hashchange", () => {
      state.route = ROUTES.has(location.hash) ? location.hash : "#overview";
      closeSidebar();
      renderRoute({ scrollTop: true });
    });

    window.addEventListener("resize", () => {
      if (state.route === "#overview") {
        requestAnimationFrame(drawOverviewChart);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        verifySessionOnResume();
      }
    });

    window.addEventListener("focus", () => {
      verifySessionOnResume();
    });

    els.navItems.forEach((item) => {
      item.addEventListener("click", () => {
        closeSidebar();
        if (shouldAutoScrollTop()) {
          requestAnimationFrame(scrollPageTop);
        }
      });
    });

    els.btnMenu?.addEventListener("click", openSidebar);
    els.overlay?.addEventListener("click", closeSidebar);

    els.btnRefresh?.addEventListener("click", () => loadData());

    els.rangeSelect?.addEventListener("change", () => {
      const raw = String(els.rangeSelect.value || "30");
      state.rangeDays = raw === "7" ? 7 : raw === "3" ? 3 : 30;
      loadData();
      if (shouldAutoScrollTop()) scrollPageTop();
    });

    els.btnExportToggle?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleExportMenu();
    });

    els.exportMenu?.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => toggleExportMenu(false));

    els.btnExportAudits?.addEventListener("click", async () => {
      toggleExportMenu(false);
      await safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    });

    els.btnExportMonitors?.addEventListener("click", async () => {
      toggleExportMenu(false);
      await safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    });

    els.btnOpenBillingSide?.addEventListener("click", goBillingPage);

    els.btnOpenSettingsSide?.addEventListener("click", () => {
      location.hash = "#settings";
      closeSidebar();
      if (shouldAutoScrollTop()) {
        requestAnimationFrame(scrollPageTop);
      }
    });

    els.btnOpenInviteSide?.addEventListener("click", goInvitePage);
    els.btnLogout?.addEventListener("click", logout);

    bindGlobalActions();
  }

  function init() {
    hydrateLogos();
    injectDashboardEnhancements();
    loadUiPrefs();
    refreshDailySeed();
    resetMissionsIfNeeded();
    state.missions = loadMissions();

    const existingToken = getToken();
    const existingRefresh = getRefreshToken();

    if (existingToken) setToken(existingToken);
    if (existingRefresh) setRefreshToken(existingRefresh);

    if (!ROUTES.has(location.hash)) {
      location.hash = "#overview";
      state.route = "#overview";
    } else {
      state.route = location.hash;
    }

    if (els.rangeSelect) {
      els.rangeSelect.value = String(state.rangeDays);
      if (!els.rangeSelect.value) els.rangeSelect.value = "30";
    }

    initEvents();
    startProactiveRefreshLoop();
    verifySessionOnResume(true);
    loadData();

    if (shouldAutoScrollTop()) {
      scrollPageTop();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
