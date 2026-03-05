/* =========================================================
   FlowPoint — dashboard.js (UPGRADED FROM YOUR VERSION)
   Fixes:
   - fetch abort bug (was aborting previous request on each call)
   - Usage formatting ([object Object]) safe
   - Missions with "Faire" action button + deep link
   - Auto-add new missions every 48h (front-only)
   - Exports dropdown more reliable (mobile)
   ========================================================= */

(() => {
  "use strict";

  // -------------------- CONFIG --------------------
  const API_BASE = ""; // keep "" if same origin
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

  // -------------------- DOM HELPERS --------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const els = {
    overlay: $("#overlay"),
    sidebar: $("#sidebar"),
    navItems: $$(".fpNavItem"),
    pageContainer: $("#pageContainer"),

    // topbar
    btnMenu: $("#btnMenu"),
    btnRefresh: $("#btnRefresh"),
    rangeSelect: $("#rangeSelect"),
    statusDot: $("#statusDot"),
    statusText: $("#statusText"),

    // dropdown exports
    btnExports: $("#btnExports"),
    exportsMenu: $("#exportsMenu"),
    btnExportAudits: $("#btnExportAudits"),
    btnExportMonitors: $("#btnExportMonitors"),

    // header texts
    helloTitle: $("#helloTitle"),
    helloSub: $("#helloSub"),
    avatarText: $("#avatarText"),

    // account box
    accPlan: $("#accPlan"),
    accOrg: $("#accOrg"),
    accRole: $("#accRole"),
    accTrial: $("#accTrial"),

    // usage
    uAudits: $("#uAudits"),
    uPdf: $("#uPdf"),
    uExports: $("#uExports"),
    uMonitors: $("#uMonitors"),
    barAudits: $("#barAudits"),
    barPdf: $("#barPdf"),
    barExports: $("#barExports"),

    // overview hero
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

    // quick actions
    btnRunAudit: $("#btnRunAudit"),
    btnAddMonitor: $("#btnAddMonitor"),
    btnGoMissions: $("#btnGoMissions"),
    btnOpenBilling: $("#btnOpenBilling"),

    // monitors table
    monitorsRows: $("#monitorsRows"),
    monitorsEmpty: $("#monitorsEmpty"),
    btnAddMonitor2: $("#btnAddMonitor2"),

    // plans buttons
    planBtns: $$("[data-plan-btn]"),
    btnSeePlans: $("#btnSeePlans"),

    // addons
    addonsList: $("#addonsList"),
    btnManageAddons: $("#btnManageAddons"),

    // account actions
    btnPortal: $("#btnPortal"),
    btnLogout: $("#btnLogout"),
  };

  // -------------------- STATE --------------------
  const state = {
    route: location.hash || "#overview",
    rangeDays: 30,
    controller: null, // abort only per loadData
    missions: [],
    me: null,
    overview: null,
    monitors: [],
    addons: [],
  };

  // -------------------- UTIL --------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setStatus(text, mode = "ok") {
    if (els.statusText) els.statusText.textContent = text || "";
    if (!els.statusDot) return;
    els.statusDot.classList.remove("warn", "danger");
    if (mode === "warn") els.statusDot.classList.add("warn");
    if (mode === "danger") els.statusDot.classList.add("danger");
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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

  function normalizeUsedLimit(used, limit) {
    // accepts numbers OR objects like {used,limit}
    if (typeof used === "object" && used) {
      const u = used.used ?? used.count ?? used.value ?? 0;
      const l = used.limit ?? used.max ?? 0;
      return { used: Number(u || 0), limit: Number(l || 0) };
    }
    return { used: Number(used || 0), limit: Number(limit || 0) };
  }

  function pctBar(fillEl, used, limit) {
    if (!fillEl) return;
    const n = normalizeUsedLimit(used, limit);
    const u = Number(n.used || 0);
    const l = Math.max(1, Number(n.limit || 0) || 1);
    const p = Math.min(100, Math.round((u / l) * 100));
    fillEl.style.width = `${p}%`;
  }

  // -------------------- AUTH --------------------
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
  }
  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  async function refreshTokenIfPossible() {
    const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refresh) throw new Error("No refresh token");

    const r = await fetch(`${API_BASE}${REFRESH_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
      credentials: "include",
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
    const tok = getToken();
    if (tok) headers.set("Authorization", `Bearer ${tok}`);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    const doFetch = () =>
      fetch(url, {
        ...options,
        headers,
        credentials: "include",
        signal: options.signal, // IMPORTANT: no global abort here
      });

    let res = await doFetch();

    if (res.status === 401 || res.status === 403) {
      try {
        await refreshTokenIfPossible();
        const tok2 = getToken();
        if (tok2) headers.set("Authorization", `Bearer ${tok2}`);
        res = await doFetch();
      } catch (e) {
        clearAuth();
        window.location.replace("/login.html");
        throw e;
      }
    }

    if (res.status === 429) {
      await sleep(600);
      res = await doFetch();
    }

    return res;
  }

  // -------------------- MISSIONS (PRO) --------------------
  const MISSIONS_KEY = "fp_missions_v2";
  const MISSIONS_LAST_GEN_KEY = "fp_missions_last_gen";
  const GEN_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48h (met 72h si tu veux)

  // Each mission can have an action:
  // { type: "goto", hash:"#audits" }
  // { type: "run_audit" }
  // { type: "add_monitor" }
  // { type: "open_billing" }
  // { type: "export_audits" }
  // { type: "export_monitors" }
  const baseMissions = [
    { id: "m1", title: "Créer ton 1er monitor", meta: "Monitoring", done: false, action: { type: "add_monitor", hash: "#monitors" } },
    { id: "m2", title: "Lancer un SEO audit", meta: "Audits", done: false, action: { type: "run_audit", hash: "#audits" } },
    { id: "m3", title: "Ouvrir Billing Portal", meta: "Billing", done: false, action: { type: "open_billing", hash: "#billing" } },
    { id: "m4", title: "Exporter audits CSV", meta: "Exports", done: false, action: { type: "export_audits" } },
    { id: "m5", title: "Exporter monitors CSV", meta: "Exports", done: false, action: { type: "export_monitors" } },
  ];

  // Pool for future missions (auto-added every 48h)
  const missionPool = [
    { id: "p1", title: "Ajouter un 2e monitor (uptime)", meta: "Monitoring", done: false, action: { type: "add_monitor", hash: "#monitors" } },
    { id: "p2", title: "Relancer un audit après modifications", meta: "Audits", done: false, action: { type: "run_audit", hash: "#audits" } },
    { id: "p3", title: "Vérifier tes Settings (emails alert)", meta: "Settings", done: false, action: { type: "goto", hash: "#settings" } },
    { id: "p4", title: "Exporter les monitors pour ton client", meta: "Exports", done: false, action: { type: "export_monitors" } },
    { id: "p5", title: "Exporter les audits du mois", meta: "Exports", done: false, action: { type: "export_audits" } },
  ];

  function loadMissions() {
    try {
      const raw = localStorage.getItem(MISSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
    return JSON.parse(JSON.stringify(baseMissions));
  }

  function saveMissions(missions) {
    localStorage.setItem(MISSIONS_KEY, JSON.stringify(missions));
  }

  function maybeGenerateNewMission() {
    const now = Date.now();
    const last = Number(localStorage.getItem(MISSIONS_LAST_GEN_KEY) || 0);

    if (!last) {
      localStorage.setItem(MISSIONS_LAST_GEN_KEY, String(now));
      return;
    }
    if (now - last < GEN_INTERVAL_MS) return;

    // pick first pool mission not already present
    const ids = new Set(state.missions.map((m) => m.id));
    const next = missionPool.find((m) => !ids.has(m.id));
    if (!next) {
      localStorage.setItem(MISSIONS_LAST_GEN_KEY, String(now));
      return;
    }

    state.missions.unshift(JSON.parse(JSON.stringify(next)));
    // cap missions to keep it clean
    state.missions = state.missions.slice(0, 10);

    saveMissions(state.missions);
    localStorage.setItem(MISSIONS_LAST_GEN_KEY, String(now));
  }

  function toggleMission(id) {
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;
    m.done = !m.done;
    saveMissions(state.missions);
  }

  function markMissionDone(id, done = true) {
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;
    m.done = !!done;
    saveMissions(state.missions);
  }

  function missionCardHTML(m, compact = false) {
    const doneClass = m.done ? "done" : "";
    const doneWrap = m.done ? "isDone" : "";
    const hasAction = !!m.action;
    return `
      <div class="fpMission ${doneWrap}">
        <div class="fpCheck ${doneClass}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
        <div class="fpMissionBody">
          <div class="fpMissionTitle">${esc(m.title)}</div>
          <div class="fpMissionMeta">${esc(m.meta || "")}</div>
          ${
            hasAction
              ? `<div style="margin-top:${compact ? "8px" : "10px"}; display:flex; gap:10px; flex-wrap:wrap">
                   <button class="fpBtn small primary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
                   <button class="fpBtn small" type="button" data-mission-goto="${esc(m.id)}">Voir</button>
                 </div>`
              : ""
          }
        </div>
      </div>
    `;
  }

  function renderMissionPreview() {
    if (!els.missionPreview) return;
    const missions = state.missions.slice(0, 4);
    els.missionPreview.innerHTML = missions.map((m) => missionCardHTML(m, true)).join("");
  }

  function renderMissionsPage() {
    const missions = state.missions;
    const done = missions.filter((m) => m.done).length;

    els.pageContainer.innerHTML = `
      <div class="fpCard" style="margin-top:14px">
        <div class="fpCardHead">
          <div>
            <div class="fpCardTitle">Missions</div>
            <div class="fpSmall">${done}/${missions.length} complétées — bouton "Faire" exécute l'action.</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="fpBtn small" id="btnResetMissions" type="button">Reset</button>
            <button class="fpBtn small primary" id="btnSaveMissions" type="button">Save</button>
          </div>
        </div>

        <div class="fpMissionList" style="margin-top:12px">
          ${missions.map((m) => missionCardHTML(m, false)).join("")}
        </div>
      </div>
    `;

    const btnReset = $("#btnResetMissions");
    const btnSave = $("#btnSaveMissions");

    if (btnReset) {
      btnReset.addEventListener("click", () => {
        state.missions = JSON.parse(JSON.stringify(baseMissions));
        saveMissions(state.missions);
        renderMissionPreview();
        renderMissionsPage();
        setStatus("Missions réinitialisées — OK", "ok");
      });
    }

    if (btnSave) {
      btnSave.addEventListener("click", () => {
        saveMissions(state.missions);
        renderMissionPreview();
        setStatus("Missions sauvegardées — OK", "ok");
      });
    }
  }

  async function runMissionAction(missionId, mode = "do") {
    const m = state.missions.find((x) => x.id === missionId);
    if (!m || !m.action) return;

    // "Voir" just navigates
    if (mode === "goto") {
      if (m.action.hash) location.hash = m.action.hash;
      return;
    }

    // "Faire": optional navigate first
    if (m.action.hash) location.hash = m.action.hash;

    const type = m.action.type;

    try {
      if (type === "goto") {
        if (m.action.hash) location.hash = m.action.hash;
        return;
      }

      if (type === "run_audit") {
        await safeRunAudit(true);
        markMissionDone(m.id, true);
        return;
      }

      if (type === "add_monitor") {
        await safeAddMonitor(true);
        // only mark done if user actually created one
        // safeAddMonitor returns true/false
        return;
      }

      if (type === "open_billing") {
        await openBillingPortal(true);
        markMissionDone(m.id, true);
        return;
      }

      if (type === "export_audits") {
        await safeExport("/api/exports/audits.csv", "audits.csv", true);
        markMissionDone(m.id, true);
        return;
      }

      if (type === "export_monitors") {
        await safeExport("/api/exports/monitors.csv", "monitors.csv", true);
        markMissionDone(m.id, true);
        return;
      }
    } finally {
      renderMissionPreview();
      if (location.hash === "#missions") renderMissionsPage();
    }
  }

  // -------------------- RENDER PAGES --------------------
  function renderSimplePage(title, subtitle, html = "") {
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

  function renderAudits() {
    renderSimplePage(
      "Audits",
      "Lance des audits SEO et retrouve ton historique.",
      `
      <div class="fpDetailActions">
        <button class="fpBtn primary" id="audBtnRun" type="button">Run SEO audit</button>
        <button class="fpBtn" id="audBtnExport" type="button">Export audits CSV</button>
      </div>
      `
    );

    const run = $("#audBtnRun");
    const exp = $("#audBtnExport");
    if (run) run.addEventListener("click", () => safeRunAudit());
    if (exp) exp.addEventListener("click", () => safeExport("/api/exports/audits.csv", "audits.csv"));
  }

  function renderMonitors() {
    renderSimplePage(
      "Monitors",
      "Ajoute, supprime et surveille tes URLs.",
      `
      <div class="fpDetailActions">
        <button class="fpBtn primary" id="monBtnAdd" type="button">Add monitor</button>
        <button class="fpBtn" id="monBtnExport" type="button">Export monitors CSV</button>
      </div>
      `
    );

    const add = $("#monBtnAdd");
    const exp = $("#monBtnExport");
    if (add) add.addEventListener("click", () => safeAddMonitor());
    if (exp) exp.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "monitors.csv"));
  }

  function renderReports() {
    renderSimplePage(
      "Reports",
      "Exports PDF/CSV et rapports mensuels.",
      `
      <div class="fpDetailActions">
        <button class="fpBtn primary" id="repBtnPdf" type="button">Export PDF</button>
        <button class="fpBtn" id="repBtnCsv" type="button">Export CSV</button>
      </div>
      `
    );

    const pdf = $("#repBtnPdf");
    const csv = $("#repBtnCsv");
    if (pdf) pdf.addEventListener("click", () => safeExport("/api/reports/export/pdf", "report.pdf"));
    if (csv) csv.addEventListener("click", () => safeExport("/api/reports/export/csv", "report.csv"));
  }

  function renderBilling() {
    renderSimplePage(
      "Billing",
      "Gère ton abonnement via Stripe Billing Portal.",
      `
      <div class="fpDetailActions">
        <button class="fpBtn primary" id="billBtnPortal" type="button">Open Billing Portal</button>
      </div>
      `
    );

    const b = $("#billBtnPortal");
    if (b) b.addEventListener("click", () => openBillingPortal());
  }

  function renderSettings() {
    renderSimplePage(
      "Settings",
      "Config organisation: alert emails, options, etc.",
      `
      <div class="fpSettingsGrid" style="margin-top:10px">
        <div class="fpCardInner">
          <div class="fpCardInnerTitle">Alert emails</div>
          <div class="fpField">
            <label class="fpLabel">Recipients (comma-separated)</label>
            <input class="fpInput" id="setRecipients" placeholder="name@domain.com, other@domain.com" />
          </div>
          <div class="fpDetailActions">
            <button class="fpBtn primary" id="setSave" type="button">Save</button>
            <button class="fpBtn" id="setTest" type="button">Send test</button>
          </div>
        </div>

        <div class="fpCardInner">
          <div class="fpCardInnerTitle">UI</div>
          <div class="fpSmall">Ton thème suit le système (light/dark).</div>
        </div>
      </div>
      `
    );

    const input = $("#setRecipients");
    const saved = localStorage.getItem("fp_alert_recipients") || "";
    if (input) input.value = saved;

    const save = $("#setSave");
    const test = $("#setTest");

    if (save) {
      save.addEventListener("click", async () => {
        const val = (input?.value || "").trim();
        localStorage.setItem("fp_alert_recipients", val);
        setStatus("Settings saved — OK", "ok");
        try {
          await fetchWithAuth("/api/org/settings", {
            method: "POST",
            body: JSON.stringify({ alertRecipients: val }),
          });
        } catch {}
      });
    }

    if (test) {
      test.addEventListener("click", async () => {
        setStatus("Sending test…", "warn");
        try {
          const r = await fetchWithAuth("/api/email/test", { method: "POST" });
          setStatus(r.ok ? "Test email sent — OK" : "Test failed", r.ok ? "ok" : "danger");
        } catch {
          setStatus("Test failed", "danger");
        }
      });
    }
  }

  // -------------------- OVERVIEW DATA (SAFE DEFAULTS) --------------------
  function hydrateOverviewFallback() {
    if (els.kpiRange) els.kpiRange.textContent = `LAST ${state.rangeDays} DAYS`;
    if (els.seoHint) els.seoHint.textContent = `Last ${state.rangeDays} days`;

    if (els.seoScore) els.seoScore.textContent = String(state.overview?.seoScore ?? 0);
    if (els.monActive) els.monActive.textContent = String(state.overview?.monActive ?? 0);
    if (els.monLimit) els.monLimit.textContent = String(state.overview?.monLimit ?? 0);
    if (els.monInc) els.monInc.textContent = String(state.overview?.incidentsDown ?? 0);
    if (els.subStatus) els.subStatus.textContent = String(state.overview?.subStatus ?? "—");
    if (els.subHint) els.subHint.textContent = String(state.overview?.subHint ?? "—");
    if (els.orgChip) els.orgChip.textContent = String(state.me?.orgName ?? "—");
  }

  function hydrateAccountFallback() {
    const me = state.me || {};

    if (els.helloTitle) els.helloTitle.textContent = `Bonjour, ${me.firstName || me.name || "—"}`;
    if (els.avatarText) {
      const s = (me.name || "FlowPoint").trim();
      els.avatarText.textContent =
        (s[0] || "F").toUpperCase() + (s.split(" ")[1]?.[0] || "P").toUpperCase();
    }

    if (els.accPlan) els.accPlan.textContent = me.plan || "—";
    if (els.accOrg) els.accOrg.textContent = me.orgName || "—";
    if (els.accRole) els.accRole.textContent = me.role || "—";
    if (els.accTrial) els.accTrial.textContent = me.trial || "—";

    const usage = me.usage || {};
    if (els.uAudits) els.uAudits.textContent = formatUsageCell(usage.audits);
    if (els.uPdf) els.uPdf.textContent = formatUsageCell(usage.pdf);
    if (els.uExports) els.uExports.textContent = formatUsageCell(usage.exports);
    if (els.uMonitors) els.uMonitors.textContent = formatUsageCell(usage.monitors);

    pctBar(els.barAudits, usage.auditsUsed ?? usage.audits, usage.auditsLimit);
    pctBar(els.barPdf, usage.pdfUsed ?? usage.pdf, usage.pdfLimit);
    pctBar(els.barExports, usage.exportsUsed ?? usage.exports, usage.exportsLimit);
  }

  async function loadData() {
    setStatus("Refreshing…", "warn");

    // Abort only when refreshing dashboard
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    const signal = state.controller.signal;

    hydrateAccountFallback();
    hydrateOverviewFallback();

    try {
      try {
        const rMe = await fetchWithAuth("/api/me", { signal });
        if (rMe.ok) state.me = await rMe.json();
      } catch {}

      try {
        const rOv = await fetchWithAuth(`/api/dashboard/overview?range=${encodeURIComponent(state.rangeDays)}`, { signal });
        if (rOv.ok) state.overview = await rOv.json();
      } catch {}

      try {
        const rMon = await fetchWithAuth("/api/monitors", { signal });
        if (rMon.ok) state.monitors = await rMon.json();
      } catch {}

      try {
        const rAd = await fetchWithAuth("/api/addons", { signal });
        if (rAd.ok) state.addons = await rAd.json();
      } catch {}

      hydrateAccountFallback();
      hydrateOverviewFallback();
      renderMonitorsTable();
      renderAddons();
      renderMissionPreview();

      setStatus("Dashboard à jour — OK", "ok");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setStatus("Erreur réseau / session — vérifie ton token", "danger");
    }
  }

  // -------------------- MONITORS TABLE (RIGHT COLUMN) --------------------
  function renderMonitorsTable() {
    if (!els.monitorsRows || !els.monitorsEmpty) return;

    const arr = Array.isArray(state.monitors) ? state.monitors : [];
    if (!arr.length) {
      els.monitorsRows.innerHTML = "";
      els.monitorsEmpty.style.display = "block";
      return;
    }

    els.monitorsEmpty.style.display = "none";
    els.monitorsRows.innerHTML = arr
      .slice(0, 30)
      .map((m) => {
        const url = m.url || m.endpoint || m.name || "—";
        const status = String(m.status || "unknown").toLowerCase();
        const interval = m.interval || m.intervalMin || "—";
        const last = m.lastCheck || m.lastCheckedAt || m.updatedAt || "—";

        return `
          <div class="fpTr row">
            <div class="fpUrl">${esc(url)}</div>
            <div>
              <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : ""}">
                <span class="fpBadgeDot"></span>
                ${esc(status.toUpperCase())}
              </span>
            </div>
            <div class="fpMono">${esc(interval)}</div>
            <div class="fpMono">${esc(last)}</div>
            <div class="fpRowBtns">
              <button class="fpBtn small" data-mon-action="test" data-id="${esc(m.id)}" type="button">Test</button>
            </div>
            <div class="fpRowBtns">
              <button class="fpBtn small danger" data-mon-action="del" data-id="${esc(m.id)}" type="button">Del</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // -------------------- ADDONS (RIGHT COLUMN) --------------------
  function renderAddons() {
    if (!els.addonsList) return;

    const arr = Array.isArray(state.addons) ? state.addons : [];
    if (!arr.length) {
      els.addonsList.innerHTML = `
        <div class="fpAddonRow">
          <div class="fpAddonLabel">No add-ons</div>
          <span class="fpAddonPill off">OFF</span>
        </div>
      `;
      return;
    }

    els.addonsList.innerHTML = arr
      .map((a) => {
        const label = a.name || a.key || "Addon";
        const on = !!(a.enabled ?? a.active ?? a.on);
        const pillClass = on ? "on" : "off";
        return `
          <div class="fpAddonRow">
            <div class="fpAddonLabel">${esc(label)}</div>
            <span class="fpAddonPill ${pillClass}">${on ? "ON" : "OFF"}</span>
          </div>
        `;
      })
      .join("");
  }

  // -------------------- ROUTER --------------------
  function setActiveNav(hash) {
    const key = hash.replace("#", "");
    els.navItems.forEach((a) => {
      const r = a.getAttribute("data-route");
      a.classList.toggle("active", r === key);
    });
  }

  function navigate(hash) {
    const h = hash || "#overview";
    const exists = ROUTES.some((r) => r.hash === h);
    state.route = exists ? h : "#overview";
    if (!exists) location.hash = "#overview";

    setActiveNav(state.route);

    if (!els.pageContainer) return;
    if (state.route === "#overview") {
      els.pageContainer.innerHTML = "";
      return;
    }

    if (state.route === "#missions") return renderMissionsPage();
    if (state.route === "#audits") return renderAudits();
    if (state.route === "#monitors") return renderMonitors();
    if (state.route === "#reports") return renderReports();
    if (state.route === "#billing") return renderBilling();
    if (state.route === "#settings") return renderSettings();
  }

  // -------------------- UI ACTIONS --------------------
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

  function toggleExportsMenu(force) {
    if (!els.exportsMenu) return;
    const isOpen = els.exportsMenu.classList.contains("show");
    const next = typeof force === "boolean" ? force : !isOpen;
    els.exportsMenu.classList.toggle("show", next);
    els.exportsMenu.setAttribute("aria-hidden", next ? "false" : "true");
  }

  async function openBillingPortal(silent = false) {
    if (!silent) setStatus("Opening billing portal…", "warn");
    try {
      const r = await fetchWithAuth("/api/billing/portal", { method: "POST" });
      if (!r.ok) throw new Error("portal failed");
      const data = await r.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url;
        return true;
      }
      setStatus("Portal URL missing", "danger");
      return false;
    } catch (e) {
      console.error(e);
      setStatus("Billing portal error", "danger");
      return false;
    }
  }

  async function safeExport(endpoint, filename, silent = false) {
    if (!silent) setStatus("Preparing export…", "warn");
    try {
      const r = await fetchWithAuth(endpoint, { method: "GET" });
      if (!r.ok) throw new Error("export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "export";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (!silent) setStatus("Export downloaded — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Export failed", "danger");
      return false;
    }
  }

  async function safeRunAudit(silent = false) {
    if (!silent) setStatus("Running audit…", "warn");
    try {
      const r = await fetchWithAuth("/api/audits/run", { method: "POST" });
      setStatus(r.ok ? "Audit started — OK" : "Audit failed", r.ok ? "ok" : "danger");
      return !!r.ok;
    } catch (e) {
      console.error(e);
      setStatus("Audit failed", "danger");
      return false;
    }
  }

  async function safeAddMonitor(silent = false) {
    const url = prompt("URL à monitor (ex: https://site.com) ?");
    if (!url) return false;

    if (!silent) setStatus("Creating monitor…", "warn");
    try {
      const r = await fetchWithAuth("/api/monitors", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error("create monitor failed");
      setStatus("Monitor created — OK", "ok");
      markMissionDone("m1", true); // convenient if first mission
      await loadData();
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Create monitor failed", "danger");
      return false;
    }
  }

  async function safeTestMonitor(id) {
    if (!id) return;
    setStatus("Testing monitor…", "warn");
    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/ping`, { method: "POST" });
      setStatus(r.ok ? "Test OK — UP" : "Test failed", r.ok ? "ok" : "danger");
      await loadData();
    } catch (e) {
      console.error(e);
      setStatus("Test failed", "danger");
    }
  }

  async function safeDeleteMonitor(id) {
    if (!id) return;
    if (!confirm("Supprimer ce monitor ?")) return;
    setStatus("Deleting monitor…", "warn");
    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}`, { method: "DELETE" });
      setStatus(r.ok ? "Monitor deleted — OK" : "Delete failed", r.ok ? "ok" : "danger");
      await loadData();
    } catch (e) {
      console.error(e);
      setStatus("Delete failed", "danger");
    }
  }

  function logout() {
    clearAuth();
    window.location.replace("/login.html");
  }

  // -------------------- EVENT BINDINGS --------------------
  function bind() {
    // mobile menu
    if (els.btnMenu) els.btnMenu.addEventListener("click", openSidebar);
    if (els.overlay) els.overlay.addEventListener("click", closeSidebar);

    els.navItems.forEach((a) =>
      a.addEventListener("click", () => {
        closeSidebar();
      })
    );

    // exports dropdown (more reliable)
    if (els.btnExports) {
      els.btnExports.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleExportsMenu();
      });
    }
    if (els.exportsMenu) {
      els.exportsMenu.addEventListener("click", (e) => e.stopPropagation());
    }
    document.addEventListener("click", () => toggleExportsMenu(false));

    if (els.btnExportAudits) {
      els.btnExportAudits.addEventListener("click", () => {
        toggleExportsMenu(false);
        safeExport("/api/exports/audits.csv", "audits.csv");
      });
    }
    if (els.btnExportMonitors) {
      els.btnExportMonitors.addEventListener("click", () => {
        toggleExportsMenu(false);
        safeExport("/api/exports/monitors.csv", "monitors.csv");
      });
    }

    // refresh + range
    if (els.btnRefresh) els.btnRefresh.addEventListener("click", loadData);
    if (els.rangeSelect) {
      els.rangeSelect.addEventListener("change", () => {
        const v = Number(els.rangeSelect.value || 30);
        state.rangeDays = [30, 7, 3].includes(v) ? v : 30;
        hydrateOverviewFallback();
        loadData();
      });
    }

    // quick actions
    if (els.btnRunAudit) els.btnRunAudit.addEventListener("click", safeRunAudit);
    if (els.btnAddMonitor) els.btnAddMonitor.addEventListener("click", safeAddMonitor);
    if (els.btnAddMonitor2) els.btnAddMonitor2.addEventListener("click", safeAddMonitor);

    if (els.btnGoMissions) {
      els.btnGoMissions.addEventListener("click", () => {
        location.hash = "#missions";
      });
    }

    if (els.btnOpenBilling) els.btnOpenBilling.addEventListener("click", openBillingPortal);

    // account buttons
    if (els.btnPortal) els.btnPortal.addEventListener("click", openBillingPortal);
    if (els.btnLogout) els.btnLogout.addEventListener("click", logout);

    // plans/manage buttons
    els.planBtns.forEach((b) => b.addEventListener("click", openBillingPortal));
    if (els.btnSeePlans) els.btnSeePlans.addEventListener("click", openBillingPortal);
    if (els.btnManageAddons) els.btnManageAddons.addEventListener("click", openBillingPortal);

    // delegation: missions + monitors
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-mission-toggle]");
      if (t) {
        const id = t.getAttribute("data-mission-toggle");
        toggleMission(id);
        renderMissionPreview();
        if (location.hash === "#missions") renderMissionsPage();
        return;
      }

      const doBtn = e.target.closest("[data-mission-do]");
      if (doBtn) {
        const id = doBtn.getAttribute("data-mission-do");
        runMissionAction(id, "do");
        return;
      }

      const goBtn = e.target.closest("[data-mission-goto]");
      if (goBtn) {
        const id = goBtn.getAttribute("data-mission-goto");
        runMissionAction(id, "goto");
        return;
      }

      const mon = e.target.closest("[data-mon-action]");
      if (mon) {
        const act = mon.getAttribute("data-mon-action");
        const id = mon.getAttribute("data-id");
        if (act === "test") safeTestMonitor(id);
        if (act === "del") safeDeleteMonitor(id);
      }
    });

    window.addEventListener("hashchange", () => navigate(location.hash));
  }

  // -------------------- INIT --------------------
  function init() {
    state.missions = loadMissions();
    maybeGenerateNewMission(); // adds one new mission every 48h max
    saveMissions(state.missions);

    if (!ROUTES.some((r) => r.hash === location.hash)) {
      if (!location.hash) location.hash = "#overview";
    }

    if (els.rangeSelect) els.rangeSelect.value = String(state.rangeDays);

    renderMissionPreview();
    navigate(location.hash || "#overview");
    bind();
    loadData();
  }

  init();
})();
