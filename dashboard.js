/* =========================================================
   FlowPoint — dashboard.js (MATCHES YOUR HTML)
   - Hash router: #overview #missions #audits #monitors #reports #billing #settings
   - Mobile sidebar toggle + overlay
   - Exports dropdown
   - Missions: done / not done ✔ + preview on overview
   - fetchWithAuth: handles expired token (retry/refresh) to stop “request expired”
   ========================================================= */

(() => {
  "use strict";

  // -------------------- CONFIG --------------------
  const API_BASE = ""; // keep "" if same origin
  const TOKEN_KEY = "token"; // your HTML checks localStorage.getItem("token")

  // Optional if your backend supports refresh:
  const REFRESH_TOKEN_KEY = "refreshToken"; // if you store it
  const REFRESH_ENDPOINT = "/api/auth/refresh"; // if exists

  const ROUTES = [
    { hash: "#overview", key: "overview", label: "Overview" },
    { hash: "#missions", key: "missions", label: "Missions" },
    { hash: "#audits", key: "audits", label: "Audits" },
    { hash: "#monitors", key: "monitors", label: "Monitors" },
    { hash: "#reports", key: "reports", label: "Reports" },
    { hash: "#billing", key: "billing", label: "Billing" },
    { hash: "#settings", key: "settings", label: "Settings" },
  ];

  // -------------------- DOM HELPERS --------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const els = {
    overlay: $("#overlay"),
    app: $(".fpApp"),
    sidebar: $("#sidebar"),
    navItems: $$(".fpNavItem"),
    pageContainer: $("#pageContainer"),

    // topbar
    btnMenu: $("#btnMenu"),
    btnRefresh: $("#btnRefresh"),
    rangeSelect: $("#rangeSelect"),
    statusPill: $("#statusPill"),
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
    aborter: null,
    missions: [],
    me: null,
    overview: null,
    monitors: [],
    addons: [],
  };

  // -------------------- UTIL --------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setStatus(text, mode = "ok") {
    if (els.statusText) els.statusText.textContent = text;
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

  function pctBar(fillEl, used, limit) {
    if (!fillEl) return;
    const u = Number(used || 0);
    const l = Math.max(1, Number(limit || 0) || 1);
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

    if (state.aborter) state.aborter.abort();
    state.aborter = new AbortController();

    const doFetch = () =>
      fetch(url, {
        ...options,
        headers,
        signal: state.aborter.signal,
        credentials: "include",
      });

    let res = await doFetch();

    // Handle expired token
    if (res.status === 401 || res.status === 403) {
      try {
        await refreshTokenIfPossible();
        const tok2 = getToken();
        if (tok2) headers.set("Authorization", `Bearer ${tok2}`);
        res = await doFetch();
      } catch (e) {
        // logout clean
        clearAuth();
        window.location.replace("/login.html");
        throw e;
      }
    }

    // small retry for rate-limit
    if (res.status === 429) {
      await sleep(600);
      res = await doFetch();
    }

    return res;
  }

  // -------------------- MISSIONS --------------------
  const MISSIONS_KEY = "fp_missions_v1";
  const defaultMissions = [
    { id: "m1", title: "Créer ton 1er monitor", meta: "Monitoring", done: false },
    { id: "m2", title: "Lancer un SEO audit", meta: "Audits", done: false },
    { id: "m3", title: "Ouvrir Billing Portal", meta: "Billing", done: false },
    { id: "m4", title: "Exporter audits CSV", meta: "Exports", done: false },
    { id: "m5", title: "Activer un add-on", meta: "Add-ons", done: false },
  ];

  function loadMissions() {
    try {
      const raw = localStorage.getItem(MISSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
    return JSON.parse(JSON.stringify(defaultMissions));
  }

  function saveMissions(missions) {
    localStorage.setItem(MISSIONS_KEY, JSON.stringify(missions));
  }

  function renderMissionPreview() {
    if (!els.missionPreview) return;
    const missions = state.missions.slice(0, 4);
    els.missionPreview.innerHTML = missions
      .map((m) => {
        const doneClass = m.done ? "done" : "";
        const doneWrap = m.done ? "isDone" : "";
        return `
          <div class="fpMission ${doneWrap}">
            <div class="fpCheck ${doneClass}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
            <div class="fpMissionBody">
              <div class="fpMissionTitle">${esc(m.title)}</div>
              <div class="fpMissionMeta">${esc(m.meta || "")}</div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderMissionsPage() {
    const missions = state.missions;
    const done = missions.filter((m) => m.done).length;

    els.pageContainer.innerHTML = `
      <div class="fpCard" style="margin-top:14px">
        <div class="fpCardHead">
          <div>
            <div class="fpCardTitle">Missions</div>
            <div class="fpSmall">Marque comme fait / pas fait ✔ — ${done}/${missions.length} complétées</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="fpBtn small" id="btnResetMissions" type="button">Reset</button>
            <button class="fpBtn small primary" id="btnSaveMissions" type="button">Save</button>
          </div>
        </div>

        <div class="fpMissionList" style="margin-top:12px">
          ${missions
            .map((m) => {
              const doneClass = m.done ? "done" : "";
              const doneWrap = m.done ? "isDone" : "";
              return `
                <div class="fpMission ${doneWrap}">
                  <div class="fpCheck ${doneClass}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
                  <div class="fpMissionBody">
                    <div class="fpMissionTitle">${esc(m.title)}</div>
                    <div class="fpMissionMeta">${esc(m.meta || "")}</div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    const btnReset = $("#btnResetMissions");
    const btnSave = $("#btnSaveMissions");

    if (btnReset) {
      btnReset.addEventListener("click", () => {
        state.missions = JSON.parse(JSON.stringify(defaultMissions));
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

  function toggleMission(id) {
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;
    m.done = !m.done;
    saveMissions(state.missions);
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
      <div class="fpNote">Connecte ces boutons à tes endpoints: <span class="fpMono">/api/audits/run</span> et <span class="fpMono">/api/audits/export.csv</span>.</div>
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
      <div class="fpNote">La liste en temps réel reste sur la colonne de droite. Ici tu peux ajouter une page détail si tu veux.</div>
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
      <div class="fpNote">Branche ces actions sur tes routes: <span class="fpMono">/api/reports/export/pdf</span> et <span class="fpMono">/api/reports/export/csv</span>.</div>
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
      <div class="fpNote">Le portal doit renvoyer une URL: <span class="fpMono">POST /api/billing/portal</span> → {"url":"https://..."}</div>
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
          <div class="fpSmall">Ton thème suit le système (light/dark). Si tu veux un toggle, je te l’ajoute.</div>
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
        // optional backend save if exists
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
    // Range
    if (els.kpiRange) els.kpiRange.textContent = `LAST ${state.rangeDays} DAYS`;
    if (els.seoHint) els.seoHint.textContent = `Last ${state.rangeDays} days`;

    // If no API, keep UI stable
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
      els.avatarText.textContent = (s[0] || "F").toUpperCase() + (s.split(" ")[1]?.[0] || "P").toUpperCase();
    }

    if (els.accPlan) els.accPlan.textContent = me.plan || "—";
    if (els.accOrg) els.accOrg.textContent = me.orgName || "—";
    if (els.accRole) els.accRole.textContent = me.role || "—";
    if (els.accTrial) els.accTrial.textContent = me.trial || "—";

    const usage = me.usage || {};
    if (els.uAudits) els.uAudits.textContent = usage.audits ?? "—";
    if (els.uPdf) els.uPdf.textContent = usage.pdf ?? "—";
    if (els.uExports) els.uExports.textContent = usage.exports ?? "—";
    if (els.uMonitors) els.uMonitors.textContent = usage.monitors ?? "—";

    pctBar(els.barAudits, usage.auditsUsed, usage.auditsLimit);
    pctBar(els.barPdf, usage.pdfUsed, usage.pdfLimit);
    pctBar(els.barExports, usage.exportsUsed, usage.exportsLimit);
  }

  async function loadData() {
    // NOTE: these endpoints are OPTIONAL. If they don't exist, dashboard still runs.
    // You can rename them to match your backend easily.

    setStatus("Refreshing…", "warn");

    // Basic fallback first (prevents UI from looking broken)
    hydrateAccountFallback();
    hydrateOverviewFallback();

    // Attempt API calls
    try {
      // /api/me
      try {
        const rMe = await fetchWithAuth("/api/me");
        if (rMe.ok) state.me = await rMe.json();
      } catch {}

      // /api/dashboard/overview?range=30
      try {
        const rOv = await fetchWithAuth(`/api/dashboard/overview?range=${encodeURIComponent(state.rangeDays)}`);
        if (rOv.ok) state.overview = await rOv.json();
      } catch {}

      // /api/monitors
      try {
        const rMon = await fetchWithAuth("/api/monitors");
        if (rMon.ok) state.monitors = await rMon.json();
      } catch {}

      // /api/addons
      try {
        const rAd = await fetchWithAuth("/api/addons");
        if (rAd.ok) state.addons = await rAd.json();
      } catch {}

      hydrateAccountFallback();
      hydrateOverviewFallback();
      renderMonitorsTable();
      renderAddons();
      renderMissionPreview();

      setStatus("Dashboard à jour — OK", "ok");
    } catch (e) {
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

    // Only render into pageContainer for non-overview
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

  async function openBillingPortal() {
    setStatus("Opening billing portal…", "warn");
    try {
      const r = await fetchWithAuth("/api/billing/portal", { method: "POST" });
      if (!r.ok) throw new Error("portal failed");
      const data = await r.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setStatus("Portal URL missing", "danger");
    } catch (e) {
      console.error(e);
      setStatus("Billing portal error", "danger");
    }
  }

  async function safeExport(endpoint, filename) {
    setStatus("Preparing export…", "warn");
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
      setStatus("Export downloaded — OK", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Export failed", "danger");
    }
  }

  async function safeRunAudit() {
    setStatus("Running audit…", "warn");
    try {
      const r = await fetchWithAuth("/api/audits/run", { method: "POST" });
      setStatus(r.ok ? "Audit started — OK" : "Audit failed", r.ok ? "ok" : "danger");
    } catch (e) {
      console.error(e);
      setStatus("Audit failed", "danger");
    }
  }

  async function safeAddMonitor() {
    // Minimal prompt to avoid modal dependency
    const url = prompt("URL à monitor (ex: https://site.com) ?");
    if (!url) return;

    setStatus("Creating monitor…", "warn");
    try {
      const r = await fetchWithAuth("/api/monitors", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error("create monitor failed");
      setStatus("Monitor created — OK", "ok");
      await loadData();
    } catch (e) {
      console.error(e);
      setStatus("Create monitor failed", "danger");
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

    // close sidebar when clicking nav on mobile
    els.navItems.forEach((a) =>
      a.addEventListener("click", () => {
        // allow hash change, then close
        closeSidebar();
      })
    );

    // dropdown exports
    if (els.btnExports) els.btnExports.addEventListener("click", () => toggleExportsMenu());
    document.addEventListener("click", (e) => {
      const inside = e.target.closest(".fpDropdown");
      if (!inside) toggleExportsMenu(false);
    });

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
        if (els.kpiRange) els.kpiRange.textContent = `LAST ${state.rangeDays} DAYS`;
        if (els.seoHint) els.seoHint.textContent = `Last ${state.rangeDays} days`;
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

    // plans/manage buttons (all route to portal for now)
    els.planBtns.forEach((b) => b.addEventListener("click", openBillingPortal));
    if (els.btnSeePlans) els.btnSeePlans.addEventListener("click", openBillingPortal);
    if (els.btnManageAddons) els.btnManageAddons.addEventListener("click", openBillingPortal);

    // mission toggle (preview + page) via event delegation
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-mission-toggle]");
      if (t) {
        const id = t.getAttribute("data-mission-toggle");
        toggleMission(id);
        renderMissionPreview();
        if (location.hash === "#missions") renderMissionsPage();
      }

      const mon = e.target.closest("[data-mon-action]");
      if (mon) {
        const act = mon.getAttribute("data-mon-action");
        const id = mon.getAttribute("data-id");
        if (act === "test") safeTestMonitor(id);
        if (act === "del") safeDeleteMonitor(id);
      }
    });

    // router
    window.addEventListener("hashchange", () => navigate(location.hash));
  }

  // -------------------- INIT --------------------
  function init() {
    state.missions = loadMissions();

    // ensure hash is valid
    if (!ROUTES.some((r) => r.hash === location.hash)) {
      if (!location.hash) location.hash = "#overview";
    }

    // set select default
    if (els.rangeSelect) els.rangeSelect.value = String(state.rangeDays);

    renderMissionPreview();
    navigate(location.hash || "#overview");
    bind();
    loadData();
  }

  init();
})();
