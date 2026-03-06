/* =========================================================
   FLOWPOINT — APP.JS (SAFE PUBLIC + PRIVATE PAGES)
   - Public pages do NOT redirect
   - Private dashboard pages require token
   - Uses your real backend routes
   ========================================================= */

(() => {
  "use strict";

  // --------- CONFIG ---------
  const API_BASE = "";
  const TOKEN_KEY = "token";
  const REFRESH_TOKEN_KEY = "refreshToken";
  const REFRESH_ENDPOINT = "/api/auth/refresh";

  const PUBLIC_PAGES = new Set([
    "public",
    "index",
    "login",
    "pricing",
    "checkout",
    "success",
    "cancel"
  ]);

  // --------- DOM ---------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const pageType = (document.body?.dataset?.page || "public").toLowerCase();
  const isPublicPage = PUBLIC_PAGES.has(pageType);

  const els = {
    overlay: $("#overlay"),
    sidebar: $("#sidebar"),
    btnMenu: $("#btnMenu"),

    statusDot: $("#statusDot"),
    statusText: $("#statusText"),
    helloTitle: $("#helloTitle"),

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

    pageTitle: $("#pageTitle"),
    pageDesc: $("#pageDesc"),
    pageActions: $("#pageActions"),
    grid: $("#grid"),

    btnPortal: $("#btnPortal"),
    btnLogout: $("#btnLogout"),

    navItems: $$(".fpNavItem"),
  };

  // --------- STATE ---------
  const state = {
    page: pageType,
    controller: null,
    me: null,
    overview: null,
    audits: [],
    monitors: [],
    missions: [],
  };

  // --------- UTIL ---------
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

  function pctBar(fillEl, used, limit) {
    if (!fillEl) return;
    const u = Number(used || 0);
    const l = Math.max(1, Number(limit || 0) || 1);
    fillEl.style.width = `${Math.min(100, Math.round((u / l) * 100))}%`;
  }

  function formatUsage(v) {
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

  // --------- AUTH ---------
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

  function requirePrivateToken() {
    if (isPublicPage) return true;

    try {
      const tok = getToken();
      if (!tok || tok.trim().length < 10) {
        window.location.replace("/login.html");
        return false;
      }
      return true;
    } catch {
      window.location.replace("/login.html");
      return false;
    }
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
        const tok2 = getToken();
        if (tok2) headers.set("Authorization", `Bearer ${tok2}`);
        res = await doFetch();
      } catch (e) {
        clearAuth();
        if (!isPublicPage) window.location.replace("/login.html");
        throw e;
      }
    }

    if (res.status === 429) {
      await sleep(600);
      res = await doFetch();
    }

    return res;
  }

  // --------- SIDEBAR ---------
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

  // --------- ACTIVE NAV ---------
  function setActiveNav() {
    els.navItems.forEach((a) => {
      const p = (a.getAttribute("data-page") || "").toLowerCase();
      a.classList.toggle("active", p === state.page);
    });
  }

  // --------- MISSIONS ---------
  const MISSIONS_KEY = "fp_missions_v3_reset";

  const defaultMissions = [
    { id: "m1", title: "Créer ton 1er monitor", meta: "Monitoring", done: false, action: "add_monitor" },
    { id: "m2", title: "Lancer un SEO audit", meta: "Audits", done: false, action: "run_audit" },
    { id: "m3", title: "Ouvrir Billing Portal", meta: "Billing", done: false, action: "open_billing" },
    { id: "m4", title: "Exporter audits CSV", meta: "Exports", done: false, action: "export_audits" },
    { id: "m5", title: "Exporter monitors CSV", meta: "Exports", done: false, action: "export_monitors" },
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

  // --------- ACTIONS ---------
  async function openBillingPortal() {
    setStatus("Ouverture Billing Portal…", "warn");
    try {
      const r = await fetchWithAuth("/api/stripe/portal", { method: "POST" });
      if (!r.ok) throw new Error("portal failed");
      const data = await r.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url;
        return true;
      }
      setStatus("Portal URL manquante", "danger");
      return false;
    } catch (e) {
      console.error(e);
      setStatus("Erreur Billing Portal", "danger");
      return false;
    }
  }

  async function safeExport(endpoint, filename) {
    setStatus("Préparation export…", "warn");
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
      setStatus("Export téléchargé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Export échoué", "danger");
      return false;
    }
  }

  async function safeRunAudit() {
    const url = prompt("URL à auditer (ex: https://site.com) ?");
    if (!url) return false;

    setStatus("Lancement audit…", "warn");
    try {
      const r = await fetchWithAuth("/api/audits/run", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      setStatus(r.ok ? "Audit lancé — OK" : "Audit échoué", r.ok ? "ok" : "danger");
      if (r.ok) await loadData();
      return !!r.ok;
    } catch (e) {
      console.error(e);
      setStatus("Audit échoué", "danger");
      return false;
    }
  }

  async function safeAddMonitor() {
    const url = prompt("URL à monitor (ex: https://site.com) ?");
    if (!url) return false;

    setStatus("Création monitor…", "warn");
    try {
      const r = await fetchWithAuth("/api/monitors", {
        method: "POST",
        body: JSON.stringify({ url, intervalMinutes: 60 }),
      });
      if (!r.ok) throw new Error("create monitor failed");
      setStatus("Monitor créé — OK", "ok");
      await loadData();
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
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/run`, { method: "POST" });
      setStatus(r.ok ? "Test OK — UP" : "Test échoué", r.ok ? "ok" : "danger");
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
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}`, { method: "DELETE" });
      setStatus(r.ok ? "Supprimé — OK" : "Suppression échouée", r.ok ? "ok" : "danger");
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

  // --------- LOAD DATA ---------
  async function loadData() {
    if (isPublicPage) return;

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
        const r = await fetchWithAuth("/api/overview?days=30", { signal });
        if (r.ok) state.overview = await r.json();
      } catch {}

      try {
        const r = await fetchWithAuth("/api/monitors", { signal });
        if (r.ok) {
          const data = await r.json().catch(() => ({}));
          state.monitors = Array.isArray(data?.monitors) ? data.monitors : [];
        }
      } catch {}

      try {
        const r = await fetchWithAuth("/api/audits", { signal });
        if (r.ok) {
          const data = await r.json().catch(() => ({}));
          state.audits = Array.isArray(data?.audits) ? data.audits : [];
        }
      } catch {}

      hydrateAccount();
      renderPage();
      setStatus("Statut : connecté", "ok");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setStatus("Erreur réseau / session", "danger");
    }
  }

  function hydrateAccount() {
    const me = state.me || {};
    const name = me.name || "—";

    if (els.helloTitle) els.helloTitle.textContent = `Bonjour, ${name}`;

    if (els.accPlan) els.accPlan.textContent = me.plan || "—";
    if (els.accOrg) els.accOrg.textContent = me.org?.name || "—";
    if (els.accRole) els.accRole.textContent = me.role || "—";

    let trialText = "—";
    if (me.hasTrial && me.trialEndsAt) {
      trialText = new Date(me.trialEndsAt).toLocaleDateString("fr-FR");
    }
    if (els.accTrial) els.accTrial.textContent = trialText;

    const usage = me.usage || {};
    if (els.uAudits) els.uAudits.textContent = formatUsage(usage.audits);
    if (els.uPdf) els.uPdf.textContent = formatUsage(usage.pdf);
    if (els.uExports) els.uExports.textContent = formatUsage(usage.exports);
    if (els.uMonitors) els.uMonitors.textContent = formatUsage(usage.monitors);

    pctBar(els.barAudits, usage.audits?.used, usage.audits?.limit);
    pctBar(els.barPdf, usage.pdf?.used, usage.pdf?.limit);
    pctBar(els.barExports, usage.exports?.used, usage.exports?.limit);
  }

  // --------- PAGE RENDERERS ---------
  function setHead(title, desc, actionsHTML) {
    if (els.pageTitle) els.pageTitle.textContent = title || "";
    if (els.pageDesc) els.pageDesc.textContent = desc || "";
    if (els.pageActions) els.pageActions.innerHTML = actionsHTML || "";
  }

  function setGrid(html) {
    if (els.grid) els.grid.innerHTML = html || "";
  }

  function renderPage() {
    if (isPublicPage) return;
    setActiveNav();

    if (state.page === "overview") return renderOverview();
    if (state.page === "missions") return renderMissions();
    if (state.page === "audits") return renderAudits();
    if (state.page === "monitors") return renderMonitors();
    if (state.page === "reports") return renderReports();
    if (state.page === "billing") return renderBilling();
    if (state.page === "settings") return renderSettings();

    state.page = "overview";
    return renderOverview();
  }

  function renderOverview() {
    setHead(
      "Overview",
      "Vue globale : KPI, actions rapides, état abonnement.",
      `
        <button class="fpBtn primary" id="btnRunAudit" type="button">Run SEO audit</button>
        <button class="fpBtn" id="btnAddMonitor" type="button">Add monitor</button>
        <a class="fpBtn ghost" href="/pricing.html">Voir Pricing</a>
      `
    );

    const ov = state.overview || {};
    const seoScore = ov.seoScore ?? 0;
    const monActive = ov.monitors?.active ?? state.monitors.length;
    const monLimit = state.me?.usage?.monitors?.limit ?? 0;
    const incidentsDown = ov.monitors?.down ?? 0;
    const subStatus = state.me?.subscriptionStatus || "—";
    const subPlan = state.me?.plan || "—";

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">KPI (30 jours)</div>
        <div class="fpSmall">Données récupérées via API.</div>

        <div class="fpKpis">
          <div class="fpKpi">
            <div class="fpKpiLabel">SEO Score</div>
            <div class="fpKpiVal">${esc(seoScore)}<span class="fpKpiUnit">/100</span></div>
            <div class="fpKpiHint">Dernière période</div>
          </div>

          <div class="fpKpi">
            <div class="fpKpiLabel">Monitors actifs</div>
            <div class="fpKpiVal">${esc(monActive)}<span class="fpKpiUnit">/ ${esc(monLimit)}</span></div>
            <div class="fpKpiHint">${esc(incidentsDown)} incident(s) DOWN</div>
          </div>

          <div class="fpKpi">
            <div class="fpKpiLabel">Subscription</div>
            <div class="fpKpiVal">${esc(subStatus)}</div>
            <div class="fpKpiHint">${esc(subPlan)}</div>
          </div>
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Quick setup</div>
        <div class="fpSmall">Missions importantes à compléter.</div>
        <div class="fpMissionGrid" id="ovMissions"></div>
      </div>
    `);

    $("#btnRunAudit")?.addEventListener("click", safeRunAudit);
    $("#btnAddMonitor")?.addEventListener("click", safeAddMonitor);

    renderMissionList("#ovMissions", 4);
  }

  function renderMissionList(selector, limit = 6) {
    const host = $(selector);
    if (!host) return;

    const list = state.missions.slice(0, limit);
    host.innerHTML = list.map((m) => {
      const doneClass = m.done ? "done" : "";
      return `
        <div class="fpMission">
          <div class="fpCheck ${doneClass}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
          <div style="min-width:0;flex:1">
            <div class="fpMissionTitle">${esc(m.title)}</div>
            <div class="fpMissionMeta">${esc(m.meta || "")}</div>
            <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
              <button class="fpBtn sm primary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
              <a class="fpBtn sm ghost" href="missions.html">Voir</a>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  async function doMission(id) {
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;

    if (m.action === "run_audit") {
      const ok = await safeRunAudit();
      if (ok) m.done = true;
    }
    if (m.action === "add_monitor") {
      const ok = await safeAddMonitor();
      if (ok) m.done = true;
    }
    if (m.action === "open_billing") {
      const ok = await openBillingPortal();
      if (ok) m.done = true;
    }
    if (m.action === "export_audits") {
      const ok = await safeExport("/api/exports/audits.csv", "audits.csv");
      if (ok) m.done = true;
    }
    if (m.action === "export_monitors") {
      const ok = await safeExport("/api/exports/monitors.csv", "monitors.csv");
      if (ok) m.done = true;
    }

    saveMissions();
    renderPage();
  }

  function renderMissions() {
    const done = state.missions.filter((m) => m.done).length;

    setHead(
      "Missions",
      `Checklist setup (✔) — ${done}/${state.missions.length} complétées.`,
      `
        <button class="fpBtn" id="btnResetM" type="button">Reset</button>
        <button class="fpBtn primary" id="btnSaveM" type="button">Save</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Checklist</div>
        <div class="fpSmall">Clique sur la case pour fait/pas fait. “Faire” exécute l’action.</div>
        <div class="fpMissionGrid" id="missionsList"></div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Notes</div>
        <div class="fpSmall">Tout reste stable même si certaines routes API ne sont pas encore prêtes.</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Conseil UI</div>
              <div class="fpRowMeta">Police et poids réduits pour éviter l’effet trop gras.</div>
            </div>
          </div>
        </div>
      </div>
    `);

    $("#btnResetM")?.addEventListener("click", () => {
      state.missions = JSON.parse(JSON.stringify(defaultMissions));
      saveMissions();
      renderPage();
      setStatus("Missions reset — OK", "ok");
    });

    $("#btnSaveM")?.addEventListener("click", () => {
      saveMissions();
      setStatus("Missions sauvegardées — OK", "ok");
    });

    const host = $("#missionsList");
    if (!host) return;

    host.innerHTML = state.missions.map((m) => {
      const doneClass = m.done ? "done" : "";
      return `
        <div class="fpMission">
          <div class="fpCheck ${doneClass}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
          <div style="min-width:0;flex:1">
            <div class="fpMissionTitle">${esc(m.title)}</div>
            <div class="fpMissionMeta">${esc(m.meta || "")}</div>
            <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
              <button class="fpBtn sm primary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderAudits() {
    setHead(
      "Audits",
      "Lancer audit SEO, voir l’historique et exporter.",
      `
        <button class="fpBtn primary" id="btnAuRun" type="button">Run SEO audit</button>
        <button class="fpBtn" id="btnAuCsv" type="button">Export CSV</button>
        <button class="fpBtn ghost" id="btnReload" type="button">Refresh</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Historique</div>
        <div class="fpSmall">GET /api/audits</div>
        <div class="fpRows" id="auditRows"></div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Endpoints</div>
        <div class="fpSmall">POST /api/audits/run • GET /api/exports/audits.csv</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Astuce</div>
              <div class="fpRowMeta">Le prompt te demande l’URL avant le lancement.</div>
            </div>
          </div>
        </div>
      </div>
    `);

    $("#btnAuRun")?.addEventListener("click", safeRunAudit);
    $("#btnAuCsv")?.addEventListener("click", () => safeExport("/api/exports/audits.csv", "audits.csv"));
    $("#btnReload")?.addEventListener("click", loadData);

    const host = $("#auditRows");
    if (!host) return;

    if (!state.audits.length) {
      host.innerHTML = `<div class="fpEmpty">Aucun audit pour le moment.</div>`;
      return;
    }

    host.innerHTML = state.audits.slice(0, 12).map((a) => {
      const url = a.url || "—";
      const score = a.score ?? "—";
      const date = a.createdAt || "—";
      return `
        <div class="fpRowCard">
          <div class="fpRowMain">
            <div class="fpRowTitle">${esc(url)}</div>
            <div class="fpRowMeta">Score: ${esc(score)} • ${esc(date)}</div>
          </div>
          <div class="fpRowRight">
            <span class="fpBadge"><span class="fpBadgeDot"></span>Audit</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderMonitors() {
    setHead(
      "Monitors",
      "Ajouter des URLs, tester, supprimer, exporter.",
      `
        <button class="fpBtn primary" id="btnMoAdd" type="button">Add monitor</button>
        <button class="fpBtn" id="btnMoCsv" type="button">Export CSV</button>
        <button class="fpBtn ghost" id="btnReload" type="button">Refresh</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Liste</div>
        <div class="fpSmall">GET /api/monitors • POST /api/monitors/:id/run • DELETE /api/monitors/:id</div>
        <div class="fpRows" id="monRows"></div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Infos</div>
        <div class="fpSmall">Export: GET /api/exports/monitors.csv</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Conseil</div>
              <div class="fpRowMeta">Le statut réel affiché vient de lastStatus.</div>
            </div>
          </div>
        </div>
      </div>
    `);

    $("#btnMoAdd")?.addEventListener("click", safeAddMonitor);
    $("#btnMoCsv")?.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "monitors.csv"));
    $("#btnReload")?.addEventListener("click", loadData);

    const host = $("#monRows");
    if (!host) return;

    const arr = Array.isArray(state.monitors) ? state.monitors : [];
    if (!arr.length) {
      host.innerHTML = `<div class="fpEmpty">Aucun monitor pour le moment.</div>`;
      return;
    }

    host.innerHTML = arr.slice(0, 20).map((m) => {
      const url = m.url || "—";
      const status = String(m.lastStatus || "unknown").toLowerCase();
      const interval = m.intervalMinutes || "—";
      const last = m.lastCheckedAt || "—";
      const badgeClass = status === "up" ? "up" : status === "down" ? "down" : "";

      return `
        <div class="fpRowCard">
          <div class="fpRowMain">
            <div class="fpRowTitle">${esc(url)}</div>
            <div class="fpRowMeta">Interval: ${esc(interval)} min • Last: ${esc(last)}</div>
          </div>
          <div class="fpRowRight">
            <span class="fpBadge ${badgeClass}">
              <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
            </span>
            <button class="fpBtn sm" type="button" data-mon-action="test" data-id="${esc(m._id || m.id)}">Test</button>
            <button class="fpBtn sm danger" type="button" data-mon-action="del" data-id="${esc(m._id || m.id)}">Del</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderReports() {
    setHead(
      "Reports",
      "Exports PDF/CSV + rapport mensuel.",
      `
        <button class="fpBtn primary" id="btnPdf" type="button">Export PDF</button>
        <button class="fpBtn" id="btnCsv" type="button">Export CSV</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Exports</div>
        <div class="fpSmall">Le backend actuel expose surtout les exports audits/monitors.</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Audits CSV</div>
              <div class="fpRowMeta">Téléchargement direct depuis l’API.</div>
            </div>
          </div>
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Monitors CSV</div>
              <div class="fpRowMeta">Téléchargement direct depuis l’API.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Mensuel</div>
        <div class="fpSmall">Tu pourras brancher un vrai rapport plus tard.</div>
        <div class="fpEmpty">Aucun module mensuel dédié pour le moment.</div>
      </div>
    `);

    $("#btnPdf")?.addEventListener("click", () => safeExport("/api/exports/audits.csv", "audits.csv"));
    $("#btnCsv")?.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "monitors.csv"));
  }

  function renderBilling() {
    setHead(
      "Billing",
      "Accès Stripe Billing Portal + statut abonnement.",
      `
        <button class="fpBtn primary" id="btnPortal2" type="button">Open Billing Portal</button>
        <a class="fpBtn ghost" href="/pricing.html">Pricing</a>
      `
    );

    const plan = state.me?.plan || "—";
    const status = state.me?.subscriptionStatus || "—";
    const renew = state.me?.trialEndsAt || "—";

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Abonnement</div>
        <div class="fpSmall">Données depuis /api/me.</div>
        <div class="fpRows">
          <div class="fpRowCard"><div class="fpRowMain"><div class="fpRowTitle">Plan</div><div class="fpRowMeta">${esc(plan)}</div></div></div>
          <div class="fpRowCard"><div class="fpRowMain"><div class="fpRowTitle">Status</div><div class="fpRowMeta">${esc(status)}</div></div></div>
          <div class="fpRowCard"><div class="fpRowMain"><div class="fpRowTitle">Trial / échéance</div><div class="fpRowMeta">${esc(renew)}</div></div></div>
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Actions</div>
        <div class="fpSmall">Tout passe par Stripe Portal.</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Gérer plan / add-ons</div>
              <div class="fpRowMeta">Ouverture sécurisée du portail Stripe.</div>
            </div>
          </div>
        </div>
      </div>
    `);

    $("#btnPortal2")?.addEventListener("click", openBillingPortal);
  }

  function renderSettings() {
    setHead(
      "Settings",
      "Alert emails et organisation.",
      `
        <button class="fpBtn primary" id="btnSave" type="button">Save</button>
      `
    );

    const saved = localStorage.getItem("fp_alert_recipients") || "";

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Alert emails</div>
        <div class="fpSmall">Sauvegarde locale + POST API si dispo.</div>
        <div class="fpField">
          <label class="fpLabel">Emails</label>
          <input class="fpInput" id="setRecipients" placeholder="name@domain.com, other@domain.com" />
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Organisation</div>
        <div class="fpSmall">Infos depuis /api/me.</div>
        <div class="fpRows">
          <div class="fpRowCard"><div class="fpRowMain"><div class="fpRowTitle">Org</div><div class="fpRowMeta">${esc(state.me?.org?.name || "—")}</div></div></div>
          <div class="fpRowCard"><div class="fpRowMain"><div class="fpRowTitle">Plan</div><div class="fpRowMeta">${esc(state.me?.plan || "—")}</div></div></div>
          <div class="fpRowCard"><div class="fpRowMain"><div class="fpRowTitle">Role</div><div class="fpRowMeta">${esc(state.me?.role || "—")}</div></div></div>
        </div>
      </div>
    `);

    const input = $("#setRecipients");
    if (input) input.value = saved;

    $("#btnSave")?.addEventListener("click", async () => {
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

  // --------- EVENTS ---------
  function bind() {
    els.btnMenu?.addEventListener("click", openSidebar);
    els.overlay?.addEventListener("click", closeSidebar);
    els.navItems.forEach((a) => a.addEventListener("click", () => closeSidebar()));

    els.btnPortal?.addEventListener("click", openBillingPortal);
    els.btnLogout?.addEventListener("click", logout);

    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-mission-toggle]");
      if (t) {
        toggleMission(t.getAttribute("data-mission-toggle"));
        renderPage();
        return;
      }

      const d = e.target.closest("[data-mission-do]");
      if (d) {
        doMission(d.getAttribute("data-mission-do"));
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
  }

  // --------- INIT ---------
  function init() {
    if (!isPublicPage && !requirePrivateToken()) return;

    state.missions = loadMissions();
    saveMissions();

    setActiveNav();
    bind();

    if (!isPublicPage) {
      loadData();
    }
  }

  init();
})();
