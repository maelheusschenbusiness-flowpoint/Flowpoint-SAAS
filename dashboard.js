(() => {
  "use strict";

  /* =========================================================
     FlowPoint — dashboard.js FINAL COMPLET
     Compatible backend :
     - GET  /api/me
     - GET  /api/overview?days=
     - GET  /api/audits
     - POST /api/audits/run
     - GET  /api/monitors
     - POST /api/monitors
     - PATCH /api/monitors/:id
     - DELETE /api/monitors/:id
     - POST /api/monitors/:id/run
     - GET  /api/org/settings
     - POST /api/org/settings
     - POST /api/stripe/portal
     - GET  /api/exports/audits.csv
     - GET  /api/exports/monitors.csv
     ========================================================= */

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

  const MISSIONS_STORAGE_KEY = "fp_dashboard_missions_v4";
  const MISSIONS_RESET_AT_KEY = "fp_dashboard_missions_reset_at_v4";
  const MISSIONS_RESET_MS = 3 * 24 * 60 * 60 * 1000;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const els = {
    overlay: $("#overlay"),
    sidebar: $("#sidebar"),
    navItems: $$(".fpNavItem"),

    pageContainer: $("#pageContainer"),

    btnMenu: $("#btnMenu"),
    btnRefresh: $("#btnRefresh"),

    rangeSelect: $("#rangeSelect"),

    btnExports: $("#btnExports"),
    exportsMenu: $("#exportsMenu"),
    btnExportAudits: $("#btnExportAudits"),
    btnExportMonitors: $("#btnExportMonitors"),

    statusDot: $("#statusDot"),
    statusText: $("#statusText"),

    helloTitle: $("#helloTitle"),
    helloSub: $("#helloSub"),

    accPlan: $("#accPlan"),
    accOrg: $("#accOrg"),
    accRole: $("#accRole"),
    accTrial: $("#accTrial"),

    uAudits: $("#uAudits"),
    uPdf: $("#uPdf"),
    uExports: $("#uExports"),
    uMonitors: $("#uMonitors"),

    barAudits: $("#barAudits"),
    barPdf: $("#barPdf"),
    barExports: $("#barExports"),

    kpiRange: $("#kpiRange"),
    orgChip: $("#orgChip"),

    seoScore: $("#seoScore"),
    seoHint: $("#seoHint"),

    monActive: $("#monActive"),
    monLimit: $("#monLimit"),
    monInc: $("#monInc"),

    subStatus: $("#subStatus"),
    subHint: $("#subHint"),

    missionPreview: $("#missionPreview"),

    btnRunAudit: $("#btnRunAudit"),
    btnAddMonitor: $("#btnAddMonitor"),
    btnAddMonitor2: $("#btnAddMonitor2"),
    btnGoMissions: $("#btnGoMissions"),
    btnOpenBilling: $("#btnOpenBilling"),

    btnPortal: $("#btnPortal"),
    btnLogout: $("#btnLogout"),
    btnSeePlans: $("#btnSeePlans"),
    btnManageAddons: $("#btnManageAddons"),

    addonsList: $("#addonsList"),

    monitorsRows: $("#monitorsRows"),
    monitorsEmpty: $("#monitorsEmpty"),

    chart: $("#chart"),

    hero: $(".fpHero"),
    gridTop: $(".fpGridTop"),
    gridMain: $(".fpGridMain"),
    gridBottom: $(".fpGridBottom"),
    liveMonitorsCard: $("#monitorsRows") ? $("#monitorsRows").closest(".fpCard") : null,
  };

  const state = {
    route: ROUTES.has(location.hash) ? location.hash : "#overview",
    rangeDays: 30,
    controller: null,

    me: null,
    overview: null,
    audits: [],
    monitors: [],
    orgSettings: {
      alertRecipients: "all",
      alertExtraEmails: [],
    },
    missions: [],
  };

  const baseMissions = [
    {
      id: "m1",
      title: "Créer ton premier monitor",
      meta: "Monitoring",
      done: false,
      action: "add_monitor",
    },
    {
      id: "m2",
      title: "Lancer un audit SEO",
      meta: "Audits",
      done: false,
      action: "run_audit",
    },
    {
      id: "m3",
      title: "Exporter les audits CSV",
      meta: "Rapports",
      done: false,
      action: "export_audits",
    },
    {
      id: "m4",
      title: "Exporter les monitors CSV",
      meta: "Rapports",
      done: false,
      action: "export_monitors",
    },
    {
      id: "m5",
      title: "Ouvrir le portail de facturation",
      meta: "Facturation",
      done: false,
      action: "open_billing",
    },
    {
      id: "m6",
      title: "Configurer les alertes email",
      meta: "Paramètres",
      done: false,
      action: "goto_settings",
    },
    {
      id: "m7",
      title: "Tester un monitor existant",
      meta: "Monitoring",
      done: false,
      action: "test_monitor",
    },
    {
      id: "m8",
      title: "Vérifier les quotas du plan",
      meta: "Facturation",
      done: false,
      action: "goto_billing",
    },
  ];

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

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function setStatus(text, type = "ok") {
    if (els.statusText) els.statusText.textContent = text || "";
    if (!els.statusDot) return;

    els.statusDot.classList.remove("warn", "danger");
    if (type === "warn") els.statusDot.classList.add("warn");
    if (type === "danger") els.statusDot.classList.add("danger");
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

  async function refreshTokenIfPossible() {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) throw new Error("Aucun refresh token");

    const r = await fetch(`${API_BASE}${REFRESH_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ refreshToken }),
    });

    if (!r.ok) {
      throw new Error("Refresh échoué");
    }

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

    const makeRequest = () =>
      fetch(url, {
        ...options,
        headers,
        credentials: "include",
        signal: options.signal,
      });

    let res = await makeRequest();

    if (res.status === 401) {
      try {
        await refreshTokenIfPossible();
        const newToken = getToken();
        if (newToken) headers.set("Authorization", `Bearer ${newToken}`);
        res = await makeRequest();
      } catch (e) {
        clearAuth();
        window.location.replace("/login.html");
        throw e;
      }
    }

    if (res.status === 429) {
      await sleep(500);
      res = await makeRequest();
    }

    return res;
  }

  function parseJsonSafe(res) {
    return res.json().catch(() => ({}));
  }

  function openSidebar() {
    if (window.innerWidth > 980) return;
    els.sidebar?.classList.add("open");
    els.overlay?.classList.add("show");
    els.overlay?.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeSidebar() {
    els.sidebar?.classList.remove("open");
    els.overlay?.classList.remove("show");
    els.overlay?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function toggleExportsMenu(force) {
    if (!els.exportsMenu) return;
    const isOpen = els.exportsMenu.classList.contains("show");
    const next = typeof force === "boolean" ? force : !isOpen;
    els.exportsMenu.classList.toggle("show", next);
    els.exportsMenu.setAttribute("aria-hidden", next ? "false" : "true");
    els.btnExports?.setAttribute("aria-expanded", next ? "true" : "false");
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("fr-FR");
  }

  function formatShortDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("fr-FR");
  }

  function formatUsage(v) {
    if (v == null) return "—";
    if (typeof v === "number" || typeof v === "string") return String(v);

    if (typeof v === "object") {
      const used = v.used ?? null;
      const limit = v.limit ?? null;
      if (used == null && limit != null) return `0/${limit}`;
      if (used != null && limit != null) return `${used}/${limit}`;
      if (used != null) return String(used);
    }

    return "—";
  }

  function setBar(fillEl, used, limit) {
    if (!fillEl) return;
    const u = Number(used || 0);
    const l = Math.max(1, Number(limit || 0));
    fillEl.style.width = `${Math.min(100, Math.round((u / l) * 100))}%`;
  }

  function normalizeOrgName() {
    return state.me?.org?.name || "Organisation";
  }

  function normalizeMonitorStatus(monitor) {
    return String(monitor?.lastStatus || "unknown").toLowerCase();
  }

  function normalizeMonitorId(monitor) {
    return monitor?._id || monitor?.id || "";
  }

  function shouldResetMissions() {
    const raw = localStorage.getItem(MISSIONS_RESET_AT_KEY);
    const ts = Number(raw || 0);
    if (!ts) return true;
    return Date.now() - ts >= MISSIONS_RESET_MS;
  }

  function buildFreshMissions() {
    return shuffleArray(baseMissions).map((m) => ({ ...m }));
  }

  function loadMissions() {
    try {
      if (shouldResetMissions()) {
        const fresh = buildFreshMissions();
        localStorage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(fresh));
        localStorage.setItem(MISSIONS_RESET_AT_KEY, String(Date.now()));
        return fresh;
      }

      const raw = localStorage.getItem(MISSIONS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}

    const fresh = buildFreshMissions();
    localStorage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(fresh));
    localStorage.setItem(MISSIONS_RESET_AT_KEY, String(Date.now()));
    return fresh;
  }

  function saveMissions() {
    localStorage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(state.missions));
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

  function getVisibleMissions() {
    return state.missions.slice(0, 4);
  }

  function hydrateAccount() {
    const me = state.me || {};
    const usage = me.usage || {};

    if (els.helloTitle) els.helloTitle.textContent = `Bonjour, ${me.name || "—"}`;
    if (els.helloSub) els.helloSub.textContent = "SEO · Monitoring · Rapports · Facturation";

    if (els.accPlan) els.accPlan.textContent = me.plan || "—";
    if (els.accOrg) els.accOrg.textContent = normalizeOrgName();
    if (els.accRole) els.accRole.textContent = me.role || "—";
    if (els.accTrial) els.accTrial.textContent = me.trialEndsAt ? formatShortDate(me.trialEndsAt) : "—";

    if (els.uAudits) els.uAudits.textContent = formatUsage(usage.audits);
    if (els.uPdf) els.uPdf.textContent = formatUsage(usage.pdf);
    if (els.uExports) els.uExports.textContent = formatUsage(usage.exports);
    if (els.uMonitors) els.uMonitors.textContent = formatUsage(usage.monitors);

    setBar(els.barAudits, usage.audits?.used, usage.audits?.limit);
    setBar(els.barPdf, usage.pdf?.used, usage.pdf?.limit);
    setBar(els.barExports, usage.exports?.used, usage.exports?.limit);
  }

  function hydrateOverviewCards() {
    const ov = state.overview || {};
    const me = state.me || {};
    const monitorLimit = me.usage?.monitors?.limit ?? 0;

    if (els.kpiRange) els.kpiRange.textContent = `${state.rangeDays} DERNIERS JOURS`;
    if (els.orgChip) els.orgChip.textContent = normalizeOrgName();

    if (els.seoScore) els.seoScore.textContent = String(ov.seoScore ?? 0);
    if (els.seoHint) {
      els.seoHint.textContent = ov.lastAuditAt
        ? `Dernier audit : ${formatShortDate(ov.lastAuditAt)}`
        : `Période : ${state.rangeDays} jours`;
    }

    if (els.monActive) els.monActive.textContent = String(ov.monitors?.active ?? 0);
    if (els.monLimit) els.monLimit.textContent = String(monitorLimit);
    if (els.monInc) els.monInc.textContent = String(ov.monitors?.down ?? 0);

    if (els.subStatus) els.subStatus.textContent = me.subscriptionStatus || me.plan || "—";
    if (els.subHint) {
      const hint = me.lastPaymentStatus || (me.hasTrial ? "Essai actif" : "Compte actif");
      els.subHint.textContent = hint || "—";
    }
  }

  function drawOverviewChart() {
    const canvas = els.chart;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(280, Math.round(rect.width || 600));
    const height = 220;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const styles = getComputedStyle(document.documentElement);
    const borderColor =
      styles.getPropertyValue("--fp-border").trim() ||
      styles.getPropertyValue("--fpBorder").trim() ||
      "rgba(15,23,42,.08)";
    const brand =
      styles.getPropertyValue("--fp-blue").trim() ||
      styles.getPropertyValue("--fpBrand").trim() ||
      "#3b5cff";
    const brand2 =
      styles.getPropertyValue("--fp-blue-2").trim() ||
      styles.getPropertyValue("--fpBrand2").trim() ||
      "#2449ff";
    const muted =
      styles.getPropertyValue("--fp-muted").trim() ||
      styles.getPropertyValue("--fpMuted").trim() ||
      "#667085";

    const data =
      Array.isArray(state.overview?.chart) && state.overview.chart.length
        ? state.overview.chart.map((n) => Number(n || 0))
        : [4, 18, 12, 32, 26, 45, 38];

    ctx.clearRect(0, 0, width, height);

    const left = 18;
    const right = width - 18;
    const top = 16;
    const bottom = height - 24;
    const chartHeight = bottom - top;

    for (let i = 0; i <= 4; i += 1) {
      const y = top + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    const max = Math.max(100, ...data);
    const stepX = data.length > 1 ? (right - left) / (data.length - 1) : 0;

    const points = data.map((v, i) => {
      const x = left + i * stepX;
      const normalized = Math.max(0, Math.min(max, v)) / max;
      const y = bottom - normalized * chartHeight;
      return { x, y, v };
    });

    const strokeGradient = ctx.createLinearGradient(left, 0, right, 0);
    strokeGradient.addColorStop(0, brand);
    strokeGradient.addColorStop(1, brand2);

    const fillGradient = ctx.createLinearGradient(0, top, 0, bottom);
    fillGradient.addColorStop(0, "rgba(59,92,255,.28)");
    fillGradient.addColorStop(1, "rgba(59,92,255,0)");

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpX = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpX, prev.y, cpX, curr.y, curr.x, curr.y);
    }
    ctx.strokeStyle = strokeGradient;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(points[0].x, bottom);
    ctx.lineTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpX = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpX, prev.y, cpX, curr.y, curr.x, curr.y);
    }
    ctx.lineTo(points[points.length - 1].x, bottom);
    ctx.closePath();
    ctx.fillStyle = fillGradient;
    ctx.fill();

    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = brand;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    });

    ctx.fillStyle = muted;
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillText("0", left, bottom + 16);
    ctx.fillText("100", left, top + 10);
  }

  function renderMissionPreview() {
    if (!els.missionPreview) return;

    const items = getVisibleMissions();

    els.missionPreview.innerHTML = items
      .map(
        (m) => `
        <div class="fpMission ${m.done ? "isDone" : ""}">
          <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
          <div class="fpMissionBody">
            <div class="fpMissionTitle">${esc(m.title)}</div>
            <div class="fpMissionMeta">${esc(m.meta)}</div>
            <div class="fpMissionActions">
              <button class="fpBtn small primary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
              <button class="fpBtn small ghost" type="button" data-mission-open="${esc(m.id)}">Voir</button>
            </div>
          </div>
        </div>
      `
      )
      .join("");
  }

  function renderLiveMonitorsCard() {
    if (!els.monitorsRows || !els.monitorsEmpty) return;

    const list = Array.isArray(state.monitors) ? state.monitors : [];
    if (!list.length) {
      els.monitorsRows.innerHTML = "";
      els.monitorsEmpty.style.display = "block";
      return;
    }

    els.monitorsEmpty.style.display = "none";
    els.monitorsRows.innerHTML = list
      .slice(0, 6)
      .map((m) => {
        const id = normalizeMonitorId(m);
        const status = normalizeMonitorStatus(m);

        return `
          <div class="fpTableRow">
            <div class="fpTableMain">
              <div class="fpUrl">${esc(m.url || "—")}</div>
              <div class="fpSmall">
                Intervalle : ${esc(m.intervalMinutes ?? "—")} min · Dernier check : ${esc(formatDate(m.lastCheckedAt))}
              </div>
            </div>
            <div class="fpTableRight">
              <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : "neutral"}">
                <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
              </span>
              <button class="fpBtn small ghost" data-mon-test="${esc(id)}" type="button">Tester</button>
              <button class="fpBtn small danger" data-mon-delete="${esc(id)}" type="button">Supprimer</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderAddons() {
    if (!els.addonsList) return;

    const addons = state.me?.addons || {};
    const entries = [
      { label: "White label", on: true },
      { label: "Monitors +50", on: Number(addons.monitorsPack50 || 0) > 0, extra: Number(addons.monitorsPack50 || 0) || 0 },
      { label: "Sièges supplémentaires", on: Number(addons.extraSeats || 0) > 0, extra: Number(addons.extraSeats || 0) || 0 },
      { label: "Rétention 90 jours", on: !!addons.retention90d },
      { label: "Rétention 365 jours", on: !!addons.retention365d },
      { label: "Support prioritaire", on: !!addons.prioritySupport },
      { label: "Domaine personnalisé", on: !!addons.customDomain },
    ];

    els.addonsList.innerHTML = entries
      .map(
        (item) => `
        <div class="fpAddonRow">
          <div class="fpAddonLabel">
            ${esc(item.label)}
            ${item.extra ? `<span class="fpMono">x${esc(item.extra)}</span>` : ""}
          </div>
          <span class="fpAddonPill ${item.on ? "on" : "off"}">${item.on ? "ACTIF" : "OFF"}</span>
        </div>
      `
      )
      .join("");
  }

  function setActiveNav() {
    const current = state.route.replace("#", "");
    els.navItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.route === current);
    });
  }

  function setOverviewVisibility(show) {
    const display = show ? "" : "none";
    if (els.hero) els.hero.style.display = display;
    if (els.gridTop) els.gridTop.style.display = display;
    if (els.gridMain) els.gridMain.style.display = display;
    if (els.gridBottom) els.gridBottom.style.display = display;
    if (els.liveMonitorsCard) els.liveMonitorsCard.style.display = display;
  }

  function setPage(html) {
    if (els.pageContainer) els.pageContainer.innerHTML = html;
  }

  function openTextModal({ title, placeholder = "", confirmText = "OK", value = "" }) {
    return new Promise((resolve) => {
      const old = document.getElementById("fpModalOverlay");
      if (old) old.remove();

      const overlay = document.createElement("div");
      overlay.id = "fpModalOverlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(10,14,28,.42)";
      overlay.style.backdropFilter = "blur(6px)";
      overlay.style.zIndex = "9999";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.padding = "18px";

      const card = document.createElement("div");
      card.style.width = "min(560px, 100%)";
      card.style.borderRadius = "24px";
      card.style.border = "1px solid rgba(255,255,255,.16)";
      card.style.background = "var(--fpCard, #111827)";
      card.style.boxShadow = "0 30px 90px rgba(0,0,0,.25)";
      card.style.padding = "22px";

      card.innerHTML = `
        <div style="font-weight:900;font-size:18px;line-height:1.25;margin-bottom:14px">${esc(title)}</div>
        <input id="fpModalInput" class="fpInput" placeholder="${esc(placeholder)}" value="${esc(value)}" />
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px">
          <button class="fpBtn fpBtnGhost" type="button" id="fpModalCancel">Annuler</button>
          <button class="fpBtn fpBtnPrimary" type="button" id="fpModalOk">${esc(confirmText)}</button>
        </div>
      `;

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const input = card.querySelector("#fpModalInput");
      const btnCancel = card.querySelector("#fpModalCancel");
      const btnOk = card.querySelector("#fpModalOk");

      function close(val) {
        overlay.remove();
        resolve(val);
      }

      btnCancel.addEventListener("click", () => close(null));
      btnOk.addEventListener("click", () => close(input.value.trim()));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null);
      });

      input.focus();
    });
  }

  async function safeExport(endpoint, filename) {
    setStatus("Préparation de l’export…", "warn");

    try {
      const r = await fetchWithAuth(endpoint, { method: "GET" });
      if (!r.ok) throw new Error("Export échoué");

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

      renderMissionPreview();
      if (state.route === "#missions") renderMissionsPage();

      setStatus("Export téléchargé avec succès", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Erreur pendant l’export", "danger");
      return false;
    }
  }

  async function openBillingPortal() {
    setStatus("Ouverture du portail de facturation…", "warn");

    try {
      const r = await fetchWithAuth("/api/stripe/portal", { method: "POST" });
      const data = await parseJsonSafe(r);

      if (!r.ok) throw new Error(data?.error || "Portail indisponible");

      if (data?.url) {
        setMissionDoneByAction("open_billing", true);
        saveMissions();
        window.location.href = data.url;
        return true;
      }

      window.location.href = "/pricing.html";
      return true;
    } catch (e) {
      console.error(e);
      window.location.href = "/pricing.html";
      return false;
    }
  }

  async function safeRunAudit() {
    const url = await openTextModal({
      title: "URL à auditer",
      placeholder: "https://site.com",
      confirmText: "Lancer l’audit",
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
      await loadData({ silent: true });
      setStatus("Audit lancé avec succès", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Échec du lancement d’audit", "danger");
      return false;
    }
  }

  async function safeAddMonitor() {
    const url = await openTextModal({
      title: "URL à surveiller",
      placeholder: "https://site.com",
      confirmText: "Créer le monitor",
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
      await loadData({ silent: true });
      setStatus("Monitor créé avec succès", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Échec de création du monitor", "danger");
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
      if (!r.ok) throw new Error(data?.error || "Test failed");

      setMissionDoneByAction("test_monitor", true);
      await loadData({ silent: true });
      setStatus("Monitor testé avec succès", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Échec du test monitor", "danger");
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

      await loadData({ silent: true });
      setStatus("Monitor supprimé", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Échec de suppression", "danger");
      return false;
    }
  }

  async function saveOrgSettings() {
    const mode = $("#settingsRecipientsMode")?.value || "all";
    const raw = $("#settingsExtraEmails")?.value || "";
    const extraEmails = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

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
      if (!r.ok) throw new Error(data?.error || "Save failed");

      state.orgSettings = {
        alertRecipients: mode,
        alertExtraEmails: extraEmails,
      };

      setMissionDoneByAction("goto_settings", true);
      renderMissionPreview();
      if (state.route === "#missions") renderMissionsPage();

      setStatus("Paramètres enregistrés", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Échec de sauvegarde des paramètres", "danger");
      return false;
    }
  }

  async function runMission(id) {
    const mission = state.missions.find((m) => m.id === id);
    if (!mission) return;

    if (mission.action === "run_audit") return safeRunAudit();
    if (mission.action === "add_monitor") return safeAddMonitor();
    if (mission.action === "export_audits") return safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    if (mission.action === "export_monitors") return safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    if (mission.action === "open_billing") return openBillingPortal();
    if (mission.action === "goto_settings") {
      location.hash = "#settings";
      return true;
    }
    if (mission.action === "test_monitor") {
      const firstMonitor = state.monitors[0];
      if (!firstMonitor) {
        location.hash = "#monitors";
        return false;
      }
      return safeTestMonitor(normalizeMonitorId(firstMonitor));
    }
    if (mission.action === "goto_billing") {
      location.hash = "#billing";
      return true;
    }
  }

  function openMissionPage(id) {
    const mission = state.missions.find((m) => m.id === id);
    if (!mission) return;

    if (mission.action === "run_audit") location.hash = "#audits";
    if (mission.action === "add_monitor" || mission.action === "test_monitor") location.hash = "#monitors";
    if (mission.action === "export_audits" || mission.action === "export_monitors") location.hash = "#reports";
    if (mission.action === "open_billing" || mission.action === "goto_billing") location.hash = "#billing";
    if (mission.action === "goto_settings") location.hash = "#settings";
  }

  function renderOverviewPage() {
    setOverviewVisibility(true);
    setPage("");
    hydrateOverviewCards();
    drawOverviewChart();
    renderMissionPreview();
    renderAddons();
    renderLiveMonitorsCard();
  }

  function renderMissionsPage() {
    setOverviewVisibility(false);

    const done = state.missions.filter((m) => m.done).length;

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">SETUP</div>
          <h2 class="fpPageTitle">Missions</h2>
          <p class="fpPageDesc">
            Checklist de mise en route pour guider rapidement le client et structurer les premières actions utiles.
          </p>
        </div>
        <div class="fpPageActions">
          <button class="fpBtn fpBtnGhost" id="missionsResetBtn" type="button">Réinitialiser</button>
          <button class="fpBtn fpBtnPrimary" id="missionsSaveBtn" type="button">Sauvegarder</button>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpCard">
          <div class="fpCardKicker">Progression</div>
          <div class="fpCardTitleLarge">Checklist client</div>
          <div class="fpMissionList">
            ${state.missions.map((m) => `
              <div class="fpMission ${m.done ? "isDone" : ""}">
                <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
                <div class="fpMissionBody">
                  <div class="fpMissionTitle">${esc(m.title)}</div>
                  <div class="fpMissionMeta">${esc(m.meta)}</div>
                  <div class="fpMissionActions">
                    <button class="fpBtn small primary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
                    <button class="fpBtn small ghost" type="button" data-mission-open="${esc(m.id)}">Ouvrir</button>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </article>

        <article class="fpCard">
          <div class="fpCardKicker">Statut</div>
          <div class="fpCardTitleLarge">Vue d’ensemble</div>

          <div class="fpStatGrid">
            <div class="fpStatBox">
              <div class="fpStatLabel">Terminées</div>
              <div class="fpStatValue">${done}<span class="fpStatSoft"> / ${state.missions.length}</span></div>
              <div class="fpStatHint">Missions complétées</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Reset auto</div>
              <div class="fpStatValue fpStatSmall">3 jours</div>
              <div class="fpStatHint">Remise à zéro automatique</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Ordre</div>
              <div class="fpStatValue fpStatSmall">Dynamique</div>
              <div class="fpStatHint">Les missions varient</div>
            </div>
          </div>

          <div class="fpEmpty">
            Les missions sont conçues pour remettre le client dans un parcours simple : monitor, audit, export, paramètres et facturation.
          </div>
        </article>
      </section>
    `);

    $("#missionsResetBtn")?.addEventListener("click", () => {
      state.missions = buildFreshMissions();
      localStorage.setItem(MISSIONS_RESET_AT_KEY, String(Date.now()));
      saveMissions();
      renderMissionPreview();
      renderMissionsPage();
      setStatus("Missions réinitialisées", "ok");
    });

    $("#missionsSaveBtn")?.addEventListener("click", () => {
      saveMissions();
      setStatus("Missions sauvegardées", "ok");
    });
  }

  function renderAuditsPage() {
    setOverviewVisibility(false);

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">SEO</div>
          <h2 class="fpPageTitle">Audits</h2>
          <p class="fpPageDesc">
            Lance des audits SEO, consulte l’historique et visualise rapidement les résultats de ton organisation.
          </p>
        </div>
        <div class="fpPageActions">
          <button class="fpBtn fpBtnPrimary" id="auditsRunBtn" type="button">Lancer un audit</button>
          <button class="fpBtn fpBtnGhost" id="auditsExportBtn" type="button">Exporter CSV</button>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpCard">
          <div class="fpCardKicker">Historique</div>
          <div class="fpCardTitleLarge">Derniers audits</div>
          <div class="fpTable">
            ${
              state.audits.length
                ? state.audits.map((a) => `
                  <div class="fpTableRow">
                    <div class="fpTableMain">
                      <div class="fpUrl">${esc(a.url || "—")}</div>
                      <div class="fpSmall">Date : ${esc(formatDate(a.createdAt))}</div>
                    </div>
                    <div class="fpTableRight">
                      <span class="fpBadge neutral">
                        <span class="fpBadgeDot"></span>Score ${esc(a.score ?? "—")}
                      </span>
                    </div>
                  </div>
                `).join("")
                : `<div class="fpEmpty">Aucun audit pour le moment.</div>`
            }
          </div>
        </article>

        <article class="fpCard">
          <div class="fpCardKicker">Résumé</div>
          <div class="fpCardTitleLarge">Indicateurs</div>

          <div class="fpStatGrid">
            <div class="fpStatBox">
              <div class="fpStatLabel">Nombre d’audits</div>
              <div class="fpStatValue">${state.audits.length}</div>
              <div class="fpStatHint">Audits chargés</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Dernier score</div>
              <div class="fpStatValue">${esc(state.overview?.seoScore ?? 0)}</div>
              <div class="fpStatHint">Vue générale SEO</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Période</div>
              <div class="fpStatValue fpStatSmall">${state.rangeDays} j</div>
              <div class="fpStatHint">Fenêtre active</div>
            </div>
          </div>

          <div class="fpEmpty">
            Cette page peut servir de base professionnelle pour les audits SEO client avant export.
          </div>
        </article>
      </section>
    `);

    $("#auditsRunBtn")?.addEventListener("click", safeRunAudit);
    $("#auditsExportBtn")?.addEventListener("click", () => {
      safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    });
  }

  function renderMonitorsPage() {
    setOverviewVisibility(false);

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">MONITORING</div>
          <h2 class="fpPageTitle">Monitors</h2>
          <p class="fpPageDesc">
            Gère les URLs surveillées, teste la disponibilité et garde une vue claire sur l’état actuel.
          </p>
        </div>
        <div class="fpPageActions">
          <button class="fpBtn fpBtnPrimary" id="monitorsAddBtn" type="button">Ajouter un monitor</button>
          <button class="fpBtn fpBtnGhost" id="monitorsExportBtn" type="button">Exporter CSV</button>
        </div>
      </section>

      <section class="fpCard">
        <div class="fpCardKicker">Liste</div>
        <div class="fpCardTitleLarge">Surveillance en direct</div>

        <div class="fpTable">
          ${
            state.monitors.length
              ? state.monitors.map((m) => {
                const id = normalizeMonitorId(m);
                const status = normalizeMonitorStatus(m);
                return `
                  <div class="fpTableRow">
                    <div class="fpTableMain">
                      <div class="fpUrl">${esc(m.url || "—")}</div>
                      <div class="fpSmall">
                        Intervalle : ${esc(m.intervalMinutes ?? "—")} min · Dernier check : ${esc(formatDate(m.lastCheckedAt))}
                      </div>
                    </div>

                    <div class="fpTableRight">
                      <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : "neutral"}">
                        <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
                      </span>
                      <button class="fpBtn small ghost" data-mon-test="${esc(id)}" type="button">Tester</button>
                      <button class="fpBtn small danger" data-mon-delete="${esc(id)}" type="button">Supprimer</button>
                    </div>
                  </div>
                `;
              }).join("")
              : `<div class="fpEmpty">Aucun monitor pour le moment.</div>`
          }
        </div>
      </section>
    `);

    $("#monitorsAddBtn")?.addEventListener("click", safeAddMonitor);
    $("#monitorsExportBtn")?.addEventListener("click", () => {
      safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    });
  }

  function renderReportsPage() {
    setOverviewVisibility(false);

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">RAPPORTS</div>
          <h2 class="fpPageTitle">Rapports</h2>
          <p class="fpPageDesc">
            Exporte les audits et les monitors au format CSV pour le reporting client ou l’analyse interne.
          </p>
        </div>
        <div class="fpPageActions">
          <button class="fpBtn fpBtnPrimary" id="reportsAuditsBtn" type="button">Audits CSV</button>
          <button class="fpBtn fpBtnGhost" id="reportsMonitorsBtn" type="button">Monitors CSV</button>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpCard">
          <div class="fpCardKicker">Exports disponibles</div>
          <div class="fpCardTitleLarge">Sources actuelles</div>

          <div class="fpStatGrid">
            <div class="fpStatBox">
              <div class="fpStatLabel">Audits exportables</div>
              <div class="fpStatValue">${state.audits.length}</div>
              <div class="fpStatHint">Route CSV active</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Monitors exportables</div>
              <div class="fpStatValue">${state.monitors.length}</div>
              <div class="fpStatHint">Route CSV active</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Usage exports</div>
              <div class="fpStatValue fpStatSmall">${esc(formatUsage(state.me?.usage?.exports))}</div>
              <div class="fpStatHint">Quota actuel</div>
            </div>
          </div>
        </article>

        <article class="fpCard">
          <div class="fpCardKicker">Conseil</div>
          <div class="fpCardTitleLarge">Utilisation client</div>
          <div class="fpEmpty">
            Utilise les exports audits pour les rapports SEO et les exports monitors pour les suivis techniques.
          </div>
        </article>
      </section>
    `);

    $("#reportsAuditsBtn")?.addEventListener("click", () => {
      safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    });

    $("#reportsMonitorsBtn")?.addEventListener("click", () => {
      safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    });
  }

  function renderBillingPage() {
    setOverviewVisibility(false);

    const me = state.me || {};
    const usage = me.usage || {};

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">FACTURATION</div>
          <h2 class="fpPageTitle">Facturation</h2>
          <p class="fpPageDesc">
            Consulte le plan actuel, les quotas, les add-ons actifs et ouvre le portail Stripe.
          </p>
        </div>
        <div class="fpPageActions">
          <button class="fpBtn fpBtnPrimary" id="billingPortalBtn" type="button">Portail de facturation</button>
          <button class="fpBtn fpBtnGhost" id="billingPricingBtn" type="button">Voir les plans</button>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpCard">
          <div class="fpCardKicker">Plan actuel</div>
          <div class="fpCardTitleLarge">Abonnement</div>

          <div class="fpStatGrid">
            <div class="fpStatBox">
              <div class="fpStatLabel">Plan</div>
              <div class="fpStatValue fpStatSmall">${esc(me.plan || "—")}</div>
              <div class="fpStatHint">Plan détecté</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Statut</div>
              <div class="fpStatValue fpStatSmall">${esc(me.subscriptionStatus || "—")}</div>
              <div class="fpStatHint">Abonnement</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Paiement</div>
              <div class="fpStatValue fpStatSmall">${esc(me.lastPaymentStatus || "—")}</div>
              <div class="fpStatHint">Dernier statut connu</div>
            </div>
          </div>
        </article>

        <article class="fpCard">
          <div class="fpCardKicker">Quotas</div>
          <div class="fpCardTitleLarge">Limites actuelles</div>

          <div class="fpAddonList">
            <div class="fpAddonRow"><div class="fpAddonLabel">Audits</div><div class="fpMono">${esc(formatUsage(usage.audits))}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">PDF</div><div class="fpMono">${esc(formatUsage(usage.pdf))}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">Exports</div><div class="fpMono">${esc(formatUsage(usage.exports))}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">Monitors</div><div class="fpMono">${esc(formatUsage(usage.monitors))}</div></div>
          </div>

          <div class="fpEmpty">
            Si Stripe ne renvoie pas une gestion d’add-ons séparée, la page pricing sert de fallback propre.
          </div>
        </article>
      </section>
    `);

    $("#billingPortalBtn")?.addEventListener("click", openBillingPortal);
    $("#billingPricingBtn")?.addEventListener("click", () => {
      window.location.href = "/pricing.html";
    });
  }

  function renderSettingsPage() {
    setOverviewVisibility(false);

    const orgName = normalizeOrgName();
    const plan = state.me?.plan || "—";
    const role = state.me?.role || "—";
    const extraEmails = Array.isArray(state.orgSettings.alertExtraEmails)
      ? state.orgSettings.alertExtraEmails.join(", ")
      : "";

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">PARAMÈTRES</div>
          <h2 class="fpPageTitle">Paramètres</h2>
          <p class="fpPageDesc">
            Configure les alertes email, visualise les informations d’organisation et garde une page client propre.
          </p>
        </div>
        <div class="fpPageActions">
          <button class="fpBtn fpBtnPrimary" id="settingsSaveBtnTop" type="button">Enregistrer</button>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpCard">
          <div class="fpCardKicker">Alertes email</div>
          <div class="fpCardTitleLarge">Notifications monitoring</div>

          <div class="fpField">
            <label class="fpLabel">Mode destinataires</label>
            <select class="fpInput" id="settingsRecipientsMode">
              <option value="all" ${state.orgSettings.alertRecipients === "all" ? "selected" : ""}>Toute l’équipe</option>
              <option value="owner" ${state.orgSettings.alertRecipients === "owner" ? "selected" : ""}>Owner uniquement</option>
            </select>
          </div>

          <div class="fpField">
            <label class="fpLabel">Emails supplémentaires</label>
            <input class="fpInput" id="settingsExtraEmails" value="${esc(extraEmails)}" placeholder="mail1@domaine.com, mail2@domaine.com" />
          </div>

          <div class="fpMissionActions">
            <button class="fpBtn fpBtnPrimary" id="settingsSaveBtnBottom" type="button">Sauvegarder</button>
          </div>
        </article>

        <article class="fpCard">
          <div class="fpCardKicker">Organisation</div>
          <div class="fpCardTitleLarge">Informations du compte</div>

          <div class="fpAddonList">
            <div class="fpAddonRow"><div class="fpAddonLabel">Organisation</div><div class="fpMono">${esc(orgName)}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">Plan</div><div class="fpMono">${esc(plan)}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">Rôle</div><div class="fpMono">${esc(role)}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">Période dashboard</div><div class="fpMono">${esc(state.rangeDays)} jours</div></div>
          </div>
        </article>
      </section>
    `);

    $("#settingsSaveBtnTop")?.addEventListener("click", saveOrgSettings);
    $("#settingsSaveBtnBottom")?.addEventListener("click", saveOrgSettings);
  }

  function renderCurrentRoute() {
    setActiveNav();

    if (state.route === "#overview") return renderOverviewPage();
    if (state.route === "#missions") return renderMissionsPage();
    if (state.route === "#audits") return renderAuditsPage();
    if (state.route === "#monitors") return renderMonitorsPage();
    if (state.route === "#reports") return renderReportsPage();
    if (state.route === "#billing") return renderBillingPage();
    if (state.route === "#settings") return renderSettingsPage();

    state.route = "#overview";
    renderOverviewPage();
  }

  async function loadData({ silent = false } = {}) {
    if (!silent) setStatus("Chargement du dashboard…", "warn");

    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    const signal = state.controller.signal;

    try {
      const [meRes, overviewRes, auditsRes, monitorsRes, settingsRes] = await Promise.all([
        fetchWithAuth("/api/me", { signal }).catch(() => null),
        fetchWithAuth(`/api/overview?days=${encodeURIComponent(state.rangeDays)}`, { signal }).catch(() => null),
        fetchWithAuth("/api/audits", { signal }).catch(() => null),
        fetchWithAuth("/api/monitors", { signal }).catch(() => null),
        fetchWithAuth("/api/org/settings", { signal }).catch(() => null),
      ]);

      if (meRes?.ok) state.me = await parseJsonSafe(meRes);

      if (overviewRes?.ok) {
        state.overview = await parseJsonSafe(overviewRes);
      } else {
        state.overview = {
          seoScore: 0,
          chart: [],
          monitors: { active: 0, down: 0 },
          rangeDays: state.rangeDays,
        };
      }

      if (auditsRes?.ok) {
        const data = await parseJsonSafe(auditsRes);
        state.audits = Array.isArray(data.audits) ? data.audits : [];
      } else {
        state.audits = [];
      }

      if (monitorsRes?.ok) {
        const data = await parseJsonSafe(monitorsRes);
        state.monitors = Array.isArray(data.monitors) ? data.monitors : [];
      } else {
        state.monitors = [];
      }

      if (settingsRes?.ok) {
        const data = await parseJsonSafe(settingsRes);
        state.orgSettings = data.settings || state.orgSettings;
      }

      hydrateAccount();
      hydrateOverviewCards();
      drawOverviewChart();
      renderMissionPreview();
      renderAddons();
      renderLiveMonitorsCard();
      renderCurrentRoute();

      setStatus("Dashboard à jour", "ok");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setStatus("Erreur réseau ou session", "danger");
    }
  }

  function logout() {
    clearAuth();
    window.location.replace("/login.html");
  }

  function bindStaticEvents() {
    els.btnMenu?.addEventListener("click", openSidebar);
    els.overlay?.addEventListener("click", closeSidebar);
    els.navItems.forEach((item) => item.addEventListener("click", closeSidebar));

    els.btnRefresh?.addEventListener("click", () => loadData());

    els.rangeSelect?.addEventListener("change", () => {
      const v = Number(els.rangeSelect.value || 30);
      state.rangeDays = [30, 7, 3].includes(v) ? v : 30;
      loadData();
    });

    els.btnExports?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleExportsMenu();
    });

    els.exportsMenu?.addEventListener("click", (e) => e.stopPropagation());

    document.addEventListener("click", () => toggleExportsMenu(false));

    els.btnExportAudits?.addEventListener("click", () => {
      toggleExportsMenu(false);
      safeExport("/api/exports/audits.csv", "flowpoint-audits.csv");
    });

    els.btnExportMonitors?.addEventListener("click", () => {
      toggleExportsMenu(false);
      safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv");
    });

    els.btnRunAudit?.addEventListener("click", safeRunAudit);
    els.btnAddMonitor?.addEventListener("click", safeAddMonitor);
    els.btnAddMonitor2?.addEventListener("click", safeAddMonitor);
    els.btnGoMissions?.addEventListener("click", () => {
      location.hash = "#missions";
    });
    els.btnOpenBilling?.addEventListener("click", openBillingPortal);

    els.btnPortal?.addEventListener("click", openBillingPortal);
    els.btnLogout?.addEventListener("click", logout);
    els.btnSeePlans?.addEventListener("click", () => {
      window.location.href = "/pricing.html";
    });
    els.btnManageAddons?.addEventListener("click", openBillingPortal);

    document.addEventListener("click", (e) => {
      const toggleBtn = e.target.closest("[data-mission-toggle]");
      if (toggleBtn) {
        toggleMission(toggleBtn.getAttribute("data-mission-toggle"));
        renderMissionPreview();
        if (state.route === "#missions") renderMissionsPage();
        return;
      }

      const runBtn = e.target.closest("[data-mission-do]");
      if (runBtn) {
        runMission(runBtn.getAttribute("data-mission-do"));
        return;
      }

      const openBtn = e.target.closest("[data-mission-open]");
      if (openBtn) {
        openMissionPage(openBtn.getAttribute("data-mission-open"));
        return;
      }

      const testBtn = e.target.closest("[data-mon-test]");
      if (testBtn) {
        safeTestMonitor(testBtn.getAttribute("data-mon-test"));
        return;
      }

      const delBtn = e.target.closest("[data-mon-delete]");
      if (delBtn) {
        safeDeleteMonitor(delBtn.getAttribute("data-mon-delete"));
      }
    });

    window.addEventListener("hashchange", () => {
      state.route = ROUTES.has(location.hash) ? location.hash : "#overview";
      renderCurrentRoute();
    });

    window.addEventListener("resize", () => {
      drawOverviewChart();
      if (window.innerWidth > 980) closeSidebar();
    });
  }

  function init() {
    state.missions = loadMissions();

    if (!ROUTES.has(location.hash)) {
      location.hash = "#overview";
      state.route = "#overview";
    }

    if (els.rangeSelect) {
      els.rangeSelect.value = String(state.rangeDays);
    }

    bindStaticEvents();
    renderCurrentRoute();
    loadData();
  }

  init();
})();
