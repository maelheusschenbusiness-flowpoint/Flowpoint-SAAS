/* =========================================================
   FlowPoint — dashboard.js (VERSION FR / PAGES SÉPARÉES)
   Compatible backend actuel :
   - GET  /api/me
   - GET  /api/overview?days=
   - GET  /api/audits
   - GET  /api/audits/:id
   - GET  /api/audits/:id/pdf
   - POST /api/audits/run
   - GET  /api/monitors
   - POST /api/monitors
   - PATCH /api/monitors/:id
   - DELETE /api/monitors/:id
   - POST /api/monitors/:id/run
   - GET  /api/monitors/:id/logs
   - GET  /api/monitors/:id/uptime
   - GET  /api/org/settings
   - POST /api/org/settings
   - POST /api/stripe/portal
   - GET  /api/exports/audits.csv
   - GET  /api/exports/monitors.csv
   ========================================================= */

(() => {
  "use strict";

  const API_BASE = "";
  const TOKEN_KEY = "token";
  const REFRESH_TOKEN_KEY = "refreshToken";
  const REFRESH_ENDPOINT = "/api/auth/refresh";
  const MISSIONS_KEY = "fp_dashboard_missions_v3";
  const MISSIONS_RESET_MS = 3 * 24 * 60 * 60 * 1000;

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

    seoScore: $("#seoScore"),
    seoHint: $("#seoHint"),
    monActive: $("#monActive"),
    monLimit: $("#monLimit"),
    monInc: $("#monInc"),
    subStatus: $("#subStatus"),
    subHint: $("#subHint"),

    missionPreview: $("#missionPreview"),
    monitorsRows: $("#monitorsRows"),
    monitorsEmpty: $("#monitorsEmpty"),
    addonsList: $("#addonsList"),

    btnRunAudit: $("#btnRunAudit"),
    btnAddMonitor: $("#btnAddMonitor"),
    btnGoMissions: $("#btnGoMissions"),
    btnOpenBilling: $("#btnOpenBilling"),
    btnAddMonitor2: $("#btnAddMonitor2"),
    btnManageAddons: $("#btnManageAddons"),
    btnPortal: $("#btnPortal"),
    btnLogout: $("#btnLogout"),

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

  const defaultMissions = [
    { id: "m1", title: "Créer ton premier monitor", meta: "Monitoring", done: false, action: "add_monitor" },
    { id: "m2", title: "Lancer un audit SEO", meta: "Audits", done: false, action: "run_audit" },
    { id: "m3", title: "Exporter les audits CSV", meta: "Rapports", done: false, action: "export_audits" },
    { id: "m4", title: "Exporter les monitors CSV", meta: "Rapports", done: false, action: "export_monitors" },
    { id: "m5", title: "Ouvrir le portail de facturation", meta: "Facturation", done: false, action: "open_billing" },
    { id: "m6", title: "Configurer les alertes email", meta: "Paramètres", done: false, action: "goto_settings" },
    { id: "m7", title: "Tester un monitor", meta: "Monitoring", done: false, action: "test_monitor" },
    { id: "m8", title: "Télécharger un PDF d’audit", meta: "Audits", done: false, action: "download_pdf" },
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

  function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function loadMissions() {
    try {
      const raw = localStorage.getItem(MISSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;

      if (!parsed || !Array.isArray(parsed.missions) || !parsed.lastReset) {
        const payload = {
          lastReset: Date.now(),
          missions: shuffle(defaultMissions).slice(0, 5),
        };
        localStorage.setItem(MISSIONS_KEY, JSON.stringify(payload));
        return payload.missions;
      }

      const diff = Date.now() - Number(parsed.lastReset || 0);
      if (diff >= MISSIONS_RESET_MS) {
        const payload = {
          lastReset: Date.now(),
          missions: shuffle(defaultMissions).slice(0, 5),
        };
        localStorage.setItem(MISSIONS_KEY, JSON.stringify(payload));
        return payload.missions;
      }

      return parsed.missions;
    } catch {
      const payload = {
        lastReset: Date.now(),
        missions: shuffle(defaultMissions).slice(0, 5),
      };
      localStorage.setItem(MISSIONS_KEY, JSON.stringify(payload));
      return payload.missions;
    }
  }

  function saveMissions() {
    const raw = localStorage.getItem(MISSIONS_KEY);
    let lastReset = Date.now();

    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.lastReset) lastReset = parsed.lastReset;
    } catch {}

    localStorage.setItem(
      MISSIONS_KEY,
      JSON.stringify({
        lastReset,
        missions: state.missions,
      })
    );
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
    if (els.helloSub) els.helloSub.textContent = "SEO · Monitoring · Rapports · Facturation";

    if (els.accPlan) els.accPlan.textContent = me.plan || "—";
    if (els.accOrg) els.accOrg.textContent = normalizeOrgName();
    if (els.accRole) els.accRole.textContent = me.role || "—";
    if (els.accTrial) {
      els.accTrial.textContent = me.trialEndsAt ? formatShortDate(me.trialEndsAt) : "—";
    }

    if (els.uAudits) els.uAudits.textContent = formatUsage(usage.audits);
    if (els.uPdf) els.uPdf.textContent = formatUsage(usage.pdf);
    if (els.uExports) els.uExports.textContent = formatUsage(usage.exports);
    if (els.uMonitors) els.uMonitors.textContent = formatUsage(usage.monitors);

    setBar(els.barAudits, usage.audits?.used, usage.audits?.limit);
    setBar(els.barPdf, usage.pdf?.used, usage.pdf?.limit);
    setBar(els.barExports, usage.exports?.used, usage.exports?.limit);
  }

  function hydrateTopCards() {
    const ov = state.overview || {};
    const me = state.me || {};
    const monitorLimit = me.usage?.monitors?.limit ?? 0;

    if (els.seoScore) els.seoScore.textContent = String(ov.seoScore ?? 0);
    if (els.seoHint) {
      els.seoHint.textContent = ov.lastAuditAt
        ? `Dernier audit : ${formatShortDate(ov.lastAuditAt)}`
        : `Période ${state.rangeDays} jours`;
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

  function renderMissionPreview() {
    if (!els.missionPreview) return;

    els.missionPreview.innerHTML = state.missions.map((m) => `
      <div class="fpMission ${m.done ? "isDone" : ""}">
        <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
        <div class="fpMissionBody">
          <div class="fpMissionTitle">${esc(m.title)}</div>
          <div class="fpMissionMeta">${esc(m.meta)}</div>
          <div class="fpMissionActions">
            <button class="fpBtn small primary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
            <button class="fpBtn small" type="button" data-mission-open="${esc(m.id)}">Voir</button>
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

    els.monitorsRows.innerHTML = arr.slice(0, 6).map((m) => {
      const id = normalizeMonitorId(m);
      const status = normalizeMonitorStatus(m);
      return `
        <div class="fpTableRow">
          <div class="fpTableMain">
            <div class="fpUrl">${esc(m.url || "—")}</div>
            <div class="fpSmall">Intervalle : ${esc(m.intervalMinutes ?? "—")} min · Dernier check : ${esc(formatDate(m.lastCheckedAt))}</div>
          </div>

          <div class="fpTableRight">
            <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : ""}">
              <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
            </span>
            <button class="fpBtn small" data-mon-test="${esc(id)}" type="button">Tester</button>
            <button class="fpBtn small danger" data-mon-delete="${esc(id)}" type="button">Supprimer</button>
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
      { label: "Sièges supplémentaires", on: Number(addons.extraSeats || 0) > 0, extra: Number(addons.extraSeats || 0) || 0 },
      { label: "Rétention 90 jours", on: !!addons.retention90d },
      { label: "Rétention 365 jours", on: !!addons.retention365d },
      { label: "Support prioritaire", on: !!addons.prioritySupport },
      { label: "Domaine personnalisé", on: !!addons.customDomain },
    ];

    els.addonsList.innerHTML = entries.map((item) => `
      <div class="fpAddonRow">
        <div class="fpAddonLabel">
          ${esc(item.label)}
          ${item.extra ? `<span class="fpMono">x${esc(item.extra)}</span>` : ""}
        </div>
        <span class="fpAddonPill ${item.on ? "on" : "off"}">${item.on ? "ACTIF" : "OFF"}</span>
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
    if (els.pageContainer) els.pageContainer.innerHTML = html || "";
  }

  function drawOverviewChart() {
    const canvas = els.chart;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(280, Math.round(rect.width || 700));
    const height = 220;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const data = Array.isArray(state.overview?.chart) && state.overview.chart.length
      ? state.overview.chart.map((n) => Number(n || 0))
      : [0, 0, 0, 0, 0, 0, 0];

    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const lineColor = styles.getPropertyValue("--fp-border").trim() || "rgba(255,255,255,.1)";
    const brand = styles.getPropertyValue("--fp-blue").trim() || "#3b5cff";
    const brand2 = styles.getPropertyValue("--fp-blue-2").trim() || "#2449ff";
    const muted = styles.getPropertyValue("--fp-muted").trim() || "#667085";

    for (let i = 0; i < 8; i += 1) {
      const y = 20 + i * ((height - 40) / 7);
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(width - 20, y);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const max = Math.max(100, ...data);
    const left = 24;
    const right = width - 24;
    const top = 18;
    const bottom = height - 28;
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
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(points[0].x, bottom);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, bottom);
    ctx.closePath();

    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, "rgba(59,92,255,.30)");
    fill.addColorStop(1, "rgba(59,92,255,0)");
    ctx.fillStyle = fill;
    ctx.fill();

    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = brand;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    });

    ctx.fillStyle = muted;
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillText("0", 2, bottom + 4);
    ctx.fillText("100", 0, top + 6);
  }

  function buildAiRecommendations(audit) {
    const recs = [];
    const findings = audit?.findings || {};

    if (!findings.title?.ok) recs.push("Optimiser la balise title avec un mot-clé principal et une longueur plus précise.");
    if (!findings.metaDescription?.ok) recs.push("Réécrire la meta description pour améliorer le taux de clic dans Google.");
    if (!findings.h1?.ok) recs.push("Structurer la page avec un seul H1 clair pour renforcer la compréhension SEO.");
    if (!findings.viewport?.ok) recs.push("Corriger l’affichage mobile pour améliorer l’expérience utilisateur et le SEO mobile.");
    if (!findings.responseTime?.ok) recs.push("Réduire le temps de chargement du site pour limiter la perte de trafic.");
    if (!findings.og?.ok) recs.push("Ajouter les balises Open Graph pour améliorer le partage social et la présentation.");
    if (!findings.https?.ok) recs.push("Forcer HTTPS sur toutes les pages pour rassurer Google et les visiteurs.");

    if (!recs.length && Array.isArray(audit?.recommendations) && audit.recommendations.length) {
      return audit.recommendations.slice(0, 5);
    }

    return recs.slice(0, 5);
  }

  function renderOverviewPage() {
    const ov = state.overview || {};
    const me = state.me || {};
    const recentAudits = state.audits.slice(0, 5);
    const recentMonitors = state.monitors.slice(0, 4);

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">DASHBOARD</div>
          <h2 class="fpPageTitle">Vue générale</h2>
          <p class="fpPageDesc">Vue générale de ton compte, de tes performances et de tes actions prioritaires.</p>
        </div>

        <div class="fpPageActions">
          <button class="fpBtn primary" id="overviewRunAudit" type="button">Lancer un audit SEO</button>
          <button class="fpBtn" id="overviewAddMonitor" type="button">Ajouter un monitor</button>
          <button class="fpBtn ghost" id="overviewOpenBilling" type="button">Facturation</button>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpInnerCard">
          <div class="fpInnerTitle">Résumé business</div>
          <div class="fpInnerText">Ce bloc répond rapidement à la question : où en est le client ?</div>

          <div class="fpStatGrid">
            <div class="fpStatBox">
              <div class="fpStatLabel">Score SEO</div>
              <div class="fpStatValue">${esc(ov.seoScore ?? 0)}</div>
              <div class="fpStatHint">${ov.lastAuditAt ? `Dernier audit : ${esc(formatShortDate(ov.lastAuditAt))}` : "Aucun audit récent"}</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Monitors actifs</div>
              <div class="fpStatValue">${esc(ov.monitors?.active ?? 0)}<span class="fpStatSoft"> / ${esc(me.usage?.monitors?.limit ?? 0)}</span></div>
              <div class="fpStatHint">${esc(ov.monitors?.down ?? 0)} incident(s) détecté(s)</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">Plan</div>
              <div class="fpStatValue fpStatSmall">${esc(me.plan || "—")}</div>
              <div class="fpStatHint">${esc(me.subscriptionStatus || "Compte actif")}</div>
            </div>
          </div>
        </article>

        <article class="fpInnerCard">
          <div class="fpInnerTitle">Actions rapides</div>
          <div class="fpInnerText">Les étapes prioritaires pour utiliser le SaaS immédiatement.</div>
          <div class="fpMissionList">
            ${state.missions.map((m) => `
              <div class="fpMission ${m.done ? "isDone" : ""}">
                <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
                <div class="fpMissionBody">
                  <div class="fpMissionTitle">${esc(m.title)}</div>
                  <div class="fpMissionMeta">${esc(m.meta)}</div>
                  <div class="fpMissionActions">
                    <button class="fpBtn small primary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
                    <button class="fpBtn small" type="button" data-mission-open="${esc(m.id)}">Voir</button>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </article>
      </section>

      <section class="fpGrid2">
        <article class="fpInnerCard">
          <div class="fpInnerTitle">Audits récents</div>
          <div class="fpInnerText">Historique rapide des derniers audits SEO.</div>

          ${
            recentAudits.length
              ? recentAudits.map((a) => `
                <div class="fpListRow">
                  <div>
                    <div class="fpUrl">${esc(a.url || "—")}</div>
                    <div class="fpSmall">${esc(formatDate(a.createdAt))}</div>
                  </div>
                  <div class="fpListRight">
                    <span class="fpBadge neutral">${esc(a.score ?? "—")} / 100</span>
                  </div>
                </div>
              `).join("")
              : `<div class="fpEmpty">Aucun audit disponible pour le moment.</div>`
          }
        </article>

        <article class="fpInnerCard">
          <div class="fpInnerTitle">Monitors actifs</div>
          <div class="fpInnerText">Vue rapide sur les URLs surveillées.</div>

          ${
            recentMonitors.length
              ? recentMonitors.map((m) => {
                const status = normalizeMonitorStatus(m);
                return `
                  <div class="fpListRow">
                    <div>
                      <div class="fpUrl">${esc(m.url || "—")}</div>
                      <div class="fpSmall">Intervalle : ${esc(m.intervalMinutes ?? "—")} min</div>
                    </div>
                    <div class="fpListRight">
                      <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : "neutral"}">
                        <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
                      </span>
                    </div>
                  </div>
                `;
              }).join("")
              : `<div class="fpEmpty">Aucun monitor disponible pour le moment.</div>`
          }
        </article>
      </section>
    `);

    $("#overviewRunAudit")?.addEventListener("click", safeRunAudit);
    $("#overviewAddMonitor")?.addEventListener("click", safeAddMonitor);
    $("#overviewOpenBilling")?.addEventListener("click", openBillingPortal);
  }

  function renderMissionsPage() {
    const done = state.missions.filter((m) => m.done).length;
    const progress = `${done}/${state.missions.length}`;

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">SETUP</div>
          <h2 class="fpPageTitle">Missions</h2>
          <p class="fpPageDesc">Checklist de démarrage pour faire utiliser le produit rapidement au client.</p>
        </div>

        <div class="fpPageActions">
          <button class="fpBtn" id="missionsReset" type="button">Réinitialiser</button>
          <button class="fpBtn primary" id="missionsSave" type="button">Enregistrer</button>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpInnerCard">
          <div class="fpInnerTitle">Progression</div>
          <div class="fpInnerText">Les missions se renouvellent automatiquement tous les 3 jours.</div>
          <div class="fpStatBox" style="margin-top:14px">
            <div class="fpStatLabel">MISSIONS TERMINÉES</div>
            <div class="fpStatValue">${esc(progress)}</div>
          </div>
        </article>

        <article class="fpInnerCard">
          <div class="fpInnerTitle">Liste complète</div>
          <div class="fpMissionList">
            ${state.missions.map((m) => `
              <div class="fpMission ${m.done ? "isDone" : ""}">
                <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
                <div class="fpMissionBody">
                  <div class="fpMissionTitle">${esc(m.title)}</div>
                  <div class="fpMissionMeta">${esc(m.meta)}</div>
                  <div class="fpMissionActions">
                    <button class="fpBtn small primary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
                    <button class="fpBtn small" type="button" data-mission-open="${esc(m.id)}">Voir</button>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </article>
      </section>
    `);

    $("#missionsReset")?.addEventListener("click", () => {
      state.missions = shuffle(defaultMissions).slice(0, 5);
      localStorage.setItem(
        MISSIONS_KEY,
        JSON.stringify({ lastReset: Date.now(), missions: state.missions })
      );
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
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">SEO</div>
          <h2 class="fpPageTitle">Audits</h2>
          <p class="fpPageDesc">Audits SEO automatiques, recommandations, PDF et lecture détaillée.</p>
        </div>

        <div class="fpPageActions">
          <button class="fpBtn primary" id="auditsRun" type="button">Lancer un audit SEO</button>
          <button class="fpBtn" id="auditsExport" type="button">Exporter CSV</button>
        </div>
      </section>

      <section class="fpInnerCard">
        <div class="fpInnerTitle">Historique des audits</div>
        <div class="fpInnerText">Clique sur “Détails” pour voir le résumé, les problèmes et les recommandations.</div>

        ${
          state.audits.length
            ? state.audits.map((a) => `
              <div class="fpAuditRow">
                <div class="fpAuditLeft">
                  <div class="fpUrl">${esc(a.url || "—")}</div>
                  <div class="fpSmall">${esc(formatDate(a.createdAt))}</div>
                  <div class="fpSmall">${esc(a.summary || "")}</div>
                </div>

                <div class="fpAuditRight">
                  <span class="fpBadge neutral">${esc(a.score ?? "—")} / 100</span>
                  <button class="fpBtn small" data-audit-detail="${esc(a._id)}" type="button">Détails</button>
                  <button class="fpBtn small primary" data-audit-pdf="${esc(a._id)}" type="button">PDF</button>
                </div>
              </div>
            `).join("")
            : `<div class="fpEmpty">Aucun audit pour le moment.</div>`
        }
      </section>
    `);

    $("#auditsRun")?.addEventListener("click", safeRunAudit);
    $("#auditsExport")?.addEventListener("click", () => safeExport("/api/exports/audits.csv", "flowpoint-audits.csv"));
  }

  async function renderAuditDetail(id) {
    if (!id) return;
    setStatus("Chargement détail audit…", "warn");

    try {
      const r = await fetchWithAuth(`/api/audits/${encodeURIComponent(id)}`, { method: "GET" });
      const data = await parseJsonSafe(r);
      if (!r.ok || !data?.audit) throw new Error(data?.error || "Audit introuvable");

      const audit = data.audit;
      const aiRecs = buildAiRecommendations(audit);
      const checks = audit.findings || {};
      const problems = Object.entries(checks)
        .filter(([, val]) => val && val.ok === false)
        .map(([key, val]) => `${key}: ${typeof val?.value === "object" ? JSON.stringify(val.value) : String(val?.value ?? "—")}`);

      setPage(`
        <section class="fpPageHero">
          <div>
            <div class="fpKicker">AUDIT DÉTAILLÉ</div>
            <h2 class="fpPageTitle">Analyse SEO</h2>
            <p class="fpPageDesc">${esc(audit.url || "—")}</p>
          </div>

          <div class="fpPageActions">
            <button class="fpBtn" id="auditBackBtn" type="button">Retour</button>
            <button class="fpBtn primary" id="auditPdfBtn" type="button">Télécharger le PDF</button>
          </div>
        </section>

        <section class="fpGrid2">
          <article class="fpInnerCard">
            <div class="fpInnerTitle">Résumé</div>
            <div class="fpStatBox" style="margin-top:14px">
              <div class="fpStatLabel">SCORE</div>
              <div class="fpStatValue">${esc(audit.score ?? 0)}</div>
              <div class="fpStatHint">${esc(audit.summary || "—")}</div>
            </div>

            <div class="fpInnerTitle" style="margin-top:22px">Problèmes détectés</div>
            ${
              problems.length
                ? problems.map((p) => `<div class="fpListRow"><div>${esc(p)}</div></div>`).join("")
                : `<div class="fpEmpty">Aucun problème bloquant détecté.</div>`
            }
          </article>

          <article class="fpInnerCard">
            <div class="fpInnerTitle">Recommandations IA SEO</div>
            <div class="fpInnerText">Version intelligente basée sur les checks de l’audit pour guider le client plus facilement.</div>

            ${
              aiRecs.length
                ? aiRecs.map((rItem) => `<div class="fpListRow"><div>${esc(rItem)}</div></div>`).join("")
                : `<div class="fpEmpty">Aucune recommandation disponible.</div>`
            }
          </article>
        </section>
      `);

      $("#auditBackBtn")?.addEventListener("click", () => renderAuditsPage());
      $("#auditPdfBtn")?.addEventListener("click", () => downloadAuditPdf(id));

      setStatus("Audit détaillé chargé", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Erreur chargement audit", "danger");
    }
  }

  function renderMonitorsPage() {
    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">MONITORING</div>
          <h2 class="fpPageTitle">Monitors</h2>
          <p class="fpPageDesc">Disponibilité, uptime, logs et actions rapides sur les URLs surveillées.</p>
        </div>

        <div class="fpPageActions">
          <button class="fpBtn primary" id="monitorsAdd" type="button">Ajouter un monitor</button>
          <button class="fpBtn" id="monitorsExport" type="button">Exporter CSV</button>
        </div>
      </section>

      <section class="fpInnerCard">
        <div class="fpInnerTitle">Liste des monitors</div>
        ${
          state.monitors.length
            ? state.monitors.map((m) => {
              const id = normalizeMonitorId(m);
              const status = normalizeMonitorStatus(m);
              return `
                <div class="fpAuditRow">
                  <div class="fpAuditLeft">
                    <div class="fpUrl">${esc(m.url || "—")}</div>
                    <div class="fpSmall">Intervalle : ${esc(m.intervalMinutes ?? "—")} min</div>
                    <div class="fpSmall">Dernier check : ${esc(formatDate(m.lastCheckedAt))}</div>
                  </div>

                  <div class="fpAuditRight">
                    <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : "neutral"}">
                      <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
                    </span>
                    <button class="fpBtn small" data-mon-detail="${esc(id)}" type="button">Détails</button>
                    <button class="fpBtn small" data-mon-test="${esc(id)}" type="button">Tester</button>
                    <button class="fpBtn small danger" data-mon-delete="${esc(id)}" type="button">Supprimer</button>
                  </div>
                </div>
              `;
            }).join("")
            : `<div class="fpEmpty">Aucun monitor pour le moment.</div>`
        }
      </section>
    `);

    $("#monitorsAdd")?.addEventListener("click", safeAddMonitor);
    $("#monitorsExport")?.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv"));
  }

  async function renderMonitorDetail(id) {
    if (!id) return;
    setStatus("Chargement détail monitor…", "warn");

    try {
      const monitor = state.monitors.find((m) => normalizeMonitorId(m) === id);
      if (!monitor) throw new Error("Monitor introuvable");

      const [uptimeRes, logsRes] = await Promise.all([
        fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/uptime?days=7`, { method: "GET" }),
        fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/logs`, { method: "GET" }),
      ]);

      const uptimeData = await parseJsonSafe(uptimeRes);
      const logsData = await parseJsonSafe(logsRes);

      const uptime = uptimeData?.uptimePercent ?? "—";
      const totalChecks = uptimeData?.totalChecks ?? 0;
      const logs = Array.isArray(logsData?.logs) ? logsData.logs : [];

      setPage(`
        <section class="fpPageHero">
          <div>
            <div class="fpKicker">MONITOR DÉTAILLÉ</div>
            <h2 class="fpPageTitle">Disponibilité</h2>
            <p class="fpPageDesc">${esc(monitor.url || "—")}</p>
          </div>

          <div class="fpPageActions">
            <button class="fpBtn" id="monitorBackBtn" type="button">Retour</button>
            <button class="fpBtn primary" id="monitorTestBtn" type="button">Tester maintenant</button>
          </div>
        </section>

        <section class="fpGrid2">
          <article class="fpInnerCard">
            <div class="fpInnerTitle">Uptime réel</div>
            <div class="fpStatBox" style="margin-top:14px">
              <div class="fpStatLabel">UPTIME 7 JOURS</div>
              <div class="fpStatValue">${esc(uptime)}%</div>
              <div class="fpStatHint">${esc(totalChecks)} vérification(s)</div>
            </div>
          </article>

          <article class="fpInnerCard">
            <div class="fpInnerTitle">Logs récents</div>
            ${
              logs.length
                ? logs.slice(0, 15).map((log) => `
                  <div class="fpListRow">
                    <div>
                      <div class="fpSmall">${esc(formatDate(log.checkedAt))}</div>
                      <div class="fpSmall">HTTP ${esc(log.httpStatus ?? 0)} · ${esc(log.responseTimeMs ?? 0)} ms · ${esc(log.status || "—")}</div>
                    </div>
                  </div>
                `).join("")
                : `<div class="fpEmpty">Aucun log disponible.</div>`
            }
          </article>
        </section>
      `);

      $("#monitorBackBtn")?.addEventListener("click", renderMonitorsPage);
      $("#monitorTestBtn")?.addEventListener("click", async () => {
        await safeTestMonitor(id);
        await renderMonitorDetail(id);
      });

      setStatus("Monitor détaillé chargé", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Erreur chargement monitor", "danger");
    }
  }

  function renderReportsPage() {
    const auditCount = state.audits.length;
    const monitorCount = state.monitors.length;
    const latestAudit = state.audits[0];

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">REPORTING</div>
          <h2 class="fpPageTitle">Rapports</h2>
          <p class="fpPageDesc">Exports CSV, génération PDF et diffusion client.</p>
        </div>

        <div class="fpPageActions">
          <button class="fpBtn primary" id="reportsAuditsCsv" type="button">Audits CSV</button>
          <button class="fpBtn" id="reportsMonitorsCsv" type="button">Monitors CSV</button>
          <button class="fpBtn ghost" id="reportsAuditPdf" type="button">Dernier PDF</button>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpInnerCard">
          <div class="fpInnerTitle">Exports disponibles</div>
          <div class="fpStatGrid">
            <div class="fpStatBox">
              <div class="fpStatLabel">AUDITS</div>
              <div class="fpStatValue">${auditCount}</div>
              <div class="fpStatHint">Export CSV</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">MONITORS</div>
              <div class="fpStatValue">${monitorCount}</div>
              <div class="fpStatHint">Export CSV</div>
            </div>

            <div class="fpStatBox">
              <div class="fpStatLabel">PDF</div>
              <div class="fpStatValue fpStatSmall">${latestAudit ? "Disponible" : "—"}</div>
              <div class="fpStatHint">Rapport audit</div>
            </div>
          </div>
        </article>

        <article class="fpInnerCard">
          <div class="fpInnerTitle">Utilisation</div>
          <div class="fpInnerText">Chaque export ou PDF consomme les quotas de ton abonnement.</div>

          <div class="fpListRow"><div>Exporter les audits pour tes rapports clients</div></div>
          <div class="fpListRow"><div>Exporter les monitors pour le suivi technique</div></div>
          <div class="fpListRow"><div>Télécharger le PDF pour une présentation plus premium</div></div>
        </article>
      </section>
    `);

    $("#reportsAuditsCsv")?.addEventListener("click", () => safeExport("/api/exports/audits.csv", "flowpoint-audits.csv"));
    $("#reportsMonitorsCsv")?.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "flowpoint-monitors.csv"));
    $("#reportsAuditPdf")?.addEventListener("click", async () => {
      if (!latestAudit?._id) {
        setStatus("Aucun audit disponible pour générer un PDF", "danger");
        return;
      }
      await downloadAuditPdf(latestAudit._id);
    });
  }

  function renderBillingPage() {
    const me = state.me || {};
    const quotas = me.usage || {};

    setPage(`
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">BILLING</div>
          <h2 class="fpPageTitle">Facturation</h2>
          <p class="fpPageDesc">Plan, quotas, modules et portail Stripe.</p>
        </div>

        <div class="fpPageActions">
          <button class="fpBtn primary" id="billingPortalBtn" type="button">Ouvrir le portail</button>
          <button class="fpBtn" id="billingPricingBtn" type="button">Voir les prix</button>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpInnerCard">
          <div class="fpInnerTitle">Plan actuel</div>
          <div class="fpStatBox" style="margin-top:14px">
            <div class="fpStatLabel">PLAN</div>
            <div class="fpStatValue fpStatSmall">${esc(me.plan || "—")}</div>
            <div class="fpStatHint">${esc(me.subscriptionStatus || "Compte actif")}</div>
          </div>

          <div class="fpInnerTitle" style="margin-top:22px">Quotas</div>
          <div class="fpListRow"><div>Audits</div><div class="fpMono">${esc(formatUsage(quotas.audits))}</div></div>
          <div class="fpListRow"><div>PDF</div><div class="fpMono">${esc(formatUsage(quotas.pdf))}</div></div>
          <div class="fpListRow"><div>Exports</div><div class="fpMono">${esc(formatUsage(quotas.exports))}</div></div>
          <div class="fpListRow"><div>Monitors</div><div class="fpMono">${esc(formatUsage(quotas.monitors))}</div></div>
        </article>

        <article class="fpInnerCard">
          <div class="fpInnerTitle">Modules activés</div>
          <div class="fpInnerText">Ce bloc aide au futur upsell et rend la valeur visible plus vite.</div>
          ${els.addonsList ? els.addonsList.innerHTML : ""}
        </article>
      </section>
    `);

    $("#billingPortalBtn")?.addEventListener("click", openBillingPortal);
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
      <section class="fpPageHero">
        <div>
          <div class="fpKicker">PARAMÈTRES</div>
          <h2 class="fpPageTitle">Paramètres</h2>
          <p class="fpPageDesc">Emails d’alerte, organisation et préférences du workspace.</p>
        </div>
      </section>

      <section class="fpGrid2">
        <article class="fpInnerCard">
          <div class="fpInnerTitle">Emails d’alerte</div>
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

          <div class="fpPageActions">
            <button class="fpBtn primary" id="settingsSaveBtn" type="button">Enregistrer</button>
          </div>
        </article>

        <article class="fpInnerCard">
          <div class="fpInnerTitle">Organisation</div>
          <div class="fpListRow"><div>Organisation</div><div class="fpMono">${esc(orgName)}</div></div>
          <div class="fpListRow"><div>Plan</div><div class="fpMono">${esc(plan)}</div></div>
          <div class="fpListRow"><div>Rôle</div><div class="fpMono">${esc(role)}</div></div>
        </article>
      </section>
    `);

    $("#settingsSaveBtn")?.addEventListener("click", saveOrgSettings);
  }

  function renderCurrentRoute() {
    setActiveNav();
    setPage("");

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
    hydrateTopCards();
    renderMissionPreview();
    renderRightMonitors();
    renderAddons();
    renderCurrentRoute();
    drawOverviewChart();
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

  async function downloadAuditPdf(auditId) {
    if (!auditId) return false;
    setStatus("Préparation du PDF…", "warn");

    try {
      const r = await fetchWithAuth(`/api/audits/${encodeURIComponent(auditId)}/pdf`, { method: "GET" });
      if (!r.ok) throw new Error("PDF failed");

      const blob = await r.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `flowpoint-audit-${auditId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      setMissionDoneByAction("download_pdf", true);
      renderMissionPreview();
      if (state.route === "#missions") renderMissionsPage();

      setStatus("PDF téléchargé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Téléchargement PDF échoué", "danger");
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
      overlay.className = "fpModalOverlay";

      const card = document.createElement("div");
      card.className = "fpModalCard";
      card.innerHTML = `
        <div class="fpModalTitle">${esc(title)}</div>
        <input id="fpModalInput" class="fpInput" placeholder="${esc(placeholder)}" value="${esc(value)}" />
        <div class="fpModalActions">
          <button class="fpBtn" type="button" id="fpModalCancel">Annuler</button>
          <button class="fpBtn primary" type="button" id="fpModalOk">${esc(confirmText)}</button>
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
      title: "URL à auditer",
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

      if (state.route !== "#audits") {
        location.hash = "#audits";
      } else {
        renderAuditsPage();
      }

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
      title: "URL à monitor",
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

      if (state.route !== "#monitors") {
        location.hash = "#monitors";
      } else {
        renderMonitorsPage();
      }

      setStatus("Monitor créé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Création monitor échouée", "danger");
      return false;
    }
  }

  async function safeTestMonitor(id) {
    if (!id) return false;
    setStatus("Test monitor…", "warn");

    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/run`, {
        method: "POST",
      });

      const data = await parseJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Monitor test failed");

      setMissionDoneByAction("test_monitor", true);
      await loadData({ silent: true });

      if (state.route === "#monitors") renderMonitorsPage();

      setStatus("Test monitor — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Test monitor échoué", "danger");
      return false;
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
      if (state.route === "#monitors") renderMonitorsPage();
      setStatus("Monitor supprimé — OK", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Suppression échouée", "danger");
    }
  }

  async function saveOrgSettings() {
    const mode = $("#settingsRecipientsMode")?.value || "all";
    const raw = $("#settingsExtraEmails")?.value || "";
    const extraEmails = raw.split(",").map((s) => s.trim()).filter(Boolean);

    setStatus("Sauvegarde paramètres…", "warn");

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

      setStatus("Paramètres sauvegardés — OK", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Erreur sauvegarde paramètres", "danger");
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
        setStatus("Aucun monitor à tester", "danger");
        return false;
      }
      return safeTestMonitor(normalizeMonitorId(firstMonitor));
    }
    if (mission.action === "download_pdf") {
      const firstAudit = state.audits[0];
      if (!firstAudit?._id) {
        setStatus("Aucun audit disponible pour générer un PDF", "danger");
        return false;
      }
      return downloadAuditPdf(firstAudit._id);
    }
  }

  function openMissionPage(id) {
    const mission = state.missions.find((m) => m.id === id);
    if (!mission) return;

    if (mission.action === "run_audit" || mission.action === "download_pdf") location.hash = "#audits";
    if (mission.action === "add_monitor" || mission.action === "test_monitor") location.hash = "#monitors";
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
    els.btnGoMissions?.addEventListener("click", () => {
      location.hash = "#missions";
    });
    els.btnOpenBilling?.addEventListener("click", openBillingPortal);
    els.btnAddMonitor2?.addEventListener("click", safeAddMonitor);
    els.btnManageAddons?.addEventListener("click", openBillingPortal);
    els.btnPortal?.addEventListener("click", openBillingPortal);
    els.btnLogout?.addEventListener("click", logout);

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

      const auditDetailBtn = e.target.closest("[data-audit-detail]");
      if (auditDetailBtn) {
        renderAuditDetail(auditDetailBtn.getAttribute("data-audit-detail"));
        return;
      }

      const auditPdfBtn = e.target.closest("[data-audit-pdf]");
      if (auditPdfBtn) {
        downloadAuditPdf(auditPdfBtn.getAttribute("data-audit-pdf"));
        return;
      }

      const monDetailBtn = e.target.closest("[data-mon-detail]");
      if (monDetailBtn) {
        renderMonitorDetail(monDetailBtn.getAttribute("data-mon-detail"));
        return;
      }

      const monTestBtn = e.target.closest("[data-mon-test]");
      if (monTestBtn) {
        safeTestMonitor(monTestBtn.getAttribute("data-mon-test"));
        return;
      }

      const monDeleteBtn = e.target.closest("[data-mon-delete]");
      if (monDeleteBtn) {
        safeDeleteMonitor(monDeleteBtn.getAttribute("data-mon-delete"));
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

    bindEvents();
    loadData();
  }

  init();
})();
