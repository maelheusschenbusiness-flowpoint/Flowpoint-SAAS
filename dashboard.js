(() => {
  "use strict";

  const API_BASE = "";
  const TOKEN_KEY = "token";
  const REFRESH_TOKEN_KEY = "refreshToken";
  const REFRESH_ENDPOINT = "/api/auth/refresh";
  const ME_ENDPOINT = "/api/me";
  const LOGIN_URL = "/login.html";

  const PROACTIVE_REFRESH_INTERVAL_MS = 45000;
  const SESSION_RECHECK_MS = 15000;
  const REFRESH_SOON_BUFFER_MS = 90 * 1000;
  const REDIRECT_DELAY_MS = 4000;
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  const MISSIONS_STORAGE_KEY = "fp_dashboard_missions_v80";
  const MISSIONS_RESET_KEY = "fp_dashboard_missions_reset_v80";
  const UI_PREFS_STORAGE_KEY = "fp_dashboard_ui_prefs_v80";
  const TOOLS_STORAGE_KEY = "fp_dashboard_tools_v80";
  const NOTES_STORAGE_KEY = "fp_notes_items_v3";
  const CHAT_STORAGE_KEY = "fp_chat_messages_v3";
  const CALENDAR_STORAGE_KEY = "fp_calendar_items_v3";
  const MISSION_LIBRARY_CURSOR_KEY = "fp_dashboard_mission_cursor_v6";
  const MISSION_LIBRARY_LAST_KEY = "fp_dashboard_mission_last_v6";
  const LOGO_SRC = "/assets/flowpoint-logo.svg";

  const ROUTES = new Set([
    "#overview",
    "#missions",
    "#audits",
    "#monitors",
    "#reports",
    "#local-seo",
    "#team",
    "#billing",
    "#settings",

    "#tools",
    "#calendar",
    "#competitors",
    "#map",
    "#chat",
    "#notes",
  ]);

  const REDIRECT_ROUTES = {
    "#tools": "#overview",
    "#calendar": "#overview",
    "#competitors": "#local-seo",
    "#map": "#local-seo",
    "#chat": "#team",
    "#notes": "#team",
  };

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
    route: "#overview",
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
    toolStates: {},
    controller: null,
    loading: false,
    lastLoadedAt: null,

    dailySeed: "",
    filters: {
      audits: { q: "", status: "all", sort: "date_desc" },
      monitors: { q: "", status: "all", sort: "date_desc" },
      missions: { q: "", status: "all" },
    },

    uiPrefs: {
      themeAuto: true,
      liveStatus: true,
      compactLists: false,
      showAdvancedCards: true,
    },

    auth: {
      refreshInFlight: false,
      checkingSession: false,
      lastSessionCheckAt: 0,
      redirectScheduled: false,
      proactiveIntervalId: null,
      redirectTimeoutId: null,
    },
  };

  function getSafeRoute(hash) {
    const raw = ROUTES.has(hash) ? hash : "#overview";
    return REDIRECT_ROUTES[raw] || raw;
  }

  state.route = getSafeRoute(location.hash);

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

  function hashString(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i += 1) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
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

  function parseJsonSafe(res) {
    if (!res) return Promise.resolve({});
    return res.json().catch(() => ({}));
  }

  function getStorageJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setStorageJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
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
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch {}
  }

  function setRefreshToken(token) {
    if (!token) return;
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
    try { sessionStorage.setItem(REFRESH_TOKEN_KEY, token); } catch {}
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

  function normalizeOrgName() {
    return state.me?.org?.name || state.me?.organization?.name || "Workspace principal";
  }

  function getDayNumber() {
    const now = new Date();
    const local = new Date(now);
    if (local.getHours() < 10) local.setDate(local.getDate() - 1);
    local.setHours(10, 0, 0, 0);
    return Math.floor(local.getTime() / 86400000);
  }

  function getDaySeed(extra = "") {
    return `${getDayNumber()}__${normalizeOrgName()}__${extra}__${state.rangeDays}`;
  }

  function refreshDailySeed() {
    state.dailySeed = getDaySeed("global");
  }

  function getStableRotationOffset(seedText, length) {
    if (!length) return 0;
    const base = hashString(`${seedText}__${normalizeOrgName()}__${state.rangeDays}`);
    return Math.abs(base + getDayNumber()) % length;
  }

  function rotateLibrary(list, seedText) {
    const arr = Array.isArray(list) ? [...list] : [];
    if (!arr.length) return [];
    const offset = getStableRotationOffset(seedText, arr.length);
    return arr.slice(offset).concat(arr.slice(0, offset));
  }

  function pickLibrary(list, count, seedText) {
    return rotateLibrary(list, seedText).slice(0, count);
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

    return String(normalizeOrgName()).trim();
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

  function statusLabel(status) {
    const s = lower(status);
    if (!s) return "Statut en attente";
    if (s === "trialing") return "À l’essai";
    if (s === "active") return "Actif";
    if (s === "past_due") return "Paiement en retard";
    if (s === "canceled") return "Annulé";
    if (s === "incomplete") return "Incomplet";
    if (s === "incomplete_expired") return "Expiré";
    if (s === "unpaid") return "Impayé";
    return cap(s.replaceAll("_", " "));
  }

  function trialLabel(value) {
    const status = lower(state.me?.subscriptionStatus || state.me?.lastPaymentStatus || "");
    if (!value) return status === "trialing" ? "Essai actif" : "Essai non défini";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return status === "trialing" ? "Essai actif" : "Essai non défini";
    return d.getTime() >= Date.now() ? "Essai actif" : "Essai terminé";
  }

  function recipientsLabel(mode) {
    return lower(mode) === "owner" ? "Owner uniquement" : "Toute l’équipe";
  }

  function getUsageBucket(usage, key) {
    if (!usage || typeof usage !== "object") return null;
    if (key === "pdf") return usage.pdf || usage.pdfs || null;
    if (key === "audit") return usage.audit || usage.audits || null;
    if (key === "monitor") return usage.monitor || usage.monitors || null;
    if (key === "export") return usage.export || usage.exports || null;
    return usage[key] || null;
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

  function setStatus(text, mode = "ok") {
    if (!state.uiPrefs.liveStatus) {
      if (els.statusText) els.statusText.textContent = "Statut masqué";
      if (els.statusDot) els.statusDot.classList.remove("warn", "danger");
      return;
    }

    if (els.statusText) els.statusText.textContent = text || "Prêt";
    if (!els.statusDot) return;

    els.statusDot.classList.remove("warn", "danger");
    if (mode === "warn") els.statusDot.classList.add("warn");
    if (mode === "danger") els.statusDot.classList.add("danger");
  }

  function hydrateLogos() {
    if (els.sidebarLogo) els.sidebarLogo.src = LOGO_SRC;
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

  function goBillingPage() {
    setStatus("Ouverture de la facturation…", "warn");
    location.hash = "#billing";
    return true;
  }

  function goInvitePage() {
    setStatus("Ouverture de l’invitation…", "warn");
    window.location.href = "/invite-accept.html";
    return true;
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

  function hydrateSidebarAccount() {
    const me = state.me || {};
    const usage = me.usage || {};

    const auditsUsage = getUsageBucket(usage, "audit");
    const pdfUsage = getUsageBucket(usage, "pdf");
    const exportsUsage = getUsageBucket(usage, "export");
    const monitorsUsage = getUsageBucket(usage, "monitor");

    if (els.accPlan) els.accPlan.textContent = planLabel(me.plan);
    if (els.accOrg) els.accOrg.textContent = normalizeOrgName();
    if (els.accRole) els.accRole.textContent = cap(me.role || "owner");
    if (els.accTrial) els.accTrial.textContent = trialLabel(me.trialEndsAt);

    if (els.usageAudits) els.usageAudits.textContent = formatUsage(auditsUsage);
    if (els.usagePdf) els.usagePdf.textContent = formatUsage(pdfUsage);
    if (els.usageExports) els.usageExports.textContent = formatUsage(exportsUsage);
    if (els.usageMonitors) els.usageMonitors.textContent = formatUsage(monitorsUsage);

    setBar(els.barAudits, auditsUsage?.used, auditsUsage?.limit);
    setBar(els.barPdf, pdfUsage?.used, pdfUsage?.limit);
    setBar(els.barExports, exportsUsage?.used, exportsUsage?.limit);
    setBar(els.barMonitors, monitorsUsage?.used, monitorsUsage?.limit);
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
    const libraries = {
    feed: [
      { title: "Nouveau rapport généré", text: "Le rapport mensuel a été préparé avec la synthèse SEO, uptime et local.", time: "Il y a 12 min" },
      { title: "Alerte performance détectée", text: "Un site surveillé présente une latence inhabituelle sur mobile.", time: "Il y a 44 min" },
      { title: "Opportunité locale identifiée", text: "3 nouvelles pages géolocalisées peuvent être créées pour augmenter les leads.", time: "Aujourd’hui" },
      { title: "Nouvel export disponible", text: "Un export CSV a été préparé pour faciliter le suivi de performance.", time: "Aujourd’hui" },
      { title: "Signal concurrent détecté", text: "Un concurrent renforce ses pages services sur une zone à potentiel.", time: "Ce matin" },
      { title: "Monitor testé avec succès", text: "La couche monitoring a bien répondu et l’historique reste cohérent.", time: "Il y a 1 h" },
      { title: "Bloc local enrichi", text: "De nouvelles suggestions orientées Local SEO ont été calculées.", time: "Il y a 2 h" },
      { title: "Priorités revues", text: "La hiérarchie des actions a été recalculée sur la période choisie.", time: "Il y a 3 h" }
    ],

    overviewQuickWins: [
      { title: "Pages locales sous-exploitées", text: "Créer ou enrichir des pages géolocalisées peut rapidement améliorer la génération de leads.", tag: "Élevé", progress: 82 },
      { title: "Performance mobile", text: "Réduire la lenteur mobile peut améliorer SEO, confort utilisateur et conversion.", tag: "Priorité", progress: 71 },
      { title: "Rapports dirigeants", text: "Une version simplifiée des résultats augmente la valeur perçue côté client final.", tag: "Moyen", progress: 64 },
      { title: "Pages services trop courtes", text: "Allonger les pages commerciales principales augmente souvent la lisibilité et la conversion.", tag: "Élevé", progress: 76 },
      { title: "Signaux de confiance", text: "Ajouter des preuves, avis et éléments rassurants aide la vente et le SEO.", tag: "Impact", progress: 68 },
      { title: "CTA trop faibles", text: "Des appels à l’action plus visibles peuvent augmenter la conversion sans gros chantier.", tag: "CRO", progress: 63 }
    ],

    overviewMissionLibrary: [
      { title: "Créer un monitor critique", meta: "Monitoring", action: "add_monitor", impact: "Élevé" },
      { title: "Lancer un audit stratégique", meta: "Audits", action: "run_audit", impact: "Très élevé" },
      { title: "Configurer les alertes email", meta: "Paramètres", action: "goto_settings", impact: "Élevé" },
      { title: "Préparer un rapport client", meta: "Rapports", action: "goto_reports", impact: "Moyen" },
      { title: "Préparer un plan Local SEO", meta: "Local SEO", action: "goto_local", impact: "Élevé" },
      { title: "Tester un monitor existant", meta: "Monitoring", action: "test_monitor", impact: "Élevé" },
      { title: "Exporter les audits", meta: "Rapports", action: "export_audits", impact: "Moyen" },
      { title: "Exporter les monitors", meta: "Rapports", action: "export_monitors", impact: "Moyen" },
      { title: "Créer une mission monitoring", meta: "Monitoring", action: "create_monitor_mission", impact: "Élevé" },
      { title: "Créer une mission rapport", meta: "Rapports", action: "create_report_mission", impact: "Moyen" }
    ],

    tools: [
      {
        id: "smart_seo_audit",
        name: "Smart SEO Audit",
        tag: "Core",
        description: "Analyse technique, contenu, structure et opportunités immédiates.",
        features: ["Balises, maillage, structure", "Priorisation SEO actionnable", "Vision claire pour le client"]
      },
      {
        id: "uptime_monitoring",
        name: "Uptime Monitoring",
        tag: "Premium",
        description: "Surveillance continue du site avec logique d’alerte et historique.",
        features: ["Disponibilité et latence", "Historique des incidents", "Justification forte de la valeur"]
      },
      {
        id: "local_visibility",
        name: "Local Visibility",
        tag: "Growth",
        description: "Module dédié au SEO local, réputation et présence Maps.",
        features: ["Google Business Profile", "Pages locales ciblées", "Signaux commerciaux locaux"]
      },
      {
        id: "competitor_watch",
        name: "Competitor Watch",
        tag: "Premium",
        description: "Comparaison de visibilité et de structure face aux concurrents.",
        features: ["Écart concurrentiel lisible", "Axes d’amélioration clairs", "Meilleur argumentaire commercial"]
      },
      {
        id: "report_builder",
        name: "Report Builder",
        tag: "Client-ready",
        description: "Création de rapports clairs, vendables et faciles à partager.",
        features: ["PDF et CSV", "Résumé dirigeant", "Livrables premium"]
      },
      {
        id: "team_workspace",
        name: "Team Workspace",
        tag: "Ultra",
        description: "Gestion des membres, rôles et accès pour scaler plus facilement.",
        features: ["Accès par rôle", "Collaboration simple", "Upsell naturel"]
      }
    ],

    team: [
      { name: "Maël", role: "Owner", detail: "Accès complet au workspace, au billing et à la configuration globale." },
      { name: "SEO Manager", role: "Manager", detail: "Peut lancer des audits, exporter des rapports et gérer les missions." },
      { name: "Client Viewer", role: "Viewer", detail: "Peut consulter les rapports et la progression sans modifier les données." },
      { name: "Tech Ops", role: "Editor", detail: "Peut gérer les monitors, vérifier la stabilité et corriger les alertes." }
    ],

    competitorBenchmarks: [
      { metric: "Pages locales", ours: "6", best: "14", gap: "À développer" },
      { metric: "Vitesse mobile", ours: "72/100", best: "91/100", gap: "Élevé" },
      { metric: "Pages services", ours: "8", best: "12", gap: "Modéré" },
      { metric: "Signaux de confiance", ours: "Bon", best: "Très fort", gap: "À renforcer" }
    ],

    settingsInfoTips: [
      { title: "Thème automatique", text: "Utilise l’apparence système du navigateur. Effet surtout visuel." },
      { title: "Statut temps réel", text: "Affiche et met à jour la barre d’état du dashboard." },
      { title: "Listes compactes", text: "Réduit les espaces verticaux dans les lignes et cartes de listes." },
      { title: "Cartes avancées", text: "Affiche davantage de blocs de lecture business et analytique." }
    ]
  };

  const missionLibraries = {
    audit: [
      { title: "Traiter un audit prioritaire", meta: "Audits", impact: "Élevé", action: "goto_audits" },
      { title: "Relire les recommandations SEO", meta: "Audits", impact: "Moyen", action: "goto_audits" },
      { title: "Préparer un audit client-ready", meta: "Audits", impact: "Élevé", action: "goto_audits" }
    ],
    local: [
      { title: "Préparer un plan Local SEO", meta: "Local SEO", impact: "Élevé", action: "goto_local" },
      { title: "Lister les villes prioritaires", meta: "Local SEO", impact: "Élevé", action: "goto_local" },
      { title: "Créer une mission pages locales", meta: "Local SEO", impact: "Moyen", action: "goto_local" }
    ],
    report: [
      { title: "Préparer un rapport client", meta: "Rapports", impact: "Moyen", action: "goto_reports" },
      { title: "Sortir un livrable dirigeant", meta: "Rapports", impact: "Élevé", action: "goto_reports" }
    ],
    monitor: [
      { title: "Stabiliser la surveillance d’un monitor", meta: "Monitoring", impact: "Élevé", action: "goto_monitors" },
      { title: "Analyser un incident récent", meta: "Monitoring", impact: "Élevé", action: "goto_monitors" }
    ],
    overview: [
      { title: "Traiter un quick win du dashboard", meta: "Overview", impact: "Moyen", action: "goto_overview" },
      { title: "Relire les priorités business", meta: "Overview", impact: "Moyen", action: "goto_overview" }
    ]
  };

  function shuffleWithSeed(list, seedText) {
    const arr = [...list];
    let seed = hashString(seedText);
    for (let i = arr.length - 1; i > 0; i -= 1) {
      seed = (seed * 9301 + 49297) % 233280;
      const j = seed % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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
      ["exportsPack1000", "Exports +1000"]
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

  function hasAddon(key) {
    return !!getAddonEntries().find((a) => a.key === key && a.enabled);
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
    } catch {}
  }

  function saveUiPrefs() {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(state.uiPrefs));
  }

  function toggleUiPref(key) {
    if (!(key in state.uiPrefs)) return;
    state.uiPrefs[key] = !state.uiPrefs[key];
    saveUiPrefs();
    renderRoute({ preserveScroll: true });
  }

  function loadToolStates() {
    try {
      const raw = localStorage.getItem(TOOLS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      state.toolStates = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      state.toolStates = {};
    }
  }

  function saveToolStates() {
    localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify(state.toolStates));
  }

  function isToolActive(toolId) {
    return !!state.toolStates[toolId];
  }

  function setToolActive(toolId, value) {
    state.toolStates[toolId] = !!value;
    saveToolStates();
  }

  function getActiveToolCards() {
    return libraries.tools.filter((tool) => isToolActive(tool.id));
  }

  function getNotesItems() {
    return getStorageJson(NOTES_STORAGE_KEY, [
      {
        id: "n1",
        title: "Idées quick wins",
        text: "Créer plus de pages locales sur les zones rentables.",
        updatedAt: new Date().toISOString()
      },
      {
        id: "n2",
        title: "Suivi client",
        text: "Préparer un rapport avant / après pour mieux vendre la rétention.",
        updatedAt: new Date().toISOString()
      }
    ]);
  }

  function saveNotesItems(items) {
    setStorageJson(NOTES_STORAGE_KEY, items);
  }

  function getChatMessages() {
    return getStorageJson(CHAT_STORAGE_KEY, [
      {
        id: "c1",
        author: "System",
        text: "Canal interne simple prêt. Utilise-le pour laisser des messages rapides.",
        createdAt: new Date().toISOString()
      }
    ]);
  }

  function saveChatMessages(items) {
    setStorageJson(CHAT_STORAGE_KEY, items);
  }

  function getCalendarItems() {
    return getStorageJson(CALENDAR_STORAGE_KEY, [
      {
        id: "cal1",
        title: "Audit mensuel client",
        date: new Date().toISOString().slice(0, 10),
        type: "Audit"
      },
      {
        id: "cal2",
        title: "Revue monitors",
        date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        type: "Monitoring"
      }
    ]);
  }

  function saveCalendarItems(items) {
    setStorageJson(CALENDAR_STORAGE_KEY, items);
  }

  function addSimpleNote(title, text) {
    const items = getNotesItems();
    items.unshift({
      id: `note_${Date.now()}`,
      title: title || "Nouvelle note",
      text: text || "",
      updatedAt: new Date().toISOString()
    });
    saveNotesItems(items);
    setStatus("Note ajoutée — OK", "ok");
    return true;
  }

  function deleteSimpleNote(id) {
    const items = getNotesItems().filter((x) => x.id !== id);
    saveNotesItems(items);
    setStatus("Note supprimée — OK", "ok");
  }

  function addSimpleChatMessage(text) {
    if (!text) return false;
    const items = getChatMessages();
    items.push({
      id: `chat_${Date.now()}`,
      author: "Vous",
      text,
      createdAt: new Date().toISOString()
    });
    saveChatMessages(items);
    setStatus("Message envoyé — OK", "ok");
    return true;
  }

  function addSimpleCalendarItem(title, date, type = "Tâche") {
    if (!title || !date) return false;
    const items = getCalendarItems();
    items.unshift({
      id: `cal_${Date.now()}`,
      title,
      date,
      type
    });
    saveCalendarItems(items);
    setStatus("Événement ajouté — OK", "ok");
    return true;
  }

  function deleteSimpleCalendarItem(id) {
    const items = getCalendarItems().filter((x) => x.id !== id);
    saveCalendarItems(items);
    setStatus("Événement supprimé — OK", "ok");
  }

  function getMapTargets() {
    return pickLibrary(
      [
        { name: "Concurrent Alpha", city: "Liège", rating: "4.6", reviews: "124 avis", site: "alpha-example.be", tag: "Fort" },
        { name: "Concurrent Beta", city: "Verviers", rating: "4.2", reviews: "67 avis", site: "beta-example.be", tag: "Moyen" },
        { name: "Concurrent Gamma", city: "Spa", rating: "4.8", reviews: "211 avis", site: "gamma-example.be", tag: "Très fort" },
        { name: "Concurrent Delta", city: "Bruxelles", rating: "4.1", reviews: "52 avis", site: "delta-example.be", tag: "À surveiller" }
      ],
      4,
      getDaySeed("map_targets")
    );
  }
// =========================================================
// FLOWPOINT — PERSONALIZED MISSION ENGINE
// =========================================================

const MISSION_ENGINE_VERSION = "v1";
const SITE_PROFILE_CACHE_KEY = "fp_site_profile_cache_v1";

const MISSION_PRIORITY = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function normalizeUrlInput(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function getPrimarySiteUrl() {
  const auditUrl = state.audits?.[0]?.url || "";
  const monitorUrl = state.monitors?.[0]?.url || "";
  return normalizeUrlInput(auditUrl || monitorUrl || "");
}

function getSiteProfileCache() {
  return getStorageJson(SITE_PROFILE_CACHE_KEY, {});
}

function saveSiteProfileCache(cache) {
  setStorageJson(SITE_PROFILE_CACHE_KEY, cache);
}

function getCachedSiteProfile(url) {
  if (!url) return null;
  const cache = getSiteProfileCache();
  return cache[url] || null;
}

function setCachedSiteProfile(url, profile) {
  if (!url || !profile) return;
  const cache = getSiteProfileCache();
  cache[url] = {
    ...profile,
    cachedAt: new Date().toISOString(),
    version: MISSION_ENGINE_VERSION
  };
  saveSiteProfileCache(cache);
}

function slugToText(slug = "") {
  return String(slug || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/[-_]/g, " ")
    .trim();
}

function extractDomainParts(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      pathname: u.pathname || "/",
      origin: u.origin
    };
  } catch {
    return {
      host: "",
      pathname: "/",
      origin: ""
    };
  }
}

function inferBusinessType(url = "") {
  const host = lower(extractDomainParts(url).host);
  if (!host) return "generic";
  if (host.includes("plomb") || host.includes("chauff")) return "local_services";
  if (host.includes("garage") || host.includes("auto")) return "automotive";
  if (host.includes("resto") || host.includes("pizza") || host.includes("snack")) return "restaurant";
  if (host.includes("shop") || host.includes("store") || host.includes("boutique")) return "ecommerce";
  if (host.includes("app") || host.includes("saas") || host.includes("crm")) return "saas";
  return "generic";
}

function inferPagesFromData() {
  const pages = new Set();

  state.audits.forEach((audit) => {
    if (audit?.url) {
      try {
        const u = new URL(normalizeUrlInput(audit.url));
        pages.add(u.pathname || "/");
      } catch {}
    }
  });

  state.monitors.forEach((monitor) => {
    if (monitor?.url) {
      try {
        const u = new URL(normalizeUrlInput(monitor.url));
        pages.add(u.pathname || "/");
      } catch {}
    }
  });

  if (!pages.size) pages.add("/");

  return Array.from(pages);
}

function buildSiteProfileFromCurrentData(url) {
  const normalized = normalizeUrlInput(url || getPrimarySiteUrl());
  const parts = extractDomainParts(normalized);
  const pages = inferPagesFromData();

  const hasContactPage = pages.some((p) => /^\/contact/.test(lower(p)));
  const hasLocalPages = pages.some((p) => {
    const txt = lower(p);
    return txt.includes("ville") || txt.includes("liege") || txt.includes("verviers") || txt.includes("bruxelles") || txt.includes("local");
  });

  const lowScoreAudits = state.audits.filter((a) => Number(a.score || 0) < 50);
  const mediumScoreAudits = state.audits.filter((a) => {
    const s = Number(a.score || 0);
    return s >= 50 && s < 75;
  });

  const missingMetaSignals = state.audits.filter((a) => {
    const txt = lower(`${a.summary || ""} ${(a.recommendations || []).join(" ")}`);
    return txt.includes("meta") || txt.includes("description") || txt.includes("title");
  });

  const speedSignals = state.audits.filter((a) => {
    const txt = lower(`${a.summary || ""} ${(a.recommendations || []).join(" ")}`);
    return txt.includes("mobile") || txt.includes("vitesse") || txt.includes("speed") || txt.includes("performance");
  });

  const headingSignals = state.audits.filter((a) => {
    const txt = lower(`${a.summary || ""} ${(a.recommendations || []).join(" ")}`);
    return txt.includes("h1") || txt.includes("heading") || txt.includes("balise");
  });

  const hasDownMonitors = state.monitors.some((m) => normalizeMonitorStatus(m) === "down");
  const hasNoMonitors = !state.monitors.length;
  const criticalMonitorUrls = state.monitors
    .filter((m) => normalizeMonitorStatus(m) === "down")
    .map((m) => m.url)
    .filter(Boolean)
    .slice(0, 6);

  return {
    siteUrl: normalized,
    origin: parts.origin,
    host: parts.host,
    businessType: inferBusinessType(normalized),
    pages,
    hasContactPage,
    hasLocalPages,
    hasNoMonitors,
    hasDownMonitors,
    criticalMonitorUrls,
    lowScorePages: lowScoreAudits.map((a) => a.url).filter(Boolean).slice(0, 12),
    mediumScorePages: mediumScoreAudits.map((a) => a.url).filter(Boolean).slice(0, 12),
    missingMetaPages: missingMetaSignals.map((a) => a.url).filter(Boolean).slice(0, 12),
    speedPages: speedSignals.map((a) => a.url).filter(Boolean).slice(0, 12),
    headingPages: headingSignals.map((a) => a.url).filter(Boolean).slice(0, 12),
    generatedAt: new Date().toISOString()
  };
}

function getCurrentSiteProfile() {
  const url = getPrimarySiteUrl();
  const cached = getCachedSiteProfile(url);
  if (cached?.version === MISSION_ENGINE_VERSION) return cached;

  const profile = buildSiteProfileFromCurrentData(url);
  if (url) setCachedSiteProfile(url, profile);
  return profile;
}

function createMissionTemplate({
  key,
  title,
  description,
  category,
  priority = "medium",
  difficulty = "medium",
  plans = ["standard", "pro", "ultra"],
  source = "system",
  tags = [],
  action = "goto_missions",
  conditions = [],
  build = null
}) {
  return {
    key,
    title,
    description,
    category,
    priority,
    difficulty,
    plans,
    source,
    tags,
    action,
    conditions,
    build
  };
}

function allowPlanForMission(template) {
  const plan = lower(state.me?.plan || "standard");
  return (template.plans || []).includes(plan);
}

function buildMissionId(prefix = "pm") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function missionImpactFromPriority(priority) {
  if (priority === "critical") return "Critique";
  if (priority === "high") return "Élevé";
  if (priority === "medium") return "Moyen";
  return "Faible";
}

function missionMetaFromCategory(category, source) {
  const map = {
    seo: "SEO technique",
    content: "Contenu",
    local: "Local SEO",
    monitor: "Monitoring",
    conversion: "Conversion",
    reporting: "Rapports",
    trust: "Confiance",
    ops: "FlowPoint"
  };
  return `${map[category] || "Général"} · ${cap(source || "system")}`;
}

function makePersonalizedMission(template, overrides = {}) {
  const priority = overrides.priority || template.priority || "medium";

  return {
    id: buildMissionId(template.key || "mission"),
    title: overrides.title || template.title,
    description: overrides.description || template.description || "",
    meta: overrides.meta || missionMetaFromCategory(overrides.category || template.category, overrides.source || template.source),
    done: false,
    action: overrides.action || template.action || "goto_missions",
    impact: missionImpactFromPriority(priority),
    category: overrides.category || template.category || "ops",
    priority,
    difficulty: overrides.difficulty || template.difficulty || "medium",
    source: overrides.source || template.source || "system",
    dueLabel: overrides.dueLabel || null,
    tags: overrides.tags || template.tags || [],
    personalized: true,
    siteUrl: overrides.siteUrl || getPrimarySiteUrl() || ""
  };
}

// =========================================================
// MASSIVE LIBRARY — CORE TEMPLATES
// =========================================================

const MASSIVE_MISSION_LIBRARY = [
  createMissionTemplate({
    key: "monitor_homepage",
    title: "Créer un monitor pour la page d’accueil",
    description: "La homepage doit être surveillée car elle porte l’essentiel de la visibilité et de la conversion.",
    category: "monitor",
    priority: "high",
    difficulty: "low",
    source: "monitor",
    action: "add_monitor",
    tags: ["homepage", "uptime", "critical"],
    conditions: ["no_monitors"]
  }),

  createMissionTemplate({
    key: "fix_down_monitor",
    title: "Traiter un monitor DOWN",
    description: "Une page critique surveillée est en échec et doit être vérifiée rapidement.",
    category: "monitor",
    priority: "critical",
    difficulty: "medium",
    source: "monitor",
    action: "goto_monitors",
    tags: ["down", "incident", "urgent"],
    conditions: ["has_down_monitors"]
  }),

  createMissionTemplate({
    key: "add_meta_description",
    title: "Ajouter une meta description manquante",
    description: "Une page importante manque de meta description exploitable.",
    category: "seo",
    priority: "high",
    difficulty: "low",
    source: "audit",
    action: "goto_audits",
    tags: ["meta", "quick-win", "seo"],
    conditions: ["missing_meta_pages"]
  }),

  createMissionTemplate({
    key: "improve_mobile_speed",
    title: "Améliorer la vitesse mobile d’une page clé",
    description: "Une page montre des signaux de performance insuffisants côté mobile.",
    category: "seo",
    priority: "high",
    difficulty: "medium",
    source: "audit",
    action: "goto_audits",
    tags: ["speed", "mobile", "performance"],
    conditions: ["speed_pages"]
  }),

  createMissionTemplate({
    key: "fix_heading_structure",
    title: "Corriger la structure H1 / headings",
    description: "La hiérarchie de titres d’une page semble faible ou incohérente.",
    category: "content",
    priority: "medium",
    difficulty: "low",
    source: "audit",
    action: "goto_audits",
    tags: ["h1", "content", "seo"],
    conditions: ["heading_pages"]
  }),

  createMissionTemplate({
    key: "create_contact_page",
    title: "Créer ou renforcer la page contact",
    description: "Le site manque d’une page contact claire ou suffisamment visible.",
    category: "conversion",
    priority: "high",
    difficulty: "medium",
    source: "system",
    action: "goto_missions",
    tags: ["contact", "conversion", "trust"],
    conditions: ["missing_contact_page"]
  }),

  createMissionTemplate({
    key: "create_local_pages",
    title: "Créer des pages locales ciblées",
    description: "Le site semble manquer de couverture locale claire sur les zones importantes.",
    category: "local",
    priority: "high",
    difficulty: "medium",
    plans: ["pro", "ultra"],
    source: "local",
    action: "goto_local",
    tags: ["local", "city-pages", "seo"],
    conditions: ["missing_local_pages"]
  }),

  createMissionTemplate({
    key: "add_trust_signals",
    title: "Ajouter plus de preuves de confiance",
    description: "Le site gagnerait à afficher davantage d’avis, garanties ou preuves visibles.",
    category: "trust",
    priority: "medium",
    difficulty: "low",
    plans: ["pro", "ultra"],
    source: "system",
    action: "goto_missions",
    tags: ["trust", "conversion", "reviews"],
    conditions: ["generic"]
  }),

  createMissionTemplate({
    key: "generate_report_client",
    title: "Préparer un rapport client",
    description: "Un livrable clair permet de mieux vendre la valeur du travail effectué.",
    category: "reporting",
    priority: "medium",
    difficulty: "low",
    source: "report",
    action: "goto_reports",
    tags: ["report", "client", "value"],
    conditions: ["generic"]
  }),

  createMissionTemplate({
    key: "create_audit_pack",
    title: "Transformer les audits faibles en plan d’action",
    description: "Les audits faibles doivent être regroupés en actions concrètes prioritaires.",
    category: "ops",
    priority: "high",
    difficulty: "medium",
    plans: ["ultra"],
    source: "audit",
    action: "create_audit_mission",
    tags: ["pack", "audit", "strategy"],
    conditions: ["low_score_pages"]
  })
];

// =========================================================
// TEMPLATE EXPANDERS — POUR ARRIVER À 100+ MISSIONS
// =========================================================

const LOCAL_CITY_CANDIDATES = [
  "Liège", "Verviers", "Bruxelles", "Namur", "Charleroi",
  "Spa", "Herve", "Seraing", "Waremme", "Huy"
];

const SERVICE_KEYWORDS = [
  "contact", "services", "prix", "devis", "about", "faq",
  "booking", "reservation", "rendez-vous", "home", "accueil"
];

function expandPageBasedTemplates(profile) {
  const missions = [];
  const uniquePages = Array.from(new Set([
    ...profile.lowScorePages,
    ...profile.missingMetaPages,
    ...profile.speedPages,
    ...profile.headingPages,
    ...profile.pages
  ])).slice(0, 20);

  uniquePages.forEach((pageUrl, index) => {
    const path = (() => {
      try {
        return new URL(normalizeUrlInput(pageUrl), profile.origin || undefined).pathname || "/";
      } catch {
        return pageUrl || "/";
      }
    })();

    const label = path === "/" ? "la homepage" : `la page ${path}`;

    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[2], {
        title: `Ajouter une meta description sur ${label}`,
        description: `${label} semble manquer d’une meta description claire et exploitable.`,
        siteUrl: profile.siteUrl,
        dueLabel: index < 3 ? "Priorité semaine" : null
      })
    );

    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[3], {
        title: `Améliorer la vitesse de ${label}`,
        description: `${label} montre des signaux de performance à retravailler, surtout côté mobile.`,
        siteUrl: profile.siteUrl
      })
    );

    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[4], {
        title: `Revoir la structure H1 / headings de ${label}`,
        description: `${label} gagnerait à avoir une hiérarchie de titres plus claire et plus forte pour le SEO.`,
        siteUrl: profile.siteUrl
      })
    );
  });

  return missions;
}

function expandLocalTemplates(profile) {
  if (profile.hasLocalPages) return [];

  return LOCAL_CITY_CANDIDATES.map((city, index) =>
    makePersonalizedMission(MASSIVE_MISSION_LIBRARY[6], {
      title: `Créer une page locale ciblée sur ${city}`,
      description: `Le site ${profile.host || ""} gagnerait à couvrir ${city} avec une page locale claire et orientée conversion.`,
      category: "local",
      source: "local",
      priority: index < 3 ? "high" : "medium",
      action: "goto_local",
      siteUrl: profile.siteUrl,
      dueLabel: index < 3 ? "Ville prioritaire" : null
    })
  );
}

function expandMonitorTemplates(profile) {
  const missions = [];

  if (profile.hasNoMonitors) {
    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[0], {
        siteUrl: profile.siteUrl,
        dueLabel: "À mettre en place"
      })
    );

    SERVICE_KEYWORDS.slice(0, 5).forEach((keyword) => {
      missions.push(makePersonalizedMission(MASSIVE_MISSION_LIBRARY[0], {
        title: `Créer un monitor pour la page ${keyword}`,
        description: `La page ${keyword} doit être surveillée car elle peut être critique pour les leads ou la conversion.`,
        siteUrl: profile.siteUrl,
        action: "add_monitor",
        priority: keyword === "contact" ? "critical" : "high"
      }));
    });
  }

  profile.criticalMonitorUrls.forEach((url) => {
    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[1], {
        title: `Traiter l’incident monitor sur ${url}`,
        description: `Le monitor associé à ${url} est actuellement DOWN ou instable.`,
        siteUrl: profile.siteUrl,
        action: "goto_monitors",
        priority: "critical",
        dueLabel: "Urgent"
      })
    );
  });

  return missions;
}

function expandTrustAndConversionTemplates(profile) {
  const businessType = profile.businessType;
  const missions = [];

  missions.push(
    makePersonalizedMission(MASSIVE_MISSION_LIBRARY[7], {
      title: `Ajouter des preuves de confiance sur ${profile.host || "le site"}`,
      description: `Le site gagnerait à afficher plus d’avis, garanties ou éléments rassurants visibles rapidement.`,
      category: "trust",
      source: "system",
      siteUrl: profile.siteUrl
    })
  );

  if (!profile.hasContactPage) {
    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[5], {
        title: "Créer une vraie page contact orientée conversion",
        description: "Le site ne semble pas assez clair sur la prise de contact ou la demande de devis.",
        siteUrl: profile.siteUrl,
        dueLabel: "Important"
      })
    );
  }

  if (businessType === "restaurant") {
    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[7], {
        title: "Ajouter un bouton Réserver visible sur mobile",
        description: "Le site d’un restaurant doit pousser la réservation ou l’appel dès le haut de page.",
        category: "conversion",
        source: "system",
        siteUrl: profile.siteUrl,
        priority: "high"
      })
    );
  }

  if (businessType === "saas") {
    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[7], {
        title: "Renforcer les CTA produit sur la homepage",
        description: "Un SaaS doit afficher plus clairement son action principale : essai, démo ou inscription.",
        category: "conversion",
        source: "system",
        siteUrl: profile.siteUrl,
        priority: "high"
      })
    );
  }

  if (businessType === "automotive" || businessType === "local_services") {
    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[7], {
        title: "Ajouter un numéro cliquable et visible sur mobile",
        description: "Pour une activité locale ou automotive, l’appel doit être immédiat sur mobile.",
        category: "conversion",
        source: "system",
        siteUrl: profile.siteUrl,
        priority: "high"
      })
    );
  }

  return missions;
}

function expandReportingAndOpsTemplates(profile) {
  const missions = [
    makePersonalizedMission(MASSIVE_MISSION_LIBRARY[8], {
      title: `Préparer un rapport client pour ${profile.host || "ce site"}`,
      description: "Un livrable lisible aide à mieux vendre la valeur produite et les prochaines actions.",
      siteUrl: profile.siteUrl
    })
  ];

  if (hasPlan("ultra")) {
    missions.push(
      makePersonalizedMission(MASSIVE_MISSION_LIBRARY[9], {
        title: "Créer un pack de missions SEO prioritaire",
        description: "Regrouper les pages faibles en vrai plan d’action lisible pour l’équipe ou le client.",
        siteUrl: profile.siteUrl,
        dueLabel: "Mode Ultra"
      })
    );
  }

  return missions;
}

function dedupePersonalizedMissions(list) {
  const map = new Map();
  list.forEach((item) => {
    const key = lower(`${item.title}__${item.siteUrl || ""}`);
    if (!map.has(key)) map.set(key, item);
  });
  return Array.from(map.values());
}

function sortPersonalizedMissions(list) {
  return [...list].sort((a, b) => {
    const prioDiff = (MISSION_PRIORITY[b.priority] || 0) - (MISSION_PRIORITY[a.priority] || 0);
    if (prioDiff !== 0) return prioDiff;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function generatePersonalizedMissionLibrary() {
  const profile = getCurrentSiteProfile();

  let missions = [];
  missions = missions.concat(expandPageBasedTemplates(profile));
  missions = missions.concat(expandLocalTemplates(profile));
  missions = missions.concat(expandMonitorTemplates(profile));
  missions = missions.concat(expandTrustAndConversionTemplates(profile));
  missions = missions.concat(expandReportingAndOpsTemplates(profile));

  const deduped = dedupePersonalizedMissions(missions);
  const filteredByPlan = deduped.filter((m) => {
    if (!m) return false;
    if (hasPlan("ultra")) return true;
    if (hasPlan("pro")) return m.priority !== "critical" || m.category !== "ops" || true;
    return !["reporting"].includes(m.category) || true;
  });

  return sortPersonalizedMissions(filteredByPlan);
}
  function getDefaultMissions() {
  const personalized = generatePersonalizedMissionLibrary();

  if (personalized.length) {
    return personalized.slice(0, hasPlan("ultra") ? 120 : hasPlan("pro") ? 80 : 40);
  }

  const pool = Array.isArray(libraries.overviewMissionLibrary)
    ? libraries.overviewMissionLibrary
    : [];

  if (!pool.length) {
    return [
      { id: "m1", title: "Créer ton premier monitor", meta: "Monitoring", done: false, action: "add_monitor", impact: "Élevé" },
      { id: "m2", title: "Lancer un audit SEO", meta: "Audits", done: false, action: "run_audit", impact: "Très élevé" },
      { id: "m3", title: "Exporter les audits CSV", meta: "Rapports", done: false, action: "export_audits", impact: "Moyen" },
      { id: "m4", title: "Exporter les monitors CSV", meta: "Rapports", done: false, action: "export_monitors", impact: "Moyen" }
    ];
  }

  return pool.map((item, index) => ({
    id: `m${index + 1}`,
    title: item.title,
    meta: item.meta,
    done: false,
    action: item.action,
    impact: item.impact || "Moyen"
  }));
}
function getCurrentMissionPoolLabel() {
  const profile = getCurrentSiteProfile();
  if (!profile?.siteUrl) return "Bibliothèque standard";
  return `Bibliothèque personnalisée · ${profile.host || profile.siteUrl}`;
}
  function loadMissions() {
    try {
      const raw = localStorage.getItem(MISSIONS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
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

  function addMissionFromTemplate(title, meta, impact, action = "goto_overview") {
    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    state.missions.unshift({
      id,
      title,
      meta,
      done: false,
      action,
      impact
    });
    saveMissions();
    setStatus("Mission ajoutée — OK", "ok");
  }

  function getMissionLibraryCursors() {
    return getStorageJson(MISSION_LIBRARY_CURSOR_KEY, {});
  }

  function saveMissionLibraryCursors(cursors) {
    setStorageJson(MISSION_LIBRARY_CURSOR_KEY, cursors);
  }

  function getMissionLastMap() {
    return getStorageJson(MISSION_LIBRARY_LAST_KEY, {});
  }

  function saveMissionLastMap(map) {
    setStorageJson(MISSION_LIBRARY_LAST_KEY, map);
  }

  function addMissionFromCategory(category) {
    const library = missionLibraries[category] || [];
    if (!library.length) return false;

    const cursors = getMissionLibraryCursors();
    const lastMap = getMissionLastMap();

    const currentIndex = Number(cursors[category] || 0);
    const lastTitle = String(lastMap[category] || "");

    const shuffled = shuffleWithSeed(
      library,
      `${category}__${normalizeOrgName()}__${state.rangeDays}__${getDayNumber()}__${state.missions.length}`
    );

    const rotated = shuffled.slice(currentIndex).concat(shuffled.slice(0, currentIndex));

    const picked =
      rotated.find((item) => item.title !== lastTitle && !state.missions.some((m) => !m.done && m.title === item.title)) ||
      rotated.find((item) => item.title !== lastTitle) ||
      rotated[0];

    if (!picked) return false;

    addMissionFromTemplate(picked.title, picked.meta, picked.impact, picked.action);

    const pickedIndex = shuffled.findIndex((item) => item.title === picked.title);
    cursors[category] = pickedIndex >= 0 ? (pickedIndex + 1) % shuffled.length : (currentIndex + 1) % shuffled.length;
    lastMap[category] = picked.title;

    saveMissionLibraryCursors(cursors);
    saveMissionLastMap(lastMap);

    return true;
  }

  function handleMissionCategoryAction(action) {
    if (action === "create_audit_mission") return addMissionFromCategory("audit");
    if (action === "create_local_mission") return addMissionFromCategory("local");
    if (action === "create_report_mission") return addMissionFromCategory("report");
    if (action === "create_monitor_mission") return addMissionFromCategory("monitor");
    if (action === "create_overview_mission") return addMissionFromCategory("overview");
    return false;
  }

  function findMissionById(id) {
    return state.missions.find((m) => m.id === id) || null;
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

  function normalizeMonitorStatus(monitor) {
    const s = lower(monitor?.lastStatus || monitor?.status || monitor?.state || "unknown");
    if (s === "inactive" || s === "paused" || s === "disabled") return "unknown";
    return s;
  }

  function normalizeMonitorId(monitor) {
    return monitor?._id || monitor?.id || "";
  }

  function normalizeAuditId(audit) {
    return audit?._id || audit?.id || "";
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

  function parseJwt(token) {
    try {
      const payload = token.split(".")[1];
      if (!payload) return null;
      return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return null;
    }
  }

  function getTokenExpMs(token) {
    const parsed = parseJwt(token);
    if (!parsed?.exp) return 0;
    return Number(parsed.exp) * 1000;
  }

  function shouldRefreshSoon(token, bufferMs = REFRESH_SOON_BUFFER_MS) {
    if (!token) return false;
    const expMs = getTokenExpMs(token);
    if (!expMs) return true;
    return (expMs - Date.now()) <= bufferMs;
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
      const nextAccessToken = data?.token || data?.accessToken || "";
      const nextRefreshToken = data?.refreshToken || "";

      if (!nextAccessToken) throw new Error("Missing access token after refresh");

      setToken(nextAccessToken);
      if (nextRefreshToken) setRefreshToken(nextRefreshToken);

      state.auth.redirectScheduled = false;
      if (state.auth.redirectTimeoutId) {
        clearTimeout(state.auth.redirectTimeoutId);
        state.auth.redirectTimeoutId = null;
      }

      return true;
    } finally {
      state.auth.refreshInFlight = false;
    }
  }

  async function fetchWithAuth(path, options = {}) {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const headers = new Headers(options.headers || {});
    const initialToken = getToken();

    if (initialToken) headers.set("Authorization", `Bearer ${initialToken}`);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

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
          const nextToken = getToken();
          if (nextToken) headers.set("Authorization", `Bearer ${nextToken}`);
          else headers.delete("Authorization");
          res = await doFetch();
        }
      } catch (err) {
        console.warn("Refresh failed:", err);
      }
    }

    if (res.status === 401) {
      const isAuthRoute =
        url.includes("/api/auth/refresh") ||
        url.includes("/api/auth/login") ||
        url.includes("/api/auth/register");

      if (!isAuthRoute) scheduleLoginRedirect();
    }

    if (res.status === 429) {
      await sleep(400);
      res = await doFetch();
    }

    return res;
  }

  function scheduleLoginRedirect(delay = REDIRECT_DELAY_MS) {
    if (state.auth.redirectScheduled) return;

    state.auth.redirectScheduled = true;
    setStatus("Session expirée, tentative de reconnexion…", "warn");

    state.auth.redirectTimeoutId = setTimeout(async () => {
      try {
        if (!hasAnyToken()) {
          clearAuth();
          window.location.replace(LOGIN_URL);
          return;
        }

        const ok = await refreshTokenIfPossible();
        if (ok) {
          state.auth.redirectScheduled = false;
          state.auth.redirectTimeoutId = null;
          setStatus("Session rétablie", "ok");
          return;
        }
      } catch (e) {
        console.warn("Final refresh before redirect failed:", e);
      }

      clearAuth();
      window.location.replace(LOGIN_URL);
    }, delay);
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
      if (r.status === 401) {
        try {
          await refreshTokenIfPossible();
          state.auth.redirectScheduled = false;
          setStatus("Session rétablie", "ok");
        } catch (e) {
          console.warn("Session resume refresh failed:", e);
          scheduleLoginRedirect(2200);
        }
      }
    } catch (e) {
      console.warn("Session check skipped:", e);
    } finally {
      state.auth.checkingSession = false;
    }
  }

  function startProactiveRefreshLoop() {
    if (state.auth.proactiveIntervalId) clearInterval(state.auth.proactiveIntervalId);

    state.auth.proactiveIntervalId = setInterval(async () => {
      if (!hasAnyToken()) return;
      if (document.visibilityState !== "visible") return;

      const token = getToken();
      if (!shouldRefreshSoon(token)) return;

      try {
        await refreshTokenIfPossible();
        state.auth.redirectScheduled = false;
      } catch (e) {
        console.warn("Proactive refresh failed:", e);
      }
    }, PROACTIVE_REFRESH_INTERVAL_MS);
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
      <div class="fpInlineLinks fpInlineLinksFramed">
        ${valid.map((item) => `<a href="${esc(item.href)}">${esc(item.label)}</a>`).join("")}
      </div>
    `;
  }

  function createToolbar({
    searchId,
    searchPlaceholder,
    searchValue,
    statusId,
    statusValue,
    sortId,
    sortValue,
    statuses = [],
    sorts = []
  }) {
    return `
      <div class="fpTopActionsRow fpToolbarRow" style="margin-top:14px">
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

  function renderToolStateList(items) {
    if (!items.length) return createEmpty("Aucun module activé pour le moment.");
    return `
      <div class="fpToolStateRow">
        ${items.map((tool) => `
          <div class="fpToolStateItem">
            <div>
              <div class="fpRowTitle">${esc(tool.name)}</div>
              <div class="fpToolStateMeta">${esc(tool.description)}</div>
            </div>
            <div class="fpAddonPill on">ACTIVÉ</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function createActionGrid(items = []) {
    if (!items.length) return "";
    return `
      <div class="fpReportsGrid">
        ${items.map((item) => `
          <div class="fpReportCard">
            ${item.tag ? `<div class="fpAddonPill on">${esc(item.tag)}</div>` : ""}
            <div class="fpReportTitle" style="margin-top:${item.tag ? "14px" : "0"}">${esc(item.title)}</div>
            <div class="fpReportMeta">${esc(item.text || "")}</div>
            <div class="fpDetailActions">
              ${
                item.href
                  ? `<a class="fpBtn ${esc(item.btnClass || "fpBtnPrimary")}" href="${esc(item.href)}">${esc(item.cta || "Ouvrir")}</a>`
                  : `<button class="fpBtn ${esc(item.btnClass || "fpBtnPrimary")}" type="button" data-quick-action="${esc(item.action || "")}" ${item.payload ? `data-quick-payload="${esc(item.payload)}"` : ""}>${esc(item.cta || "Lancer")}</button>`
              }
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function createMiniRows(items = []) {
    if (!items.length) return createEmpty("Aucune donnée disponible.");
    return `
      <div class="fpRows">
        ${items.map((item) => `
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">${esc(item.title || "Bloc")}</div>
              <div class="fpRowMeta">${esc(item.text || "")}</div>
            </div>
            ${
              item.badge
                ? `<div class="fpRowRight"><div class="fpAddonPill on">${esc(item.badge)}</div></div>`
                : ""
            }
          </div>
        `).join("")}
      </div>
    `;
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
    function goBillingPage() {
    setStatus("Ouverture de la facturation…", "warn");
    location.hash = "#billing";
    return true;
  }

  function goInvitePage() {
    setStatus("Ouverture de l’invitation…", "warn");
    window.location.href = "/invite-accept.html";
    return true;
  }

  function openMissionTarget(mission) {
    if (!mission) return false;

    const action = mission.action;

    if (action === "goto_overview") { location.hash = "#overview"; return true; }
    if (action === "goto_audits") { location.hash = "#audits"; return true; }
    if (action === "goto_monitors") { location.hash = "#monitors"; return true; }
    if (action === "goto_reports") { location.hash = "#reports"; return true; }
    if (action === "goto_local") { location.hash = "#local-seo"; return true; }
    if (action === "goto_team") { location.hash = "#team"; return true; }
    if (action === "goto_settings") { location.hash = "#settings"; return true; }
    if (action === "goto_missions") { location.hash = "#missions"; return true; }
    if (action === "open_billing") return goBillingPage();
    if (action === "open_invite") return goInvitePage();

    if (action === "scroll_quick_wins") {
      if (state.route !== "#overview") {
        location.hash = "#overview";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            $("#fpQuickWinsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        });
      } else {
        $("#fpQuickWinsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return true;
    }

    return false;
  }

  function getOverviewFeed() {
    const dynamic = [];
    const audits = Array.isArray(state.audits) ? state.audits : [];
    const monitors = Array.isArray(state.monitors) ? state.monitors : [];

    if (audits[0]) {
      dynamic.push({
        title: "Dernier audit chargé",
        text: `${audits[0].url || "Audit SEO"} · score ${audits[0].score ?? 0}`,
        time: audits[0].createdAt ? formatShortDate(audits[0].createdAt) : "Récent"
      });
    }

    if (monitors[0]) {
      dynamic.push({
        title: "Dernier monitor observé",
        text: `${monitors[0].url || "Monitor"} · ${normalizeMonitorStatus(monitors[0]).toUpperCase()}`,
        time: monitors[0].lastCheckedAt ? formatShortDate(monitors[0].lastCheckedAt) : "Récent"
      });
    }

    const rotated = pickLibrary(
      libraries.feed,
      6,
      getDaySeed(`feed_${state.rangeDays}_${state.lastLoadedAt || ""}`)
    );

    return [...dynamic, ...rotated].slice(0, 6);
  }

  function getOverviewQuickWins() {
    return pickLibrary(libraries.overviewQuickWins, 3, getDaySeed(`qw_${state.rangeDays}`));
  }

  function getAuditPriorityCards() {
    return pickLibrary(
      [
        { title: "Optimisation de structure", text: "Améliorer la hiérarchie des pages et le maillage peut débloquer de meilleurs signaux SEO.", tag: "SEO" },
        { title: "Contenu local", text: "Les pages locales ciblées donnent souvent un bon levier rapide sur des requêtes commerciales.", tag: "Local" },
        { title: "Expérience mobile", text: "La vitesse et la lisibilité mobile renforcent SEO, confiance et conversion.", tag: "UX" },
        { title: "Pages services premium", text: "Renforcer les pages d’offre améliore le potentiel business du trafic acquis.", tag: "Business" }
      ],
      3,
      getDaySeed(`audit_axes_${state.rangeDays}`)
    );
  }

  function getReportFormatCards() {
    return pickLibrary(
      [
        { title: "PDF client-ready", text: "Idéal pour les livrables premium, les bilans mensuels et la présentation.", tag: "PDF" },
        { title: "CSV opérationnel", text: "Utile pour les traitements internes, le pilotage et les exports massifs.", tag: "CSV" },
        { title: "Résumé direction", text: "Version simple et vendeuse pour dirigeants non techniques.", tag: "Exec" },
        { title: "Version comparative", text: "Très utile pour montrer le avant / après et renforcer la rétention.", tag: "Delta" }
      ],
      3,
      getDaySeed(`report_formats_${state.rangeDays}`)
    );
  }

  function getLocalAxisCards() {
    return pickLibrary(
      [
        { title: "Optimiser Google Business Profile", text: "Amélioration concrète pour renforcer la visibilité locale et la confiance utilisateur." },
        { title: "Uniformiser nom / adresse / téléphone", text: "Réduit les signaux contradictoires et renforce la cohérence locale." },
        { title: "Développer les pages géolocalisées", text: "Permet de mieux couvrir les recherches locales à intention commerciale." },
        { title: "Renforcer les avis et signaux de confiance", text: "Aide autant la conversion que la crédibilité perçue." },
        { title: "Créer une FAQ locale", text: "Très utile pour répondre aux recherches de proximité plus précises." },
        { title: "Mailler fiche et pages locales", text: "Donne une continuité plus forte entre la présence locale et le site principal." }
      ],
      6,
      getDaySeed(`local_axes_${state.rangeDays}`)
    );
  }

  function getLocalBusinessCards() {
    return pickLibrary(
      [
        { title: "Plus de visibilité locale", text: "Mieux apparaître sur les recherches proches de l’intention d’achat.", tag: "Leads" },
        { title: "Leads plus qualifiés", text: "Toucher des visiteurs déjà prêts à appeler, réserver ou acheter.", tag: "Qualité" },
        { title: "Meilleure conversion", text: "Les signaux locaux renforcent la confiance et l’action.", tag: "Conversion" },
        { title: "Différenciation immédiate", text: "Un meilleur ancrage local aide à se détacher visiblement de concurrents moins travaillés.", tag: "Diff" }
      ],
      4,
      getDaySeed(`local_business_${state.rangeDays}`)
    );
  }

  function getToolCards() {
    return pickLibrary(libraries.tools, 6, getDaySeed(`tools_${state.rangeDays}`));
  }

  function getTeamCards() {
    return pickLibrary(libraries.team, 4, getDaySeed(`team_${state.rangeDays}`));
  }

  function getReportChecklistCards() {
    return pickLibrary(
      [
        "Résumé exécutif clair",
        "Actions prioritaires",
        "Valeur business",
        "Preuve d’évolution",
        "Synthèse lisible pour non-tech",
        "Bloc risques / opportunités"
      ],
      4,
      getDaySeed(`report_check_${state.rangeDays}`)
    );
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

  function getPlanSummaryCards() {
    const usage = state.me?.usage || {};
    const cards = [];

    const auditsUsage = getUsageBucket(usage, "audit");
    const pdfUsage = getUsageBucket(usage, "pdf");
    const exportsUsage = getUsageBucket(usage, "export");
    const monitorsUsage = getUsageBucket(usage, "monitor");

    cards.push({
      title: `Plan ${planLabel(state.me?.plan)}`,
      text: hasPlan("pro")
        ? "Lecture plus premium et plus complète du dashboard."
        : "Base actionnable pour SEO, monitoring et rapports.",
      badge: "PLAN"
    });

    if (auditsUsage?.limit != null) {
      cards.push({
        title: "Quota audits",
        text: `${auditsUsage.used ?? 0}/${auditsUsage.limit} utilisés`,
        badge: "AUDITS"
      });
    }

    if (monitorsUsage?.limit != null) {
      cards.push({
        title: "Quota monitors",
        text: `${monitorsUsage.used ?? 0}/${monitorsUsage.limit} utilisés`,
        badge: "MONITORS"
      });
    }

    if (pdfUsage?.limit != null) {
      cards.push({
        title: "Quota PDF",
        text: `${pdfUsage.used ?? 0}/${pdfUsage.limit} utilisés`,
        badge: "PDF"
      });
    }

    if (exportsUsage?.limit != null) {
      cards.push({
        title: "Quota exports",
        text: `${exportsUsage.used ?? 0}/${exportsUsage.limit} utilisés`,
        badge: "EXPORT"
      });
    }

    return cards;
  }

  function getOverviewActionCards() {
    const cards = [
      {
        title: "Lancer un audit ciblé mobile",
        text: "Relance rapidement un audit SEO pour alimenter la page Audits.",
        cta: "Lancer audit",
        action: "run_audit",
        tag: "SEO"
      },
      {
        title: "Créer une nouvelle surveillance",
        text: "Ajoute une URL dans la couche monitoring sans quitter l’overview.",
        cta: "Créer monitor",
        action: "add_monitor",
        tag: "UPTIME"
      },
      {
        title: "Relire les quick wins du jour",
        text: "Retour rapide vers les priorités business les plus utiles.",
        cta: "Voir overview",
        action: "goto_overview",
        tag: "FOCUS",
        btnClass: "fpBtnGhost"
      },
      {
        title: "Exporter un rapport dirigeant",
        text: "Accès direct vers la page rapports pour sortir un livrable.",
        cta: "Ouvrir rapports",
        action: "goto_reports",
        tag: "REPORT",
        btnClass: "fpBtnGhost"
      }
    ];

    return cards;
  }

  function getAuditExecutionCards() {
    return [
      {
        title: "Créer une mission depuis cette page",
        text: "Ajoute une mission d’exécution dans la checklist.",
        cta: "Ajouter mission",
        action: "create_audit_mission",
        tag: "MISSION"
      },
      {
        title: "Relancer un audit",
        text: "Refais partir un audit depuis la page Audit sans repasser ailleurs.",
        cta: "Relancer",
        action: "run_audit",
        tag: "SEO"
      },
      {
        title: "Transformer l’audit en rapport",
        text: "Basculer vers la page rapports pour valoriser les résultats.",
        cta: "Vers rapports",
        action: "goto_reports",
        tag: "REPORT",
        btnClass: "fpBtnGhost"
      }
    ];
  }

  function getMonitorExecutionCards() {
    return [
      {
        title: "Tester les monitors visibles",
        text: "Lance un test en série sur les éléments actuellement listés.",
        cta: "Tester",
        action: "bulk_test_monitors",
        tag: "BULK"
      },
      {
        title: "Créer un nouveau monitor",
        text: "Ajoute rapidement une nouvelle URL à surveiller.",
        cta: "Créer monitor",
        action: "add_monitor",
        tag: "UPTIME"
      },
      {
        title: "Configurer les alertes",
        text: "Va directement en paramètres pour renforcer la réception des alertes.",
        cta: "Configurer",
        action: "goto_settings",
        tag: "ALERT",
        btnClass: "fpBtnGhost"
      }
    ];
  }

  function getReportExecutionCards() {
    return [
      {
        title: "Générer un rapport mensuel",
        text: "Utilise les données audits et monitoring pour produire un livrable.",
        cta: "Exporter audits",
        action: "export_audits",
        tag: "MONTH"
      },
      {
        title: "Générer un rapport client",
        text: "Prépare les données monitoring pour un suivi client simple.",
        cta: "Exporter monitors",
        action: "export_monitors",
        tag: "CLIENT"
      },
      {
        title: "Comparer les périodes",
        text: "Change la période puis recharge les données pour enrichir la lecture.",
        cta: "Voir overview",
        action: "goto_overview",
        tag: "DELTA",
        btnClass: "fpBtnGhost"
      }
    ];
  }

  function getLocalExecutionCards() {
    return [
      {
        title: "Générer une liste de villes à cibler",
        text: "Transforme la logique locale en prochaine étape concrète.",
        cta: "Créer mission",
        action: "create_local_mission",
        tag: "CITY"
      },
      {
        title: "Préparer un plan de pages locales",
        text: "Passe de la lecture locale à une vraie logique d’exécution.",
        cta: "Ajouter mission",
        action: "create_local_mission",
        tag: "PAGES"
      },
      {
        title: "Basculer vers les audits",
        text: "Relie directement Local SEO aux audits prioritaires.",
        cta: "Voir audits",
        action: "goto_audits",
        tag: "SEO",
        btnClass: "fpBtnGhost"
      }
    ];
  }

  function getTeamExecutionCards() {
    return [
      {
        title: "Ouvrir l’invitation",
        text: "Ajoute quelqu’un au workspace sans quitter cette page.",
        cta: "Inviter",
        action: "open_invite",
        tag: "TEAM"
      },
      {
        title: "Ouvrir la facturation",
        text: "Revoir plan, add-ons et logique d’équipe.",
        cta: "Facturation",
        action: "open_billing",
        tag: "BILLING",
        btnClass: "fpBtnGhost"
      },
      {
        title: "Configurer le workspace",
        text: "Passe en paramètres pour structurer l’organisation et les alertes.",
        cta: "Paramètres",
        action: "goto_settings",
        tag: "SETUP",
        btnClass: "fpBtnGhost"
      }
    ];
  }

  function getSettingsExecutionCards() {
    const cards = [
      {
        title: "Sauvegarder la configuration alertes",
        text: "Valide les réglages sans quitter la page.",
        cta: "Sauvegarder",
        action: "save_settings_ui",
        tag: "SAVE"
      },
      {
        title: "Créer un monitor après config",
        text: "Enchaîne directement après le réglage des alertes.",
        cta: "Créer monitor",
        action: "add_monitor",
        tag: "UPTIME"
      },
      {
        title: "Lancer un audit après config",
        text: "Complète la mise en place du workspace avec un audit.",
        cta: "Lancer audit",
        action: "run_audit",
        tag: "SEO"
      }
    ];

    if (hasAddon("customDomain")) {
      cards.push({
        title: "Configurer le domaine custom",
        text: "Le custom domain doit devenir visible aussi dans les paramètres.",
        cta: "Voir info",
        action: "show_custom_domain_info",
        tag: "DOMAIN",
        btnClass: "fpBtnGhost"
      });
    }

    return cards;
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
      setMissionDoneByAction("save_settings_ui", true);
      setStatus("Paramètres sauvegardés — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Erreur sauvegarde paramètres", "danger");
      return false;
    }
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
                    ${esc(formatDate(log.checkedAt))} · HTTP ${esc(log.httpStatus ?? log.statusCode ?? 0)} · ${esc(log.responseTimeMs ?? 0)} ms
                    ${log.error || log.note ? ` · ${esc(log.error || log.note)}` : ""}
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

  function injectDashboardEnhancements() {
    const old = document.getElementById("fpDashboardEnhancements");
    if (old) old.remove();

    const style = document.createElement("style");
    style.id = "fpDashboardEnhancements";
    style.textContent = `
      .fpToolStateRow{
        display:flex;
        flex-direction:column;
        gap:12px;
        margin-top:14px;
      }

      .fpToolStateItem{
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:14px;
        padding:14px 16px;
        border-radius:18px;
        border:1px solid var(--fpBorder);
        background:rgba(255,255,255,.03);
      }

      .fpToolStateMeta{
        margin-top:6px;
        color:var(--fpTextSoft);
        font-size:14px;
        line-height:1.5;
        font-weight:700;
      }

      .fpPriorityText{
        margin-top:8px;
        color:var(--fpTextSoft);
        font-size:14px;
        line-height:1.5;
        font-weight:700;
      }

      .fpTableMeta{
        margin-top:8px;
        color:var(--fpMuted);
        font-size:13px;
        font-weight:700;
        line-height:1.45;
      }
    `;
    document.head.appendChild(style);
  }

  async function runMission(id) {
    const mission = findMissionById(id);
    if (!mission) return false;

    const action = mission.action;
    const createdMission = handleMissionCategoryAction(action);

    if (createdMission) {
      mission.done = true;
      saveMissions();
      setStatus("Mission ajoutée — OK", "ok");
      return true;
    }

    if (action === "add_monitor") {
      const ok = await safeAddMonitor();
      if (ok) {
        mission.done = true;
        saveMissions();
        await loadData({ silent: true });
      }
      return ok;
    }

    if (action === "run_audit") {
      const ok = await safeRunAudit();
      if (ok) {
        mission.done = true;
        saveMissions();
        await loadData({ silent: true });
      }
      return ok;
    }

    if (action === "export_audits") {
      const ok = await safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
      if (ok) {
        mission.done = true;
        saveMissions();
      }
      return ok;
    }

    if (action === "export_monitors") {
      const ok = await safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
      if (ok) {
        mission.done = true;
        saveMissions();
      }
      return ok;
    }

    if (action === "test_monitor") {
      const firstMonitor = Array.isArray(state.monitors) ? state.monitors[0] : null;
      if (!firstMonitor) {
        setStatus("Aucun monitor à tester", "danger");
        return false;
      }

      const ok = await safeTestMonitor(normalizeMonitorId(firstMonitor));
      if (ok) {
        mission.done = true;
        saveMissions();
        await loadData({ silent: true });
      }
      return ok;
    }

    if (action === "open_billing") {
      mission.done = true;
      saveMissions();
      goBillingPage();
      return true;
    }

    if (action === "open_invite") {
      mission.done = true;
      saveMissions();
      goInvitePage();
      return true;
    }

    if (openMissionTarget(mission)) {
      mission.done = true;
      saveMissions();
      setStatus("Mission ouverte — OK", "ok");
      return true;
    }

    return false;
  }

  async function runQuickAction(action, payload = "") {
    const createdMission = handleMissionCategoryAction(action);
    if (createdMission) {
      renderRoute({ preserveScroll: true });
      return true;
    }

    if (action === "run_audit") {
      const ok = await safeRunAudit();
      if (ok) {
        await loadData({ silent: true });
        renderRoute({ preserveScroll: true });
      }
      return ok;
    }

    if (action === "add_monitor") {
      const ok = await safeAddMonitor();
      if (ok) {
        await loadData({ silent: true });
        renderRoute({ preserveScroll: true });
      }
      return ok;
    }

    if (action === "export_audits") {
      return safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    }

    if (action === "export_monitors") {
      return safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    }

    if (action === "bulk_test_monitors") {
      const monitors = getFilteredMonitors().slice(0, 8);
      if (!monitors.length) {
        setStatus("Aucun monitor à tester", "danger");
        return false;
      }

      setStatus("Tests des monitors…", "warn");

      let success = 0;
      for (const monitor of monitors) {
        const ok = await safeTestMonitor(normalizeMonitorId(monitor));
        if (ok) success += 1;
        await sleep(120);
      }

      await loadData({ silent: true });
      renderRoute({ preserveScroll: true });

      if (success) {
        setStatus(`Tests terminés — ${success} monitor(s) validé(s)`, "ok");
        return true;
      }

      setStatus("Aucun test monitor validé", "danger");
      return false;
    }

    if (action === "goto_overview") { location.hash = "#overview"; return true; }
    if (action === "goto_audits") { location.hash = "#audits"; return true; }
    if (action === "goto_monitors") { location.hash = "#monitors"; return true; }
    if (action === "goto_reports") { location.hash = "#reports"; return true; }
    if (action === "goto_local") { location.hash = "#local-seo"; return true; }
    if (action === "goto_team") { location.hash = "#team"; return true; }
    if (action === "goto_settings") { location.hash = "#settings"; return true; }
    if (action === "goto_missions") { location.hash = "#missions"; return true; }
    if (action === "open_billing") return goBillingPage();
    if (action === "open_invite") return goInvitePage();
    if (action === "save_settings_ui") return saveOrgSettings();

    if (action === "show_custom_domain_info") {
      openHtmlModal({
        title: "Domaine custom",
        body: `
          <div class="fpTextPanel">
            Cette option est active. Prévois ici un vrai champ relié au backend pour gérer le domaine personnalisé du workspace.
          </div>
        `
      });
      return true;
    }

    if (action === "scroll_quick_wins") {
      if (state.route !== "#overview") {
        location.hash = "#overview";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            $("#fpQuickWinsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        });
      } else {
        $("#fpQuickWinsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return true;
    }

    if (payload && action === "test_monitor") {
      const ok = await safeTestMonitor(payload);
      if (ok) {
        await loadData({ silent: true });
        renderRoute({ preserveScroll: true });
      }
      return ok;
    }

    if (action === "calendar_add") {
      const title = await openTextModal({
        title: "Titre de l’événement",
        placeholder: "Ex: Audit mensuel client",
        confirmText: "Continuer"
      });
      if (!title) return false;

      const date = await openTextModal({
        title: "Date de l’événement",
        placeholder: "2026-04-15",
        confirmText: "Ajouter"
      });
      if (!date) return false;

      const ok = addSimpleCalendarItem(title, date, "Tâche");
      if (ok) renderRoute({ preserveScroll: true });
      return ok;
    }

    if (action === "notes_add") {
      const title = await openTextModal({
        title: "Titre de la note",
        placeholder: "Ex: Idée client",
        confirmText: "Continuer"
      });
      if (!title) return false;

      const text = await openTextModal({
        title: "Contenu de la note",
        placeholder: "Écris le contenu...",
        confirmText: "Ajouter"
      });

      addSimpleNote(title, text || "");
      renderRoute({ preserveScroll: true });
      return true;
    }

    if (action === "chat_add") {
      const text = await openTextModal({
        title: "Nouveau message",
        placeholder: "Écris un message...",
        confirmText: "Envoyer"
      });
      if (!text) return false;

      const ok = addSimpleChatMessage(text);
      if (ok) renderRoute({ preserveScroll: true });
      return ok;
    }

    return false;
  }
    function bindMissionCardEvents() {
    $$("[data-mission-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-mission-toggle");
        toggleMission(id);
        renderRoute({ preserveScroll: true });
      });
    });

    $$("[data-mission-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-mission-open");
        const mission = findMissionById(id);
        if (!mission) return;
        openMissionTarget(mission);
      });
    });

    $$("[data-mission-do]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-mission-do");
        const ok = await runMission(id);
        if (ok) renderRoute({ preserveScroll: true });
      });
    });
  }

  function bindQuickActionButtons() {
    $$("[data-quick-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-quick-action") || "";
        const payload = btn.getAttribute("data-quick-payload") || "";
        await runQuickAction(action, payload);
      });
    });
  }

  function bindOverviewPageEvents() {
    bindMissionCardEvents();
    bindQuickActionButtons();
  }

  function bindMissionsPageEvents() {
    bindMissionCardEvents();
    bindQuickActionButtons();
  }

  function afterRenderCurrentRoute() {
    if (state.route === "#overview") {
      bindOverviewPageEvents();
      return;
    }

    if (state.route === "#missions") {
      bindMissionsPageEvents();
      return;
    }

    bindQuickActionButtons();
  }

  function renderOverviewPage() {
    const me = state.me || {};
    const ov = state.overview || {};
    const recentAudits = Array.isArray(state.audits) ? state.audits.slice(0, 4) : [];
    const recentMonitors = Array.isArray(state.monitors) ? state.monitors.slice(0, 4) : [];
    const done = countDoneMissions();
    const auditBuckets = getAuditHealthBuckets();
    const monitorBuckets = getMonitorHealthBuckets();
    const feedItems = getOverviewFeed();
    const quickWins = getOverviewQuickWins();
    const planCards = getPlanSummaryCards();
    const rotatingPriorityMissions = pickLibrary(
      state.missions,
      4,
      getDaySeed("overview_priority_missions")
    );
    const overviewActionCards = getOverviewActionCards();

    const overviewTools = pickLibrary(
      libraries.tools,
      4,
      getDaySeed("overview_tools_embed")
    );

    const overviewCalendarItems = getCalendarItems()
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 4);

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
            "Lecture multi-indicateurs sur la période sélectionnée.",
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
            "Actions rapides",
            "Passer à l’action",
            "Des blocs réellement utiles pour agir sans quitter l’overview.",
            createActionGrid(overviewActionCards)
          )}

          ${createSectionCard(
            "Quick setup",
            "Missions prioritaires",
            "Bibliothèque tournante mise à jour chaque jour à 10h locale.",
            `
              <div class="fpMissionStack">
                ${rotatingPriorityMissions.map((m) => `
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
            "Vue plus claire pour piloter plusieurs signaux au même endroit.",
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

          <div id="fpQuickWinsSection" data-section="quick-wins"></div>

          ${createSectionCard(
            "Opportunités business",
            "Quick wins rentables",
            "Bibliothèque tournante enrichie et remise à jour chaque jour à 10h locale.",
            renderPriorityList(quickWins)
          )}

          ${createSectionCard(
            "Outils intégrés",
            "Modules utiles directement dans Overview",
            "Overview absorbe Outils pour rendre la navigation plus légère et plus logique.",
            `
              <div class="fpReportsGrid">
                ${overviewTools.map((tool) => {
                  const active = isToolActive(tool.id);
                  return `
                    <div class="fpReportCard">
                      <div class="fpAddonPill on">${esc(tool.tag)}</div>
                      <div class="fpReportTitle" style="margin-top:14px">${esc(tool.name)}</div>
                      <div class="fpReportMeta">${esc(tool.description)}</div>
                      <div class="fpToolFeatureList">
                        ${tool.features.map((f) => `<div class="fpToolFeature">• ${esc(f)}</div>`).join("")}
                      </div>
                      <div class="fpDetailActions">
                        <button
                          class="fpBtn ${active ? "fpBtnPrimary" : "fpBtnGhost"}"
                          type="button"
                          data-tool-toggle="${esc(tool.id)}"
                        >
                          ${active ? "Activé" : "Activer"}
                        </button>
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>
            `
          )}

          ${createSectionCard(
            "Calendrier intégré",
            "Planning rapide",
            "Overview absorbe Calendrier pour garder un vrai hub de pilotage.",
            `
              <div class="fpDetailActions" style="margin-bottom:14px">
                <button class="fpBtn fpBtnPrimary" type="button" data-quick-action="calendar_add">Ajouter un événement</button>
                <button class="fpBtn fpBtnGhost" type="button" data-quick-action="goto_audits">Voir audits</button>
              </div>

              ${
                overviewCalendarItems.length
                  ? `
                    <div class="fpRows">
                      ${overviewCalendarItems.map((item) => `
                        <div class="fpRowCard">
                          <div class="fpRowMain">
                            <div class="fpRowTitle">${esc(item.title)}</div>
                            <div class="fpRowMeta">${esc(item.date)} · ${esc(item.type || "Tâche")}</div>
                          </div>
                          <div class="fpRowRight">
                            <button class="fpBtn fpBtnDanger fpBtnSmall" type="button" data-calendar-delete="${esc(item.id)}">Supprimer</button>
                          </div>
                        </div>
                      `).join("")}
                    </div>
                  `
                  : createEmpty("Aucun événement pour le moment.")
              }
            `
          )}

          ${createSectionCard(
            "Plan / capacités",
            "Ce que ton niveau débloque",
            "Le dashboard devient plus utile selon le plan et les quotas.",
            createMiniRows(planCards)
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Organisation",
            "Résumé chargé",
            "Vue synthétique du compte actif.",
            `
              <div class="fpInfoList">
                <div class="fpInfoRow"><span>Plan</span><strong>${esc(planLabel(me.plan))}</strong></div>
                <div class="fpInfoRow"><span>Organisation</span><strong>${esc(normalizeOrgName())}</strong></div>
                <div class="fpInfoRow"><span>Statut</span><strong>${esc(statusLabel(me.subscriptionStatus || me.lastPaymentStatus))}</strong></div>
                <div class="fpInfoRow"><span>Essai</span><strong>${esc(trialLabel(me.trialEndsAt))}</strong></div>
                <div class="fpInfoRow"><span>Monitors actifs</span><strong>${esc(ov.monitors?.active ?? 0)}</strong></div>
                <div class="fpInfoRow"><span>Incidents</span><strong>${esc(ov.monitors?.down ?? 0)}</strong></div>
                <div class="fpInfoRow"><span>Missions faites</span><strong>${done}/${state.missions.length}</strong></div>
              </div>
            `
          )}

          ${createSectionCard(
            "Activité récente",
            "Feed dashboard",
            "Feed live alimenté par les audits, monitors et réglages.",
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

    $$("[data-calendar-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        deleteSimpleCalendarItem(btn.getAttribute("data-calendar-delete"));
        renderRoute({ preserveScroll: true });
      });
    });

    $$("[data-tool-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const toolId = btn.getAttribute("data-tool-toggle");
        const next = !isToolActive(toolId);
        setToolActive(toolId, next);
        setStatus(next ? "Module activé — OK" : "Module désactivé — OK", "ok");
        renderRoute({ preserveScroll: true });
      });
    });
  }

  function renderMissionsPage() {
  const missions = getFilteredMissions();
  const allMissions = Array.isArray(state.missions) ? state.missions : [];

  const total = allMissions.length;
  const done = allMissions.filter((m) => m.done).length;
  const todo = allMissions.filter((m) => !m.done).length;
  const progress = total ? Math.round((done / total) * 100) : 0;

  const criticalMissions = allMissions.filter((m) => !m.done && lower(m.impact).includes("crit"));
  const highMissions = allMissions.filter(
    (m) => !m.done && (lower(m.impact).includes("élev") || lower(m.priority) === "high")
  );
  const personalizedCount = allMissions.filter((m) => m.personalized).length;

  const siteProfile = typeof getCurrentSiteProfile === "function" ? getCurrentSiteProfile() : null;
  const siteLabel = siteProfile?.host || siteProfile?.siteUrl || "Bibliothèque standard";

  const topNow = [...allMissions]
    .filter((m) => !m.done)
    .sort((a, b) => {
      const rank = { critical: 4, high: 3, medium: 2, low: 1 };
      const pa = rank[lower(a.priority || "")] || 0;
      const pb = rank[lower(b.priority || "")] || 0;
      return pb - pa;
    })
    .slice(0, 6);

  const recentDone = [...allMissions].filter((m) => m.done).slice(0, 6);

  const packs = [
    {
      title: "Pack SEO technique",
      text: "Génère un lot d’actions SEO à partir des pages faibles détectées.",
      cta: "Créer mission",
      action: "create_audit_mission",
      tag: "SEO"
    },
    {
      title: "Pack monitoring",
      text: "Transforme la surveillance et les incidents en actions suivies.",
      cta: "Créer mission",
      action: "create_monitor_mission",
      tag: "UPTIME"
    },
    {
      title: "Pack Local SEO",
      text: "Prépare des actions ville, zone et présence locale.",
      cta: "Créer mission",
      action: "create_local_mission",
      tag: "LOCAL"
    },
    {
      title: "Pack reporting",
      text: "Prépare une restitution claire pour le client final.",
      cta: "Créer mission",
      action: "create_report_mission",
      tag: "REPORT"
    }
  ];

  const proUltraCards = [
    {
      title: "Pro",
      text: "Bibliothèque enrichie, missions plus ciblées, quick wins et suggestions plus utiles."
    },
    {
      title: "Ultra",
      text: "Missions plus profondes, packs d’actions, base prête pour automatisation, assignation et workflows."
    },
    {
      title: "Bibliothèque active",
      text: `Source actuelle : ${siteLabel}. Les missions peuvent être personnalisées selon les URLs connues, audits et monitors.`
    },
    {
      title: "Étape backend",
      text: "La suite logique sera de sortir les missions du localStorage pour les mettre en base avec statuts avancés."
    }
  ];

  const statsHtml = `
    <div class="fpStatsGrid">
      <div class="fpStatCard">
        <div class="fpStatLabel">Missions</div>
        <div class="fpStatValue">${total}</div>
        <div class="fpStatMeta">Bibliothèque chargée</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">À faire</div>
        <div class="fpStatValue">${todo}</div>
        <div class="fpStatMeta">Actions ouvertes</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">Terminées</div>
        <div class="fpStatValue">${done}</div>
        <div class="fpStatMeta">Actions validées</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">Progression</div>
        <div class="fpStatValue">${progress}%</div>
        <div class="fpStatMeta">Avancement global</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">Critiques</div>
        <div class="fpStatValue">${criticalMissions.length}</div>
        <div class="fpStatMeta">Urgences détectées</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">Personnalisées</div>
        <div class="fpStatValue">${personalizedCount}</div>
        <div class="fpStatMeta">Basées sur le site</div>
      </div>
    </div>
  `;

  const toolbarHtml = createToolbar({
    searchId: "fpMissionsSearch",
    searchPlaceholder: "Rechercher une mission, une page ou une catégorie…",
    searchValue: state.filters.missions.q,
    statusId: "fpMissionsStatus",
    statusValue: state.filters.missions.status,
    sortId: "fpMissionsDummySort",
    sortValue: "default",
    statuses: [
      { value: "all", label: "Toutes" },
      { value: "todo", label: "À faire" },
      { value: "done", label: "Terminées" }
    ],
    sorts: [
      { value: "default", label: "Ordre actuel" }
    ]
  });

  const topNowHtml = topNow.length
    ? `
      <div class="fpMissionBoardList">
        ${topNow.map((m) => `
          <div class="fpMissionBoardCard">
            <div class="fpMissionBoardHead">
              <div class="fpMissionBoardMain">
                <div class="fpMissionBoardTitle">${esc(m.title)}</div>
                <div class="fpMissionBoardMeta">
                  ${esc(m.meta || "Général")}
                  ${m.siteUrl ? ` · ${esc(m.siteUrl)}` : ""}
                </div>
              </div>

              <div class="fpMissionBoardBadges">
                <div class="fpAddonPill ${m.done ? "on" : "off"}">${esc(m.impact || "Moyen")}</div>
              </div>
            </div>

            ${m.description ? `<div class="fpMissionBoardText">${esc(m.description)}</div>` : ""}

            <div class="fpMissionBoardActions">
              <button class="fpBtn fpBtnPrimary fpBtnSmall" type="button" data-mission-do="${esc(m.id)}">Exécuter</button>
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-mission-toggle="${esc(m.id)}">${m.done ? "Réouvrir" : "Terminer"}</button>
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-mission-open="${esc(m.id)}">Ouvrir</button>
            </div>
          </div>
        `).join("")}
      </div>
    `
    : createEmpty("Aucune priorité à afficher pour le moment.");

  const missionsTableHtml = missions.length
    ? `
      <div class="fpTable">
        <div class="fpTableHead" style="grid-template-columns:1.55fr .8fr .85fr .8fr 1fr">
          <div>Mission</div>
          <div>Source</div>
          <div>Impact</div>
          <div>Statut</div>
          <div>Actions</div>
        </div>

        ${missions.map((m) => `
          <div class="fpTableRow fpMissionTableRow" style="grid-template-columns:1.55fr .8fr .85fr .8fr 1fr">
            <div>
              <div class="fpTableUrl">${esc(m.title)}</div>
              <div class="fpTableMeta">
                ${esc(m.meta || "Général")}
                ${m.personalized ? " · personnalisée" : ""}
              </div>
            </div>

            <div>
              <div class="fpBenchmarkCellPill">${esc(cap(m.source || "system"))}</div>
            </div>

            <div>
              <div class="fpBenchmarkCellPill">${esc(m.impact || "Moyen")}</div>
            </div>

            <div>
              <div class="fpAddonPill ${m.done ? "on" : "off"}">${m.done ? "Terminée" : "À faire"}</div>
            </div>

            <div class="fpTableActions">
              <button class="fpBtn fpBtnPrimary fpBtnSmall" type="button" data-mission-do="${esc(m.id)}">Faire</button>
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-mission-toggle="${esc(m.id)}">Toggle</button>
            </div>
          </div>
        `).join("")}
      </div>
    `
    : createEmpty("Aucune mission trouvée avec ce filtre.");

  const libraryHtml = `
    <div class="fpRows">
      <div class="fpRowCard">
        <div class="fpRowMain">
          <div class="fpRowTitle">Source actuelle</div>
          <div class="fpRowMeta">${esc(siteLabel)}</div>
        </div>
        <div class="fpRowRight">
          <div class="fpAddonPill on">ACTIF</div>
        </div>
      </div>

      <div class="fpRowCard">
        <div class="fpRowMain">
          <div class="fpRowTitle">Missions haut impact</div>
          <div class="fpRowMeta">${highMissions.length} priorités élevées ou critiques ouvertes</div>
        </div>
        <div class="fpRowRight">
          <div class="fpAddonPill off">FOCUS</div>
        </div>
      </div>

      <div class="fpRowCard">
        <div class="fpRowMain">
          <div class="fpRowTitle">Plan actif</div>
          <div class="fpRowMeta">${esc(planLabel(state.me?.plan))}</div>
        </div>
        <div class="fpRowRight">
          <div class="fpAddonPill on">${esc(planLabel(state.me?.plan)).toUpperCase()}</div>
        </div>
      </div>
    </div>
  `;

  const recentDoneHtml = recentDone.length
    ? `
      <div class="fpRows">
        ${recentDone.map((m) => `
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">${esc(m.title)}</div>
              <div class="fpRowMeta">${esc(m.meta || "Général")}</div>
            </div>
            <div class="fpRowRight">
              <div class="fpAddonPill on">OK</div>
            </div>
          </div>
        `).join("")}
      </div>
    `
    : createEmpty("Aucune mission terminée pour le moment.");

  const heroHtml = `${statsHtml}${toolbarHtml}`;

  const pageHtml = `
    ${createSectionCard(
      "Missions",
      "Centre d’exécution",
      "Transforme les audits, monitors et opportunités détectées en vraies actions exploitables.",
      heroHtml
    )}

    <div class="fpGrid fpGridMain">
      <div class="fpCol fpColMain">
        ${createSectionCard(
          "À faire maintenant",
          "Priorités du moment",
          "Les missions les plus utiles à traiter en premier.",
          topNowHtml
        )}

        ${createSectionCard(
          "Vue de travail",
          "Toutes les missions",
          "Lecture complète avec statut, source et action rapide.",
          missionsTableHtml
        )}
      </div>

      <div class="fpCol fpColSide">
        ${createSectionCard(
          "Bibliothèque active",
          "Missions personnalisées",
          "Le moteur peut produire des missions différentes selon les URLs connues, audits et monitors.",
          libraryHtml
        )}

        ${createSectionCard(
          "Packs d’actions",
          "Créer plus vite",
          "Déclenche des groupes d’actions utiles sans remplir la page de cartes vides.",
          createActionGrid(packs)
        )}

        ${createSectionCard(
          "Historique",
          "Dernières missions terminées",
          "Lecture rapide des actions déjà validées.",
          recentDoneHtml
        )}

        ${createSectionCard(
          "Pro / Ultra",
          "Missions plus poussées",
          "La page est prête à devenir beaucoup plus forte quand on branchera la logique avancée.",
          renderCheckGrid(proUltraCards)
        )}
      </div>
    </div>
  `;

  setPage(pageHtml);

  requestAnimationFrame(() => {
    const search = $("#fpMissionsSearch");
    const status = $("#fpMissionsStatus");

    if (search) {
      search.addEventListener("input", (e) => {
        state.filters.missions.q = e.target.value || "";
        renderRoute({ preserveScroll: true });
      });
    }

    if (status) {
      status.addEventListener("change", (e) => {
        state.filters.missions.status = e.target.value || "all";
        renderRoute({ preserveScroll: true });
      });
    }

    bindMissionCardEvents();
    bindQuickActionButtons();
  });
}
  function renderAuditsPage() {
  const audits = getFilteredAudits();
  const allAudits = Array.isArray(state.audits) ? state.audits : [];

  const avgScore = allAudits.length
    ? Math.round(allAudits.reduce((sum, a) => sum + Number(a.score || 0), 0) / allAudits.length)
    : 0;

  const scoreStrong = allAudits.filter((a) => Number(a.score || 0) >= 75).length;
  const scoreMid = allAudits.filter((a) => Number(a.score || 0) >= 45 && Number(a.score || 0) < 75).length;
  const scoreWeak = allAudits.filter((a) => Number(a.score || 0) < 45).length;

  const featuredAudit =
    [...allAudits].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;

  const worstAudits = [...allAudits]
    .sort((a, b) => Number(a.score || 0) - Number(b.score || 0))
    .slice(0, 5);

  const potentialAudits = [...allAudits]
    .sort((a, b) => {
      const as = Number(a.score || 0);
      const bs = Number(b.score || 0);
      const ap = as >= 45 && as <= 74 ? 1 : 0;
      const bp = bs >= 45 && bs <= 74 ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return bs - as;
    })
    .slice(0, 5);

  const trendSeries = allAudits.length
    ? [...allAudits]
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
        .slice(-10)
        .map((a) => clamp(Number(a.score || 0), 0, 100))
    : [42, 48, 51, 47, 58, 62, 60, 68, 72, 74];

  const firstTrend = trendSeries[0] || 0;
  const lastTrend = trendSeries[trendSeries.length - 1] || 0;
  const trendDiff = Math.round(lastTrend - firstTrend);

  const criticalPages = worstAudits.length;
  const quickWinCount = Math.max(3, Math.min(12, scoreWeak + scoreMid));
  const regressionCount = trendDiff < 0 ? Math.abs(trendDiff) : 0;

  const issueBuckets = {
    meta: Math.max(1, Math.min(18, Math.round(scoreWeak * 1.5 + scoreMid * 0.5 + 2))),
    speed: Math.max(1, Math.min(14, Math.round(scoreWeak * 1.2 + 2))),
    content: Math.max(1, Math.min(16, Math.round(scoreMid * 1.2 + 3))),
    local: Math.max(1, Math.min(10, Math.round(scoreWeak * 0.7 + 2))),
    conversion: Math.max(1, Math.min(12, Math.round(scoreMid * 0.8 + 2)))
  };

  const issueCards = [
    {
      title: "Meta / titles",
      text: `${issueBuckets.meta} signaux à retravailler sur les balises et snippets.`,
      badge: "META"
    },
    {
      title: "Performance",
      text: `${issueBuckets.speed} signaux de vitesse ou expérience mobile à renforcer.`,
      badge: "SPEED"
    },
    {
      title: "Contenu / structure",
      text: `${issueBuckets.content} opportunités liées aux H1, au contenu et à la hiérarchie.`,
      badge: "CONTENT"
    },
    {
      title: "Local SEO",
      text: `${issueBuckets.local} signaux locaux ou pages ville à structurer.`,
      badge: "LOCAL"
    },
    {
      title: "Conversion",
      text: `${issueBuckets.conversion} opportunités de CTA, lisibilité ou confiance.`,
      badge: "CRO"
    }
  ];

  const quickWinsRows = [
    {
      title: "Créer un pack quick wins SEO",
      text: "Transformer les signaux les plus simples à corriger en missions immédiates.",
      badge: "QUICK"
    },
    {
      title: "Traiter les pages à score moyen",
      text: "Les pages 45-74 peuvent souvent monter plus vite qu’une page totalement faible.",
      badge: "VALUE"
    },
    {
      title: "Renforcer la homepage et la page contact",
      text: "Ces pages ont souvent le meilleur effet business quand elles sont optimisées.",
      badge: "CORE"
    },
    {
      title: "Préparer une restitution client",
      text: "Le client perçoit davantage la valeur quand le diagnostic devient lisible et actionnable.",
      badge: "REPORT"
    }
  ];

  const actionCards = [
    {
      title: "Lancer un audit SEO",
      text: "Déclenche immédiatement une nouvelle analyse du site ou d’une page clé.",
      cta: "Lancer",
      action: "run_audit",
      tag: "SEO"
    },
    {
      title: "Créer une mission audit",
      text: "Transforme directement les constats de la page en action exploitable.",
      cta: "Créer mission",
      action: "create_audit_mission",
      tag: "MISSION"
    },
    {
      title: "Créer un pack quick wins",
      text: "Prépare plusieurs actions utiles à partir des audits faibles ou moyens.",
      cta: "Créer pack",
      action: "create_audit_mission",
      tag: "PACK"
    },
    {
      title: "Préparer un rapport",
      text: "Bascule vers la couche rapport pour valoriser les résultats auprès du client.",
      cta: "Rapports",
      action: "goto_reports",
      tag: "REPORT",
      btnClass: "fpBtnGhost"
    }
  ];

  const massActionCards = [
    {
      title: "Créer missions depuis audits faibles",
      text: "Génère un lot d’actions priorisées à partir des pages les plus faibles.",
      cta: "Créer missions",
      action: "create_audit_mission",
      tag: "MASS"
    },
    {
      title: "Ajouter au rapport client",
      text: "Passe directement vers la restitution pour valoriser les analyses.",
      cta: "Vers rapport",
      action: "goto_reports",
      tag: "FLOW"
    },
    {
      title: "Créer monitor depuis l’audit",
      text: "Faire suivre les pages importantes par le monitoring ensuite.",
      cta: "Créer monitor",
      action: "add_monitor",
      tag: "UPTIME"
    },
    {
      title: "Relancer audit maintenant",
      text: "Rejoue une analyse rapidement après modification du site.",
      cta: "Relancer",
      action: "run_audit",
      tag: "RECHECK"
    }
  ];

  const businessImpactRows = [
    {
      title: "Pages faibles = perte de clarté",
      text: "Des pages mal structurées nuisent à la compréhension de l’offre et à la confiance.",
      badge: "UX"
    },
    {
      title: "Pages à potentiel = gain rapide",
      text: "Certaines pages ne sont pas critiques mais peuvent monter vite avec peu d’effort.",
      badge: "VALUE"
    },
    {
      title: "Quick wins = effet plus visible",
      text: "Les petits correctifs bien choisis donnent un effet concret plus rapidement.",
      badge: "FAST"
    },
    {
      title: "Audit → mission → rapport",
      text: "C’est le meilleur flux pour transformer l’analyse en vraie valeur perçue.",
      badge: "FLOW"
    }
  ];

  const proUltraRows = [
    {
      title: "Pro",
      text: "Quick wins enrichis, meilleure restitution, lecture plus vendable et actions plus fluides."
    },
    {
      title: "Ultra",
      text: "Packs d’actions, logique portefeuille, comparatif fort et pilotage plus premium."
    },
    {
      title: "Étape backend",
      text: "Enrichir chaque audit avec issues, sévérité, quick wins, catégories et comparaison."
    },
    {
      title: "Étape produit",
      text: "Faire de cette page un vrai centre d’exécution SEO, pas juste une liste d’analyses."
    }
  ];

  const statsHtml = `
    <div class="fpStatsGrid">
      <div class="fpStatCard">
        <div class="fpStatLabel">Audits</div>
        <div class="fpStatValue">${allAudits.length}</div>
        <div class="fpStatMeta">Historique total chargé</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">Score moyen</div>
        <div class="fpStatValue">${avgScore}</div>
        <div class="fpStatMeta">Lecture globale actuelle</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">Pages critiques</div>
        <div class="fpStatValue">${criticalPages}</div>
        <div class="fpStatMeta">Audits à traiter d’abord</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">Quick wins</div>
        <div class="fpStatValue">${quickWinCount}</div>
        <div class="fpStatMeta">Actions rapides détectées</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">Tendance</div>
        <div class="fpStatValue">${trendDiff >= 0 ? `+${trendDiff}` : trendDiff}</div>
        <div class="fpStatMeta">Évolution récente</div>
      </div>

      <div class="fpStatCard">
        <div class="fpStatLabel">Régressions</div>
        <div class="fpStatValue">${regressionCount}</div>
        <div class="fpStatMeta">Signaux en baisse</div>
      </div>
    </div>
  `;

  const actionsHtml = `
    <div class="fpTopActionsRow">
      <button class="fpBtn fpBtnPrimary" id="fpAuditsRunBtn" type="button">Lancer un audit</button>
      <button class="fpBtn fpBtnGhost" id="fpAuditsExportBtn" type="button">Exporter CSV</button>
      <button class="fpBtn fpBtnGhost" type="button" data-quick-action="create_audit_mission">Créer mission</button>
      <button class="fpBtn fpBtnGhost" type="button" data-quick-action="goto_reports">Rapport</button>
    </div>
  `;

  const toolbarHtml = createToolbar({
    searchId: "fpAuditsSearch",
    searchPlaceholder: "Rechercher une URL, un résumé ou un statut…",
    searchValue: state.filters.audits.q,
    statusId: "fpAuditsStatus",
    statusValue: state.filters.audits.status,
    sortId: "fpAuditsSort",
    sortValue: state.filters.audits.sort,
    statuses: [
      { value: "all", label: "Tous les statuts" },
      { value: "ok", label: "OK" },
      { value: "error", label: "À corriger" }
    ],
    sorts: [
      { value: "date_desc", label: "Date décroissante" },
      { value: "date_asc", label: "Date croissante" },
      { value: "score_desc", label: "Score décroissant" },
      { value: "score_asc", label: "Score croissant" }
    ]
  });

  const featuredAuditHtml = featuredAudit
    ? `
      <div class="fpAuditHero">
        <div class="fpAuditHeroLeft">
          <div class="fpCardKicker">Dernier audit important</div>
          <div class="fpAuditHeroTitle">${esc(featuredAudit.url || "Audit SEO")}</div>
          <div class="fpAuditHeroMeta">
            Score ${esc(featuredAudit.score ?? 0)} · ${esc(formatDate(featuredAudit.createdAt))}
          </div>
          <div class="fpAuditHeroText">
            ${esc(featuredAudit.summary || "Aucun résumé disponible pour cet audit.")}
          </div>

          <div class="fpAuditHeroActions">
            <button class="fpBtn fpBtnPrimary" type="button" data-audit-detail="${esc(normalizeAuditId(featuredAudit))}">Voir détail</button>
            <button class="fpBtn fpBtnGhost" type="button" data-quick-action="create_audit_mission">Créer mission</button>
            <button class="fpBtn fpBtnGhost" type="button" data-quick-action="goto_reports">Rapport</button>
            <button class="fpBtn fpBtnGhost" type="button" data-quick-action="add_monitor">Monitor</button>
          </div>
        </div>

        <div class="fpAuditHeroRight">
          <div class="fpAuditHeroScore">${esc(featuredAudit.score ?? 0)}</div>
          <div class="fpAuditHeroScoreLabel">Score mis en avant</div>
        </div>
      </div>
    `
    : createEmpty("Aucun audit disponible pour le moment.");

  const chartsHtml = `
    <div class="fpAuditAnalyticsGrid">
      <div class="fpCardInner">
        <div class="fpCardInnerTitle" style="font-size:24px">Évolution du score SEO</div>
        <div class="fpSmall">Progression récente basée sur les derniers audits disponibles.</div>
        <div class="fpChartCard">
          <div class="fpChartBox">
            <canvas id="fpAuditsTrendChart"></canvas>
          </div>
          <div class="fpChartLegend">
            <div class="fpLegendItem"><span class="fpLegendDot"></span> Score SEO</div>
          </div>
        </div>
      </div>

      <div class="fpCardInner">
        <div class="fpCardInnerTitle" style="font-size:24px">Répartition analytique</div>
        <div class="fpSmall">Lecture immédiate des audits forts, moyens et critiques.</div>
        <div class="fpAuditBars">
          <div class="fpAuditBarCard">
            <div class="fpAuditBarHead">
              <span>Forts</span>
              <strong>${scoreStrong}</strong>
            </div>
            <div class="fpBar"><div class="fpBarFill" style="width:${Math.max(8, scoreStrong * 14)}%"></div></div>
          </div>

          <div class="fpAuditBarCard">
            <div class="fpAuditBarHead">
              <span>Moyens</span>
              <strong>${scoreMid}</strong>
            </div>
            <div class="fpBar"><div class="fpBarFill" style="width:${Math.max(8, scoreMid * 10)}%"></div></div>
          </div>

          <div class="fpAuditBarCard">
            <div class="fpAuditBarHead">
              <span>Critiques</span>
              <strong>${scoreWeak}</strong>
            </div>
            <div class="fpBar"><div class="fpBarFill" style="width:${Math.max(8, scoreWeak * 16)}%"></div></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const issuesHtml = `
    <div class="fpAuditIssueGrid">
      ${issueCards.map((item) => `
        <div class="fpAuditIssueCard">
          <div class="fpAuditIssueTop">
            <div class="fpAuditIssueTitle">${esc(item.title)}</div>
            <div class="fpAddonPill on">${esc(item.badge)}</div>
          </div>
          <div class="fpAuditIssueText">${esc(item.text)}</div>
          <div class="fpAuditIssueActions">
            <button class="fpBtn fpBtnPrimary fpBtnSmall" type="button" data-quick-action="create_audit_mission">Créer mission</button>
            <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-quick-action="goto_reports">Rapport</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  const criticalHtml = worstAudits.length
    ? `
      <div class="fpRows">
        ${worstAudits.map((a) => `
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">${esc(a.url || "Audit SEO")}</div>
              <div class="fpRowMeta">Score ${esc(a.score ?? 0)} · ${esc(formatDate(a.createdAt))}</div>
            </div>
            <div class="fpRowRight" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-audit-detail="${esc(normalizeAuditId(a))}">Détail</button>
              <button class="fpBtn fpBtnSoft fpBtnSmall" type="button" data-quick-action="create_audit_mission">Mission</button>
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-quick-action="run_audit">Relancer</button>
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-quick-action="add_monitor">Monitor</button>
            </div>
          </div>
        `).join("")}
      </div>
    `
    : createEmpty("Aucune page critique pour le moment.");

  const potentialHtml = potentialAudits.length
    ? `
      <div class="fpRows">
        ${potentialAudits.map((a) => `
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">${esc(a.url || "Audit SEO")}</div>
              <div class="fpRowMeta">Score ${esc(a.score ?? 0)} · potentiel de progression rapide</div>
            </div>
            <div class="fpRowRight" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-audit-detail="${esc(normalizeAuditId(a))}">Détail</button>
              <button class="fpBtn fpBtnSoft fpBtnSmall" type="button" data-quick-action="create_audit_mission">Créer mission</button>
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-quick-action="goto_reports">Rapport</button>
            </div>
          </div>
        `).join("")}
      </div>
    `
    : createEmpty("Aucune page à potentiel détectée.");

  const historyHtml = audits.length
    ? `
      <div class="fpTable">
        <div class="fpTableHead" style="grid-template-columns:1.35fr .65fr .8fr .7fr 1.2fr">
          <div>URL</div>
          <div>Score</div>
          <div>Date</div>
          <div>Statut</div>
          <div>Actions</div>
        </div>

        ${audits.map((a) => `
          <div class="fpTableRow" style="grid-template-columns:1.35fr .65fr .8fr .7fr 1.2fr">
            <div>
              <div class="fpTableUrl">${esc(a.url || "Audit SEO")}</div>
              <div class="fpTableMeta">${esc(a.summary || "Aucun résumé")}</div>
            </div>

            <div>
              <div class="fpScore">${esc(a.score ?? 0)}</div>
            </div>

            <div>
              <div class="fpTableMeta">${esc(formatDate(a.createdAt))}</div>
            </div>

            <div>
              ${createBadge(a.status === "ok" || Number(a.score || 0) >= 75 ? "up" : "down")}
            </div>

            <div class="fpTableActions">
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-audit-detail="${esc(normalizeAuditId(a))}">Détail</button>
              <button class="fpBtn fpBtnSoft fpBtnSmall" type="button" data-quick-action="create_audit_mission">Mission</button>
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-quick-action="goto_reports">Rapport</button>
              <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-quick-action="add_monitor">Monitor</button>
            </div>
          </div>
        `).join("")}
      </div>
    `
    : createEmpty("Aucun audit trouvé avec ce filtre.");

  const compareHtml = `
    <div class="fpInlineStats">
      <div class="fpInlineStat">
        <div class="fpBigValue">${firstTrend}</div>
        <div class="fpInlineStatText">Score début série</div>
      </div>
      <div class="fpInlineStat">
        <div class="fpBigValue">${lastTrend}</div>
        <div class="fpInlineStatText">Score fin série</div>
      </div>
      <div class="fpInlineStat">
        <div class="fpBigValue">${trendDiff >= 0 ? `+${trendDiff}` : trendDiff}</div>
        <div class="fpInlineStatText">Delta actuel</div>
      </div>
    </div>
  `;

  const pageHtml = `
    ${createSectionCard(
      "Audits",
      "Analytics SEO",
      "Passe du diagnostic à l’action avec plus de visualisation, d’analytics et d’exécution.",
      `${actionsHtml}${statsHtml}${toolbarHtml}`
    )}

    <div class="fpGrid fpGridMain">
      <div class="fpCol fpColMain">
        ${createSectionCard(
          "Audit mis en avant",
          "Point de départ principal",
          "Le dernier audit chargé devient une vraie base de travail.",
          featuredAuditHtml
        )}

        ${createSectionCard(
          "Analytics",
          "Graphiques et lecture",
          "Visualise la tendance et la répartition des scores avant d’agir.",
          chartsHtml
        )}

        ${createSectionCard(
          "Issues SEO",
          "Problèmes regroupés",
          "Des catégories d’issues plus lisibles et directement actionnables.",
          issuesHtml
        )}

        ${createSectionCard(
          "Quick wins",
          "Actions les plus rapides",
          "Les meilleures actions à effet rapide pour débloquer de la valeur.",
          createMiniRows(quickWinsRows)
        )}

        ${createSectionCard(
          "Pages critiques",
          "À corriger en premier",
          "Les audits les plus faibles doivent devenir des actions rapidement.",
          criticalHtml
        )}

        ${createSectionCard(
          "Pages à potentiel",
          "Pas les pires, mais les plus rentables",
          "Certaines pages peuvent progresser vite avec peu d’effort.",
          potentialHtml
        )}

        ${createSectionCard(
          "Historique enrichi",
          "Tous les audits",
          "Une table plus utile avec actions directes.",
          historyHtml
        )}

        ${createSectionCard(
          "Actions de masse",
          "Créer plus vite",
          "Déclenche plusieurs workflows utiles depuis la page Audits.",
          createActionGrid(massActionCards)
        )}

        ${createSectionCard(
          "Comparaison",
          "Avant / après rapide",
          "Première lecture comparative sans encore toucher au backend.",
          compareHtml
        )}
      </div>

      <div class="fpCol fpColSide">
        ${createSectionCard(
          "Impact business",
          "Pourquoi cette page sert vraiment",
          "L’objectif n’est pas seulement de lire un score, mais de produire de la valeur.",
          createMiniRows(businessImpactRows)
        )}

        ${createSectionCard(
          "Pro / Ultra",
          "Montée en gamme",
          "Cette page peut encore devenir beaucoup plus forte.",
          renderCheckGrid(proUltraRows)
        )}
      </div>
    </div>
  `;

  setPage(pageHtml);

  function drawAuditsTrendChart() {
    const canvas = $("#fpAuditsTrendChart");
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

    const stepX = trendSeries.length > 1 ? chartW / (trendSeries.length - 1) : chartW;
    const points = trendSeries.map((value, i) => ({
      x: padLeft + i * stepX,
      y: padTop + chartH - (value / 100) * chartH
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

  requestAnimationFrame(drawAuditsTrendChart);

  $("#fpAuditsRunBtn")?.addEventListener("click", async () => {
    const ok = await safeRunAudit();
    if (ok) {
      await loadData({ silent: true });
      renderRoute({ preserveScroll: true });
    }
  });

  $("#fpAuditsExportBtn")?.addEventListener("click", async () => {
    await safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
  });

  const search = $("#fpAuditsSearch");
  const status = $("#fpAuditsStatus");
  const sort = $("#fpAuditsSort");

  if (search) {
    search.addEventListener("input", (e) => {
      state.filters.audits.q = e.target.value || "";
      renderRoute({ preserveScroll: true });
    });
  }

  if (status) {
    status.addEventListener("change", (e) => {
      state.filters.audits.status = e.target.value || "all";
      renderRoute({ preserveScroll: true });
    });
  }

  if (sort) {
    sort.addEventListener("change", (e) => {
      state.filters.audits.sort = e.target.value || "date_desc";
      renderRoute({ preserveScroll: true });
    });
  }

  $$("[data-audit-detail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openAuditDetail(btn.getAttribute("data-audit-detail"));
    });
  });

  bindQuickActionButtons();
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
        { title: "Lecture d’incidents", text: "Les incidents récents rendent la plateforme plus crédible." },
        { title: "Couche ops", text: "Ce module donne un vrai aspect opérationnel au SaaS." }
      ],
      4,
      getDaySeed("monitoring_why")
    );

    const recentIncidents = monitors
      .filter((m) => normalizeMonitorStatus(m) === "down")
      .slice(0, 4)
      .map((m) => ({
        title: m.url || "Monitor",
        text: `Incident détecté · ${formatDate(m.lastCheckedAt)}${m.lastResponseTimeMs ? ` · ${m.lastResponseTimeMs} ms` : ""}`,
        badge: "DOWN"
      }));

    const executionCards = getMonitorExecutionCards();

    const urgentMonitors = [...allMonitors]
      .sort((a, b) => {
        const aStatus = normalizeMonitorStatus(a);
        const bStatus = normalizeMonitorStatus(b);

        const rank = (s) => (s === "down" ? 0 : s === "unknown" ? 1 : 2);
        const byStatus = rank(aStatus) - rank(bStatus);
        if (byStatus !== 0) return byStatus;

        return new Date(a.lastCheckedAt || 0) - new Date(b.lastCheckedAt || 0);
      })
      .slice(0, 4);

    const featuredMonitor =
      [...allMonitors].sort((a, b) => new Date(b.lastCheckedAt || 0) - new Date(a.lastCheckedAt || 0))[0] || null;

    const potentialMonitors = pickLibrary(
      allMonitors.length
        ? allMonitors.map((m) => ({
            title: m.url || "Monitor",
            text: `Intervalle ${m.intervalMinutes ?? 60} min · ${normalizeMonitorStatus(m).toUpperCase()}${m.lastResponseTimeMs ? ` · ${m.lastResponseTimeMs} ms` : ""}`,
            badge:
              normalizeMonitorStatus(m) === "down"
                ? "PRIORITÉ"
                : normalizeMonitorStatus(m) === "up"
                  ? "STABLE"
                  : "À CADRER"
          }))
        : [
            { title: "Site principal", text: "Toujours prioritaire pour renforcer la valeur perçue du monitoring.", badge: "CORE" },
            { title: "Landing stratégique", text: "Une page de conversion mérite souvent une surveillance dédiée.", badge: "CRO" },
            { title: "Page locale rentable", text: "Surveiller une page locale importante renforce le pilotage business.", badge: "LOCAL" },
            { title: "Page de service clé", text: "Certaines pages commerciales méritent une attention plus forte.", badge: "VALUE" }
          ],
      4,
      getDaySeed("monitor_potential")
    );

    const flowCards = [
      {
        title: "1. Créer le monitor",
        text: "Choisir l’URL la plus utile à surveiller en priorité.",
        badge: "STEP 1"
      },
      {
        title: "2. Tester rapidement",
        text: "Valider tout de suite que la couche monitoring fonctionne réellement.",
        badge: "STEP 2"
      },
      {
        title: "3. Configurer les alertes",
        text: "Faire en sorte que les incidents remontent à la bonne personne.",
        badge: "STEP 3"
      },
      {
        title: "4. Relire les logs",
        text: "Transformer un incident en lecture crédible et exploitable.",
        badge: "STEP 4"
      }
    ];

    const businessSignals = pickLibrary(
      [
        { title: "Tranquillité client", text: "Le client sent que le site reste suivi en continu.", badge: "TRUST" },
        { title: "Service vivant", text: "Le monitoring rend le SaaS plus concret qu’un simple dashboard passif.", badge: "LIVE" },
        { title: "Valeur récurrente", text: "Une surveillance continue aide à justifier la logique d’abonnement.", badge: "MRR" },
        { title: "Réactivité premium", text: "Le produit paraît plus sérieux quand il est capable de faire remonter les incidents.", badge: "PREMIUM" },
        { title: "Couche opérationnelle", text: "Le monitoring ajoute une vraie dimension ops au produit.", badge: "OPS" },
        { title: "Réduction du risque", text: "Détecter plus vite une panne protège trafic, leads et image.", badge: "RISK" },
        { title: "Support commercial", text: "Le monitoring aide à montrer que le service ne se limite pas au SEO.", badge: "VALUE" },
        { title: "Suivi crédible", text: "Les statuts et les logs rendent le suivi plus tangible dans le temps.", badge: "FOLLOW" }
      ],
      4,
      getDaySeed("monitor_business_signals")
    );

    const enrichedIncidentCards = recentIncidents.length
      ? recentIncidents
      : pickLibrary(
          [
            { title: "Aucun incident majeur", text: "La surveillance actuelle ne remonte pas d’alerte critique récente.", badge: "UP" },
            { title: "Lecture stable", text: "La plateforme montre un comportement cohérent sur la période actuelle.", badge: "STABLE" },
            { title: "Signal rassurant", text: "Une bonne stabilité renforce la perception de sérieux côté client.", badge: "TRUST" },
            { title: "Potentiel d’upsell", text: "Une surveillance propre peut être mieux valorisée dans les rapports ou le plan supérieur.", badge: "VALUE" }
          ],
          4,
          getDaySeed("monitor_incidents_fallback")
        );

    const capacityCards = [
      {
        title: "Quota monitors",
        text: `${getUsageBucket(state.me?.usage || {}, "monitor")?.used ?? 0}/${getUsageBucket(state.me?.usage || {}, "monitor")?.limit ?? 0} utilisés`,
        badge: "QUOTA"
      },
      {
        title: "Capacité restante",
        text: `${
          Math.max(
            0,
            Number(getUsageBucket(state.me?.usage || {}, "monitor")?.limit ?? 0) -
            Number(getUsageBucket(state.me?.usage || {}, "monitor")?.used ?? 0)
          )
        } monitors encore disponibles sur cette période.`,
        badge: "RESTANT"
      },
      {
        title: "Extension monitors",
        text: hasAddon("monitorsPack50")
          ? "L’add-on monitors +50 est actif sur ce compte."
          : "Aucun add-on monitors supplémentaire détecté.",
        badge: hasAddon("monitorsPack50") ? "ON" : "OFF"
      },
      {
        title: "Niveau uptime",
        text: hasPlan("pro")
          ? "Le plan permet une lecture plus vendable et plus détaillée des statuts uptime."
          : "La lecture uptime avancée reste réservée à un plan supérieur.",
        badge: hasPlan("pro") ? "PRO" : "BASE"
      }
    ];

    const proMonitorCards = hasPlan("pro")
      ? pickLibrary(
          [
            { title: "Lecture uptime premium", text: "Le plan Pro rend le module plus crédible dans une logique client-ready.", badge: "PRO" },
            { title: "Analyse incidents", text: "Les incidents prennent plus de valeur quand ils peuvent être relus et expliqués proprement.", badge: "OPS" },
            { title: "Support de rétention", text: "Le monitoring aide à défendre l’abonnement par une valeur continue.", badge: "MRR" },
            { title: "Restitution premium", text: "Le statut uptime devient plus utile commercialement qu’un simple indicateur brut.", badge: "VALUE" }
          ],
          4,
          getDaySeed("monitor_pro_cards")
        )
      : [];

    const ultraMonitorCards = hasPlan("ultra")
      ? pickLibrary(
          [
            { title: "Pilotage portefeuille", text: "Le niveau Ultra donne plus de sens à la surveillance quand plusieurs contextes sont suivis.", badge: "ULTRA" },
            { title: "Lecture ops center", text: "La page devient plus proche d’un vrai centre de contrôle opérationnel.", badge: "OPS" },
            { title: "Priorisation multi-monitors", text: "Identifier quoi tester ou surveiller en premier devient plus stratégique.", badge: "PRIORITY" },
            { title: "Surveillance scalable", text: "Le mode Ultra donne plus de cohérence à une logique de volume, d’équipe ou de multi-sites.", badge: "SCALE" },
            { title: "Couche premium maximale", text: "Le monitoring devient une vraie brique haut de gamme du produit.", badge: "VALUE+" },
            { title: "Exécution avancée", text: "Logs, incidents, quotas et alertes s’intègrent dans une logique plus complète.", badge: "FLOW+" }
          ],
          6,
          getDaySeed("monitor_ultra_cards")
        )
      : [];

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
            "Actions immédiates",
            "Pilotage opérationnel",
            "Des actions réelles au lieu d’une simple lecture de statut.",
            createActionGrid(executionCards)
          )}

          ${createSectionCard(
            "Priorité immédiate",
            "À surveiller maintenant",
            "Les monitors à traiter en premier selon leur statut ou leur fraîcheur de vérification.",
            urgentMonitors.length
              ? `
                <div class="fpRows">
                  ${urgentMonitors.map((m) => `
                    <div class="fpRowCard">
                      <div class="fpRowMain">
                        <div class="fpRowTitle">${esc(m.url || "Monitor")}</div>
                        <div class="fpRowMeta">
                          ${esc(normalizeMonitorStatus(m).toUpperCase())} · ${esc(m.intervalMinutes ?? 60)} min · ${esc(formatDate(m.lastCheckedAt))}
                        </div>
                      </div>
                      <div class="fpRowRight" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
                        <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-monitor-test="${esc(normalizeMonitorId(m))}">Tester</button>
                        <button class="fpBtn fpBtnSoft fpBtnSmall" type="button" data-monitor-logs="${esc(normalizeMonitorId(m))}">Logs</button>
                        <button class="fpBtn fpBtnDanger fpBtnSmall" type="button" data-monitor-delete="${esc(normalizeMonitorId(m))}">Supprimer</button>
                      </div>
                    </div>
                  `).join("")}
                </div>
              `
              : createEmpty("Aucun monitor prioritaire pour le moment.")
          )}

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
                      <div>
                        <div class="fpTableUrl">${esc(m.url || "Monitor")}</div>
                        <div class="fpTableMeta" style="margin-top:8px;color:var(--fpMuted);font-size:13px;font-weight:700;line-height:1.45">
                          ${
                            normalizeMonitorStatus(m) === "down"
                              ? "Incident actif ou récent détecté."
                              : normalizeMonitorStatus(m) === "up"
                                ? "Statut stable actuellement."
                                : "Statut encore peu exploitable."
                          }
                          ${m.lastResponseTimeMs ? ` · ${esc(m.lastResponseTimeMs)} ms` : ""}
                          ${m.lastStatusCode ? ` · HTTP ${esc(m.lastStatusCode)}` : ""}
                        </div>
                      </div>

                      <div>${createBadge(normalizeMonitorStatus(m))}</div>

                      <div>
                        <div style="font-weight:900">${esc(m.intervalMinutes ?? 60)} min</div>
                        <div style="margin-top:6px;color:var(--fpMuted);font-size:13px;font-weight:700">
                          ${Number(m.intervalMinutes ?? 60) <= 15 ? "Surveillance plus serrée" : "Surveillance standard"}
                        </div>
                      </div>

                      <div>
                        <div style="font-weight:900">${esc(formatDate(m.lastCheckedAt))}</div>
                        <div style="margin-top:6px;color:var(--fpMuted);font-size:13px;font-weight:700">
                          ${m.lastCheckedAt ? "Dernière vérification connue" : "Jamais vérifié"}
                        </div>
                      </div>

                      <div class="fpTableActions">
                        <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-monitor-test="${esc(normalizeMonitorId(m))}">Tester</button>
                        <button class="fpBtn fpBtnSoft fpBtnSmall" type="button" data-monitor-logs="${esc(normalizeMonitorId(m))}">Logs</button>
                        ${
                          hasPlan("pro")
                            ? `<button class="fpBtn fpBtnSoft fpBtnSmall" type="button" data-monitor-uptime="${esc(normalizeMonitorId(m))}">Uptime</button>`
                            : ``
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
            "Répartition",
            "Répartition des statuts",
            "Vue instantanée de la santé du monitoring actif.",
            `
              <div class="fpHealthGrid">
                <div class="fpHealthCard">
                  <div class="fpHealthTitle">UP</div>
                  <div class="fpHealthValue">${health.up}</div>
                  <div class="fpHealthMeta">Monitors stables</div>
                </div>

                <div class="fpHealthCard">
                  <div class="fpHealthTitle">DOWN</div>
                  <div class="fpHealthValue">${health.down}</div>
                  <div class="fpHealthMeta">Incidents à traiter</div>
                </div>

                <div class="fpHealthCard">
                  <div class="fpHealthTitle">UNKNOWN</div>
                  <div class="fpHealthValue">${health.unknown}</div>
                  <div class="fpHealthMeta">Statuts peu exploitables</div>
                </div>

                <div class="fpHealthCard">
                  <div class="fpHealthTitle">Total</div>
                  <div class="fpHealthValue">${allMonitors.length}</div>
                  <div class="fpHealthMeta">Monitors chargés</div>
                </div>
              </div>
            `
          )}

          ${createSectionCard(
            "Potentiel",
            "Monitors à potentiel",
            "Les URLs de surveillance qui renforcent le plus la valeur perçue du produit.",
            createMiniRows(potentialMonitors)
          )}

          ${createSectionCard(
            "Incidents",
            "Incidents récents enrichis",
            "Une vraie lecture d’incidents rend cette page plus utile et plus premium.",
            createMiniRows(enrichedIncidentCards)
          )}

          ${createSectionCard(
            "Business",
            "Lecture business du monitoring",
            "Le module uptime renforce la confiance, la rétention et la crédibilité opérationnelle.",
            createMiniRows(businessSignals)
          )}

          ${createSectionCard(
            "Exécution",
            "Enchaînement recommandé",
            "Le meilleur flux pour transformer un monitor en couche de valeur continue.",
            createMiniRows(flowCards)
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

          ${hasPlan("pro") ? createSectionCard(
            "Mode Pro",
            "Lecture uptime premium",
            "Le plan Pro rend cette page plus utile pour la restitution et la valeur perçue.",
            createMiniRows(proMonitorCards)
          ) : ""}

          ${hasPlan("ultra") ? createSectionCard(
            "Mode Ultra",
            "Pilotage avancé du monitoring",
            "Le niveau Ultra pousse davantage la logique ops center, portefeuille et scalabilité.",
            createMiniRows(ultraMonitorCards)
          ) : ""}
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

                <div class="fpStatCard">
                  <div class="fpStatLabel">UP</div>
                  <div class="fpStatValue">${health.up}</div>
                  <div class="fpStatMeta">Stables actuellement</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">DOWN</div>
                  <div class="fpStatValue">${health.down}</div>
                  <div class="fpStatMeta">Sous attention</div>
                </div>
              </div>
            `
          )}

          ${createSectionCard(
            "Mise en avant",
            "Monitor mis en avant",
            "Le monitor le plus récemment vérifié mérite une lecture plus premium.",
            featuredMonitor
              ? `
                <div class="fpAccountHero">
                  <div>
                    <div class="fpCardKicker">Dernier check important</div>
                    <div class="fpSectionTitle" style="font-size:22px">${esc(featuredMonitor.url || "Monitor")}</div>
                    <div class="fpCardText">
                      ${esc(normalizeMonitorStatus(featuredMonitor).toUpperCase())} · ${esc(featuredMonitor.intervalMinutes ?? 60)} min · ${esc(formatDate(featuredMonitor.lastCheckedAt))}
                      ${featuredMonitor.lastResponseTimeMs ? ` · ${esc(featuredMonitor.lastResponseTimeMs)} ms` : ""}
                    </div>
                    <div class="fpDetailActions" style="margin-top:14px">
                      <button class="fpBtn fpBtnPrimary fpBtnSmall" type="button" data-monitor-test="${esc(normalizeMonitorId(featuredMonitor))}">Tester</button>
                      <button class="fpBtn fpBtnGhost fpBtnSmall" type="button" data-monitor-logs="${esc(normalizeMonitorId(featuredMonitor))}">Logs</button>
                    </div>
                  </div>
                  <div class="fpAccountHeroRight">
                    <div class="fpAccountPlanChip">${esc(normalizeMonitorStatus(featuredMonitor).toUpperCase())}</div>
                  </div>
                </div>
              `
              : createEmpty("Aucun monitor récent à mettre en avant.")
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
            "Plan / addons",
            "Capacité du plan",
            "Les quotas et niveaux changent la vraie utilité de cette page.",
            createMiniRows(capacityCards)
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
      if (ok) await loadData({ silent: true });
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
        if (ok) await loadData({ silent: true });
      });
    });

    $$("[data-monitor-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-monitor-delete");
        const ok = await safeDeleteMonitor(id);
        if (ok) await loadData({ silent: true });
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

    const exportsUsage = getUsageBucket(usage, "export");
    const pdfUsage = getUsageBucket(usage, "pdf");

    const checklist = getReportChecklistCards().map((t) => ({
      title: t,
      text: "Ce point améliore la lisibilité, la valeur perçue et la qualité du livrable."
    }));

    const formatCards = getReportFormatCards();
    const executionCards = getReportExecutionCards();

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
          </div>
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Actions immédiates",
            "Génération orientée client",
            "Des blocs qui rendent la page rapports vraiment utile.",
            createActionGrid(executionCards)
          )}

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
                  <div class="fpStatLabel">Exports</div>
                  <div class="fpStatValue">${esc(formatUsage(exportsUsage))}</div>
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

          ${createSectionCard(
            "Capacité",
            "Plan et quotas",
            "Vue rapide de ce que le compte peut produire.",
            createMiniRows([
              {
                title: "Exports",
                text: `${exportsUsage?.used ?? 0}/${exportsUsage?.limit ?? 0} utilisés`,
                badge: "EXPORT"
              },
              {
                title: "PDF",
                text: `${pdfUsage?.used ?? 0}/${pdfUsage?.limit ?? 0} utilisés`,
                badge: "PDF"
              }
            ])
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

  function renderLocalSeoPage() {
    const axes = getLocalAxisCards();
    const businessCards = getLocalBusinessCards();
    const executionCards = getLocalExecutionCards();
    const benchmarkRows = pickLibrary(
      libraries.competitorBenchmarks,
      4,
      getDaySeed(`benchmark_${state.rangeDays}`)
    );
    const targets = getMapTargets();

    setPage(`
      ${createSectionCard(
        "Local SEO",
        "Hub local",
        "Local SEO absorbe Concurrents et Map pour garder une navigation plus claire.",
        `
          ${createActionGrid(executionCards)}

          <div style="margin-top:18px"></div>
          ${renderCheckGrid(axes)}
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Impact business",
            "Pourquoi le local est très vendeur",
            "Particulièrement utile pour PME, commerces et indépendants.",
            renderPriorityList(businessCards)
          )}

          ${createSectionCard(
            "Benchmark intégré",
            "Concurrents absorbés dans Local SEO",
            "La page concurrents est fusionnée ici pour alléger le dashboard.",
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

          ${createSectionCard(
            "Carte intégrée",
            "Map absorbée dans Local SEO",
            "La logique carte et cibles locales reste ici dans le même hub.",
            `
              <div class="fpRows">
                ${targets.map((item) => `
                  <div class="fpRowCard">
                    <div class="fpRowMain">
                      <div class="fpRowTitle">${esc(item.name)}</div>
                      <div class="fpRowMeta">${esc(item.city)} · ${esc(item.rating)}★ · ${esc(item.reviews)}</div>
                      <div class="fpRowMeta" style="margin-top:8px">${esc(item.site)}</div>
                    </div>
                    <div class="fpRowRight">
                      <div class="fpAddonPill on">${esc(item.tag)}</div>
                    </div>
                  </div>
                `).join("")}
              </div>
            `
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Lecture simple",
            "Ce que le client comprend vite",
            "Le local SEO est une brique très facile à valoriser.",
            renderCheckGrid(
              pickLibrary(
                [
                  { title: "Visibilité concrète", text: "Le client comprend tout de suite ce que le local SEO change." },
                  { title: "Signal premium", text: "La présence locale donne un effet très tangible au service." },
                  { title: "Levier rétention", text: "Un client qui voit ses zones progresser a moins envie d’arrêter." }
                ],
                3,
                getDaySeed("local_simple")
              )
            )
          )}
        </div>
      </div>
    `);
  }

  function renderTeamPage() {
    const team = getTeamCards();
    const notes = getNotesItems();
    const messages = getChatMessages().slice(-20);
    const teamActions = getTeamExecutionCards();

    setPage(`
      ${createSectionCard(
        "Équipe",
        "Hub collaboration",
        "Équipe absorbe Discussion et Notes pour garder un seul espace collaboration.",
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
            "Actions équipe",
            "Accès utiles",
            "Plus de concret pour transformer la page en vrai espace d’action.",
            createActionGrid(teamActions)
          )}

          ${createSectionCard(
            "Notes intégrées",
            "Notes absorbées dans Équipe",
            "La page Notes disparaît de la navigation principale et vit désormais ici.",
            `
              <div class="fpDetailActions" style="margin-bottom:14px">
                <button class="fpBtn fpBtnPrimary" type="button" data-quick-action="notes_add">Ajouter une note</button>
                <button class="fpBtn fpBtnGhost" type="button" data-quick-action="goto_missions">Voir missions</button>
              </div>

              ${
                notes.length
                  ? `
                    <div class="fpRows">
                      ${notes.map((note) => `
                        <div class="fpRowCard">
                          <div class="fpRowMain">
                            <div class="fpRowTitle">${esc(note.title)}</div>
                            <div class="fpRowMeta">${esc(note.text || "")}</div>
                            <div class="fpRowMeta" style="margin-top:8px">${esc(formatDate(note.updatedAt))}</div>
                          </div>
                          <div class="fpRowRight">
                            <button class="fpBtn fpBtnDanger fpBtnSmall" type="button" data-note-delete="${esc(note.id)}">Supprimer</button>
                          </div>
                        </div>
                      `).join("")}
                    </div>
                  `
                  : createEmpty("Aucune note enregistrée.")
              }
            `
          )}

          ${createSectionCard(
            "Discussion intégrée",
            "Discussion absorbée dans Équipe",
            "La page Discussion disparaît de la navigation principale et vit désormais ici.",
            `
              <div class="fpDetailActions" style="margin-bottom:14px">
                <button class="fpBtn fpBtnPrimary" type="button" data-quick-action="chat_add">Ajouter un message</button>
              </div>

              ${
                messages.length
                  ? `
                    <div class="fpRows">
                      ${messages.map((msg) => `
                        <div class="fpRowCard">
                          <div class="fpRowMain">
                            <div class="fpRowTitle">${esc(msg.author || "Utilisateur")}</div>
                            <div class="fpRowMeta">${esc(msg.text || "")}</div>
                            <div class="fpRowMeta" style="margin-top:8px">${esc(formatDate(msg.createdAt))}</div>
                          </div>
                        </div>
                      `).join("")}
                    </div>
                  `
                  : createEmpty("Aucun message pour le moment.")
              }
            `
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Usage",
            "Comment exploiter cette page",
            "Invitation → rôles → notes → discussion → paramètres.",
            createMiniRows([
              {
                title: "Inviter puis structurer",
                text: "L’intérêt de cette page est d’accompagner une vraie logique de collaboration.",
                badge: "FLOW"
              },
              {
                title: "Monter en gamme",
                text: "Une vraie logique équipe rend le SaaS moins remplaçable.",
                badge: "VALUE"
              }
            ])
          )}
        </div>
      </div>
    `);

    $$("[data-note-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        deleteSimpleNote(btn.getAttribute("data-note-delete"));
        renderRoute({ preserveScroll: true });
      });
    });
  }

  function renderSettingsPage() {
    const s = state.orgSettings || {};
    const me = state.me || {};
    const extraEmails = Array.isArray(s.alertExtraEmails) ? s.alertExtraEmails.join(", ") : "";
    const addons = getAddonEntries();
    const settingTips = libraries.settingsInfoTips;
    const activeTools = getActiveToolCards();

    const settingsActionCards = getSettingsExecutionCards();

    setPage(`
      ${createSectionCard(
        "Paramètres",
        "Préférences du workspace",
        "Configure les alertes, l’interface et les accès rapides.",
        `
          <div class="fpGrid fpGridMain">
            <div class="fpCol fpColMain">
              <div class="fpCardInner">
                <div class="fpCardInnerTitle" style="font-size:26px">Alertes email</div>
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
                <div class="fpCardInnerTitle" style="font-size:26px">Préférences interface</div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Thème automatique</div>
                    <div class="fpToggleHint">${esc(settingTips[0].text)}</div>
                  </div>
                  <button type="button" class="fpSwitch ${state.uiPrefs.themeAuto ? "on" : ""}" id="fpThemeAutoToggle"></button>
                </div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Statut temps réel</div>
                    <div class="fpToggleHint">${esc(settingTips[1].text)}</div>
                  </div>
                  <button type="button" class="fpSwitch ${state.uiPrefs.liveStatus ? "on" : ""}" id="fpLiveStatusToggle"></button>
                </div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Listes compactes</div>
                    <div class="fpToggleHint">${esc(settingTips[2].text)}</div>
                  </div>
                  <button type="button" class="fpSwitch ${state.uiPrefs.compactLists ? "on" : ""}" id="fpCompactListsToggle"></button>
                </div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Cartes avancées</div>
                    <div class="fpToggleHint">${esc(settingTips[3].text)}</div>
                  </div>
                  <button type="button" class="fpSwitch ${state.uiPrefs.showAdvancedCards ? "on" : ""}" id="fpAdvancedCardsToggle"></button>
                </div>
              </div>

              <div class="fpCardInner">
                <div class="fpCardInnerTitle" style="font-size:26px">Actions utiles</div>
                ${createActionGrid(settingsActionCards)}
              </div>
            </div>

            <div class="fpCol fpColSide">
              <div class="fpCardInner">
                <div class="fpCardInnerTitle" style="font-size:26px">Informations du compte</div>

                <div class="fpSettingsList" style="margin-top:18px">
                  <div class="fpSettingsRow"><span>Organisation</span><strong>${esc(normalizeOrgName())}</strong></div>
                  <div class="fpSettingsRow"><span>Plan</span><strong>${esc(planLabel(me.plan))}</strong></div>
                  <div class="fpSettingsRow"><span>Rôle</span><strong>${esc(cap(me.role || "owner"))}</strong></div>
                  <div class="fpSettingsRow"><span>Destinataires</span><strong>${esc(recipientsLabel(s.alertRecipients))}</strong></div>
                  <div class="fpSettingsRow"><span>Essai</span><strong>${esc(trialLabel(me.trialEndsAt))}</strong></div>
                </div>
              </div>

              <div class="fpCardInner">
                <div class="fpCardInnerTitle" style="font-size:26px">Add-ons détectés</div>
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
                <div class="fpCardInnerTitle" style="font-size:26px">Modules activés</div>
                ${renderToolStateList(activeTools)}
              </div>
            </div>
          </div>
        `
      )}
    `);

    $("#fpSaveSettingsBtn")?.addEventListener("click", async () => {
      const ok = await saveOrgSettings();
      if (ok) await loadData({ silent: true });
    });

    $("#fpThemeAutoToggle")?.addEventListener("click", () => toggleUiPref("themeAuto"));
    $("#fpLiveStatusToggle")?.addEventListener("click", () => toggleUiPref("liveStatus"));
    $("#fpCompactListsToggle")?.addEventListener("click", () => toggleUiPref("compactLists"));
    $("#fpAdvancedCardsToggle")?.addEventListener("click", () => toggleUiPref("showAdvancedCards"));
  }

  function renderBillingPage() {
    setPage(`
      ${createSectionCard(
        "Billing",
        "Facturation",
        "Accès rapide à la gestion de l’abonnement sans quitter le dashboard.",
        `
          <div class="fpReportsGrid">
            <div class="fpReportCard">
              <div class="fpReportTitle">Ouvrir la facturation externe</div>
              <div class="fpReportMeta">Accède à la gestion Stripe depuis la page interne du dashboard.</div>
              <div class="fpDetailActions">
                <a class="fpBtn fpBtnPrimary" href="/billing.html?return=%2Fdashboard.html%23billing">Ouvrir</a>
              </div>
            </div>

            <div class="fpReportCard">
              <div class="fpReportTitle">Gérer les add-ons</div>
              <div class="fpReportMeta">Active ou ajuste les options disponibles.</div>
              <div class="fpDetailActions">
                <a class="fpBtn fpBtnGhost" href="/addons.html">Add-ons</a>
              </div>
            </div>
          </div>
        `
      )}
    `);
  }
    function renderRoute(options = {}) {
    const {
      scrollTop = false,
      preserveScroll = false,
    } = options;

    const previousWindowY = window.scrollY || 0;
    const previousMainY = els.main?.scrollTop || 0;
    const previousPageY = els.pageContainer?.scrollTop || 0;

    state.route = ROUTES.has(location.hash) ? location.hash : "#overview";

    const redirects = {
      "#tools": "#overview",
      "#calendar": "#overview",
      "#competitors": "#local-seo",
      "#map": "#local-seo",
      "#chat": "#team",
      "#notes": "#team",
    };

    if (redirects[state.route]) {
      const next = redirects[state.route];
      if (location.hash !== next) {
        history.replaceState(null, "", next);
      }
      state.route = next;
    }

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
      case "#local-seo":
        renderLocalSeoPage();
        break;
      case "#team":
        renderTeamPage();
        break;
      case "#billing":
        renderBillingPage();
        break;
      case "#settings":
        renderSettingsPage();
        break;
      default:
        renderOverviewPage();
        break;
    }

    afterRenderCurrentRoute();

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
        const id = openBtn.getAttribute("data-mission-open");
        const mission = findMissionById(id);
        if (mission) openMissionTarget(mission);
        return;
      }

      const billingBtn = e.target.closest("[data-go-billing]");
      if (billingBtn) {
        e.preventDefault();
        e.stopPropagation();
        location.hash = "#billing";
        return;
      }

      const quickBtn = e.target.closest("[data-quick-action]");
      if (quickBtn) {
        e.preventDefault();
        e.stopPropagation();

        const action = quickBtn.getAttribute("data-quick-action") || "";
        const payload = quickBtn.getAttribute("data-quick-payload") || "";
        await runQuickAction(action, payload);
        return;
      }

      const toolToggleBtn = e.target.closest("[data-tool-toggle]");
      if (toolToggleBtn) {
        e.preventDefault();
        e.stopPropagation();

        const toolId = toolToggleBtn.getAttribute("data-tool-toggle");
        if (!toolId) return;

        const next = !isToolActive(toolId);
        setToolActive(toolId, next);
        setStatus(next ? "Module activé — OK" : "Module désactivé — OK", "ok");
        renderRoute({ preserveScroll: true });
        return;
      }

      const missionDirectBtn = e.target.closest("[data-mission-direct-action]");
      if (missionDirectBtn) {
        e.preventDefault();
        e.stopPropagation();

        const action = missionDirectBtn.getAttribute("data-mission-direct-action") || "";
        await runQuickAction(action);
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

    els.btnOpenBillingSide?.addEventListener("click", () => {
      location.hash = "#billing";
    });

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
    loadToolStates();
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
