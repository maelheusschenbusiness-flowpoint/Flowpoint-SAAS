'use strict';

/* ═════════════════════════════════════════════════════════════
   FLOWPOINT DASHBOARD JS — CORE STABLE v1
   Compatible avec dashboard.html actuel + dashboard.css actuel
   ═════════════════════════════════════════════════════════════ */

(function () {
  if (window.__FLOWPOINT_DASHBOARD_LOADED__) {
    console.warn('[FlowPoint] Dashboard déjà initialisé.');
    return;
  }

  window.__FLOWPOINT_DASHBOARD_LOADED__ = true;

  /* ─────────────────────────────────────────────
     CONSTANTES
  ───────────────────────────────────────────── */

  const TOKEN_KEY = 'fp_token';

  const STORAGE_KEYS = {
    theme: 'fp_theme',
    sidebarCollapsed: 'fp_sidebar_collapsed',
    activityLastSeen: 'fp_activity_last_seen',
    pushEnabled: 'fp_push_enabled',
    teamMessages: 'fp_team_messages_v1',
    notes: 'fp_notes_v1',
    calendar: 'fp_calendar_v1',
    layout: 'fp_dashboard_layout_v1',
  };

  const ROUTES = [
    'overview',
    'growth',
    'missions',
    'audits',
    'monitors',
    'local-seo',
    'competitor',
    'conversion',
    'data-explorer',
    'reports',
    'alerts-center',
    'activity-feed',
    'team',
    'client-mode',
    'billing',
    'settings',
    'ai',
  ];

  const ROUTE_LABELS = {
    overview: "Vue d'ensemble",
    growth: 'Croissance',
    missions: 'Missions',
    audits: 'Audits SEO',
    monitors: 'Monitors',
    'local-seo': 'Local SEO',
    competitor: 'Concurrents',
    conversion: 'Conversion',
    'data-explorer': 'Data Explorer',
    reports: 'Rapports',
    'alerts-center': "Centre d'alertes",
    'activity-feed': 'Activité',
    team: 'Équipe',
    'client-mode': 'Mode Client',
    billing: 'Facturation',
    settings: 'Paramètres',
    ai: 'Assistant IA',
  };

  const PLAN_LIMITS = {
    standard: {
      audits: 30,
      monitors: 3,
      reports: 30,
      exports: 30,
      seats: 1,
      aiCredits: 100,
      retentionDays: 30,
    },
    pro: {
      audits: 300,
      monitors: 50,
      reports: 300,
      exports: 300,
      seats: 3,
      aiCredits: 1000,
      retentionDays: 365,
    },
    ultra: {
      audits: 2000,
      monitors: 300,
      reports: 2000,
      exports: 2000,
      seats: 10,
      aiCredits: 10000,
      retentionDays: 730,
    },
  };

  /* ─────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────── */

  const STATE = {
    initialized: false,
    booting: false,
    route: 'overview',
    subRoute: null,
    theme: localStorage.getItem(STORAGE_KEYS.theme) || 'dark',
    sidebarCollapsed: localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === '1',
    mobileSidebarOpen: false,

    user: null,
    org: null,
    plan: 'standard',
    limits: PLAN_LIMITS.standard,

    audits: [],
    monitors: [],
    reports: [],
    missions: [],
    alerts: [],
    competitors: [],
    activityEvents: [],
    notifications: [],
    teamMessages: [],
    notes: [],
    calendarEvents: [],

    aiMessages: [],
    aiMemory: {
      businessGoal: 'Améliorer visibilité, conversion et rétention client.',
      preferredTone: 'direct, premium, actionnable',
      defaultAudience: 'PME / indépendants',
    },

    ui: {
      commandPaletteOpen: false,
      activityPanelOpen: false,
      floatPanelOpen: false,
      notificationOpen: false,
      messageOpen: false,
      fabOpen: false,
      loading: false,
      error: null,
    },

    realtime: {
      billingEvents: null,
      activityEvents: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
    },

    filters: {
      audits: '',
      monitors: '',
      missions: 'all',
      activity: 'all',
      reports: '',
    },

    selected: {
      audits: new Set(),
      monitors: new Set(),
    },

    cacheLoaded: false,
  };

  window.FP = {
    STATE,
    navigate,
    navigateSub,
    render,
    showToast,
    openFloatPanel,
    closeFloatPanel,
    logout,
    api,
  };

  window.STATE = STATE;

  /* ─────────────────────────────────────────────
     HELPERS DOM
  ───────────────────────────────────────────── */

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function pageEl() {
    return $('#fp-page');
  }

  function escHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, Number(n) || 0));
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function formatDate(value) {
    if (!value) return '—';

    try {
      return new Date(value).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '—';
    }
  }

  function formatTime(value) {
    if (!value) return '—';

    try {
      return new Date(value).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  function timeAgo(value) {
    const ts = new Date(value || Date.now()).getTime();
    const diff = Math.max(0, Date.now() - ts);
    const min = Math.floor(diff / 60000);
    const h = Math.floor(min / 60);
    const d = Math.floor(h / 24);

    if (min < 1) return 'maintenant';
    if (min < 60) return `${min} min`;
    if (h < 24) return `${h} h`;
    return `${d} j`;
  }

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function initials(name = 'FP') {
    return String(name)
      .split(/[ @._-]/)
      .filter(Boolean)
      .slice(0, 2)
      .map(x => x[0]?.toUpperCase())
      .join('') || 'FP';
  }

  /* ─────────────────────────────────────────────
     TOKEN + API
  ───────────────────────────────────────────── */

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  }

  function removeToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  async function api(path, options = {}) {
    const token = getToken();

    let response;

    try {
      response = await fetch(`/api${path}`, {
        ...options,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(options.headers || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch (err) {
      throw new Error('Backend indisponible. Vérifie Render ou la connexion.');
    }

    if (response.status === 401 || response.status === 403) {
      removeToken();
      window.location.href = '/login.html';
      return null;
    }

    const text = await response.text();
    let data = {};

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Réponse serveur invalide. Un asset ou une route API renvoie probablement du HTML.');
      }
    }

    if (!response.ok) {
      throw new Error(data?.error || `Erreur API ${response.status}`);
    }

    return data;
  }

  async function apiGet(path) {
    return api(path, { method: 'GET' });
  }

  async function apiPost(path, body = {}) {
    return api(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async function apiPatch(path, body = {}) {
    return api(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async function apiDelete(path) {
    return api(path, { method: 'DELETE' });
  }

  /* ─────────────────────────────────────────────
     LOCAL STORAGE
  ───────────────────────────────────────────── */

  function loadLocalCollections() {
    STATE.teamMessages = safeJsonParse(localStorage.getItem(STORAGE_KEYS.teamMessages), [
      {
        id: uid('msg'),
        author: 'FlowPoint IA',
        channel: 'general',
        text: 'Bienvenue dans le workspace FlowPoint.',
        createdAt: new Date().toISOString(),
        system: true,
      },
    ]);

    STATE.notes = safeJsonParse(localStorage.getItem(STORAGE_KEYS.notes), [
      {
        id: uid('note'),
        title: 'Plan de lancement',
        body: 'Stabiliser auth, dashboard, billing, monitoring puis ajouter les automatisations IA.',
        createdAt: new Date().toISOString(),
      },
    ]);

    STATE.calendarEvents = safeJsonParse(localStorage.getItem(STORAGE_KEYS.calendar), [
      {
        id: uid('cal'),
        title: 'Revue SaaS hebdo',
        date: new Date().toISOString().slice(0, 10),
        time: '09:00',
        type: 'strategy',
      },
    ]);
  }

  function saveTeamMessages() {
    localStorage.setItem(STORAGE_KEYS.teamMessages, JSON.stringify(STATE.teamMessages));
  }

  function saveNotes() {
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(STATE.notes));
  }

  function saveCalendar() {
    localStorage.setItem(STORAGE_KEYS.calendar, JSON.stringify(STATE.calendarEvents));
  }

  /* ─────────────────────────────────────────────
     SESSION
  ───────────────────────────────────────────── */

  async function verifySession() {
    const token = getToken();

    if (!token) {
      window.location.href = '/login.html';
      return false;
    }

    const data = await apiGet('/auth/me');

    if (!data) return false;

    const user = data.user || data;
    const org = data.org || user.org || null;

    STATE.user = user;
    STATE.org = org;
    STATE.plan = normalizePlan(org?.plan || user?.plan || 'standard');
    STATE.limits = PLAN_LIMITS[STATE.plan] || PLAN_LIMITS.standard;

    updateUserUI();

    return true;
  }

  function normalizePlan(plan) {
    const p = String(plan || 'standard').toLowerCase();

    if (p.includes('ultra')) return 'ultra';
    if (p.includes('pro')) return 'pro';
    return 'standard';
  }

  function updateUserUI() {
    const user = STATE.user || {};
    const org = STATE.org || {};

    const sidebarUser = $('#sidebar-user');

    if (sidebarUser) {
      sidebarUser.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          <div class="fp-user-avatar">${escHtml(initials(user.firstName || user.email || 'FP'))}</div>
          <div style="min-width:0">
            <div class="fp-user-name">${escHtml(user.firstName || user.email || 'Utilisateur')}</div>
            <div class="fp-user-plan">${escHtml((org.name || user.companyName || STATE.plan || 'FlowPoint').toString())}</div>
          </div>
        </div>
      `;
    }

    renderPlanSwitcher();
    renderUsageSidebar();
  }

  /* ─────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    if (STATE.initialized || STATE.booting) return;

    STATE.booting = true;

    try {
      document.documentElement.setAttribute('data-theme', STATE.theme);

      loadLocalCollections();

      await verifySession();

      await loadDashboardData();

      bindGlobalEvents();
      bindNavigation();
      bindTopbar();
      bindPanels();
      bindFab();
      bindActivityPanel();
      bindKeyboard();

      initRouter();
      initRealtime();

      STATE.initialized = true;
      STATE.booting = false;

      render();
      showToast('success', 'Dashboard FlowPoint chargé.');
    } catch (err) {
      STATE.booting = false;
      console.error('[FlowPoint boot]', err);
      showFatalError(err.message || 'Erreur de chargement du dashboard.');
    }
  }

  async function loadDashboardData() {
    const requests = [
      apiGet('/audits').catch(() => null),
      apiGet('/monitors').catch(() => null),
      apiGet('/reports').catch(() => null),
      apiGet('/missions').catch(() => null),
    ];

    const [auditsRes, monitorsRes, reportsRes, missionsRes] = await Promise.all(requests);

    STATE.audits = normalizeArrayResponse(auditsRes, 'audits');
    STATE.monitors = normalizeArrayResponse(monitorsRes, 'monitors');
    STATE.reports = normalizeArrayResponse(reportsRes, 'reports');
    STATE.missions = normalizeArrayResponse(missionsRes, 'missions');

    if (!STATE.audits.length) STATE.audits = demoAudits();
    if (!STATE.monitors.length) STATE.monitors = demoMonitors();
    if (!STATE.reports.length) STATE.reports = demoReports();
    if (!STATE.missions.length) STATE.missions = demoMissions();

    STATE.alerts = buildAlertsFromData();
    STATE.competitors = demoCompetitors();
    STATE.activityEvents = demoActivity();

    STATE.cacheLoaded = true;
  }

  function normalizeArrayResponse(res, key) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (Array.isArray(res[key])) return res[key];
    if (Array.isArray(res.data)) return res.data;
    return [];
  }
    /* ─────────────────────────────────────────────
     ROUTER
  ───────────────────────────────────────────── */

  function initRouter() {
    window.addEventListener('hashchange', handleRoute);

    if (!location.hash) {
      location.hash = '#overview';
    }

    handleRoute();
  }

  function handleRoute() {
    const hash = location.hash.replace('#', '') || 'overview';

    const route = ROUTES.includes(hash)
      ? hash
      : 'overview';

    STATE.route = route;

    updateBreadcrumb();
    updateActiveNav();

    render();
  }

  function navigate(route) {
    if (!ROUTES.includes(route)) {
      route = 'overview';
    }

    location.hash = `#${route}`;

    closeMobileSidebar();
  }

  function navigateSub(route, subRoute = null) {
    STATE.subRoute = subRoute;
    navigate(route);
  }

  function updateBreadcrumb() {
    const el = $('#fp-breadcrumb-current');

    if (!el) return;

    el.textContent =
      ROUTE_LABELS[STATE.route] ||
      'Dashboard';
  }

  function updateActiveNav() {
    $$('[data-route]').forEach(item => {
      item.classList.remove('active');

      if (
        item.dataset.route ===
        STATE.route
      ) {
        item.classList.add('active');
      }
    });
  }

  function bindNavigation() {
    $$('[data-route]').forEach(item => {
      item.addEventListener('click', event => {
        event.preventDefault();

        navigate(
          item.dataset.route
        );
      });
    });
  }

  /* ─────────────────────────────────────────────
     GLOBAL EVENTS
  ───────────────────────────────────────────── */

  function bindGlobalEvents() {
    let resizeTimer;

    window.addEventListener(
      'resize',
      () => {
        clearTimeout(resizeTimer);

        resizeTimer = setTimeout(() => {
          FP.mobile =
            window.innerWidth <= 900;

          if (!FP.mobile) {
            closeMobileSidebar();
          }
        }, 80);
      }
    );

    window.addEventListener(
      'online',
      () => {
        showToast(
          'success',
          'Connexion rétablie.'
        );
      }
    );

    window.addEventListener(
      'offline',
      () => {
        showToast(
          'warning',
          'Mode hors ligne.'
        );
      }
    );
  }

  /* ─────────────────────────────────────────────
     TOPBAR
  ───────────────────────────────────────────── */

  function bindTopbar() {
    const searchBtn =
      $('#fp-open-search');

    const notifBtn =
      $('#fp-open-notifications');

    const activityBtn =
      $('#fp-open-activity');

    const themeBtn =
      $('#fp-toggle-theme');

    if (searchBtn) {
      searchBtn.addEventListener(
        'click',
        toggleCommandPalette
      );
    }

    if (notifBtn) {
      notifBtn.addEventListener(
        'click',
        toggleNotifications
      );
    }

    if (activityBtn) {
      activityBtn.addEventListener(
        'click',
        toggleActivityPanel
      );
    }

    if (themeBtn) {
      themeBtn.addEventListener(
        'click',
        toggleTheme
      );
    }
  }

  /* ─────────────────────────────────────────────
     SIDEBAR
  ───────────────────────────────────────────── */

  function toggleMobileSidebar() {
    STATE.mobileSidebarOpen =
      !STATE.mobileSidebarOpen;

    document.body.classList.toggle(
      'fp-mobile-sidebar-open',
      STATE.mobileSidebarOpen
    );
  }

  function closeMobileSidebar() {
    STATE.mobileSidebarOpen = false;

    document.body.classList.remove(
      'fp-mobile-sidebar-open'
    );
  }

  function bindPanels() {
    const sidebarToggle =
      $('#fp-sidebar-toggle');

    const mobileOverlay =
      $('#fp-mobile-overlay');

    if (sidebarToggle) {
      sidebarToggle.addEventListener(
        'click',
        toggleMobileSidebar
      );
    }

    if (mobileOverlay) {
      mobileOverlay.addEventListener(
        'click',
        closeMobileSidebar
      );
    }
  }

  /* ─────────────────────────────────────────────
     FLOAT PANEL
  ───────────────────────────────────────────── */

  function openFloatPanel(
    title,
    content
  ) {
    const panel =
      $('#fp-float-panel');

    if (!panel) return;

    panel.innerHTML = `
      <div class="fp-float-panel-card">

        <div class="fp-float-panel-top">

          <div class="fp-float-panel-title">
            ${escHtml(title)}
          </div>

          <button
            class="fp-icon-btn"
            id="fp-close-float-panel"
          >
            ✕
          </button>

        </div>

        <div class="fp-float-panel-content">
          ${content}
        </div>

      </div>
    `;

    panel.classList.add('show');

    $('#fp-close-float-panel')
      ?.addEventListener(
        'click',
        closeFloatPanel
      );
  }

  function closeFloatPanel() {
    $('#fp-float-panel')
      ?.classList.remove('show');
  }

  /* ─────────────────────────────────────────────
     FAB
  ───────────────────────────────────────────── */

  function bindFab() {
    const fab =
      $('#fp-fab-main');

    if (!fab) return;

    fab.addEventListener(
      'click',
      () => {
        STATE.ui.fabOpen =
          !STATE.ui.fabOpen;

        document.body.classList.toggle(
          'fp-fab-open',
          STATE.ui.fabOpen
        );
      }
    );
  }

  /* ─────────────────────────────────────────────
     ACTIVITY PANEL
  ───────────────────────────────────────────── */

  function bindActivityPanel() {
    $('#fp-close-activity')
      ?.addEventListener(
        'click',
        closeActivityPanel
      );
  }

  function toggleActivityPanel() {
    STATE.ui.activityPanelOpen =
      !STATE.ui.activityPanelOpen;

    document.body.classList.toggle(
      'fp-activity-open',
      STATE.ui.activityPanelOpen
    );

    renderActivityPanel();
  }

  function closeActivityPanel() {
    STATE.ui.activityPanelOpen =
      false;

    document.body.classList.remove(
      'fp-activity-open'
    );
  }

  function renderActivityPanel() {
    const panel =
      $('#fp-activity-panel-content');

    if (!panel) return;

    panel.innerHTML =
      STATE.activityEvents
        .slice(0, 30)
        .map(event => `
          <div class="fp-activity-item">

            <div class="fp-activity-dot ${escHtml(event.level || 'info')}"></div>

            <div style="min-width:0">

              <div class="fp-activity-title">
                ${escHtml(event.title)}
              </div>

              <div class="fp-activity-desc">
                ${escHtml(event.description || '')}
              </div>

            </div>

            <div class="fp-activity-time">
              ${timeAgo(event.createdAt)}
            </div>

          </div>
        `)
        .join('');
  }

  /* ─────────────────────────────────────────────
     NOTIFICATIONS
  ───────────────────────────────────────────── */

  function toggleNotifications() {
    STATE.ui.notificationOpen =
      !STATE.ui.notificationOpen;

    document.body.classList.toggle(
      'fp-notifications-open',
      STATE.ui.notificationOpen
    );

    renderNotifications();
  }

  function renderNotifications() {
    const panel =
      $('#fp-notifications-panel');

    if (!panel) return;

    panel.innerHTML = `
      <div class="fp-panel-head">
        Notifications
      </div>

      <div class="fp-panel-body">

        ${
          STATE.notifications.length
            ? STATE.notifications
                .map(item => `
                  <div class="fp-notification-item">

                    <div class="fp-notification-title">
                      ${escHtml(item.title)}
                    </div>

                    <div class="fp-notification-text">
                      ${escHtml(item.text)}
                    </div>

                  </div>
                `)
                .join('')
            : `
              <div class="fp-empty">
                Aucune notification
              </div>
            `
        }

      </div>
    `;
  }
    /* ─────────────────────────────────────────────
     COMMAND PALETTE
  ───────────────────────────────────────────── */

  function bindKeyboard() {
    window.addEventListener(
      'keydown',
      event => {

        const key =
          event.key.toLowerCase();

        if (
          (event.ctrlKey ||
            event.metaKey) &&
          key === 'k'
        ) {
          event.preventDefault();

          toggleCommandPalette();
        }

        if (
          key === 'escape'
        ) {

          closeCommandPalette();
          closeFloatPanel();
          closeActivityPanel();
        }
      }
    );
  }

  function toggleCommandPalette() {
    STATE.ui.commandPaletteOpen =
      !STATE.ui.commandPaletteOpen;

    document.body.classList.toggle(
      'fp-command-open',
      STATE.ui.commandPaletteOpen
    );

    renderCommandPalette();

    if (
      STATE.ui.commandPaletteOpen
    ) {

      setTimeout(() => {
        $('#fp-command-input')
          ?.focus();
      }, 40);
    }
  }

  function closeCommandPalette() {
    STATE.ui.commandPaletteOpen =
      false;

    document.body.classList.remove(
      'fp-command-open'
    );
  }

  function renderCommandPalette() {

    const root =
      $('#fp-command-results');

    if (!root) return;

    const routes =
      ROUTES.map(route => ({
        type: 'route',
        route,
        label:
          ROUTE_LABELS[route]
      }));

    root.innerHTML =
      routes.map(item => `
        <button
          class="fp-command-item"
          data-command-route="${escHtml(item.route)}"
        >

          <div class="fp-command-item-title">
            ${escHtml(item.label)}
          </div>

          <div class="fp-command-item-sub">
            Ouvrir ${escHtml(item.label)}
          </div>

        </button>
      `).join('');

    $$('[data-command-route]')
      .forEach(btn => {

        btn.addEventListener(
          'click',
          () => {

            navigate(
              btn.dataset.commandRoute
            );

            closeCommandPalette();
          }
        );
      });

    $('#fp-command-input')
      ?.addEventListener(
        'input',
        event => {

          const value =
            event.target.value
              .toLowerCase()
              .trim();

          $$('[data-command-route]')
            .forEach(btn => {

              const text =
                btn.textContent
                  .toLowerCase();

              btn.style.display =
                text.includes(value)
                  ? ''
                  : 'none';
            });
        }
      );
  }

  /* ─────────────────────────────────────────────
     REALTIME
  ───────────────────────────────────────────── */

  function initRealtime() {

    subscribeBillingEvents();

    subscribeActivityEvents();
  }

  function subscribeBillingEvents() {

    try {

      if (
        STATE.realtime.billingEvents
      ) {

        STATE.realtime.billingEvents.close();
      }

      const es =
        new EventSource(
          '/api/billing/events'
        );

      STATE.realtime.billingEvents =
        es;

      es.onmessage =
        event => {

          try {

            const payload =
              JSON.parse(
                event.data
              );

            addActivityEvent({
              level: 'success',

              title:
                payload.title ||
                'Billing event',

              description:
                payload.message ||
                'Nouvelle activité Stripe.',

              createdAt:
                new Date().toISOString(),
            });

          } catch (err) {

            console.error(err);
          }
        };

      es.onerror = () => {

        try {
          es.close();
        } catch {}

        clearTimeout(
          STATE.realtime.reconnectTimer
        );

        STATE.realtime.reconnectAttempts++;

        STATE.realtime.reconnectTimer =
          setTimeout(() => {

            subscribeBillingEvents();

          }, Math.min(
            10000,
            1000 *
            STATE.realtime.reconnectAttempts
          ));
      };

    } catch (err) {

      console.error(
        '[Realtime billing]',
        err
      );
    }
  }

  function subscribeActivityEvents() {

    addActivityEvent({
      level: 'info',
      title: 'Realtime actif',
      description:
        'Le système temps réel FlowPoint est connecté.',
      createdAt:
        new Date().toISOString(),
    });
  }

  /* ─────────────────────────────────────────────
     ACTIVITY ENGINE
  ───────────────────────────────────────────── */

  function addActivityEvent(
    event
  ) {

    STATE.activityEvents.unshift({
      id: uid('activity'),
      level:
        event.level || 'info',
      title:
        event.title || 'Activité',
      description:
        event.description || '',
      createdAt:
        event.createdAt ||
        new Date().toISOString(),
    });

    STATE.activityEvents =
      STATE.activityEvents.slice(
        0,
        120
      );

    renderActivityPanel();
  }

  /* ─────────────────────────────────────────────
     TOAST SYSTEM
  ───────────────────────────────────────────── */

  function showToast(
    type = 'info',
    text = ''
  ) {

    const root =
      $('#fp-toast-root');

    if (!root) return;

    const toast =
      document.createElement(
        'div'
      );

    toast.className =
      `fp-toast ${type}`;

    toast.innerHTML = `
      <div class="fp-toast-dot"></div>

      <div class="fp-toast-text">
        ${escHtml(text)}
      </div>
    `;

    root.appendChild(toast);

    setTimeout(() => {
      toast.classList.add(
        'show'
      );
    }, 20);

    setTimeout(() => {

      toast.classList.remove(
        'show'
      );

      setTimeout(() => {
        toast.remove();
      }, 200);

    }, 3500);
  }

  /* ─────────────────────────────────────────────
     THEME
  ───────────────────────────────────────────── */

  function toggleTheme() {

    STATE.theme =
      STATE.theme === 'dark'
        ? 'light'
        : 'dark';

    localStorage.setItem(
      STORAGE_KEYS.theme,
      STATE.theme
    );

    document.documentElement
      .setAttribute(
        'data-theme',
        STATE.theme
      );

    showToast(
      'success',
      `Mode ${STATE.theme}`
    );
  }

  /* ─────────────────────────────────────────────
     USER MENU
  ───────────────────────────────────────────── */

  function logout() {

    removeToken();

    window.location.href =
      '/login.html';
  }

  /* ─────────────────────────────────────────────
     PLAN UI
  ───────────────────────────────────────────── */

  function renderPlanSwitcher() {

    const el =
      $('#fp-plan-badge');

    if (!el) return;

    el.innerHTML = `
      <div class="fp-plan-pill ${escHtml(STATE.plan)}">
        ${escHtml(
          STATE.plan.toUpperCase()
        )}
      </div>
    `;
  }

  function renderUsageSidebar() {

    const root =
      $('#fp-usage-sidebar');

    if (!root) return;

    const limits =
      STATE.limits;

    root.innerHTML = `
      <div class="fp-usage-card">

        ${renderUsageRow(
          'Audits',
          STATE.audits.length,
          limits.audits
        )}

        ${renderUsageRow(
          'Monitors',
          STATE.monitors.length,
          limits.monitors
        )}

        ${renderUsageRow(
          'Reports',
          STATE.reports.length,
          limits.reports
        )}

      </div>
    `;
  }

  function renderUsageRow(
    label,
    current,
    max
  ) {

    const percent =
      clamp(
        (current / max) * 100,
        0,
        100
      );

    return `
      <div class="fp-usage-row">

        <div class="fp-usage-top">

          <div>
            ${escHtml(label)}
          </div>

          <div>
            ${current}/${max}
          </div>

        </div>

        <div class="fp-usage-bar">

          <div
            class="fp-usage-fill"
            style="width:${percent}%"
          ></div>

        </div>

      </div>
    `;
  }
    /* ─────────────────────────────────────────────
     MAIN RENDER
  ───────────────────────────────────────────── */

  function render() {

    const root =
      pageEl();

    if (!root) {
      return;
    }

    document.body.setAttribute(
      'data-route',
      STATE.route
    );

    switch (STATE.route) {

      case 'overview':
        renderOverview(root);
        break;

      case 'growth':
        renderGrowth(root);
        break;

      case 'missions':
        renderMissions(root);
        break;

      case 'audits':
        renderAudits(root);
        break;

      case 'monitors':
        renderMonitors(root);
        break;

      case 'local-seo':
        renderLocalSeo(root);
        break;

      case 'competitor':
        renderCompetitor(root);
        break;

      case 'conversion':
        renderConversion(root);
        break;

      case 'data-explorer':
        renderDataExplorer(root);
        break;

      case 'reports':
        renderReports(root);
        break;

      case 'alerts-center':
        renderAlertsCenter(root);
        break;

      case 'activity-feed':
        renderActivityFeedPage(root);
        break;

      case 'team':
        renderTeam(root);
        break;

      case 'client-mode':
        renderClientMode(root);
        break;

      case 'billing':
        renderBilling(root);
        break;

      case 'settings':
        renderSettings(root);
        break;

      case 'ai':
        renderAI(root);
        break;

      default:
        renderOverview(root);
    }
  }

  /* ─────────────────────────────────────────────
     OVERVIEW
  ───────────────────────────────────────────── */

  function renderOverview(root) {

    const monitorsUp =
      STATE.monitors.filter(
        x => x.status === 'up'
      ).length;

    const criticalAlerts =
      STATE.alerts.filter(
        x => x.level === 'critical'
      ).length;

    const missionDone =
      STATE.missions.filter(
        x => x.status === 'done'
      ).length;

    root.innerHTML = `
      <div class="fp-page-wrap">

        <section class="fp-hero">

          <div class="fp-hero-left">

            <div class="fp-eyebrow">
              FLOWPOINT CONTROL CENTER
            </div>

            <h1 class="fp-hero-title">
              ${
                getOverviewGreeting()
              }
            </h1>

            <p class="fp-hero-text">
              Votre infrastructure digitale est surveillée, analysée et optimisée en temps réel.
            </p>

            <div class="fp-hero-actions">

              <button
                class="fp-btn fp-btn-primary"
                onclick="FP.navigate('audits')"
              >
                Lancer un audit
              </button>

              <button
                class="fp-btn fp-btn-secondary"
                onclick="FP.navigate('reports')"
              >
                Voir les rapports
              </button>

            </div>

          </div>

          <div class="fp-hero-right">

            <div class="fp-health-card">

              <div class="fp-health-top">
                Santé globale
              </div>

              <div class="fp-health-score">
                92
              </div>

              <div class="fp-health-sub">
                Infrastructure stable
              </div>

            </div>

          </div>

        </section>

        <section class="fp-stats-grid">

          ${renderStatCard(
            'Audits SEO',
            STATE.audits.length,
            '+12%',
            'success'
          )}

          ${renderStatCard(
            'Monitors actifs',
            monitorsUp,
            `${criticalAlerts} critique(s)`,
            criticalAlerts
              ? 'danger'
              : 'success'
          )}

          ${renderStatCard(
            'Rapports',
            STATE.reports.length,
            'PDF + exports',
            'info'
          )}

          ${renderStatCard(
            'Missions',
            missionDone,
            `${STATE.missions.length} total`,
            'warning'
          )}

        </section>

        <section class="fp-grid-2">

          <div class="fp-card">

            <div class="fp-card-top">

              <div class="fp-card-title">
                Infrastructure
              </div>

              <button
                class="fp-mini-btn"
                onclick="FP.navigate('monitors')"
              >
                Voir
              </button>

            </div>

            <div class="fp-monitor-list">

              ${
                STATE.monitors
                  .slice(0, 6)
                  .map(renderOverviewMonitor)
                  .join('')
              }

            </div>

          </div>

          <div class="fp-card">

            <div class="fp-card-top">

              <div class="fp-card-title">
                Activité récente
              </div>

              <button
                class="fp-mini-btn"
                onclick="FP.navigate('activity-feed')"
              >
                Ouvrir
              </button>

            </div>

            <div class="fp-activity-preview">

              ${
                STATE.activityEvents
                  .slice(0, 6)
                  .map(renderActivityPreviewItem)
                  .join('')
              }

            </div>

          </div>

        </section>

        <section class="fp-card">

          <div class="fp-card-top">

            <div class="fp-card-title">
              Missions prioritaires
            </div>

            <button
              class="fp-mini-btn"
              onclick="FP.navigate('missions')"
            >
              Voir tout
            </button>

          </div>

          <div class="fp-mission-grid">

            ${
              STATE.missions
                .slice(0, 8)
                .map(renderMissionCard)
                .join('')
            }

          </div>

        </section>

      </div>
    `;
  }

  function getOverviewGreeting() {

    const firstName =
      STATE.user?.firstName ||
      'Utilisateur';

    const hour =
      new Date().getHours();

    if (hour < 12) {
      return `Bonjour ${firstName}`;
    }

    if (hour < 18) {
      return `Bon après-midi ${firstName}`;
    }

    return `Bonsoir ${firstName}`;
  }

  function renderStatCard(
    label,
    value,
    sub,
    type = 'info'
  ) {

    return `
      <div class="fp-stat-card ${type}">

        <div class="fp-stat-label">
          ${escHtml(label)}
        </div>

        <div class="fp-stat-value">
          ${escHtml(value)}
        </div>

        <div class="fp-stat-sub">
          ${escHtml(sub)}
        </div>

      </div>
    `;
  }

  function renderOverviewMonitor(
    monitor
  ) {

    return `
      <div class="fp-monitor-item">

        <div class="fp-monitor-left">

          <div class="fp-monitor-dot ${
            monitor.status === 'up'
              ? 'up'
              : 'down'
          }"></div>

          <div>

            <div class="fp-monitor-name">
              ${escHtml(
                monitor.name ||
                monitor.url
              )}
            </div>

            <div class="fp-monitor-url">
              ${escHtml(
                monitor.url
              )}
            </div>

          </div>

        </div>

        <div class="fp-monitor-latency">
          ${
            monitor.latency || 0
          }ms
        </div>

      </div>
    `;
  }

  function renderActivityPreviewItem(
    item
  ) {

    return `
      <div class="fp-activity-preview-item">

        <div class="fp-activity-preview-top">

          <div class="fp-activity-preview-title">
            ${escHtml(item.title)}
          </div>

          <div class="fp-activity-preview-time">
            ${timeAgo(
              item.createdAt
            )}
          </div>

        </div>

        <div class="fp-activity-preview-desc">
          ${escHtml(
            item.description || ''
          )}
        </div>

      </div>
    `;
  }

  function renderMissionCard(
    mission
  ) {

    return `
      <div class="fp-mission-card">

        <div class="fp-mission-top">

          <div class="fp-mission-category">
            ${escHtml(
              mission.category ||
              'Mission'
            )}
          </div>

          <div class="fp-mission-status ${
            escHtml(
              mission.status || 'todo'
            )
          }">
            ${escHtml(
              mission.status || 'todo'
            )}
          </div>

        </div>

        <div class="fp-mission-title">
          ${escHtml(
            mission.title
          )}
        </div>

        <div class="fp-mission-impact">
          ${
            escHtml(
              mission.impact ||
              'Amélioration visibilité et conversion.'
            )
          }
        </div>

      </div>
    `;
  }
    /* ─────────────────────────────────────────────
     MISSIONS
  ───────────────────────────────────────────── */

  function renderMissions(root) {

    root.innerHTML = `
      <div class="fp-page-wrap">

        <div class="fp-page-top">

          <div>

            <div class="fp-eyebrow">
              FLOWPOINT MISSIONS
            </div>

            <h1 class="fp-page-title">
              Missions intelligentes
            </h1>

          </div>

          <div class="fp-page-actions">

            <button
              class="fp-btn fp-btn-primary"
              id="fp-generate-missions"
            >
              Générer avec IA
            </button>

          </div>

        </div>

        <section class="fp-mission-grid">

          ${
            STATE.missions
              .map(renderMissionCard)
              .join('')
          }

        </section>

      </div>
    `;

    $('#fp-generate-missions')
      ?.addEventListener(
        'click',
        generateAIMissions
      );
  }

  async function generateAIMissions() {

    showToast(
      'info',
      'Analyse IA des opportunités...'
    );

    const generated = [

      {
        id: uid('mission'),
        title:
          'Ajouter des données structurées FAQ',
        category: 'SEO',
        impact:
          'Augmentation potentielle du CTR Google.',
        status: 'todo',
      },

      {
        id: uid('mission'),
        title:
          'Créer une landing page géolocalisée',
        category: 'Local SEO',
        impact:
          'Meilleure visibilité locale.',
        status: 'todo',
      },

      {
        id: uid('mission'),
        title:
          'Optimiser le Largest Contentful Paint',
        category: 'Performance',
        impact:
          'Amélioration Core Web Vitals.',
        status: 'todo',
      },
    ];

    STATE.missions.unshift(
      ...generated
    );

    addActivityEvent({
      level: 'success',
      title:
        'Missions IA générées',
      description:
        `${generated.length} nouvelles missions créées.`,
    });

    render();

    showToast(
      'success',
      'Nouvelles missions créées.'
    );
  }

  /* ─────────────────────────────────────────────
     AUDITS
  ───────────────────────────────────────────── */

  function renderAudits(root) {

    root.innerHTML = `
      <div class="fp-page-wrap">

        <div class="fp-page-top">

          <div>

            <div class="fp-eyebrow">
              FLOWPOINT AUDITS
            </div>

            <h1 class="fp-page-title">
              Audits SEO
            </h1>

          </div>

          <div class="fp-page-actions">

            <button
              class="fp-btn fp-btn-primary"
              id="fp-create-audit"
            >
              Nouvel audit
            </button>

          </div>

        </div>

        <div class="fp-table">

          <div class="fp-table-head">

            <div>URL</div>
            <div>Score</div>
            <div>Performance</div>
            <div>Issues</div>
            <div>Date</div>

          </div>

          ${
            STATE.audits
              .map(audit => `
                <div class="fp-table-row">

                  <div class="fp-table-url">
                    ${escHtml(audit.url)}
                  </div>

                  <div>
                    ${audit.score || 0}
                  </div>

                  <div>
                    ${audit.speed || 0}
                  </div>

                  <div>
                    ${audit.issues || 0}
                  </div>

                  <div>
                    ${formatDate(
                      audit.createdAt
                    )}
                  </div>

                </div>
              `)
              .join('')
          }

        </div>

      </div>
    `;

    $('#fp-create-audit')
      ?.addEventListener(
        'click',
        createAudit
      );
  }

  async function createAudit() {

    const url =
      prompt(
        'URL à auditer'
      );

    if (!url) return;

    try {

      const result =
        await apiPost(
          '/audits',
          { url }
        );

      STATE.audits.unshift(
        result.audit || result
      );

      addActivityEvent({
        level: 'success',
        title:
          'Nouvel audit',
        description:
          `Audit créé pour ${url}`,
      });

      render();

      showToast(
        'success',
        'Audit lancé.'
      );

    } catch (err) {

      console.error(err);

      showToast(
        'danger',
        err.message
      );
    }
  }

  /* ─────────────────────────────────────────────
     MONITORS
  ───────────────────────────────────────────── */

  function renderMonitors(root) {

    root.innerHTML = `
      <div class="fp-page-wrap">

        <div class="fp-page-top">

          <div>

            <div class="fp-eyebrow">
              FLOWPOINT MONITORING
            </div>

            <h1 class="fp-page-title">
              Infrastructure monitoring
            </h1>

          </div>

          <div class="fp-page-actions">

            <button
              class="fp-btn fp-btn-primary"
              id="fp-create-monitor"
            >
              Ajouter monitor
            </button>

          </div>

        </div>

        <div class="fp-monitor-grid">

          ${
            STATE.monitors
              .map(monitor => `
                <div class="fp-monitor-card">

                  <div class="fp-monitor-card-top">

                    <div class="fp-monitor-card-name">
                      ${escHtml(
                        monitor.name ||
                        monitor.url
                      )}
                    </div>

                    <div class="fp-monitor-pill ${
                      monitor.status === 'up'
                        ? 'up'
                        : 'down'
                    }">

                      ${
                        monitor.status || 'up'
                      }

                    </div>

                  </div>

                  <div class="fp-monitor-card-url">
                    ${escHtml(
                      monitor.url
                    )}
                  </div>

                  <div class="fp-monitor-metrics">

                    <div>

                      <div class="fp-monitor-metric-label">
                        Latence
                      </div>

                      <div class="fp-monitor-metric-value">
                        ${
                          monitor.latency || 0
                        }ms
                      </div>

                    </div>

                    <div>

                      <div class="fp-monitor-metric-label">
                        Uptime
                      </div>

                      <div class="fp-monitor-metric-value">
                        ${
                          monitor.uptime || 100
                        }%
                      </div>

                    </div>

                  </div>

                </div>
              `)
              .join('')
          }

        </div>

      </div>
    `;

    $('#fp-create-monitor')
      ?.addEventListener(
        'click',
        createMonitor
      );
  }

  async function createMonitor() {

    const url =
      prompt(
        'URL du monitor'
      );

    if (!url) return;

    try {

      const result =
        await apiPost(
          '/monitors',
          {
            url,
            name: url,
          }
        );

      STATE.monitors.unshift(
        result.monitor || result
      );

      addActivityEvent({
        level: 'success',
        title:
          'Monitor ajouté',
        description:
          `${url} est maintenant surveillé.`,
      });

      render();

      showToast(
        'success',
        'Monitor créé.'
      );

    } catch (err) {

      console.error(err);

      showToast(
        'danger',
        err.message
      );
    }
  }
    /* ─────────────────────────────────────────────
     AUTRES PAGES SAAS
  ───────────────────────────────────────────── */

  function renderGrowth(root) {
    root.innerHTML = renderSimplePage(
      'FLOWPOINT GROWTH',
      'Croissance',
      'Score business, opportunités, quick wins et roadmap de croissance pilotée par IA.'
    );
  }

  function renderLocalSeo(root) {
    root.innerHTML = renderSimplePage(
      'FLOWPOINT LOCAL SEO',
      'Local SEO',
      'Suivi Google Business Profile, zones locales, pages géolocalisées et opportunités régionales.'
    );
  }

  function renderCompetitor(root) {
    root.innerHTML = renderSimplePage(
      'FLOWPOINT COMPETITORS',
      'Concurrents',
      'Benchmark SEO, vitesse, positionnement, contenu, visibilité et gaps business.'
    );
  }

  function renderConversion(root) {
    root.innerHTML = renderSimplePage(
      'FLOWPOINT CONVERSION',
      'Conversion',
      'Analyse des CTA, formulaires, parcours client, pages faibles et potentiel de revenus.'
    );
  }

  function renderDataExplorer(root) {
    root.innerHTML = renderSimplePage(
      'FLOWPOINT DATA',
      'Data Explorer',
      'Exploration des audits, monitors, rapports, incidents, exports et tendances.'
    );
  }

  function renderReports(root) {
    root.innerHTML = `
      <div class="fp-page-wrap">
        <div class="fp-page-top">
          <div>
            <div class="fp-eyebrow">FLOWPOINT REPORTS</div>
            <h1 class="fp-page-title">Rapports</h1>
          </div>
          <button class="fp-btn fp-btn-primary" onclick="FP.navigate('client-mode')">
            Mode client
          </button>
        </div>

        <div class="fp-mission-grid">
          ${
            STATE.reports.map(report => `
              <div class="fp-mission-card">
                <div class="fp-mission-top">
                  <div class="fp-mission-category">${escHtml(report.type || 'PDF')}</div>
                  <div class="fp-mission-status done">${escHtml(report.shared ? 'partagé' : 'interne')}</div>
                </div>
                <div class="fp-mission-title">${escHtml(report.name || 'Rapport FlowPoint')}</div>
                <div class="fp-mission-impact">${escHtml(formatDate(report.createdAt || report.date))}</div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;
  }

  function renderAlertsCenter(root) {
    root.innerHTML = `
      <div class="fp-page-wrap">
        <div class="fp-page-top">
          <div>
            <div class="fp-eyebrow">FLOWPOINT ALERTS</div>
            <h1 class="fp-page-title">Centre d'alertes</h1>
          </div>
        </div>

        <div class="fp-card">
          ${
            STATE.alerts.map(alert => `
              <div class="fp-activity-preview-item">
                <div class="fp-activity-preview-top">
                  <div class="fp-activity-preview-title">${escHtml(alert.title)}</div>
                  <div class="fp-mission-status ${escHtml(alert.level)}">${escHtml(alert.level)}</div>
                </div>
                <div class="fp-activity-preview-desc">${escHtml(alert.description)}</div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;
  }

  function renderActivityFeedPage(root) {
    root.innerHTML = `
      <div class="fp-page-wrap">
        <div class="fp-page-top">
          <div>
            <div class="fp-eyebrow">FLOWPOINT ACTIVITY</div>
            <h1 class="fp-page-title">Activité</h1>
          </div>
        </div>

        <div class="fp-card">
          ${
            STATE.activityEvents.map(renderActivityPreviewItem).join('')
          }
        </div>
      </div>
    `;
  }

  function renderTeam(root) {
    root.innerHTML = `
      <div class="fp-page-wrap">
        <div class="fp-page-top">
          <div>
            <div class="fp-eyebrow">FLOWPOINT TEAM</div>
            <h1 class="fp-page-title">Workspace équipe</h1>
          </div>
        </div>

        <section class="fp-grid-2">
          <div class="fp-card">
            <div class="fp-card-title">Canal équipe</div>
            <div class="fp-activity-preview" id="fp-team-messages">
              ${
                STATE.teamMessages.map(msg => `
                  <div class="fp-activity-preview-item">
                    <div class="fp-activity-preview-top">
                      <div class="fp-activity-preview-title">${escHtml(msg.author || 'Équipe')}</div>
                      <div class="fp-activity-preview-time">${timeAgo(msg.createdAt)}</div>
                    </div>
                    <div class="fp-activity-preview-desc">${escHtml(msg.text)}</div>
                  </div>
                `).join('')
              }
            </div>

            <div style="display:flex;gap:8px;margin-top:14px">
              <input id="fp-team-message-input" class="fp-input" placeholder="Message équipe..." />
              <button class="fp-btn fp-btn-primary" id="fp-send-team-message">Envoyer</button>
            </div>
          </div>

          <div class="fp-card">
            <div class="fp-card-title">Notes rapides</div>
            ${
              STATE.notes.map(note => `
                <div class="fp-activity-preview-item">
                  <div class="fp-activity-preview-title">${escHtml(note.title)}</div>
                  <div class="fp-activity-preview-desc">${escHtml(note.body)}</div>
                </div>
              `).join('')
            }
            <button class="fp-btn fp-btn-secondary" id="fp-add-note" style="margin-top:12px">
              Ajouter note
            </button>
          </div>
        </section>
      </div>
    `;

    $('#fp-send-team-message')?.addEventListener('click', sendTeamMessage);
    $('#fp-team-message-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendTeamMessage();
    });
    $('#fp-add-note')?.addEventListener('click', addNote);
  }

  function sendTeamMessage() {
    const input = $('#fp-team-message-input');
    const text = input?.value.trim();

    if (!text) return;

    STATE.teamMessages.unshift({
      id: uid('msg'),
      author: STATE.user?.firstName || 'Moi',
      channel: 'general',
      text,
      createdAt: new Date().toISOString(),
    });

    saveTeamMessages();

    addActivityEvent({
      level: 'info',
      title: 'Nouveau message équipe',
      description: text,
    });

    render();
  }

  function addNote() {
    const title = prompt('Titre de la note');
    if (!title) return;

    const body = prompt('Contenu de la note') || '';

    STATE.notes.unshift({
      id: uid('note'),
      title,
      body,
      createdAt: new Date().toISOString(),
    });

    saveNotes();
    render();
  }

  function renderClientMode(root) {
    root.innerHTML = renderSimplePage(
      'FLOWPOINT CLIENT MODE',
      'Mode Client',
      'Portail client, rapports white-label, partage sécurisé et synthèse executive.'
    );
  }

  function renderBilling(root) {
    root.innerHTML = `
      <div class="fp-page-wrap">
        <div class="fp-page-top">
          <div>
            <div class="fp-eyebrow">FLOWPOINT BILLING</div>
            <h1 class="fp-page-title">Facturation</h1>
          </div>
        </div>

        <section class="fp-stats-grid">
          ${renderStatCard('Plan', STATE.plan.toUpperCase(), 'Actif', 'success')}
          ${renderStatCard('Audits', STATE.audits.length, `${STATE.limits.audits} inclus`, 'info')}
          ${renderStatCard('Monitors', STATE.monitors.length, `${STATE.limits.monitors} inclus`, 'info')}
          ${renderStatCard('IA credits', STATE.limits.aiCredits, 'Mensuel', 'warning')}
        </section>

        <section class="fp-grid-2">
          ${renderPlanCard('standard', 'Standard', 'Pour indépendants et petits sites', '30 audits · 3 monitors')}
          ${renderPlanCard('pro', 'Pro', 'Pour agences et PME', '300 audits · 50 monitors')}
          ${renderPlanCard('ultra', 'Ultra', 'Pour scale et multi-clients', '2000 audits · 300 monitors')}
        </section>
      </div>
    `;
  }

  function renderPlanCard(id, name, desc, features) {
    const current = STATE.plan === id;

    return `
      <div class="fp-card ${current ? 'active' : ''}">
        <div class="fp-card-title">${escHtml(name)}</div>
        <div class="fp-activity-preview-desc">${escHtml(desc)}</div>
        <div class="fp-mission-impact" style="margin-top:8px">${escHtml(features)}</div>
        <button
          class="fp-btn ${current ? 'fp-btn-secondary' : 'fp-btn-primary'}"
          style="margin-top:14px"
          ${current ? 'disabled' : `onclick="FP.navigate('billing')"`}
        >
          ${current ? 'Plan actuel' : 'Upgrade'}
        </button>
      </div>
    `;
  }

  function renderSettings(root) {
    root.innerHTML = `
      <div class="fp-page-wrap">
        <div class="fp-page-top">
          <div>
            <div class="fp-eyebrow">FLOWPOINT SETTINGS</div>
            <h1 class="fp-page-title">Paramètres</h1>
          </div>
        </div>

        <section class="fp-grid-2">
          <div class="fp-card">
            <div class="fp-card-title">Compte</div>
            <div class="fp-activity-preview-desc">${escHtml(STATE.user?.email || '—')}</div>
            <button class="fp-btn fp-btn-secondary" onclick="FP.logout()" style="margin-top:14px">
              Déconnexion
            </button>
          </div>

          <div class="fp-card">
            <div class="fp-card-title">Préférences</div>
            <button class="fp-btn fp-btn-primary" onclick="document.getElementById('fp-toggle-theme')?.click()">
              Changer thème
            </button>
          </div>
        </section>
      </div>
    `;
  }

  function renderAI(root) {
    root.innerHTML = `
      <div class="fp-page-wrap">
        <div class="fp-page-top">
          <div>
            <div class="fp-eyebrow">FLOWPOINT AI</div>
            <h1 class="fp-page-title">Assistant IA</h1>
          </div>
        </div>

        <section class="fp-card">
          <div class="fp-card-title">Analyse contextuelle</div>

          <div class="fp-activity-preview-desc" style="margin-bottom:14px">
            Je peux analyser tes audits, monitors, rapports, missions et générer des actions business.
          </div>

          <div class="fp-mission-grid">
            <button class="fp-btn fp-btn-secondary" onclick="FP.showToast('info','IA : génération de roadmap bientôt connectée backend.')">Générer roadmap</button>
            <button class="fp-btn fp-btn-secondary" onclick="FP.showToast('info','IA : génération rapport client bientôt connectée backend.')">Créer rapport client</button>
            <button class="fp-btn fp-btn-secondary" onclick="FP.showToast('info','IA : analyse conversion bientôt connectée backend.')">Analyser conversion</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderSimplePage(eyebrow, title, text) {
    return `
      <div class="fp-page-wrap">
        <div class="fp-page-top">
          <div>
            <div class="fp-eyebrow">${escHtml(eyebrow)}</div>
            <h1 class="fp-page-title">${escHtml(title)}</h1>
          </div>
        </div>

        <section class="fp-card">
          <div class="fp-card-title">${escHtml(title)}</div>
          <div class="fp-activity-preview-desc">${escHtml(text)}</div>
        </section>
      </div>
    `;
  }

  /* ─────────────────────────────────────────────
     DEMO FALLBACK DATA
  ───────────────────────────────────────────── */

  function demoAudits() {
    return [
      { id:'a1', url:'flowpoint.pro', score:84, speed:78, issues:7, createdAt:new Date().toISOString() },
      { id:'a2', url:'client-demo.be', score:71, speed:66, issues:12, createdAt:new Date(Date.now()-86400000).toISOString() },
    ];
  }

  function demoMonitors() {
    return [
      { id:'m1', name:'FlowPoint App', url:'https://app.flowpoint.pro', status:'up', latency:132, uptime:99.9 },
      { id:'m2', name:'Landing', url:'https://flowpoint.pro', status:'up', latency:185, uptime:99.7 },
      { id:'m3', name:'Client Demo', url:'https://client-demo.be', status:'down', latency:0, uptime:96.2 },
    ];
  }

  function demoReports() {
    return [
      { id:'r1', name:'Rapport executive mensuel', type:'PDF', shared:true, createdAt:new Date().toISOString() },
      { id:'r2', name:'Export audits SEO', type:'CSV', shared:false, createdAt:new Date(Date.now()-172800000).toISOString() },
    ];
  }

  function demoMissions() {
    return [
      { id:'mi1', title:'Optimiser les balises title des pages principales', category:'SEO', status:'todo', impact:'CTR + visibilité Google' },
      { id:'mi2', title:'Créer 3 pages locales pour les zones prioritaires', category:'Local SEO', status:'todo', impact:'Trafic local qualifié' },
      { id:'mi3', title:'Mettre en place un rapport client mensuel', category:'Rétention', status:'done', impact:'Preuve de valeur client' },
    ];
  }

  function demoCompetitors() {
    return [
      { name:'Concurrent A', score:76, speed:62, local:70 },
      { name:'Concurrent B', score:69, speed:74, local:61 },
    ];
  }

  function demoActivity() {
    return [
      { id:'ev1', level:'success', title:'Audit terminé', description:'flowpoint.pro obtient 84/100.', createdAt:new Date().toISOString() },
      { id:'ev2', level:'danger', title:'Monitor down', description:'Client Demo ne répond plus.', createdAt:new Date(Date.now()-600000).toISOString() },
      { id:'ev3', level:'info', title:'Rapport généré', description:'Rapport executive mensuel prêt.', createdAt:new Date(Date.now()-3600000).toISOString() },
    ];
  }

  function buildAlertsFromData() {
    return STATE.monitors
      .filter(m => m.status !== 'up')
      .map(m => ({
        id: uid('alert'),
        level: 'critical',
        title: `Monitor DOWN — ${m.name || m.url}`,
        description: `${m.url} ne répond pas correctement.`,
        createdAt: new Date().toISOString(),
      }));
  }

  /* ─────────────────────────────────────────────
     CLOSE IIFE
  ───────────────────────────────────────────── */

})();
