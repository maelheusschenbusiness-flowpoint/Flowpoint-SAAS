(() => {
  "use strict";

  const API_BASE = "";
  const TOKEN_KEY = "token";
  const REFRESH_TOKEN_KEY = "refreshToken";
  const REFRESH_ENDPOINT = "/api/auth/refresh";

  const ROUTES = new Set([
    "#overview",
    "#missions",
    "#audits",
    "#monitors",
    "#reports",
    "#billing",
    "#settings",
  ]);

  const MISSIONS_STORAGE_KEY = "fp_dashboard_missions_v20";
  const MISSIONS_RESET_KEY = "fp_dashboard_missions_reset_v20";
  const UI_PREFS_STORAGE_KEY = "fp_dashboard_ui_prefs_v20";
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
    },
  };

  function getDefaultMissions() {
    return [
      { id: "m1", title: "Créer ton premier monitor", meta: "Monitoring", done: false, action: "add_monitor" },
      { id: "m2", title: "Lancer un audit SEO", meta: "Audits", done: false, action: "run_audit" },
      { id: "m3", title: "Exporter les audits CSV", meta: "Rapports", done: false, action: "export_audits" },
      { id: "m4", title: "Exporter les monitors CSV", meta: "Rapports", done: false, action: "export_monitors" },
      { id: "m5", title: "Ouvrir la facturation", meta: "Facturation", done: false, action: "open_billing" },
      { id: "m6", title: "Configurer les alertes email", meta: "Paramètres", done: false, action: "goto_settings" },
      { id: "m7", title: "Tester un monitor existant", meta: "Monitoring", done: false, action: "test_monitor" },
      { id: "m8", title: "Consulter les quotas du plan", meta: "Facturation", done: false, action: "view_billing" },
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

  function formatNumber(v) {
    const n = Number(v || 0);
    return new Intl.NumberFormat("fr-FR").format(n);
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
      <div class="fpTextPanel">
        <strong>${esc(lockedTitle)}</strong><br>
        ${esc(lockedText)}<br>
        <span class="fpMuted">Niveau requis : ${esc(planLabel(minPlan))}</span>
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
    if (s === "payment_succeeded") return "Paiement validé";
    if (s === "checkout_verified") return "Paiement vérifié";
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
    if (!value) return "Bientôt";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Bientôt";
    return d.toLocaleDateString("fr-FR");
  }

  function formatRelativeDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    const diff = Date.now() - d.getTime();
    const min = Math.round(diff / 60000);
    if (min < 1) return "à l’instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const day = Math.round(h / 24);
    return `il y a ${day} j`;
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

  function trialMetaLabel(value) {
    const status = lower(state.me?.subscriptionStatus || state.me?.lastPaymentStatus || "");
    if (!value) {
      if (status === "trialing") return "Essai en cours";
      return "Aucun essai actif";
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      if (status === "trialing") return "Essai en cours";
      return "Aucun essai actif";
    }
    return d.getTime() >= Date.now()
      ? `Jusqu’au ${formatShortDate(value)}`
      : `Terminé le ${formatShortDate(value)}`;
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

  function usagePercent(v) {
    const used = Number(v?.used ?? 0);
    const limit = Number(v?.limit ?? 0);
    if (!limit) return 0;
    return clamp(Math.round((used / limit) * 100), 0, 100);
  }

  function setBar(el, used, limit) {
    if (!el) return;
    const u = Number(used || 0);
    const l = Math.max(1, Number(limit || 0));
    const pct = clamp(Math.round((u / l) * 100), 0, 100);
    el.style.width = `${pct}%`;
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  }

  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
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

    renderRoute();
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

  async function refreshTokenIfPossible() {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) throw new Error("No refresh token");

    const r = await fetch(`${API_BASE}${REFRESH_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ refreshToken }),
    });

    if (!r.ok) throw new Error("Refresh failed");

    const data = await r.json().catch(() => ({}));
    if (data?.token) setToken(data.token);
    if (data?.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
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
        await refreshTokenIfPossible();
        const newToken = getToken();
        if (newToken) headers.set("Authorization", `Bearer ${newToken}`);
        res = await doFetch();
      } catch (e) {
        clearAuth();
        window.location.replace("/login.html");
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

  function normalizeMonitorStatus(monitor) {
    return lower(monitor?.lastStatus || monitor?.status || monitor?.state || "unknown");
  }

  function normalizeMonitorId(monitor) {
    return monitor?._id || monitor?.id || "";
  }

  function normalizeAuditId(audit) {
    return audit?._id || audit?.id || "";
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

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function loadMissions() {
    try {
      const raw = localStorage.getItem(MISSIONS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (e) {
      console.error("Erreur lecture missions :", e);
    }
    return shuffleArray(getDefaultMissions());
  }

  function saveMissions() {
    localStorage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(state.missions));
  }

  function resetMissionsIfNeeded(force = false) {
    const now = Date.now();
    const lastReset = Number(localStorage.getItem(MISSIONS_RESET_KEY) || 0);
    if (force || !lastReset || now - lastReset >= THREE_DAYS_MS) {
      state.missions = shuffleArray(getDefaultMissions());
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
      s === "unknown" ? "UNKNOWN" :
      cap(s);

    const cls =
      s === "up" ? "up" :
      s === "down" ? "down" :
      s === "active" ? "up" :
      s === "trialing" ? "warn" :
      "";

    return `
      <span class="fpBadge ${cls}">
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
          class="fpInput"
          placeholder="${esc(searchPlaceholder)}"
          value="${esc(searchValue || "")}"
          style="min-width:220px"
        />
        <select id="${esc(statusId)}" class="fpInput" style="min-width:180px">
          ${statuses.map((s) => `<option value="${esc(s.value)}" ${s.value === statusValue ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
        </select>
        <select id="${esc(sortId)}" class="fpInput" style="min-width:220px">
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
    function openBillingCenter() {
    setStatus("Ouverture du paiement FlowPoint…", "warn");
    setMissionDoneByAction("open_billing", true);
    saveMissions();
    window.location.href = "/checkout-embedded.html";
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
      const matchesQ = !q || lower(a.url).includes(q) || lower(a.summary).includes(q);
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

  async function openAuditDetail(id) {
    if (!id) return;
    setStatus("Chargement du détail audit…", "warn");

    try {
      const r = await fetchWithAuth(`/api/audits/${encodeURIComponent(id)}`, { method: "GET" });
      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Audit detail failed");

      const audit = data?.audit || data;
      const findings = audit?.findings || {};
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
              ? `<div class="fpRows">${recommendations.map((r) => `<div class="fpRowCard"><div class="fpRowTitle">${esc(r)}</div></div>`).join("")}</div>`
              : `<div class="fpEmpty">Aucune recommandation disponible.</div>`
          }
        </div>

        <div class="fpCardInner" style="margin-top:16px">
          <div class="fpCardInnerTitle" style="font-size:22px">Checks</div>
          ${
            Object.keys(findings).length
              ? `<div class="fpRows">
                  ${Object.entries(findings).map(([k, v]) => `
                    <div class="fpRowCard">
                      <div class="fpRowMain">
                        <div class="fpRowTitle">${esc(k)}</div>
                        <div class="fpRowMeta">${esc(typeof v?.value === "object" ? JSON.stringify(v?.value) : String(v?.value ?? "—"))}</div>
                      </div>
                      <div class="fpRowRight">${createBadge(v?.ok ? "up" : "down")}</div>
                    </div>
                  `).join("")}
                </div>`
              : `<div class="fpEmpty">Aucun détail de check disponible.</div>`
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

          <div class="fpStatCard">
            <div class="fpStatLabel">UP</div>
            <div class="fpStatValue">${esc(data?.upChecks ?? 0)}</div>
            <div class="fpStatMeta">Checks passés avec succès</div>
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

  function buildPlanBenefitsCard() {
    const current = lower(state.me?.plan);
    const rows = [
      { plan: "standard", audits: "30", monitors: "3", pdf: "30", exports: "30", extras: "Base" },
      { plan: "pro", audits: "300", monitors: "50", pdf: "300", exports: "300", extras: "Plus de volume" },
      { plan: "ultra", audits: "2000", monitors: "300", pdf: "2000", exports: "2000", extras: "Équipe + scale" },
    ];

    return `
      <div class="fpRows">
        ${rows.map((r) => `
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">${esc(planLabel(r.plan))}${current === r.plan ? " · actuel" : ""}</div>
              <div class="fpRowMeta">
                Audits ${esc(r.audits)} · Monitors ${esc(r.monitors)} · PDF ${esc(r.pdf)} · Exports ${esc(r.exports)} · ${esc(r.extras)}
              </div>
            </div>
            <div class="fpRowRight">${createBadge(current === r.plan ? "active" : "unknown")}</div>
          </div>
        `).join("")}
      </div>
    `;
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
    function drawOverviewChart() {
    const canvas = $("#fpOverviewChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(220, Math.round(rect.width || 760));
    const mobile = window.innerWidth <= 760;
    const lightMode = window.matchMedia("(prefers-color-scheme: light)").matches;
    const height = mobile ? 220 : 320;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = "100%";
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const scoreData =
      Array.isArray(state.overview?.chart) && state.overview.chart.length
        ? state.overview.chart.map((n) => clamp(Number(n || 0), 0, 100))
        : [8, 16, 22, 20, 34, 41, 38, 48, 57, 61];

    const healthData = scoreData.map((n, i) => clamp(n - 8 + (i % 3) * 2, 0, 100));
    const seoData = scoreData;

    const styles = getComputedStyle(document.documentElement);
    const brand = styles.getPropertyValue("--fpBrand").trim() || "#2f5bff";
    const brand2 = styles.getPropertyValue("--fpBrand2").trim() || "#1b45ff";
    const text = styles.getPropertyValue("--fpMuted").trim() || "#94a3b8";

    const grid = lightMode
      ? "rgba(15,24,48,.18)"
      : (styles.getPropertyValue("--fpBorderStrong").trim() || "rgba(255,255,255,.14)");

    const dashedGrid = lightMode ? "rgba(15,24,48,.24)" : "rgba(255,255,255,.28)";
    const labelColor = lightMode ? "rgba(15,24,48,.72)" : text;

    const padLeft = mobile ? 34 : 42;
    const padRight = mobile ? 12 : 20;
    const padTop = 18;
    const padBottom = mobile ? 24 : 34;

    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;
    const gridLines = 5;

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;

    for (let i = 0; i <= gridLines; i += 1) {
      const y = padTop + (chartH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
    }

    ctx.fillStyle = labelColor;
    ctx.font = mobile ? "11px Inter, system-ui, sans-serif" : "12px Inter, system-ui, sans-serif";
    ctx.fillText("100", 6, padTop + 4);
    ctx.fillText("80", 12, padTop + chartH * 0.2 + 4);
    ctx.fillText("60", 12, padTop + chartH * 0.4 + 4);
    ctx.fillText("40", 12, padTop + chartH * 0.6 + 4);
    ctx.fillText("20", 12, padTop + chartH * 0.8 + 4);
    ctx.fillText("0", 18, padTop + chartH + 4);

    function buildPoints(data) {
      const stepX = data.length > 1 ? chartW / (data.length - 1) : chartW;
      return data.map((value, i) => {
        const x = padLeft + i * stepX;
        const y = padTop + chartH - (value / 100) * chartH;
        return { x, y, value };
      });
    }

    const seoPoints = buildPoints(seoData);
    const healthPoints = buildPoints(healthData);

    const areaGradient = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    areaGradient.addColorStop(0, lightMode ? "rgba(47,91,255,.20)" : "rgba(47,91,255,.24)");
    areaGradient.addColorStop(1, "rgba(47,91,255,0)");

    ctx.beginPath();
    ctx.moveTo(seoPoints[0].x, padTop + chartH);
    seoPoints.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(seoPoints[seoPoints.length - 1].x, padTop + chartH);
    ctx.closePath();
    ctx.fillStyle = areaGradient;
    ctx.fill();

    ctx.beginPath();
    healthPoints.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = dashedGrid;
    ctx.lineWidth = lightMode ? 2.4 : 2;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    const strokeGradient = ctx.createLinearGradient(padLeft, 0, width - padRight, 0);
    strokeGradient.addColorStop(0, brand);
    strokeGradient.addColorStop(1, brand2);

    ctx.beginPath();
    seoPoints.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = strokeGradient;
    ctx.lineWidth = mobile ? 3.2 : 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    seoPoints.forEach((p) => {
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

  function getOverviewInsight() {
    const chart =
      Array.isArray(state.overview?.chart) && state.overview.chart.length
        ? state.overview.chart.map((n) => Number(n || 0))
        : [];

    if (!chart.length) {
      return "Aucune donnée récente disponible. Lance un audit SEO pour générer une première courbe et suivre l’évolution de la performance.";
    }

    const first = chart[0] || 0;
    const last = chart[chart.length - 1] || 0;
    const diff = Math.round(last - first);

    if (diff >= 12) return "La tendance est positive sur la période sélectionnée. Le score SEO progresse nettement.";
    if (diff >= 1) return "La courbe reste orientée à la hausse. Les optimisations récentes semblent produire un effet progressif.";
    if (diff <= -8) return "Le score est en baisse sur la période. Il faut vérifier les derniers audits et les points critiques.";
    return "La performance reste relativement stable sur la période. Quelques ajustements peuvent relancer la progression.";
  }

  function renderOverviewHero() {
    const me = state.me || {};
    const ov = state.overview || {};
    const lastAuditText = ov.lastAuditAt ? `Dernier audit le ${formatShortDate(ov.lastAuditAt)}` : "Aucun audit récent";
    const orgName = normalizeOrgName();
    const currentPlan = planLabel(me.plan);
    const subscriptionState = statusLabel(me.subscriptionStatus || me.lastPaymentStatus);

    return `
      <section class="fpHero fpHeroWide">
        <div class="fpHeroContent">
          <div class="fpCardKicker">FlowPoint</div>
          <h1 class="fpHeroTitle">Overview</h1>
          <p class="fpHeroText">
            Suis tes performances, ton activité et les prochaines actions utiles depuis un seul dashboard.
          </p>

          <div class="fpHeroStats">
            <div class="fpMiniStat">
              <div class="fpMiniStatLabel">Organisation</div>
              <div class="fpMiniStatValue">${esc(orgName)}</div>
              <div class="fpMiniStatMeta">Workspace actuellement chargé</div>
            </div>

            <div class="fpMiniStat">
              <div class="fpMiniStatLabel">Score SEO</div>
              <div class="fpMiniStatValue">${esc(ov.seoScore ?? 0)}</div>
              <div class="fpMiniStatMeta">${esc(lastAuditText)}</div>
            </div>

            <div class="fpMiniStat">
              <div class="fpMiniStatLabel">Abonnement</div>
              <div class="fpMiniStatValue">${esc(currentPlan)}</div>
              <div class="fpMiniStatMeta">${esc(subscriptionState)}</div>
            </div>
          </div>
        </div>
      </section>
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

    setPage(`
      ${renderOverviewHero()}

      <div class="fpStatsGrid">
        <div class="fpStatCard">
          <div class="fpStatLabel">Audits utilisés</div>
          <div class="fpStatValue">${esc(formatUsage(me.usage?.audits))}</div>
          <div class="fpStatMeta">${usagePercent(me.usage?.audits)}% du quota</div>
        </div>

        <div class="fpStatCard">
          <div class="fpStatLabel">PDF utilisés</div>
          <div class="fpStatValue">${esc(formatUsage(me.usage?.pdf))}</div>
          <div class="fpStatMeta">${usagePercent(me.usage?.pdf)}% du quota</div>
        </div>

        <div class="fpStatCard">
          <div class="fpStatLabel">Exports utilisés</div>
          <div class="fpStatValue">${esc(formatUsage(me.usage?.exports))}</div>
          <div class="fpStatMeta">${usagePercent(me.usage?.exports)}% du quota</div>
        </div>
      </div>

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
                  <div class="fpLegendItem"><span class="fpLegendDot" style="background:rgba(255,255,255,.55)"></span> Santé technique</div>
                </div>
                <div class="fpChartInsight">${esc(getOverviewInsight())}</div>
              </div>
            `
          )}

          ${createSectionCard(
            "Quick setup",
            "Missions prioritaires",
            "Checklist rapide pour avancer plus vite",
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
                        <div class="fpMissionMeta">${esc(m.meta)}</div>
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

          ${
            state.uiPrefs.showAdvancedCards
              ? createSectionCard(
                  "Santé globale",
                  "Répartition des scores et états",
                  "Vue plus scalable pour piloter plus de clients",
                  `
                    <div class="fpStatsGrid">
                      <div class="fpStatCard">
                        <div class="fpStatLabel">Audits forts</div>
                        <div class="fpStatValue">${auditBuckets.strong}</div>
                        <div class="fpStatMeta">Score ≥ 75</div>
                      </div>
                      <div class="fpStatCard">
                        <div class="fpStatLabel">Audits moyens</div>
                        <div class="fpStatValue">${auditBuckets.mid}</div>
                        <div class="fpStatMeta">45 à 74</div>
                      </div>
                      <div class="fpStatCard">
                        <div class="fpStatLabel">Audits faibles</div>
                        <div class="fpStatValue">${auditBuckets.weak}</div>
                        <div class="fpStatMeta">&lt; 45</div>
                      </div>
                      <div class="fpStatCard">
                        <div class="fpStatLabel">Monitors UP</div>
                        <div class="fpStatValue">${monitorBuckets.up}</div>
                        <div class="fpStatMeta">Disponibles</div>
                      </div>
                      <div class="fpStatCard">
                        <div class="fpStatLabel">Monitors DOWN</div>
                        <div class="fpStatValue">${monitorBuckets.down}</div>
                        <div class="fpStatMeta">Incidents détectés</div>
                      </div>
                      <div class="fpStatCard">
                        <div class="fpStatLabel">Monitors unknown</div>
                        <div class="fpStatValue">${monitorBuckets.unknown}</div>
                        <div class="fpStatMeta">Sans historique</div>
                      </div>
                    </div>
                  `
                )
              : ""
          }
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
            "Audits récents",
            "Historique rapide",
            "Derniers audits chargés depuis l’API",
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
            "Surveillance en direct des URLs",
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

          ${createSectionCard(
            "Liens utiles",
            "Accès rapide",
            "Navigation complémentaire du workspace",
            `${createInlineLinks([
              { href: "#billing", label: "Facturation" },
              { href: "#settings", label: "Paramètres" },
              { href: "/pricing.html", label: "Retour pricing" },
            ])}`
          )}
        </div>
      </div>
    `);

    requestAnimationFrame(drawOverviewChart);
  }

  function renderMissionsPage() {
    const done = countDoneMissions();

    setPage(`
      ${createSectionCard(
        "Missions",
        "Checklist d’activation",
        "Les missions se réinitialisent automatiquement tous les 3 jours et changent d’ordre pour éviter d’être toujours identiques.",
        `
          <div class="fpMissionPageGrid">
            <div class="fpMissionPageMain">
              <div class="fpMissionStack">
                ${state.missions.map((m) => `
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
                        <div class="fpMissionMeta">${esc(m.meta)}</div>
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
                  <div class="fpStatLabel">Ordre</div>
                  <div class="fpStatValue">Dynamique</div>
                  <div class="fpStatMeta">Les missions varient</div>
                </div>
              </div>

              <div class="fpTextPanel">
                Les missions sont conçues pour remettre le client dans un parcours simple : monitor, audit, export, paramètres et facturation.
              </div>

              <div class="fpTextPanel">
                Conseil : complète d’abord monitor + audit + paramètres. C’est le trio qui active vraiment le dashboard.
              </div>

              <div class="fpTextPanel">
                ${createInlineLinks([
                  { href: "/pricing.html", label: "Retour pricing" },
                  { href: "#billing", label: "Facturation" },
                ])}
              </div>
            </div>
          </div>
        `
      )}
    `);
  }

  function renderAuditsPage() {
    const audits = getFilteredAudits();
    const allAudits = Array.isArray(state.audits) ? state.audits : [];
    const avgScore = allAudits.length
      ? Math.round(allAudits.reduce((sum, a) => sum + Number(a.score || 0), 0) / allAudits.length)
      : 0;

    setPage(`
      ${createSectionCard(
        "Audits",
        "Centre SEO",
        "Lance des audits, consulte l’historique et identifie rapidement les priorités.",
        `
                    <div class="fpTopActionsRow">
            <button class="fpBtn fpBtnPrimary" id="fpAuditsRunBtn" type="button">Lancer un audit SEO</button>
            <button class="fpBtn fpBtnGhost" id="fpAuditsExportBtn" type="button">Exporter en CSV</button>
            <a class="fpBtn fpBtnGhost" href="#billing">Billing</a>
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
            "Derniers audits disponibles sur ton organisation",
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
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Résumé",
            "Vue synthétique",
            "Indicateurs rapides de la partie audit",
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
            "Conseil",
            "Lecture client",
            "Comment présenter la page audit",
            `
              <div class="fpTextPanel">
                Montre l’historique, la régularité des audits et la progression du score. Cette page doit rassurer et montrer une logique de suivi.
              </div>
            `
          )}

          ${createSectionCard(
            "Fonctions avancées",
            "Niveau par plan",
            "Capacités premium liées aux audits",
            `
              ${featureGate(
                "pro",
                `<div class="fpTextPanel">Le plan Pro débloque l’usage PDF plus crédible pour la livraison client et un volume d’audits bien plus élevé.</div>`,
                "PDF & volume",
                "Le plan Standard reste volontairement plus limité pour garder une vraie montée en gamme."
              )}
              ${featureGate(
                "ultra",
                `<div class="fpTextPanel">Le plan Ultra est pensé pour les grosses charges, plusieurs clients, davantage d’automatisation et une volumétrie forte.</div>`,
                "Scale multi-clients",
                "Disponible surtout pour les équipes ou les clients avec gros volume."
              )}
            `
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

    $("#fpAuditsSearch")?.addEventListener("input", (e) => {
      state.filters.audits.q = e.target.value || "";
      renderAuditsPage();
    });

    $("#fpAuditsStatus")?.addEventListener("change", (e) => {
      state.filters.audits.status = e.target.value || "all";
      renderAuditsPage();
    });

    $("#fpAuditsSort")?.addEventListener("change", (e) => {
      state.filters.audits.sort = e.target.value || "date_desc";
      renderAuditsPage();
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
    const upCount = allMonitors.filter((m) => normalizeMonitorStatus(m) === "up").length;
    const downCount = allMonitors.filter((m) => normalizeMonitorStatus(m) === "down").length;
    const unknownCount = allMonitors.filter((m) => normalizeMonitorStatus(m) === "unknown").length;

    setPage(`
      ${createSectionCard(
        "Monitoring",
        "Surveillance des sites",
        "Ajoute des URLs, contrôle leur disponibilité et pilote les incidents plus rapidement.",
        `
                    <div class="fpTopActionsRow">
            <button class="fpBtn fpBtnPrimary" id="fpAddMonitorBtn" type="button">Ajouter un monitor</button>
            <button class="fpBtn fpBtnGhost" id="fpExportMonitorsBtn" type="button">Exporter en CSV</button>
            <a class="fpBtn fpBtnGhost" href="#billing">Billing</a>
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
              { value: "unknown", label: "UNKNOWN" },
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
            "Tous les monitors actuellement chargés depuis ton backend",
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
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Résumé",
            "État du monitoring",
            "Vue rapide de la surveillance active",
            `
              <div class="fpStatsGrid fpStatsGridSingle">
                <div class="fpStatCard">
                  <div class="fpStatLabel">Total</div>
                  <div class="fpStatValue">${allMonitors.length}</div>
                  <div class="fpStatMeta">Monitors chargés</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">UP</div>
                  <div class="fpStatValue">${upCount}</div>
                  <div class="fpStatMeta">Services disponibles</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">DOWN</div>
                  <div class="fpStatValue">${downCount}</div>
                  <div class="fpStatMeta">Incidents détectés</div>
                </div>

                <div class="fpStatCard">
                  <div class="fpStatLabel">UNKNOWN</div>
                  <div class="fpStatValue">${unknownCount}</div>
                  <div class="fpStatMeta">Sans historique récent</div>
                </div>
              </div>
            `
          )}

          ${createSectionCard(
            "Alertes",
            "Réception email",
            "Résumé de la configuration courante",
            `
              <div class="fpInfoList">
                <div class="fpInfoRow"><span>Mode</span><strong>${esc(recipientsLabel(state.orgSettings?.alertRecipients))}</strong></div>
                <div class="fpInfoRow"><span>Emails extra</span><strong>${esc((state.orgSettings?.alertExtraEmails || []).join(", ") || "Aucun")}</strong></div>
              </div>
            `
          )}

          ${createSectionCard(
            "Capacités Pro / Ultra",
            "Monitoring avancé",
            "Fonctions qui rendent la page plus scalable",
            `
              ${featureGate(
                "pro",
                `<div class="fpTextPanel">Le plan Pro débloque la lecture uptime et améliore la supervision des services dans le temps.</div>`,
                "Uptime avancé",
                "Le plan Standard garde le monitoring simple."
              )}
              ${featureGate(
                "ultra",
                `<div class="fpTextPanel">Le plan Ultra est le plus adapté à de gros volumes de monitors, plus d’alertes et un usage orienté équipe / portefeuille clients.</div>`,
                "Monitoring à grande échelle",
                "Réservé au niveau le plus scalable."
              )}
            `
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

    $("#fpMonitorsSearch")?.addEventListener("input", (e) => {
      state.filters.monitors.q = e.target.value || "";
      renderMonitorsPage();
    });

    $("#fpMonitorsStatus")?.addEventListener("change", (e) => {
      state.filters.monitors.status = e.target.value || "all";
      renderMonitorsPage();
    });

    $("#fpMonitorsSort")?.addEventListener("change", (e) => {
      state.filters.monitors.sort = e.target.value || "date_desc";
      renderMonitorsPage();
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

    setPage(`
      ${createSectionCard(
        "Rapports",
        "Exports et historiques",
        "Télécharge les données importantes du dashboard et prépare des livrables clients plus propres.",
        `
                    <div class="fpReportCard">
              <div class="fpReportTitle">Billing</div>
              <div class="fpReportMeta">Accès rapide à la facturation.</div>
              <div class="fpDetailActions">
                <a class="fpBtn fpBtnGhost" href="#billing">Ouvrir Billing</a>
              </div>
            </div>

            <div class="fpReportCard">
              <div class="fpReportTitle">Add-ons</div>
              <div class="fpReportMeta">Ajuste les options de ton abonnement.</div>
              <div class="fpDetailActions">
                <a class="fpBtn fpBtnGhost" href="/addons.html">Ouvrir Add-ons</a>
              </div>
            </div>
          <div class="fpReportsGrid">
            <div class="fpReportCard">
              <div class="fpReportTitle">Export audits</div>
              <div class="fpReportMeta">Télécharge tous les audits SEO en CSV.</div>
              <div class="fpDetailActions">
                <button class="fpBtn fpBtnPrimary" id="fpExportAuditsBtn" type="button">Exporter audits</button>
              </div>
            </div>

            <div class="fpReportCard">
              <div class="fpReportTitle">Export monitors</div>
              <div class="fpReportMeta">Télécharge les données de monitoring en CSV.</div>
              <div class="fpDetailActions">
                <button class="fpBtn fpBtnPrimary" id="fpExportMonitorsBtn2" type="button">Exporter monitors</button>
              </div>
            </div>

            <div class="fpReportCard">
              <div class="fpReportTitle">Accès pricing</div>
              <div class="fpReportMeta">Retour rapide vers l’offre FlowPoint.</div>
              <div class="fpDetailActions">
                <a class="fpBtn fpBtnGhost" href="/pricing.html">Voir pricing</a>
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
            "Résumé rapide des volumes actuellement disponibles",
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
            "Livrables",
            "Utilisation commerciale",
            "Cette zone peut servir pour la livraison client",
            `
              <div class="fpTextPanel">
                Utilise les exports pour les comptes-rendus, suivis mensuels, comparatifs avant/après et reporting interne.
              </div>
            `
          )}

          ${createSectionCard(
            "Fonctions premium",
            "Rapports avancés",
            "Modules à plus forte valeur pour un SaaS scalable",
            `
              ${featureGate(
                "pro",
                `<div class="fpTextPanel">Le plan Pro est plus adapté pour générer des livrables réguliers, des exports fréquents et un usage client plus crédible.</div>`,
                "Reporting plus sérieux",
                "Le plan Standard reste volontairement plus serré sur la partie reporting."
              )}
              ${featureGate(
                "ultra",
                `<div class="fpTextPanel">Le plan Ultra est conçu pour un usage intensif, plusieurs clients et davantage d’opérations mensuelles.</div>`,
                "Scale reportings",
                "Pensé pour la volumétrie élevée."
              )}
            `
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Conseil",
            "Usage commercial",
            "À quoi sert cette page",
            `
              <div class="fpTextPanel">
                La page reports sert à transformer tes données en livrables. C’est utile pour les clients, les suivis internes et les comptes-rendus mensuels.
              </div>
            `
          )}

          ${createSectionCard(
            "Liens utiles",
            "Navigation",
            "Accès rapide",
            `${createInlineLinks([
              { href: "/pricing.html", label: "Retour pricing" },
              { href: "#billing", label: "Facturation" },
            ])}`
          )}
        </div>
      </div>
    `);

    $("#fpExportAuditsBtn")?.addEventListener("click", async () => {
      await safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    });

    $("#fpExportMonitorsBtn2")?.addEventListener("click", async () => {
      await safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    });
  }

  function renderBillingPage() {
    const me = state.me || {};
    const usage = me.usage || {};
    const addons = getAddonEntries();
    const orgName = normalizeOrgName();

    setPage(`
      ${createSectionCard(
        "Facturation",
        "Abonnement",
        "Consulte le plan actuel, les quotas et la gestion complète FlowPoint.",
        `
          <div class="fpTopActionsRow">
            <a class="fpBtn fpBtnGhost" href="/pricing.html">Retour pricing</a>
            <button class="fpBtn fpBtnPrimary" id="fpBillingCenterBtn" type="button">Paiement</button>
            <button class="fpBtn fpBtnGhost" id="fpBillingRefreshBtn" type="button">Actualiser</button>
          </div>
        `
      )}

      <div class="fpGrid fpGridMain">
        <div class="fpCol fpColMain">
          ${createSectionCard(
            "Plan",
            "Abonnement actif",
            "État actuel de la facturation",
            `
              <div class="fpBillingGrid">
                <div class="fpBillingCard">
                  <div class="fpBillingTitle">Plan actuel</div>
                  <div class="fpBillingPlan">${esc(planLabel(me.plan))}</div>
                  <div class="fpBillingStatus">${esc(statusLabel(me.subscriptionStatus || me.lastPaymentStatus))}</div>
                </div>

                <div class="fpBillingCard">
                  <div class="fpBillingTitle">Organisation</div>
                  <div class="fpBillingPlan">${esc(orgName)}</div>
                  <div class="fpBillingStatus">Workspace actuellement connecté</div>
                </div>

                <div class="fpBillingCard">
                  <div class="fpBillingTitle">Essai</div>
                  <div class="fpBillingPlan">${esc(trialLabel(me.trialEndsAt))}</div>
                  <div class="fpBillingStatus">${esc(trialMetaLabel(me.trialEndsAt))}</div>
                </div>

                <div class="fpBillingCard">
                  <div class="fpBillingTitle">Rôle</div>
                  <div class="fpBillingPlan">${esc(cap(me.role || "owner"))}</div>
                  <div class="fpBillingStatus">Niveau d’accès actuel</div>
                </div>
              </div>
            `
          )}

          ${createSectionCard(
            "Quotas",
            "Limites du plan",
            "Consommation visible dans l’espace client",
            `
              <div class="fpQuotaList">
                <div class="fpQuotaRow"><span>Audits</span><strong>${esc(formatUsage(usage.audits))}</strong></div>
                <div class="fpQuotaRow"><span>PDF</span><strong>${esc(formatUsage(usage.pdf))}</strong></div>
                <div class="fpQuotaRow"><span>Exports</span><strong>${esc(formatUsage(usage.exports))}</strong></div>
                <div class="fpQuotaRow"><span>Monitors</span><strong>${esc(formatUsage(usage.monitors))}</strong></div>
                <div class="fpQuotaRow"><span>Team seats</span><strong>${esc(formatUsage(usage.teamSeats))}</strong></div>
              </div>
            `
          )}

          ${createSectionCard(
            "Comparatif",
            "Bénéfices par plan",
            "Structure plus scalable pour guider l’upgrade",
            buildPlanBenefitsCard()
          )}
        </div>

        <div class="fpCol fpColSide">
          ${createSectionCard(
            "Add-ons",
            "Modules actifs",
            "Résumé des modules et options disponibles",
            `
              <div class="fpAddonsList">
                ${addons.map((a) => `
                  <div class="fpAddonRow">
                    <div class="fpAddonLabel">${esc(a.label)}</div>
                    <div class="fpAddonPill ${a.enabled ? "on" : "off"}">${esc(a.text)}</div>
                  </div>
                `).join("")}
              </div>
            `
          )}

          ${createSectionCard(
            "Gestion",
            "Actions utiles",
            "Accès direct aux pages liées à la facturation",
            `${createInlineLinks([
              { href: "/pricing.html", label: "Retour pricing" },
              { href: "#settings", label: "Paramètres" },
              { href: "#reports", label: "Rapports" },
            ])}`
          )}
        </div>
      </div>
    `);

    $("#fpBillingCenterBtn")?.addEventListener("click", openBillingCenter);
    $("#fpBillingRefreshBtn")?.addEventListener("click", () => loadData());
  }

  function renderSettingsPage() {
    const s = state.orgSettings || {};
    const me = state.me || {};
    const extraEmails = Array.isArray(s.alertExtraEmails) ? s.alertExtraEmails.join(", ") : "";

    setPage(`
      ${createSectionCard(
        "Paramètres",
        "Préférences du workspace",
        "Configure les alertes et les informations générales du compte.",
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
                  />
                </div>

                <div class="fpDetailActions">
                  <button class="fpBtn fpBtnPrimary" id="fpSaveSettingsBtn" type="button">Sauvegarder</button>
                </div>
              </div>

              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Préférences interface</div>
                <div class="fpSmall">Le mode clair ou sombre suit automatiquement les paramètres du navigateur.</div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Thème automatique</div>
                    <div class="fpToggleHint">Basé sur les préférences système du client</div>
                  </div>
                  <button
                    type="button"
                    class="fpSwitch ${state.uiPrefs.themeAuto ? "on" : ""}"
                    id="fpThemeAutoToggle"
                    aria-pressed="${state.uiPrefs.themeAuto ? "true" : "false"}"
                    title="Activer ou désactiver le thème automatique"
                  ></button>
                </div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Statut temps réel</div>
                    <div class="fpToggleHint">Affichage de l’état courant du dashboard</div>
                  </div>
                  <button
                    type="button"
                    class="fpSwitch ${state.uiPrefs.liveStatus ? "on" : ""}"
                    id="fpLiveStatusToggle"
                    aria-pressed="${state.uiPrefs.liveStatus ? "true" : "false"}"
                    title="Afficher ou masquer le statut temps réel"
                  ></button>
                </div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Listes compactes</div>
                    <div class="fpToggleHint">Réduit un peu la densité visuelle</div>
                  </div>
                  <button
                    type="button"
                    class="fpSwitch ${state.uiPrefs.compactLists ? "on" : ""}"
                    id="fpCompactListsToggle"
                    aria-pressed="${state.uiPrefs.compactLists ? "true" : "false"}"
                  ></button>
                </div>

                <div class="fpToggleRow">
                  <div class="fpToggleText">
                    <div class="fpToggleTitle">Cartes avancées</div>
                    <div class="fpToggleHint">Affiche plus de blocs analytiques</div>
                  </div>
                  <button
                    type="button"
                    class="fpSwitch ${state.uiPrefs.showAdvancedCards ? "on" : ""}"
                    id="fpAdvancedCardsToggle"
                    aria-pressed="${state.uiPrefs.showAdvancedCards ? "true" : "false"}"
                  ></button>
                </div>
              </div>

              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Liens utiles</div>
                <div class="fpSmall">Accès rapide aux pages liées au compte.</div>
                ${createInlineLinks([
                  { href: "#billing", label: "Facturation" },
                  { href: "/pricing.html", label: "Retour pricing" },
                  { href: "#reports", label: "Rapports" },
                ])}
              </div>
            </div>

            <div class="fpCol fpColSide">
              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Informations du compte</div>
                <div class="fpSmall">Résumé de l’espace actuellement connecté.</div>

                <div class="fpSettingsList">
                  <div class="fpSettingsRow"><span>Organisation</span><strong>${esc(normalizeOrgName())}</strong></div>
                  <div class="fpSettingsRow"><span>Plan</span><strong>${esc(planLabel(me.plan))}</strong></div>
                  <div class="fpSettingsRow"><span>Rôle</span><strong>${esc(cap(me.role || "owner"))}</strong></div>
                  <div class="fpSettingsRow"><span>Destinataires</span><strong>${esc(recipientsLabel(s.alertRecipients))}</strong></div>
                  <div class="fpSettingsRow"><span>Essai</span><strong>${esc(trialLabel(me.trialEndsAt))}</strong></div>
                  <div class="fpSettingsRow"><span>Dernière synchro</span><strong>${esc(state.lastLoadedAt ? formatDate(state.lastLoadedAt) : "Récente")}</strong></div>
                </div>
              </div>

              <div class="fpCardInner">
                <div class="fpCardInnerTitle">Données utiles</div>
                <div class="fpSettingsList">
                  <div class="fpSettingsRow"><span>Audits</span><strong>${esc(formatUsage(me.usage?.audits))}</strong></div>
                  <div class="fpSettingsRow"><span>Exports</span><strong>${esc(formatUsage(me.usage?.exports))}</strong></div>
                  <div class="fpSettingsRow"><span>Monitors</span><strong>${esc(formatUsage(me.usage?.monitors))}</strong></div>
                  <div class="fpSettingsRow"><span>PDF</span><strong>${esc(formatUsage(me.usage?.pdf))}</strong></div>
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

    if (mission.action === "run_audit") {
      location.hash = "#audits";
      return;
    }

    if (mission.action === "add_monitor" || mission.action === "test_monitor") {
      location.hash = "#monitors";
      return;
    }

    if (mission.action === "export_audits" || mission.action === "export_monitors") {
      location.hash = "#reports";
      return;
    }

    if (mission.action === "open_billing" || mission.action === "view_billing") {
      location.hash = "#billing";
      return;
    }

    if (mission.action === "goto_settings") {
      location.hash = "#settings";
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
      return openBillingCenter();
    }

    if (mission.action === "goto_settings") {
      location.hash = "#settings";
      setMissionDoneByAction("goto_settings", true);
      saveMissions();
      renderRoute();
      if (shouldAutoScrollTop()) scrollPageTop();
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

    if (mission.action === "view_billing") {
      location.hash = "#billing";
      setMissionDoneByAction("view_billing", true);
      saveMissions();
      renderRoute();
      if (shouldAutoScrollTop()) scrollPageTop();
      return true;
    }

    return false;
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
      }
    });
  }
  function logout() {
    clearAuth();
    window.location.href = "/login.html";
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
      closeSidebar();
      if (shouldAutoScrollTop()) requestAnimationFrame(scrollPageTop);
    });

    els.btnOpenSettingsSide?.addEventListener("click", () => {
      location.hash = "#settings";
      closeSidebar();
      if (shouldAutoScrollTop()) requestAnimationFrame(scrollPageTop);
    });

    els.btnLogout?.addEventListener("click", logout);

    bindGlobalActions();
  }

  function init() {
    hydrateLogos();
    loadUiPrefs();
    resetMissionsIfNeeded();
    state.missions = loadMissions();

    if (!ROUTES.has(location.hash)) {
      location.hash = "#overview";
      state.route = "#overview";
    }

    if (els.rangeSelect) {
      els.rangeSelect.value = String(state.rangeDays);
      if (!els.rangeSelect.value) els.rangeSelect.value = "30";
    }

    initEvents();
    loadData();

    if (shouldAutoScrollTop()) {
      scrollPageTop();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
