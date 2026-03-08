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
    btnGoMissions: $("#btnGoMissions"),
    btnOpenBilling: $("#btnOpenBilling"),

    monitorsRows: $("#monitorsRows"),
    monitorsEmpty: $("#monitorsEmpty"),
    btnAddMonitor2: $("#btnAddMonitor2"),

    addonsList: $("#addonsList"),
    btnManageAddons: $("#btnManageAddons"),

    btnPortal: $("#btnPortal"),
    btnLogout: $("#btnLogout"),
    btnSeePlans: $("#btnSeePlans"),
    planBtns: $$("[data-plan-btn]"),

    chart: $("#chart"),
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
    lastLoadedAt: null,
  };

  const MISSIONS_KEY = "fp_dashboard_missions_reset_v3";

  const defaultMissions = [
    { id: "m1", title: "Créer ton premier monitor", meta: "Monitoring", done: false, action: "add_monitor" },
    { id: "m2", title: "Lancer un audit SEO", meta: "Audits", done: false, action: "run_audit" },
    { id: "m3", title: "Exporter les audits CSV", meta: "Reports", done: false, action: "export_audits" },
    { id: "m4", title: "Exporter les monitors CSV", meta: "Reports", done: false, action: "export_monitors" },
    { id: "m5", title: "Ouvrir le portail billing", meta: "Billing", done: false, action: "open_billing" },
    { id: "m6", title: "Configurer les alertes email", meta: "Settings", done: false, action: "goto_settings" },
  ];

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setStatus(text, mode = "ok") {
    if (els.statusText) els.statusText.textContent = text || "";
    if (!els.statusDot) return;

    els.statusDot.classList.remove("warn", "danger");
    if (mode === "warn") els.statusDot.classList.add("warn");
    if (mode === "danger") els.statusDot.classList.add("danger");
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

  function parseJsonSafe(res) {
    return res.json().catch(() => ({}));
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

  function toggleExportsMenu(force) {
    if (!els.exportsMenu) return;
    const current = els.exportsMenu.classList.contains("show");
    const next = typeof force === "boolean" ? force : !current;
    els.exportsMenu.classList.toggle("show", next);
    els.exportsMenu.setAttribute("aria-hidden", next ? "false" : "true");
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

  function loadMissions() {
    try {
      const raw = localStorage.getItem(MISSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
    return JSON.parse(JSON.stringify(defaultMissions));
  }

  function saveMissions() {
    localStorage.setItem(MISSIONS_KEY, JSON.stringify(state.missions));
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

  function hydrateAccount() {
    const me = state.me || {};
    const usage = me.usage || {};

    if (els.helloTitle) els.helloTitle.textContent = `Bonjour, ${me.name || "—"}`;
    if (els.helloSub) els.helloSub.textContent = "SEO · Monitoring · Reports · Billing";

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

  function hydrateHeroKpis() {
    const ov = state.overview || {};
    const me = state.me || {};
    const monitorLimit = me.usage?.monitors?.limit ?? 0;

    if (els.kpiRange) els.kpiRange.textContent = `LAST ${state.rangeDays} DAYS`;
    if (els.orgChip) els.orgChip.textContent = normalizeOrgName();
    if (els.seoScore) els.seoScore.textContent = String(ov.seoScore ?? 0);

    if (els.seoHint) {
      els.seoHint.textContent = ov.lastAuditAt
        ? `Dernier audit : ${formatShortDate(ov.lastAuditAt)}`
        : "Aucun audit récent";
    }

    if (els.monActive) els.monActive.textContent = String(ov.monitors?.active ?? 0);
    if (els.monLimit) els.monLimit.textContent = String(monitorLimit);
    if (els.monInc) els.monInc.textContent = String(ov.monitors?.down ?? 0);

    if (els.subStatus) els.subStatus.textContent = me.subscriptionStatus || me.plan || "—";
    if (els.subHint) {
      els.subHint.textContent = me.lastPaymentStatus || (me.hasTrial ? "Essai actif" : "Compte actif");
    }

    renderMissionPreview();
    drawOverviewChart();
  }

  function drawOverviewChart() {
    const canvas = els.chart;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(280, Math.round(rect.width || canvas.clientWidth || 600));
    const height = 160;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const data = Array.isArray(state.overview?.chart) && state.overview.chart.length
      ? state.overview.chart.map((n) => Number(n || 0))
      : [0, 8, 15, 12, 22, 18, 26];

    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const bgLine = styles.getPropertyValue("--fpBorder").trim() || "rgba(255,255,255,.12)";
    const brand = styles.getPropertyValue("--fpBrand").trim() || "#2f5bff";
    const brand2 = styles.getPropertyValue("--fpBrand2").trim() || "#2449ff";
    const muted = styles.getPropertyValue("--fpMuted").trim() || "#667085";

    for (let i = 0; i < 4; i += 1) {
      const y = 22 + i * 30;
      ctx.strokeStyle = bgLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const max = Math.max(100, ...data);
    const left = 10;
    const right = width - 10;
    const top = 14;
    const bottom = height - 22;
    const chartH = bottom - top;
    const step = data.length > 1 ? (right - left) / (data.length - 1) : 0;

    const points = data.map((v, i) => {
      const x = left + i * step;
      const y = bottom - (Math.max(0, Math.min(max, v)) / max) * chartH;
      return { x, y, v };
    });

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, brand);
    gradient.addColorStop(1, brand2);

    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(points[0].x, bottom);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, bottom);
    ctx.closePath();

    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, "rgba(47,91,255,.30)");
    fill.addColorStop(1, "rgba(47,91,255,0)");
    ctx.fillStyle = fill;
    ctx.fill();

    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = brand;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    });

    ctx.fillStyle = muted;
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillText("0", 6, bottom + 14);
    ctx.fillText("100", 6, top + 10);
  }

  function renderMissionPreview() {
    if (!els.missionPreview) return;

    els.missionPreview.innerHTML = state.missions.slice(0, 4).map((m) => `
      <div class="fpMission ${m.done ? "isDone" : ""}">
        <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
        <div class="fpMissionBody">
          <div class="fpMissionTitle">${esc(m.title)}</div>
          <div class="fpMissionMeta">${esc(m.meta)}</div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="fpBtn small fpBtnPrimary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
            <button class="fpBtn small fpBtnGhost" type="button" data-mission-open="${esc(m.id)}">Voir</button>
          </div>
        </div>
      </div>
    `).join("");
  }

  function renderRightMonitors() {
    if (!els.monitorsRows || !els.monitorsEmpty) return;

    const arr = Array.isArray(state.monitors) ? state.monitors : [];
    if (!arr.length) {
      els.monitorsRows.innerHTML = "";
      els.monitorsEmpty.style.display = "block";
      return;
    }

    els.monitorsEmpty.style.display = "none";
    els.monitorsRows.innerHTML = arr.slice(0, 8).map((m) => {
      const id = normalizeMonitorId(m);
      const status = normalizeMonitorStatus(m);
      const interval = m.intervalMinutes ?? "—";
      const last = formatDate(m.lastCheckedAt);

      return `
        <div class="fpTr row">
          <div class="fpUrl">${esc(m.url || "—")}</div>
          <div>
            <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : ""}">
              <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
            </span>
          </div>
          <div class="fpMono">${esc(interval)} min</div>
          <div class="fpMono">${esc(last)}</div>
          <div class="fpRowBtns">
            <button class="fpBtn small fpBtnGhost" data-mon-test="${esc(id)}" type="button">Test</button>
          </div>
          <div class="fpRowBtns">
            <button class="fpBtn small fpBtnDanger" data-mon-delete="${esc(id)}" type="button">Del</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderAddons() {
    if (!els.addonsList) return;

    const addons = state.me?.addons || {};
    const entries = [
      { label: "White label", on: true },
      { label: "Monitors +50", on: Number(addons.monitorsPack50 || 0) > 0, extra: Number(addons.monitorsPack50 || 0) || 0 },
      { label: "Extra seats", on: Number(addons.extraSeats || 0) > 0, extra: Number(addons.extraSeats || 0) || 0 },
      { label: "Retention 90d", on: !!addons.retention90d },
      { label: "Retention 365d", on: !!addons.retention365d },
      { label: "Priority support", on: !!addons.prioritySupport },
      { label: "Custom domain", on: !!addons.customDomain },
    ];

    els.addonsList.innerHTML = entries.map((item) => `
      <div class="fpAddonRow">
        <div class="fpAddonLabel">
          ${esc(item.label)}
          ${item.extra ? `<span class="fpMono" style="margin-left:8px;opacity:.7">x${esc(item.extra)}</span>` : ""}
        </div>
        <span class="fpAddonPill ${item.on ? "on" : "off"}">${item.on ? "ON" : "OFF"}</span>
      </div>
    `).join("");
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

  function renderOverviewPage() {
    const ov = state.overview || {};
    const me = state.me || {};
    const recentAudits = state.audits.slice(0, 5);
    const liveMonitors = state.monitors.slice(0, 4);

    setPage(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpKicker">OVERVIEW</div>
            <div class="fpCardTitle">Business overview</div>
            <div class="fpSmall">Vue générale du workspace, des audits récents et des monitors actifs.</div>
          </div>
        </div>
      </div>

      <div class="fpSettingsGrid" style="margin-top:18px">
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Performance snapshot</div>
          <div class="fpSmall">Résumé rapide de la période sélectionnée.</div>

          <div style="display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px">
            <div class="fpKpiCard">
              <div class="fpKpiLabel">SEO SCORE</div>
              <div class="fpKpiValue">${esc(ov.seoScore ?? 0)}</div>
              <div class="fpKpiHint">${ov.lastAuditAt ? `Dernier audit le ${esc(formatShortDate(ov.lastAuditAt))}` : "Aucun audit récent"}</div>
            </div>

            <div class="fpKpiCard">
              <div class="fpKpiLabel">MONITORS ACTIFS</div>
              <div class="fpKpiValue">${esc(ov.monitors?.active ?? 0)}<span class="fpKpiUnit"> / ${esc(me.usage?.monitors?.limit ?? 0)}</span></div>
              <div class="fpKpiHint">${esc(ov.monitors?.down ?? 0)} down actuellement</div>
            </div>

            <div class="fpKpiCard">
              <div class="fpKpiLabel">PLAN</div>
              <div class="fpKpiValue fpKpiValueSmall">${esc(me.plan || "—")}</div>
              <div class="fpKpiHint">${esc(me.subscriptionStatus || "Compte actif")}</div>
            </div>
          </div>
        </div>

        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Quick setup</div>
          <div class="fpSmall">Checklist rapide pour lancer ton espace correctement.</div>

          <div style="margin-top:14px">
            ${state.missions.slice(0, 4).map((m) => `
              <div class="fpMission ${m.done ? "isDone" : ""}">
                <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
                <div class="fpMissionBody">
                  <div class="fpMissionTitle">${esc(m.title)}</div>
                  <div class="fpMissionMeta">${esc(m.meta)}</div>
                  <div style="margin-top:10px">
                    <button class="fpBtn small fpBtnPrimary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>

      <div class="fpSettingsGrid" style="margin-top:18px">
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Recent audits</div>
          <div class="fpSmall">Les derniers audits lancés depuis ton compte.</div>

          <div style="margin-top:14px">
            ${
              recentAudits.length
                ? recentAudits.map((a) => `
                  <div class="fpTr row" style="grid-template-columns:1.4fr .5fr .8fr">
                    <div class="fpUrl">${esc(a.url || "—")}</div>
                    <div class="fpMono">${esc(a.score ?? "—")}</div>
                    <div class="fpMono">${esc(formatShortDate(a.createdAt))}</div>
                  </div>
                `).join("")
                : `<div class="fpEmpty">Aucun audit disponible pour le moment.</div>`
            }
          </div>
        </div>

        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Live monitors</div>
          <div class="fpSmall">Vue rapide sur l’état courant de tes monitors.</div>

          <div style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
            ${
              liveMonitors.length
                ? liveMonitors.map((m) => `
                  <div class="fpCardInner">
                    <div class="fpUrl">${esc(m.url || "—")}</div>
                    <div class="fpSmall" style="margin-top:8px">Interval : ${esc(m.intervalMinutes ?? "—")} min</div>
                    <div style="margin-top:12px">
                      <span class="fpBadge ${normalizeMonitorStatus(m) === "up" ? "up" : normalizeMonitorStatus(m) === "down" ? "down" : ""}">
                        <span class="fpBadgeDot"></span>${esc(normalizeMonitorStatus(m).toUpperCase())}
                      </span>
                    </div>
                  </div>
                `).join("")
                : `<div class="fpEmpty">Aucun monitor disponible pour le moment.</div>`
            }
          </div>
        </div>
      </div>
    `);
  }

  function renderMissionsPage() {
    const done = state.missions.filter((m) => m.done).length;

    setPage(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpKicker">MISSIONS</div>
            <div class="fpCardTitle">Workspace missions</div>
            <div class="fpSmall">Checklist onboarding, quick actions et progression.</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="fpBtn fpBtnGhost" id="missionsReset" type="button">Reset</button>
            <button class="fpBtn fpBtnPrimary" id="missionsSave" type="button">Save</button>
          </div>
        </div>
      </div>

      <div class="fpSettingsGrid" style="margin-top:18px">
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Checklist</div>
          <div class="fpSmall">Organise le lancement de ton compte client.</div>

          <div style="margin-top:14px">
            ${state.missions.map((m) => `
              <div class="fpMission ${m.done ? "isDone" : ""}">
                <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
                <div class="fpMissionBody">
                  <div class="fpMissionTitle">${esc(m.title)}</div>
                  <div class="fpMissionMeta">${esc(m.meta)}</div>
                  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                    <button class="fpBtn small fpBtnPrimary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
                    <button class="fpBtn small fpBtnGhost" type="button" data-mission-open="${esc(m.id)}">Voir</button>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Progression</div>
          <div class="fpSmall">Visualise rapidement l’avancement du setup.</div>

          <div class="fpKpiCard" style="margin-top:14px">
            <div class="fpKpiLabel">MISSIONS TERMINÉES</div>
            <div class="fpKpiValue">${done}<span class="fpKpiUnit"> / ${state.missions.length}</span></div>
            <div class="fpKpiHint">Progression globale</div>
          </div>
        </div>
      </div>
    `);

    $("#missionsReset")?.addEventListener("click", () => {
      state.missions = JSON.parse(JSON.stringify(defaultMissions));
      saveMissions();
      renderMissionPreview();
      renderMissionsPage();
      setStatus("Missions réinitialisées", "ok");
    });

    $("#missionsSave")?.addEventListener("click", () => {
      saveMissions();
      setStatus("Missions sauvegardées", "ok");
    });
  }

  function renderAuditsPage() {
    setPage(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpKicker">AUDITS</div>
            <div class="fpCardTitle">SEO audits</div>
            <div class="fpSmall">Lance des audits SEO, consulte l’historique et exporte les résultats.</div>
          </div>
          <div class="fpDetailActions">
            <button class="fpBtn fpBtnPrimary" id="auditsRun" type="button">Run SEO audit</button>
            <button class="fpBtn fpBtnGhost" id="auditsExport" type="button">Export CSV</button>
          </div>
        </div>
      </div>

      <div class="fpCardInner" style="margin-top:18px">
        <div class="fpCardInnerTitle">Historique des audits</div>
        <div class="fpSmall">Derniers audits disponibles sur ton organisation.</div>

        <div style="margin-top:14px">
          ${
            state.audits.length
              ? state.audits.map((a) => `
                <div class="fpTr row" style="grid-template-columns:1.6fr .5fr .9fr">
                  <div class="fpUrl">${esc(a.url || "—")}</div>
                  <div class="fpMono">${esc(a.score ?? "—")}</div>
                  <div class="fpMono">${esc(formatDate(a.createdAt))}</div>
                </div>
              `).join("")
              : `<div class="fpEmpty">Aucun audit pour le moment.</div>`
          }
        </div>
      </div>
    `);

    $("#auditsRun")?.addEventListener("click", () => safeRunAudit());
    $("#auditsExport")?.addEventListener("click", () => safeExport("/api/exports/audits.csv", "flowpoint-audits.csv"));
  }

  function renderMonitorsPage() {
    setPage(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpKicker">MONITORS</div>
            <div class="fpCardTitle">URL monitoring</div>
            <div class="fpSmall">Gère les URLs surveillées, teste leur disponibilité et pilote les incidents.</div>
          </div>
          <div class="fpDetailActions">
            <button class="fpBtn fpBtnPrimary" id="monitorsAdd" type="button">Add monitor</button>
            <button class="fpBtn fpBtnGhost" id="monitorsExport" type="button">Export CSV</button>
          </div>
        </div>
      </div>

      <div class="fpCardInner" style="margin-top:18px">
        <div class="fpCardInnerTitle">Liste monitors</div>
        <div class="fpSmall">Uptime, statut, dernier check et actions rapides.</div>

        <div style="margin-top:14px">
          ${
            state.monitors.length
              ? state.monitors.map((m) => {
                const id = normalizeMonitorId(m);
                const status = normalizeMonitorStatus(m);
                return `
                  <div class="fpTr row" style="grid-template-columns:1.7fr .8fr .8fr 1fr .6fr .6fr">
                    <div class="fpUrl">${esc(m.url || "—")}</div>
                    <div>
                      <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : ""}">
                        <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
                      </span>
                    </div>
                    <div class="fpMono">${esc(m.intervalMinutes ?? "—")} min</div>
                    <div class="fpMono">${esc(formatDate(m.lastCheckedAt))}</div>
                    <div class="fpRowBtns">
                      <button class="fpBtn small fpBtnGhost" data-mon-test="${esc(id)}" type="button">Test</button>
                    </div>
                    <div class="fpRowBtns">
                      <button class="fpBtn small fpBtnDanger" data-mon-delete="${esc(id)}" type="button">Del</button>
                    </div>
                  </div>
                `;
              }).join("")
              : `<div class="fpEmpty">Aucun monitor pour le moment.</div>`
          }
        </div>
      </div>
    `);

    $("#monitorsAdd")?.addEventListener("click", () => safeAddMonitor());
    $("#monitorsExport")?.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv"));
  }

  function renderReportsPage() {
    setPage(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpKicker">REPORTS</div>
            <div class="fpCardTitle">Exports & reports</div>
            <div class="fpSmall">Exporte tes audits et tes monitors au format CSV depuis ton backend.</div>
          </div>
          <div class="fpDetailActions">
            <button class="fpBtn fpBtnPrimary" id="reportsAuditsCsv" type="button">Audits CSV</button>
            <button class="fpBtn fpBtnGhost" id="reportsMonitorsCsv" type="button">Monitors CSV</button>
          </div>
        </div>
      </div>

      <div class="fpSettingsGrid" style="margin-top:18px">
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Exports disponibles</div>
          <div class="fpSmall">Ton backend expose déjà les deux routes CSV.</div>

          <div class="fpKpiCard" style="margin-top:14px">
            <div class="fpKpiLabel">AUDITS EXPORTABLES</div>
            <div class="fpKpiValue">${state.audits.length}</div>
            <div class="fpKpiHint">GET /api/exports/audits.csv</div>
          </div>

          <div class="fpKpiCard" style="margin-top:14px">
            <div class="fpKpiLabel">MONITORS EXPORTABLES</div>
            <div class="fpKpiValue">${state.monitors.length}</div>
            <div class="fpKpiHint">GET /api/exports/monitors.csv</div>
          </div>
        </div>

        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Usage</div>
          <div class="fpSmall">Chaque export consomme le quota exports de ton plan.</div>

          <div class="fpCardInner" style="margin-top:14px">
            <div class="fpCardInnerTitle">Conseil</div>
            <div class="fpSmall">Exporte les audits pour les rapports clients et les monitors pour le suivi technique.</div>
          </div>
        </div>
      </div>
    `);

    $("#reportsAuditsCsv")?.addEventListener("click", () => safeExport("/api/exports/audits.csv", "flowpoint-audits.csv"));
    $("#reportsMonitorsCsv")?.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv"));
  }

  function renderBillingPage() {
    const me = state.me || {};
    const quotas = me.usage || {};

    setPage(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpKicker">BILLING</div>
            <div class="fpCardTitle">Billing & subscription</div>
            <div class="fpSmall">Plans, quotas, add-ons et portail Stripe.</div>
          </div>
          <div class="fpDetailActions">
            <button class="fpBtn fpBtnPrimary" id="billingPortalBtn" type="button">Open billing portal</button>
            <button class="fpBtn fpBtnGhost" id="billingPricingBtn" type="button">Pricing</button>
          </div>
        </div>
      </div>

      <div class="fpSettingsGrid" style="margin-top:18px">
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Plan actuel</div>

          <div class="fpKpiCard" style="margin-top:14px">
            <div class="fpKpiLabel">PLAN</div>
            <div class="fpKpiValue fpKpiValueSmall">${esc(me.plan || "—")}</div>
            <div class="fpKpiHint">${esc(me.subscriptionStatus || "Compte actif")}</div>
          </div>
        </div>

        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Quotas</div>
          <div class="fpSmall">Vue rapide des limites actuelles de ton abonnement.</div>

          <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:14px">
            <div class="fpAddonRow"><div class="fpAddonLabel">Audits</div><div class="fpMono">${esc(formatUsage(quotas.audits))}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">PDF</div><div class="fpMono">${esc(formatUsage(quotas.pdf))}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">Exports</div><div class="fpMono">${esc(formatUsage(quotas.exports))}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">Monitors</div><div class="fpMono">${esc(formatUsage(quotas.monitors))}</div></div>
          </div>
        </div>
      </div>
    `);

    $("#billingPortalBtn")?.addEventListener("click", () => openBillingPortal());
    $("#billingPricingBtn")?.addEventListener("click", () => {
      window.location.href = "/pricing.html";
    });
  }

  function renderSettingsPage() {
    const orgName = normalizeOrgName();
    const plan = state.me?.plan || "—";
    const role = state.me?.role || "—";
    const extraEmails = Array.isArray(state.orgSettings.alertExtraEmails)
      ? state.orgSettings.alertExtraEmails.join(", ")
      : "";

    setPage(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpKicker">SETTINGS</div>
            <div class="fpCardTitle">Workspace settings</div>
            <div class="fpSmall">Emails d’alerte, organisation et préférences.</div>
          </div>
        </div>
      </div>

      <div class="fpSettingsGrid" style="margin-top:18px">
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Alert emails</div>
          <div class="fpSmall">Paramètres branchés sur /api/org/settings.</div>

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

          <div class="fpDetailActions">
            <button class="fpBtn fpBtnPrimary" id="settingsSaveBtn" type="button">Save settings</button>
          </div>
        </div>

        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Organisation</div>
          <div class="fpSmall">Résumé du compte connecté.</div>

          <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:14px">
            <div class="fpAddonRow"><div class="fpAddonLabel">Organisation</div><div class="fpMono">${esc(orgName)}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">Plan</div><div class="fpMono">${esc(plan)}</div></div>
            <div class="fpAddonRow"><div class="fpAddonLabel">Rôle</div><div class="fpMono">${esc(role)}</div></div>
          </div>
        </div>
      </div>
    `);

    $("#settingsSaveBtn")?.addEventListener("click", saveOrgSettings);
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

  function drawInitialUi() {
    hydrateAccount();
    hydrateHeroKpis();
    renderRightMonitors();
    renderAddons();
    renderCurrentRoute();
  }

  async function safeExport(endpoint, filename) {
    setStatus("Préparation export…", "warn");
    try {
      const r = await fetchWithAuth(endpoint, { method: "GET" });
      if (!r.ok) throw new Error("Export failed");

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

      setStatus("Export téléchargé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Export échoué", "danger");
      return false;
    }
  }

  async function openBillingPortal() {
    setStatus("Ouverture du portail billing…", "warn");
    try {
      const r = await fetchWithAuth("/api/stripe/portal", { method: "POST" });
      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Portal failed");

      if (data?.url) {
        setMissionDoneByAction("open_billing", true);
        saveMissions();
        window.location.href = data.url;
        return true;
      }

      throw new Error("URL du portail absente");
    } catch (e) {
      console.error(e);
      setStatus("Erreur portail Stripe", "danger");
      return false;
    }
  }

  function openTextModal({ title, placeholder = "", confirmText = "OK", value = "" }) {
    return new Promise((resolve) => {
      const existing = document.getElementById("fpModalOverlay");
      if (existing) existing.remove();

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
      card.style.background = "var(--fpCardStrong)";
      card.style.boxShadow = "0 30px 90px rgba(0,0,0,.25)";
      card.style.padding = "22px";

      card.innerHTML = `
        <div style="font-weight:800;font-size:18px;line-height:1.25;margin-bottom:14px">${esc(title)}</div>
        <input id="fpModalInput" class="fpInput" placeholder="${esc(placeholder)}" value="${esc(value)}" />
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px;flex-wrap:wrap">
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

  async function safeRunAudit() {
    const url = await openTextModal({
      title: "URL à auditer (ex: https://site.com) ?",
      placeholder: "https://site.com",
      confirmText: "Lancer",
    });

    if (!url) return false;

    setStatus("Lancement audit…", "warn");

    try {
      const r = await fetchWithAuth("/api/audits/run", {
        method: "POST",
        body: JSON.stringify({ url }),
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Audit failed");

      setMissionDoneByAction("run_audit", true);
      await loadData({ silent: true });
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
      title: "URL à monitor (ex: https://site.com) ?",
      placeholder: "https://site.com",
      confirmText: "Créer",
    });

    if (!url) return false;

    setStatus("Création monitor…", "warn");

    try {
      const r = await fetchWithAuth("/api/monitors", {
        method: "POST",
        body: JSON.stringify({ url, intervalMinutes: 60 }),
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Monitor failed");

      setMissionDoneByAction("add_monitor", true);
      await loadData({ silent: true });
      setStatus("Monitor créé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Création monitor échouée", "danger");
      return false;
    }
  }

  async function safeTestMonitor(id) {
    if (!id) return;
    setStatus("Test monitor…", "warn");

    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/run`, {
        method: "POST",
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Monitor test failed");

      await loadData({ silent: true });
      setStatus("Test monitor — OK", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Test monitor échoué", "danger");
    }
  }

  async function safeDeleteMonitor(id) {
    if (!id) return;
    const ok = window.confirm("Supprimer ce monitor ?");
    if (!ok) return;

    setStatus("Suppression monitor…", "warn");

    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Delete failed");

      await loadData({ silent: true });
      setStatus("Monitor supprimé — OK", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Suppression échouée", "danger");
    }
  }

  async function saveOrgSettings() {
    const mode = $("#settingsRecipientsMode")?.value || "all";
    const raw = $("#settingsExtraEmails")?.value || "";
    const extraEmails = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setStatus("Sauvegarde settings…", "warn");

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
      renderMissionPreview();
      if (state.route === "#missions") renderMissionsPage();

      setStatus("Settings sauvegardés — OK", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Erreur sauvegarde settings", "danger");
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
  }

  function openMissionPage(id) {
    const mission = state.missions.find((m) => m.id === id);
    if (!mission) return;

    if (mission.action === "run_audit") location.hash = "#audits";
    if (mission.action === "add_monitor") location.hash = "#monitors";
    if (mission.action === "export_audits" || mission.action === "export_monitors") location.hash = "#reports";
    if (mission.action === "open_billing") location.hash = "#billing";
    if (mission.action === "goto_settings") location.hash = "#settings";
  }

  async function loadData({ silent = false } = {}) {
    if (!silent) setStatus("Chargement…", "warn");

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
        state.overview = { seoScore: 0, chart: [], monitors: { active: 0, down: 0 }, rangeDays: state.rangeDays };
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

      state.lastLoadedAt = new Date().toISOString();

      drawInitialUi();
      setStatus("Dashboard à jour — OK", "ok");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setStatus("Erreur réseau / session", "danger");
    }
  }

  function logout() {
    clearAuth();
    window.location.replace("/login.html");
  }

  function bindEvents() {
    els.btnMenu?.addEventListener("click", openSidebar);
    els.overlay?.addEventListener("click", closeSidebar);
    els.navItems.forEach((item) => item.addEventListener("click", closeSidebar));

    els.btnRefresh?.addEventListener("click", () => loadData());

    els.rangeSelect?.addEventListener("change", () => {
      const v = Number(els.rangeSelect.value || 30);
      state.rangeDays = [30, 7, 3].includes(v) ? v : 30;
      hydrateHeroKpis();
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

    els.btnRunAudit?.addEventListener("click", () => safeRunAudit());
    els.btnAddMonitor?.addEventListener("click", () => safeAddMonitor());
    els.btnAddMonitor2?.addEventListener("click", () => safeAddMonitor());
    els.btnGoMissions?.addEventListener("click", () => { location.hash = "#missions"; });
    els.btnOpenBilling?.addEventListener("click", () => openBillingPortal());

    els.btnPortal?.addEventListener("click", () => openBillingPortal());
    els.btnLogout?.addEventListener("click", logout);
    els.btnSeePlans?.addEventListener("click", () => { window.location.href = "/pricing.html"; });
    els.btnManageAddons?.addEventListener("click", () => openBillingPortal());
    els.planBtns.forEach((btn) => btn.addEventListener("click", () => openBillingPortal()));

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

    window.addEventListener("resize", drawOverviewChart);
  }

  function init() {
    state.missions = loadMissions();

    if (!ROUTES.has(location.hash)) {
      location.hash = "#overview";
      state.route = "#overview";
    }

    if (els.rangeSelect) els.rangeSelect.value = String(state.rangeDays);

    drawInitialUi();
    bindEvents();
    loadData();
  }

  init();
})();
