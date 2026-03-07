(() => {
  "use strict";

  const API_BASE = "";
  const TOKEN_KEY = "token";
  const REFRESH_TOKEN_KEY = "refreshToken";
  const REFRESH_ENDPOINT = "/api/auth/refresh";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = {
    page: (document.body.dataset.page || "overview").toLowerCase(),
    me: null,
    overview: null,
    audits: [],
    monitors: [],
    missions: [],
    controller: null,
  };

  const els = {
    overlay: $("#fpOverlay"),
    sidebar: $("#fpSidebar"),
    sidebarClose: $("#fpSidebarClose"),
    menuBtn: $("#fpMenuBtn"),

    helloTitle: $("#helloTitle"),
    statusDot: $("#statusDot"),
    statusText: $("#statusText"),

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

  const MISSIONS_KEY = "fp_new_dashboard_missions_v1";

  const defaultMissions = [
    { id: "m1", title: "Créer ton premier monitor", meta: "Monitoring", done: false, action: "add_monitor" },
    { id: "m2", title: "Lancer un audit SEO", meta: "Audits", done: false, action: "run_audit" },
    { id: "m3", title: "Exporter un rapport audits", meta: "Reports", done: false, action: "export_audits" },
    { id: "m4", title: "Ouvrir le portail Stripe", meta: "Billing", done: false, action: "open_billing" },
  ];

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setStatus(text, mode = "ok") {
    if (els.statusText) els.statusText.textContent = text || "";
    if (!els.statusDot) return;
    els.statusDot.classList.remove("warn", "danger");
    if (mode === "warn") els.statusDot.classList.add("warn");
    if (mode === "danger") els.statusDot.classList.add("danger");
  }

  function setActiveNav() {
    els.navItems.forEach((item) => {
      const page = (item.getAttribute("data-page") || "").toLowerCase();
      item.classList.toggle("active", page === state.page);
    });
  }

  function openSidebar() {
    els.sidebar?.classList.add("open");
    els.overlay?.classList.add("show");
  }

  function closeSidebar() {
    els.sidebar?.classList.remove("open");
    els.overlay?.classList.remove("show");
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
        const newToken = getToken();
        if (newToken) headers.set("Authorization", `Bearer ${newToken}`);
        res = await doFetch();
      } catch (e) {
        clearAuth();
        window.location.replace("/login.html");
        throw e;
      }
    }

    return res;
  }

  function formatUsage(v) {
    if (v == null) return "—";
    if (typeof v === "number" || typeof v === "string") return String(v);
    if (typeof v === "object") {
      const used = v.used ?? null;
      const limit = v.limit ?? null;
      if (used != null && limit != null) return `${used}/${limit}`;
      if (used != null) return String(used);
    }
    return "—";
  }

  function fillBar(el, used, limit) {
    if (!el) return;
    const u = Number(used || 0);
    const l = Math.max(1, Number(limit || 0));
    el.style.width = `${Math.min(100, Math.round((u / l) * 100))}%`;
  }

  function hydrateAccount() {
    const me = state.me || {};
    const usage = me.usage || {};

    if (els.helloTitle) els.helloTitle.textContent = `Bonjour, ${me.name || "—"}`;
    if (els.accPlan) els.accPlan.textContent = me.plan || "—";
    if (els.accOrg) els.accOrg.textContent = me.org?.name || "—";
    if (els.accRole) els.accRole.textContent = me.role || "—";
    if (els.accTrial) {
      els.accTrial.textContent = me.trialEndsAt
        ? new Date(me.trialEndsAt).toLocaleDateString("fr-FR")
        : "—";
    }

    if (els.uAudits) els.uAudits.textContent = formatUsage(usage.audits);
    if (els.uPdf) els.uPdf.textContent = formatUsage(usage.pdf);
    if (els.uExports) els.uExports.textContent = formatUsage(usage.exports);
    if (els.uMonitors) els.uMonitors.textContent = formatUsage(usage.monitors);

    fillBar(els.barAudits, usage.audits?.used, usage.audits?.limit);
    fillBar(els.barPdf, usage.pdf?.used, usage.pdf?.limit);
    fillBar(els.barExports, usage.exports?.used, usage.exports?.limit);
  }

  function setHead(title, desc, actions = "") {
    if (els.pageTitle) els.pageTitle.textContent = title;
    if (els.pageDesc) els.pageDesc.textContent = desc;
    if (els.pageActions) els.pageActions.innerHTML = actions;
  }

  function setGrid(html) {
    if (els.grid) els.grid.innerHTML = html;
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
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;
    m.done = !m.done;
    saveMissions();
  }

  async function openBillingPortal() {
    setStatus("Ouverture Billing Portal…", "warn");
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
      setStatus("Erreur portail Stripe", "danger");
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

  async function safeAddMonitor() {
    const url = prompt("URL à monitor (ex: https://site.com) ?");
    if (!url) return false;

    setStatus("Création monitor…", "warn");
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

  async function safeTestMonitor(id) {
    if (!id) return false;

    setStatus("Test monitor…", "warn");
    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/run`, {
        method: "POST",
      });
      if (!r.ok) throw new Error("Monitor test failed");
      setStatus("Test monitor — OK", "ok");
      await loadData();
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Test monitor échoué", "danger");
      return false;
    }
  }

  async function safeDeleteMonitor(id) {
    if (!id) return false;
    if (!confirm("Supprimer ce monitor ?")) return false;

    setStatus("Suppression monitor…", "warn");
    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error("Monitor delete failed");
      setStatus("Monitor supprimé — OK", "ok");
      await loadData();
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Suppression monitor échouée", "danger");
      return false;
    }
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

      setStatus("Export téléchargé — OK", "ok");
      return true;
    } catch (e) {
      console.error(e);
      setStatus("Export échoué", "danger");
      return false;
    }
  }

  async function saveAlertSettings() {
    const input = $("#settingsRecipients");
    const value = (input?.value || "").trim();

    localStorage.setItem("fp_alert_emails", value);

    try {
      await fetchWithAuth("/api/org/settings", {
        method: "POST",
        body: JSON.stringify({
          alertRecipients: "all",
          alertExtraEmails: value
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      });
      setStatus("Settings sauvegardés", "ok");
    } catch (e) {
      console.error(e);
      setStatus("Sauvegarde partielle", "warn");
    }
  }

  async function doMission(id) {
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;

    let ok = false;

    if (m.action === "add_monitor") ok = await safeAddMonitor();
    if (m.action === "run_audit") ok = await safeRunAudit();
    if (m.action === "export_audits") ok = await safeExport("/api/exports/audits.csv", "audits.csv");
    if (m.action === "open_billing") ok = await openBillingPortal();

    if (ok) {
      m.done = true;
      saveMissions();
      renderPage();
    }
  }

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
        const r = await fetchWithAuth("/api/overview?days=30", { signal });
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
      renderPage();
      setStatus("Dashboard à jour", "ok");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setStatus("Erreur réseau / session", "danger");
    }
  }

  function renderOverview() {
    const ov = state.overview || {};
    const seoScore = ov.seoScore ?? 0;
    const activeMonitors = ov.monitors?.active ?? state.monitors.length;
    const downMonitors = ov.monitors?.down ?? 0;
    const monitorLimit = state.me?.usage?.monitors?.limit ?? 0;

    setHead(
      "Overview",
      "Vue générale de ton activité, de tes quotas et des actions prioritaires.",
      `
        <button class="fpBtn fpBtnPrimary" id="btnRunAudit" type="button">Run SEO audit</button>
        <button class="fpBtn fpBtnSoft" id="btnAddMonitor" type="button">Add monitor</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Performance</div>
        <div class="fpSmall">Indicateurs principaux sur les 30 derniers jours.</div>

        <div class="fpKpis">
          <div class="fpKpi">
            <div class="fpKpiLabel">SEO Score</div>
            <div class="fpKpiVal">${esc(seoScore)}<span class="fpKpiUnit">/100</span></div>
            <div class="fpKpiHint">Dernier score disponible</div>
          </div>

          <div class="fpKpi">
            <div class="fpKpiLabel">Monitors</div>
            <div class="fpKpiVal">${esc(activeMonitors)}<span class="fpKpiUnit">/ ${esc(monitorLimit)}</span></div>
            <div class="fpKpiHint">${esc(downMonitors)} DOWN actuellement</div>
          </div>

          <div class="fpKpi">
            <div class="fpKpiLabel">Plan</div>
            <div class="fpKpiVal">${esc(state.me?.plan || "—")}</div>
            <div class="fpKpiHint">${esc(state.me?.subscriptionStatus || "—")}</div>
          </div>
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Quick setup</div>
        <div class="fpSmall">Actions utiles pour démarrer proprement.</div>
        <div class="fpMissionGrid" id="missionList"></div>
      </div>
    `);

    $("#btnRunAudit")?.addEventListener("click", safeRunAudit);
    $("#btnAddMonitor")?.addEventListener("click", safeAddMonitor);

    renderMissionList();
  }

  function renderMissionList() {
    const host = $("#missionList");
    if (!host) return;

    host.innerHTML = state.missions.map((m) => `
      <div class="fpMission">
        <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>

        <div style="min-width:0;flex:1">
          <div class="fpMissionTitle">${esc(m.title)}</div>
          <div class="fpMissionMeta">${esc(m.meta)}</div>

          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="fpBtn fpBtnPrimary sm" type="button" data-mission-do="${esc(m.id)}">Faire</button>
            <a class="fpBtn fpBtnGhost sm" href="./missions.html">Voir</a>
          </div>
        </div>
      </div>
    `).join("");
  }

  function renderMissionsPage() {
    const done = state.missions.filter((m) => m.done).length;

    setHead(
      "Missions",
      `${done}/${state.missions.length} complétées. Utilise cette page comme checklist d’onboarding.`,
      `
        <button class="fpBtn fpBtnSoft" id="btnResetMissions" type="button">Reset</button>
        <button class="fpBtn fpBtnPrimary" id="btnSaveMissions" type="button">Save</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Checklist principale</div>
        <div class="fpSmall">Chaque mission peut être cochée ou exécutée directement.</div>
        <div class="fpMissionGrid" id="missionsFullList"></div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Progression</div>
        <div class="fpSmall">Utilise cette page pour organiser le setup du compte client.</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Missions terminées</div>
              <div class="fpRowMeta">${done} sur ${state.missions.length}</div>
            </div>
          </div>

          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Conseil</div>
              <div class="fpRowMeta">Commence par monitors, puis audit, puis exports et billing.</div>
            </div>
          </div>
        </div>
      </div>
    `);

    const host = $("#missionsFullList");
    if (host) {
      host.innerHTML = state.missions.map((m) => `
        <div class="fpMission">
          <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>

          <div style="min-width:0;flex:1">
            <div class="fpMissionTitle">${esc(m.title)}</div>
            <div class="fpMissionMeta">${esc(m.meta)}</div>

            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="fpBtn fpBtnPrimary sm" type="button" data-mission-do="${esc(m.id)}">Faire</button>
            </div>
          </div>
        </div>
      `).join("");
    }

    $("#btnResetMissions")?.addEventListener("click", () => {
      state.missions = JSON.parse(JSON.stringify(defaultMissions));
      saveMissions();
      renderMissionsPage();
      setStatus("Missions réinitialisées", "ok");
    });

    $("#btnSaveMissions")?.addEventListener("click", () => {
      saveMissions();
      setStatus("Missions sauvegardées", "ok");
    });
  }

  function renderAuditsPage() {
    setHead(
      "Audits",
      "Historique des audits SEO et accès rapide aux exports.",
      `
        <button class="fpBtn fpBtnPrimary" id="btnAuditRun" type="button">Run SEO audit</button>
        <button class="fpBtn fpBtnSoft" id="btnAuditExport" type="button">Export audits CSV</button>
      `
    );

    const list = Array.isArray(state.audits) ? state.audits : [];

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Historique</div>
        <div class="fpSmall">Derniers audits récupérés depuis l’API.</div>
        <div class="fpRows" id="auditList"></div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Actions</div>
        <div class="fpSmall">Lance un audit manuel ou exporte les données CSV.</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Route audit</div>
              <div class="fpRowMeta">POST /api/audits/run</div>
            </div>
          </div>

          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Route export</div>
              <div class="fpRowMeta">GET /api/exports/audits.csv</div>
            </div>
          </div>
        </div>
      </div>
    `);

    $("#btnAuditRun")?.addEventListener("click", safeRunAudit);
    $("#btnAuditExport")?.addEventListener("click", () => safeExport("/api/exports/audits.csv", "audits.csv"));

    const host = $("#auditList");
    if (!host) return;

    if (!list.length) {
      host.innerHTML = `<div class="fpEmpty">Aucun audit disponible pour le moment.</div>`;
      return;
    }

    host.innerHTML = list.slice(0, 15).map((a) => `
      <div class="fpRowCard">
        <div class="fpRowMain">
          <div class="fpRowTitle">${esc(a.url || "—")}</div>
          <div class="fpRowMeta">
            Score: ${esc(a.score ?? "—")} • ${esc(a.createdAt || "—")}
          </div>
        </div>
        <div class="fpRowRight">
          <span class="fpBadge">
            <span class="fpBadgeDot"></span>Audit
          </span>
        </div>
      </div>
    `).join("");
  }

  function renderMonitorsPage() {
    const list = Array.isArray(state.monitors) ? state.monitors : [];

    setHead(
      "Monitors",
      "Surveille tes URLs et teste leur disponibilité.",
      `
        <button class="fpBtn fpBtnPrimary" id="btnMonitorAdd" type="button">Add monitor</button>
        <button class="fpBtn fpBtnSoft" id="btnMonitorExport" type="button">Export monitors CSV</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Liste des monitors</div>
        <div class="fpSmall">État, fréquence et actions rapides.</div>
        <div class="fpRows" id="monitorList"></div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Guides</div>
        <div class="fpSmall">Utilise cette section pour contrôler l’uptime client.</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Tester un monitor</div>
              <div class="fpRowMeta">Déclenche immédiatement une vérification.</div>
            </div>
          </div>

          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Exporter</div>
              <div class="fpRowMeta">Télécharge l’état global en CSV.</div>
            </div>
          </div>
        </div>
      </div>
    `);

    $("#btnMonitorAdd")?.addEventListener("click", safeAddMonitor);
    $("#btnMonitorExport")?.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "monitors.csv"));

    const host = $("#monitorList");
    if (!host) return;

    if (!list.length) {
      host.innerHTML = `<div class="fpEmpty">Aucun monitor disponible pour le moment.</div>`;
      return;
    }

    host.innerHTML = list.slice(0, 20).map((m) => {
      const id = m._id || m.id || "";
      const status = String(m.lastStatus || "unknown").toLowerCase();
      const badgeClass = status === "up" ? "up" : status === "down" ? "down" : "";
      return `
        <div class="fpRowCard">
          <div class="fpRowMain">
            <div class="fpRowTitle">${esc(m.url || "—")}</div>
            <div class="fpRowMeta">
              Interval: ${esc(m.intervalMinutes ?? "—")} min • Last check: ${esc(m.lastCheckedAt || "—")}
            </div>
          </div>

          <div class="fpRowRight">
            <span class="fpBadge ${badgeClass}">
              <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
            </span>
            <button class="fpBtn fpBtnSoft sm" type="button" data-monitor-test="${esc(id)}">Test</button>
            <button class="fpBtn fpBtnDanger sm" type="button" data-monitor-del="${esc(id)}">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderReportsPage() {
    setHead(
      "Reports",
      "Exports et rapports disponibles pour ton organisation.",
      `
        <button class="fpBtn fpBtnPrimary" id="btnReportAudits" type="button">Export audits CSV</button>
        <button class="fpBtn fpBtnSoft" id="btnReportMonitors" type="button">Export monitors CSV</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Exports disponibles</div>
        <div class="fpSmall">Télécharge tes données pour reporting ou client delivery.</div>

        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Audits CSV</div>
              <div class="fpRowMeta">Historique et scores SEO exportables.</div>
            </div>
          </div>

          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Monitors CSV</div>
              <div class="fpRowMeta">État des URLs et fréquence des checks.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Usage</div>
        <div class="fpSmall">Les exports utilisent ton quota mensuel si applicable.</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Conseil</div>
              <div class="fpRowMeta">Garde cette page pour toutes les livraisons client et exports internes.</div>
            </div>
          </div>
        </div>
      </div>
    `);

    $("#btnReportAudits")?.addEventListener("click", () => safeExport("/api/exports/audits.csv", "audits.csv"));
    $("#btnReportMonitors")?.addEventListener("click", () => safeExport("/api/exports/monitors.csv", "monitors.csv"));
  }

  function renderBillingPage() {
    setHead(
      "Billing",
      "Gère ton abonnement et accède à Stripe.",
      `
        <button class="fpBtn fpBtnPrimary" id="btnBillingPortalMain" type="button">Open Billing Portal</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Abonnement</div>
        <div class="fpSmall">Informations générales du plan actif.</div>

        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Plan actuel</div>
              <div class="fpRowMeta">${esc(state.me?.plan || "—")}</div>
            </div>
          </div>

          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Statut</div>
              <div class="fpRowMeta">${esc(state.me?.subscriptionStatus || "—")}</div>
            </div>
          </div>

          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Fin trial / échéance</div>
              <div class="fpRowMeta">${esc(state.me?.trialEndsAt || "—")}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Gestion</div>
        <div class="fpSmall">Toutes les modifications passent par Stripe Billing Portal.</div>
        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Upgrade / downgrade</div>
              <div class="fpRowMeta">Gère ton abonnement sans toucher au code.</div>
            </div>
          </div>
        </div>
      </div>
    `);

    $("#btnBillingPortalMain")?.addEventListener("click", openBillingPortal);
  }

  function renderSettingsPage() {
    const saved = localStorage.getItem("fp_alert_emails") || "";

    setHead(
      "Settings",
      "Paramètres de base de l’organisation et alert emails.",
      `
        <button class="fpBtn fpBtnPrimary" id="btnSaveSettings" type="button">Save settings</button>
      `
    );

    setGrid(`
      <div class="fpCard">
        <div class="fpCardTitle">Alert emails</div>
        <div class="fpSmall">Ajoute ici les emails qui doivent recevoir les alertes.</div>

        <div class="fpField">
          <label class="fpLabel" for="settingsRecipients">Recipients</label>
          <input class="fpInput" id="settingsRecipients" type="text" placeholder="support@flowpoint.pro, alert@flowpoint.pro" value="${esc(saved)}" />
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardTitle">Organisation</div>
        <div class="fpSmall">Récapitulatif actuel.</div>

        <div class="fpRows">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Nom</div>
              <div class="fpRowMeta">${esc(state.me?.org?.name || "—")}</div>
            </div>
          </div>

          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Plan</div>
              <div class="fpRowMeta">${esc(state.me?.plan || "—")}</div>
            </div>
          </div>

          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Role</div>
              <div class="fpRowMeta">${esc(state.me?.role || "—")}</div>
            </div>
          </div>
        </div>
      </div>
    `);

    $("#btnSaveSettings")?.addEventListener("click", saveAlertSettings);
  }

  function renderPage() {
    setActiveNav();

    if (state.page === "overview") return renderOverview();
    if (state.page === "missions") return renderMissionsPage();
    if (state.page === "audits") return renderAuditsPage();
    if (state.page === "monitors") return renderMonitorsPage();
    if (state.page === "reports") return renderReportsPage();
    if (state.page === "billing") return renderBillingPage();
    if (state.page === "settings") return renderSettingsPage();

    return renderOverview();
  }

  function bind() {
    els.menuBtn?.addEventListener("click", openSidebar);
    els.sidebarClose?.addEventListener("click", closeSidebar);
    els.overlay?.addEventListener("click", closeSidebar);

    els.navItems.forEach((item) => {
      item.addEventListener("click", () => closeSidebar());
    });

    els.btnPortal?.addEventListener("click", openBillingPortal);
    els.btnLogout?.addEventListener("click", () => {
      clearAuth();
      window.location.replace("/login.html");
    });

    document.addEventListener("click", async (e) => {
      const toggle = e.target.closest("[data-mission-toggle]");
      if (toggle) {
        toggleMission(toggle.getAttribute("data-mission-toggle"));
        renderPage();
        return;
      }

      const action = e.target.closest("[data-mission-do]");
      if (action) {
        await doMission(action.getAttribute("data-mission-do"));
        return;
      }

      const monitorTest = e.target.closest("[data-monitor-test]");
      if (monitorTest) {
        await safeTestMonitor(monitorTest.getAttribute("data-monitor-test"));
        return;
      }

      const monitorDel = e.target.closest("[data-monitor-del]");
      if (monitorDel) {
        await safeDeleteMonitor(monitorDel.getAttribute("data-monitor-del"));
      }
    });
  }

  function init() {
    state.missions = loadMissions();
    saveMissions();
    bind();
    loadData();
  }

  init();
})();
