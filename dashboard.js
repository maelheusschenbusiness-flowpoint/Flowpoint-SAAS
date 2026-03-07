/* =========================================================
   FlowPoint — dashboard.js (FULL RESET / CURRENT HTML)
   Compatible with:
   - current dashboard.html structure
   - current backend routes in app.js
   Fixes:
   - uses /api/overview
   - uses /api/stripe/portal
   - uses /api/monitors/:id/run
   - parses wrapped API responses correctly
   - hides overview card on non-overview pages
   - robust missions / pages / exports / mobile sidebar
   ========================================================= */

(() => {
  "use strict";

  // -------------------- CONFIG --------------------
  const API_BASE = "";
  const TOKEN_KEY = "token";
  const REFRESH_TOKEN_KEY = "refreshToken";
  const REFRESH_ENDPOINT = "/api/auth/refresh";

  const ROUTES = [
    { hash: "#overview", key: "overview" },
    { hash: "#missions", key: "missions" },
    { hash: "#audits", key: "audits" },
    { hash: "#monitors", key: "monitors" },
    { hash: "#reports", key: "reports" },
    { hash: "#billing", key: "billing" },
    { hash: "#settings", key: "settings" },
  ];

  // -------------------- HELPERS --------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

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

  function fmtDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("fr-FR");
  }

  function formatUsageCell(v) {
    if (v == null) return "—";
    if (typeof v === "number" || typeof v === "string") return String(v);
    if (typeof v === "object") {
      const used = v.used ?? v.count ?? v.value ?? v.current ?? null;
      const limit = v.limit ?? v.max ?? v.quota ?? null;
      if (used != null && limit != null) return `${used}/${limit}`;
      if (used != null) return String(used);
    }
    return "—";
  }

  function pctBar(fillEl, used, limit) {
    if (!fillEl) return;
    const u = Number(
      typeof used === "object" && used
        ? used.used ?? used.count ?? used.value ?? 0
        : used || 0
    );
    const l = Number(
      typeof used === "object" && used && limit == null
        ? used.limit ?? used.max ?? used.quota ?? 0
        : limit || 0
    );
    const safeLimit = Math.max(1, l || 1);
    const p = Math.min(100, Math.round((u / safeLimit) * 100));
    fillEl.style.width = `${p}%`;
  }

  // -------------------- DOM --------------------
  const els = {
    overlay: $("#overlay"),
    sidebar: $("#sidebar"),
    navItems: $$(".fpNavItem"),
    pageContainer: $("#pageContainer"),
    overviewHero: $("#overviewHero"),

    btnMenu: $("#btnMenu"),
    btnRefresh: $("#btnRefresh"),
    rangeSelect: $("#rangeSelect"),
    statusDot: $("#statusDot"),
    statusText: $("#statusText"),

    btnExports: $("#btnExports"),
    exportsMenu: $("#exportsMenu"),
    btnExportAudits: $("#btnExportAudits"),
    btnExportMonitors: $("#btnExportMonitors"),

    helloTitle: $("#helloTitle"),
    helloSub: $("#helloSub"),
    avatarText: $("#avatarText"),

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

    planBtns: $$("[data-plan-btn]"),
    btnSeePlans: $("#btnSeePlans"),

    addonsList: $("#addonsList"),
    btnManageAddons: $("#btnManageAddons"),

    btnPortal: $("#btnPortal"),
    btnLogout: $("#btnLogout"),
  };

  // -------------------- STATE --------------------
  const state = {
    route: location.hash || "#overview",
    rangeDays: 30,
    controller: null,
    me: null,
    overview: null,
    monitors: [],
    addons: [],
    audits: [],
    subscription: null,
    missions: [],
  };

  // -------------------- STATUS --------------------
  function setStatus(text, mode = "ok") {
    if (els.statusText) els.statusText.textContent = text || "";
    if (!els.statusDot) return;
    els.statusDot.classList.remove("warn", "danger");
    if (mode === "warn") els.statusDot.classList.add("warn");
    if (mode === "danger") els.statusDot.classList.add("danger");
  }

  // -------------------- AUTH --------------------
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
    return true;
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

    if (res.status === 401 || res.status === 403) {
      try {
        await refreshTokenIfPossible();
        const nextToken = getToken();
        if (nextToken) headers.set("Authorization", `Bearer ${nextToken}`);
        res = await doFetch();
      } catch (e) {
        clearAuth();
        window.location.replace("/login.html");
        throw e;
      }
    }

    if (res.status === 429) {
      await sleep(500);
      res = await doFetch();
    }

    return res;
  }

  // -------------------- MISSIONS --------------------
  const MISSIONS_KEY = "fp_dashboard_missions_reset_v1";

  const defaultMissions = [
    {
      id: "m1",
      title: "Créer ton 1er monitor",
      meta: "Monitoring",
      done: false,
      action: { type: "add_monitor", hash: "#monitors" },
    },
    {
      id: "m2",
      title: "Lancer un SEO audit",
      meta: "Audits",
      done: false,
      action: { type: "run_audit", hash: "#audits" },
    },
    {
      id: "m3",
      title: "Exporter audits CSV",
      meta: "Reports",
      done: false,
      action: { type: "export_audits", hash: "#reports" },
    },
    {
      id: "m4",
      title: "Ouvrir Billing Portal",
      meta: "Billing",
      done: false,
      action: { type: "open_billing", hash: "#billing" },
    },
    {
      id: "m5",
      title: "Configurer les alert emails",
      meta: "Settings",
      done: false,
      action: { type: "goto", hash: "#settings" },
    },
  ];

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
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;
    m.done = !m.done;
    saveMissions();
  }

  function markMissionDone(id, done = true) {
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;
    m.done = !!done;
    saveMissions();
  }

  function missionHTML(m, compact = false) {
    return `
      <div class="fpMission ${m.done ? "isDone" : ""}">
        <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
        <div class="fpMissionBody">
          <div class="fpMissionTitle">${esc(m.title)}</div>
          <div class="fpMissionMeta">${esc(m.meta || "")}</div>
          <div style="margin-top:${compact ? "8px" : "10px"};display:flex;gap:10px;flex-wrap:wrap">
            <button class="fpBtn small primary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
            <button class="fpBtn small" type="button" data-mission-goto="${esc(m.id)}">Voir</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderMissionPreview() {
    if (!els.missionPreview) return;
    els.missionPreview.innerHTML = state.missions.slice(0, 4).map((m) => missionHTML(m, true)).join("");
  }

  async function doMission(id, mode = "do") {
    const m = state.missions.find((x) => x.id === id);
    if (!m || !m.action) return;

    if (mode === "goto") {
      if (m.action.hash) location.hash = m.action.hash;
      return;
    }

    if (m.action.hash) location.hash = m.action.hash;

    let ok = false;

    if (m.action.type === "goto") {
      ok = true;
    } else if (m.action.type === "add_monitor") {
      ok = await safeAddMonitor(true);
    } else if (m.action.type === "run_audit") {
      ok = await safeRunAudit(true);
    } else if (m.action.type === "export_audits") {
      ok = await safeExport("/api/exports/audits.csv", "audits.csv", true);
    } else if (m.action.type === "export_monitors") {
      ok = await safeExport("/api/exports/monitors.csv", "monitors.csv", true);
    } else if (m.action.type === "open_billing") {
      ok = await openBillingPortal(true);
    }

    if (ok) {
      markMissionDone(m.id, true);
      renderMissionPreview();
      if (state.route === "#missions") renderMissionsPage();
    }
  }

  // -------------------- SIDEBAR --------------------
  function openSidebar() {
    if (!els.sidebar || !els.overlay) return;
    els.sidebar.classList.add("open");
    els.overlay.classList.add("show");
    els.overlay.setAttribute("aria-hidden", "false");
  }

  function closeSidebar() {
    if (!els.sidebar || !els.overlay) return;
    els.sidebar.classList.remove("open");
    els.overlay.classList.remove("show");
    els.overlay.setAttribute("aria-hidden", "true");
  }

  // -------------------- NAV --------------------
  function setActiveNav(hash) {
    const key = (hash || "#overview").replace("#", "");
    els.navItems.forEach((a) => {
      const route = a.getAttribute("data-route");
      a.classList.toggle("active", route === key);
    });
  }

  function toggleOverviewVisibility(show) {
    if (!els.overviewHero) return;
    els.overviewHero.style.display = show ? "" : "none";
  }

  // -------------------- HYDRATE --------------------
  function hydrateAccount() {
    const me = state.me || {};
    const usage = me.usage || {};

    const displayName = me.name || me.firstName || "—";
    if (els.helloTitle) els.helloTitle.textContent = `Bonjour, ${displayName}`;

    if (els.avatarText) {
      const source = String(displayName || "FP").trim();
      const parts = source.split(/\s+/).filter(Boolean);
      const initials =
        (parts[0]?.[0] || "F").toUpperCase() +
        (parts[1]?.[0] || (parts[0]?.[1] || "P")).toUpperCase();
      els.avatarText.textContent = initials;
    }

    if (els.accPlan) els.accPlan.textContent = me.plan || "—";
    if (els.accOrg) els.accOrg.textContent = me.org?.name || me.orgName || "—";
    if (els.accRole) els.accRole.textContent = me.role || "—";
    if (els.accTrial) {
      els.accTrial.textContent = me.trialEndsAt ? new Date(me.trialEndsAt).toLocaleDateString("fr-FR") : "—";
    }

    if (els.uAudits) els.uAudits.textContent = formatUsageCell(usage.audits);
    if (els.uPdf) els.uPdf.textContent = formatUsageCell(usage.pdf);
    if (els.uExports) els.uExports.textContent = formatUsageCell(usage.exports);
    if (els.uMonitors) els.uMonitors.textContent = formatUsageCell(usage.monitors);

    pctBar(els.barAudits, usage.audits?.used, usage.audits?.limit);
    pctBar(els.barPdf, usage.pdf?.used, usage.pdf?.limit);
    pctBar(els.barExports, usage.exports?.used, usage.exports?.limit);
  }

  function hydrateOverview() {
    const ov = state.overview || {};
    const me = state.me || {};

    if (els.kpiRange) els.kpiRange.textContent = `LAST ${state.rangeDays} DAYS`;
    if (els.seoHint) els.seoHint.textContent = `Last ${state.rangeDays} days`;

    if (els.seoScore) els.seoScore.textContent = String(ov.seoScore ?? 0);
    if (els.monActive) els.monActive.textContent = String(ov.monitors?.active ?? state.monitors.length ?? 0);
    if (els.monLimit) els.monLimit.textContent = String(me.usage?.monitors?.limit ?? 0);
    if (els.monInc) els.monInc.textContent = String(ov.monitors?.down ?? 0);
    if (els.subStatus) els.subStatus.textContent = String(me.subscriptionStatus || "—");
    if (els.subHint) els.subHint.textContent = String(me.plan || "—");
    if (els.orgChip) els.orgChip.textContent = String(me.org?.name || me.orgName || "—");
  }

  // -------------------- RIGHT COLUMN --------------------
  function renderMonitorsRight() {
    if (!els.monitorsRows || !els.monitorsEmpty) return;

    const arr = Array.isArray(state.monitors) ? state.monitors : [];
    if (!arr.length) {
      els.monitorsRows.innerHTML = "";
      els.monitorsEmpty.style.display = "block";
      return;
    }

    els.monitorsEmpty.style.display = "none";
    els.monitorsRows.innerHTML = arr.slice(0, 20).map((m) => {
      const url = m.url || "—";
      const status = String(m.lastStatus || m.status || "unknown").toLowerCase();
      const interval = m.intervalMinutes ?? m.interval ?? "—";
      const last = fmtDate(m.lastCheckedAt || m.updatedAt);

      return `
        <div class="fpTr row">
          <div class="fpUrl">${esc(url)}</div>
          <div>
            <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : ""}">
              <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
            </span>
          </div>
          <div class="fpMono">${esc(interval)}</div>
          <div class="fpMono">${esc(last)}</div>
          <div class="fpRowBtns">
            <button class="fpBtn small" type="button" data-mon-action="test" data-id="${esc(m._id || m.id)}">Test</button>
          </div>
          <div class="fpRowBtns">
            <button class="fpBtn small danger" type="button" data-mon-action="del" data-id="${esc(m._id || m.id)}">Del</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderAddonsRight() {
    if (!els.addonsList) return;

    const me = state.me || {};
    const addons = me.addons || {};
    const entries = Object.entries(addons).filter(([, value]) => {
      if (typeof value === "boolean") return value === true;
      return Number(value || 0) > 0;
    });

    if (!entries.length) {
      els.addonsList.innerHTML = `
        <div class="fpAddonRow">
          <div class="fpAddonLabel">No add-ons</div>
          <span class="fpAddonPill off">OFF</span>
        </div>
      `;
      return;
    }

    els.addonsList.innerHTML = entries.map(([key, value]) => {
      const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
      const text = typeof value === "boolean" ? "ON" : `x${value}`;
      const klass = typeof value === "boolean" ? "on" : "num";
      return `
        <div class="fpAddonRow">
          <div class="fpAddonLabel">${esc(label)}</div>
          <span class="fpAddonPill ${klass}">${esc(text)}</span>
        </div>
      `;
    }).join("");
  }

  // -------------------- ACTIONS --------------------
  async function openBillingPortal(silent = false) {
    if (!silent) setStatus("Ouverture Billing Portal…", "warn");
    try {
      const r = await fetchWithAuth("/api/stripe/portal", { method: "POST" });
      if (!r.ok) throw new Error("Portal failed");
      const data = await r.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url;
        return true;
      }
      setStatus("URL portail manquante", "danger");
      return false;
    } catch (e) {
      console.error(e);
      setStatus("Erreur Billing Portal", "danger");
      return false;
    }
  }

  async function safeRunAudit(silent = false) {
    const url = prompt("URL à auditer (ex: https://site.com) ?");
    if (!url) return false;

    if (!silent) setStatus("Lancement audit…", "warn");
    try {
      const r = await fetchWithAuth("/api/audits/run", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error("Audit failed");
      setStatus("Audit lancé — OK", "ok");
      await loadData();
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Audit échoué", "danger");
      return false;
    }
  }

  async function safeAddMonitor(silent = false) {
    const url = prompt("URL à monitor (ex: https://site.com) ?");
    if (!url) return false;

    if (!silent) setStatus("Création monitor…", "warn");
    try {
      const r = await fetchWithAuth("/api/monitors", {
        method: "POST",
        body: JSON.stringify({ url, intervalMinutes: 60 }),
      });
      if (!r.ok) throw new Error("Monitor failed");
      setStatus("Monitor créé — OK", "ok");
      await loadData();
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Création monitor échouée", "danger");
      return false;
    }
  }

  async function safeExport(endpoint, filename, silent = false) {
    if (!silent) setStatus("Préparation export…", "warn");
    try {
      const r = await fetchWithAuth(endpoint, { method: "GET" });
      if (!r.ok) throw new Error("Export failed");

      const blob = await r.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename || "export";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      if (!silent) setStatus("Export téléchargé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Export échoué", "danger");
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
      if (!r.ok) throw new Error("Test failed");
      setStatus("Test monitor — OK", "ok");
      await loadData();
    } catch (e) {
      console.error(e);
      setStatus("Test échoué", "danger");
    }
  }

  async function safeDeleteMonitor(id) {
    if (!id) return;
    if (!confirm("Supprimer ce monitor ?")) return;

    setStatus("Suppression…", "warn");
    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error("Delete failed");
      setStatus("Monitor supprimé — OK", "ok");
      await loadData();
    } catch (e) {
      console.error(e);
      setStatus("Suppression échouée", "danger");
    }
  }

  function logout() {
    clearAuth();
    window.location.replace("/login.html");
  }

  // -------------------- PAGE RENDER --------------------
  function renderPageShell(title, subtitle, html) {
    if (!els.pageContainer) return;
    els.pageContainer.innerHTML = `
      <div class="fpCard" style="margin-top:14px">
        <div class="fpCardHead">
          <div>
            <div class="fpCardTitle">${esc(title)}</div>
            <div class="fpSmall">${esc(subtitle)}</div>
          </div>
        </div>
        <div style="margin-top:12px">${html}</div>
      </div>
    `;
  }

  function renderMissionsPage() {
    const done = state.missions.filter((m) => m.done).length;

    renderPageShell(
      "Missions",
      `${done}/${state.missions.length} complétées — checklist de mise en route.`,
      `
        <div class="fpDetailActions">
          <button class="fpBtn" id="btnResetMissions" type="button">Reset</button>
          <button class="fpBtn primary" id="btnSaveMissions" type="button">Save</button>
        </div>
        <div class="fpMissionList" id="missionsFullList"></div>
      `
    );

    $("#missionsFullList").innerHTML = state.missions.map((m) => missionHTML(m, false)).join("");

    $("#btnResetMissions")?.addEventListener("click", () => {
      state.missions = JSON.parse(JSON.stringify(defaultMissions));
      saveMissions();
      renderMissionPreview();
      renderMissionsPage();
      setStatus("Missions réinitialisées — OK", "ok");
    });

    $("#btnSaveMissions")?.addEventListener("click", () => {
      saveMissions();
      setStatus("Missions sauvegardées — OK", "ok");
    });
  }

  function renderAuditsPage() {
    renderPageShell(
      "Audits",
      "Historique des audits SEO et accès rapide aux exports.",
      `
        <div class="fpDetailActions">
          <button class="fpBtn primary" id="btnAuditRun" type="button">Run SEO audit</button>
          <button class="fpBtn" id="btnAuditExport" type="button">Export audits CSV</button>
        </div>
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Historique</div>
          <div id="auditsList"></div>
        </div>
      `
    );

    $("#btnAuditRun")?.addEventListener("click", () => safeRunAudit(false));
    $("#btnAuditExport")?.addEventListener("click", () => safeExport("/api/exports/audits.csv", "audits.csv", false));

    const host = $("#auditsList");
    if (!host) return;

    if (!state.audits.length) {
      host.innerHTML = `<div class="fpEmpty">Aucun audit disponible pour le moment.</div>`;
      return;
    }

    host.innerHTML = state.audits.slice(0, 15).map((a) => `
      <div class="fpTr row" style="grid-template-columns:1.5fr .5fr 1fr; margin-top:8px">
        <div class="fpUrl">${esc(a.url || "—")}</div>
        <div class="fpMono">${esc(a.score ?? "—")}</div>
        <div class="fpMono">${esc(fmtDate(a.createdAt))}</div>
      </div>
    `).join("");
  }

  function renderMonitorsPage() {
    renderPageShell(
      "Monitors",
      "Liste complète des monitors, tests et suppressions.",
      `
        <div class="fpDetailActions">
          <button class="fpBtn primary" id="btnMonAdd" type="button">Add monitor</button>
          <button class="fpBtn" id="btnMonExport" type="button">Export monitors CSV</button>
          <button class="fpBtn" id="btnMonRefresh" type="button">Refresh</button>
        </div>
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Liste</div>
          <div id="monitorsPageRows"></div>
        </div>
      `
    );

    $("#btnMonAdd")?.addEventListener("click", () => safeAddMonitor(false));
    $("#btnMonExport")?.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "monitors.csv", false));
    $("#btnMonRefresh")?.addEventListener("click", loadData);

    const host = $("#monitorsPageRows");
    if (!host) return;

    if (!state.monitors.length) {
      host.innerHTML = `<div class="fpEmpty">Aucun monitor pour le moment.</div>`;
      return;
    }

    host.innerHTML = state.monitors.slice(0, 30).map((m) => {
      const id = m._id || m.id;
      const status = String(m.lastStatus || m.status || "unknown").toLowerCase();
      return `
        <div class="fpTr row" style="grid-template-columns:1.4fr .6fr .7fr 1fr .6fr .6fr; margin-top:8px">
          <div class="fpUrl">${esc(m.url || "—")}</div>
          <div>
            <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : ""}">
              <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
            </span>
          </div>
          <div class="fpMono">${esc(m.intervalMinutes ?? "—")}</div>
          <div class="fpMono">${esc(fmtDate(m.lastCheckedAt))}</div>
          <div class="fpRowBtns">
            <button class="fpBtn small" type="button" data-mon-action="test" data-id="${esc(id)}">Test</button>
          </div>
          <div class="fpRowBtns">
            <button class="fpBtn small danger" type="button" data-mon-action="del" data-id="${esc(id)}">Del</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderReportsPage() {
    renderPageShell(
      "Reports",
      "Exports CSV/PDF et génération de rapports.",
      `
        <div class="fpDetailActions">
          <button class="fpBtn primary" id="btnRepPdf" type="button">Export PDF</button>
          <button class="fpBtn" id="btnRepCsv" type="button">Export CSV</button>
        </div>
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Résumé</div>
          <div class="fpSmall">Tu peux brancher ici des rapports mensuels plus tard.</div>
          <div class="fpEmpty">Section reports prête.</div>
        </div>
      `
    );

    $("#btnRepPdf")?.addEventListener("click", () => safeExport("/api/reports/export/pdf", "report.pdf", false));
    $("#btnRepCsv")?.addEventListener("click", () => safeExport("/api/reports/export/csv", "report.csv", false));
  }

  function renderBillingPage() {
    const me = state.me || {};
    renderPageShell(
      "Billing",
      "Gestion de l’abonnement via Stripe Billing Portal.",
      `
        <div class="fpDetailActions">
          <button class="fpBtn primary" id="btnBillingPortal2" type="button">Open Billing Portal</button>
          <button class="fpBtn" id="btnCheckoutPage" type="button">Checkout</button>
        </div>

        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Abonnement</div>
          <div class="fpTr row" style="grid-template-columns:1fr 1fr 1fr; margin-top:8px">
            <div>
              <div class="fpSmall">Plan</div>
              <div class="fpUrl">${esc(me.plan || "—")}</div>
            </div>
            <div>
              <div class="fpSmall">Status</div>
              <div class="fpUrl">${esc(me.subscriptionStatus || "—")}</div>
            </div>
            <div>
              <div class="fpSmall">Trial</div>
              <div class="fpUrl">${esc(me.trialEndsAt ? new Date(me.trialEndsAt).toLocaleDateString("fr-FR") : "—")}</div>
            </div>
          </div>
        </div>
      `
    );

    $("#btnBillingPortal2")?.addEventListener("click", () => openBillingPortal(false));
    $("#btnCheckoutPage")?.addEventListener("click", () => {
      window.location.href = "/checkout.html";
    });
  }

  function renderSettingsPage() {
    const saved = localStorage.getItem("fp_alert_recipients") || "";
    const me = state.me || {};

    renderPageShell(
      "Settings",
      "Emails d’alertes et informations d’organisation.",
      `
        <div class="fpSettingsGrid">
          <div class="fpCardInner">
            <div class="fpCardInnerTitle">Alert emails</div>
            <div class="fpField">
              <label class="fpLabel">Recipients (comma-separated)</label>
              <input class="fpInput" id="setRecipients" placeholder="name@domain.com, other@domain.com" />
            </div>
            <div class="fpDetailActions">
              <button class="fpBtn primary" id="btnSetSave" type="button">Save</button>
              <button class="fpBtn" id="btnSetTest" type="button">Send test</button>
            </div>
          </div>

          <div class="fpCardInner">
            <div class="fpCardInnerTitle">Organisation</div>
            <div class="fpSmall">Org: <span class="fpMono">${esc(me.org?.name || me.orgName || "—")}</span></div>
            <div class="fpSmall" style="margin-top:8px">Plan: <span class="fpMono">${esc(me.plan || "—")}</span></div>
            <div class="fpSmall" style="margin-top:8px">Role: <span class="fpMono">${esc(me.role || "—")}</span></div>
          </div>
        </div>
      `
    );

    const input = $("#setRecipients");
    if (input) input.value = saved;

    $("#btnSetSave")?.addEventListener("click", async () => {
      const val = (input?.value || "").trim();
      localStorage.setItem("fp_alert_recipients", val);
      setStatus("Settings sauvegardés — OK", "ok");
      try {
        await fetchWithAuth("/api/org/settings", {
          method: "POST",
          body: JSON.stringify({ alertRecipients: val }),
        });
      } catch {}
    });

    $("#btnSetTest")?.addEventListener("click", async () => {
      setStatus("Test email…", "warn");
      try {
        const r = await fetchWithAuth("/api/email/test", { method: "POST" });
        setStatus(r.ok ? "Test email envoyé — OK" : "Test email échoué", r.ok ? "ok" : "danger");
      } catch {
        setStatus("Test email échoué", "danger");
      }
    });
  }

  // -------------------- ROUTER --------------------
  function navigate(hash) {
    const nextHash = hash || "#overview";
    const exists = ROUTES.some((r) => r.hash === nextHash);
    state.route = exists ? nextHash : "#overview";

    if (!exists) location.hash = "#overview";

    setActiveNav(state.route);
    toggleOverviewVisibility(state.route === "#overview");

    if (state.route === "#overview") {
      if (els.pageContainer) els.pageContainer.innerHTML = "";
      return;
    }

    if (state.route === "#missions") return renderMissionsPage();
    if (state.route === "#audits") return renderAuditsPage();
    if (state.route === "#monitors") return renderMonitorsPage();
    if (state.route === "#reports") return renderReportsPage();
    if (state.route === "#billing") return renderBillingPage();
    if (state.route === "#settings") return renderSettingsPage();
  }

  // -------------------- LOAD DATA --------------------
  async function loadData() {
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    const signal = state.controller.signal;

    setStatus("Chargement…", "warn");

    try {
      try {
        const r = await fetchWithAuth("/api/me", { signal });
        if (r.ok) state.me = await r.json();
      } catch {}

      try {
        const r = await fetchWithAuth(`/api/overview?days=${encodeURIComponent(state.rangeDays)}`, { signal });
        if (r.ok) state.overview = await r.json();
      } catch {}

      try {
        const r = await fetchWithAuth("/api/audits", { signal });
        if (r.ok) {
          const data = await r.json().catch(() => ({}));
          state.audits = Array.isArray(data.audits) ? data.audits : [];
        }
      } catch {}

      try {
        const r = await fetchWithAuth("/api/monitors", { signal });
        if (r.ok) {
          const data = await r.json().catch(() => ({}));
          state.monitors = Array.isArray(data.monitors) ? data.monitors : [];
        }
      } catch {}

      hydrateAccount();
      hydrateOverview();
      renderMissionPreview();
      renderMonitorsRight();
      renderAddonsRight();

      if (state.route !== "#overview") {
        navigate(state.route);
      }

      setStatus("Dashboard à jour — OK", "ok");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setStatus("Erreur réseau / session", "danger");
    }
  }

  // -------------------- EXPORT MENU --------------------
  function toggleExportsMenu(force) {
    if (!els.exportsMenu) return;
    const open = els.exportsMenu.classList.contains("show");
    const next = typeof force === "boolean" ? force : !open;
    els.exportsMenu.classList.toggle("show", next);
    els.exportsMenu.setAttribute("aria-hidden", next ? "false" : "true");
  }

  // -------------------- BIND --------------------
  function bind() {
    els.btnMenu?.addEventListener("click", openSidebar);
    els.overlay?.addEventListener("click", closeSidebar);
    els.navItems.forEach((a) => a.addEventListener("click", closeSidebar));

    els.btnExports?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleExportsMenu();
    });

    els.exportsMenu?.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => toggleExportsMenu(false));

    els.btnExportAudits?.addEventListener("click", () => {
      toggleExportsMenu(false);
      safeExport("/api/exports/audits.csv", "audits.csv");
    });

    els.btnExportMonitors?.addEventListener("click", () => {
      toggleExportsMenu(false);
      safeExport("/api/exports/monitors.csv", "monitors.csv");
    });

    els.btnRefresh?.addEventListener("click", loadData);

    els.rangeSelect?.addEventListener("change", () => {
      const v = Number(els.rangeSelect.value || 30);
      state.rangeDays = [30, 7, 3].includes(v) ? v : 30;
      hydrateOverview();
      loadData();
    });

    els.btnRunAudit?.addEventListener("click", () => safeRunAudit(false));
    els.btnAddMonitor?.addEventListener("click", () => safeAddMonitor(false));
    els.btnAddMonitor2?.addEventListener("click", () => safeAddMonitor(false));
    els.btnGoMissions?.addEventListener("click", () => { location.hash = "#missions"; });
    els.btnOpenBilling?.addEventListener("click", () => openBillingPortal(false));

    els.btnPortal?.addEventListener("click", () => openBillingPortal(false));
    els.btnLogout?.addEventListener("click", logout);

    els.planBtns.forEach((b) => b.addEventListener("click", () => openBillingPortal(false)));
    els.btnSeePlans?.addEventListener("click", () => {
      window.location.href = "/pricing.html";
    });
    els.btnManageAddons?.addEventListener("click", () => openBillingPortal(false));

    document.addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-mission-toggle]");
      if (toggle) {
        toggleMission(toggle.getAttribute("data-mission-toggle"));
        renderMissionPreview();
        if (state.route === "#missions") renderMissionsPage();
        return;
      }

      const doBtn = e.target.closest("[data-mission-do]");
      if (doBtn) {
        doMission(doBtn.getAttribute("data-mission-do"), "do");
        return;
      }

      const goBtn = e.target.closest("[data-mission-goto]");
      if (goBtn) {
        doMission(goBtn.getAttribute("data-mission-goto"), "goto");
        return;
      }

      const monBtn = e.target.closest("[data-mon-action]");
      if (monBtn) {
        const action = monBtn.getAttribute("data-mon-action");
        const id = monBtn.getAttribute("data-id");
        if (action === "test") safeTestMonitor(id);
        if (action === "del") safeDeleteMonitor(id);
      }
    });

    window.addEventListener("hashchange", () => navigate(location.hash));
  }

  // -------------------- INIT --------------------
  function init() {
    state.missions = loadMissions();
    saveMissions();

    if (!ROUTES.some((r) => r.hash === location.hash)) {
      location.hash = "#overview";
    }

    if (els.rangeSelect) els.rangeSelect.value = String(state.rangeDays);

    setActiveNav(location.hash || "#overview");
    renderMissionPreview();
    navigate(location.hash || "#overview");
    bind();
    loadData();
  }

  init();
})();
