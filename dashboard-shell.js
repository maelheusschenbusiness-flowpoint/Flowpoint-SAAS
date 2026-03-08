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
    orgSettings: null,
    controller: null,
    missions: [],
    rangeDays: 30,
  };

  const els = {
    overlay: $("#fpOverlay"),
    sidebar: $("#fpSidebar"),
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
    gridMain: $("#gridMain"),
    gridSide: $("#gridSide"),

    btnPortal: $("#btnPortal"),
    btnLogout: $("#btnLogout"),
    rangeSelect: $("#rangeSelect"),

    navItems: $$(".fpNavItem"),
  };

  const MISSIONS_KEY = "fp_dashboard_reset_missions_v4";

  const defaultMissions = [
    { id: "m1", title: "Créer ton premier monitor", meta: "Monitoring", done: false, action: "add_monitor" },
    { id: "m2", title: "Lancer un audit SEO", meta: "Audits", done: false, action: "run_audit" },
    { id: "m3", title: "Exporter les audits CSV", meta: "Reports", done: false, action: "export_audits" },
    { id: "m4", title: "Ouvrir le portail billing", meta: "Billing", done: false, action: "open_billing" }
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

  function openSidebar() {
    els.sidebar?.classList.add("open");
    els.overlay?.classList.add("show");
  }

  function closeSidebar() {
    els.sidebar?.classList.remove("open");
    els.overlay?.classList.remove("show");
  }

  function setActiveNav() {
    els.navItems.forEach((item) => {
      const p = (item.getAttribute("data-page") || "").toLowerCase();
      item.classList.toggle("active", p === state.page);
    });
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
      body: JSON.stringify({ refreshToken })
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
        signal: options.signal
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

  function hydrateAccount() {
    const me = state.me || {};
    const usage = me.usage || {};

    if (els.helloTitle) {
      els.helloTitle.textContent = `Bonjour, ${me.name || "—"}`;
    }

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

  async function openBillingPortal() {
    setStatus("Ouverture du portail billing…", "warn");
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
        body: JSON.stringify({ url })
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
        body: JSON.stringify({ url, intervalMinutes: 60 })
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

  async function safeRunMonitor(id) {
    if (!id) return;
    setStatus("Test du monitor…", "warn");
    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/run`, {
        method: "POST"
      });
      if (!r.ok) throw new Error("Run monitor failed");
      setStatus("Monitor testé — OK", "ok");
      await loadData();
    } catch (e) {
      console.error(e);
      setStatus("Test monitor échoué", "danger");
    }
  }

  async function safeDeleteMonitor(id) {
    if (!id) return;
    if (!confirm("Supprimer ce monitor ?")) return;

    setStatus("Suppression monitor…", "warn");
    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      if (!r.ok) throw new Error("Delete failed");
      setStatus("Monitor supprimé — OK", "ok");
      await loadData();
    } catch (e) {
      console.error(e);
      setStatus("Suppression échouée", "danger");
    }
  }

  async function doMission(id) {
    const mission = state.missions.find((m) => m.id === id);
    if (!mission) return;

    let ok = false;
    if (mission.action === "add_monitor") ok = await safeAddMonitor();
    if (mission.action === "run_audit") ok = await safeRunAudit();
    if (mission.action === "export_audits") ok = await safeExport("/api/exports/audits.csv", "audits.csv");
    if (mission.action === "open_billing") ok = await openBillingPortal();

    if (ok) {
      mission.done = true;
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
        const r = await fetchWithAuth(`/api/overview?days=${state.rangeDays}`, { signal });
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

      try {
        const r = await fetchWithAuth("/api/org/settings", { signal });
        if (r.ok) {
          const data = await r.json().catch(() => ({}));
          state.orgSettings = data?.settings || null;
        }
      } catch {}

      hydrateAccount();
      renderPage();
      setStatus("Dashboard à jour — OK", "ok");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setStatus("Erreur réseau / session", "danger");
    }
  }

  function renderCard(title, text, body) {
    return `
      <section class="fpCard">
        <div class="fpCardHeader">
          <div>
            <div class="fpCardTitle">${esc(title)}</div>
            ${text ? `<div class="fpCardText">${esc(text)}</div>` : ""}
          </div>
        </div>
        ${body || ""}
      </section>
    `;
  }

  function renderOverviewPage() {
    const ov = state.overview || {};
    const seoScore = ov.seoScore ?? 0;
    const monitorsActive = ov.monitors?.active ?? state.monitors.length;
    const monitorsDown = ov.monitors?.down ?? 0;
    const chart = Array.isArray(ov.chart) ? ov.chart : [];
    const usageMonitorsLimit = state.me?.usage?.monitors?.limit ?? 0;
    const lastAudit = ov.lastAuditAt ? new Date(ov.lastAuditAt).toLocaleString("fr-FR") : "—";

    if (els.pageTitle) els.pageTitle.textContent = "Overview";
    if (els.pageDesc) els.pageDesc.textContent = "Vue générale de ton compte et de tes performances.";
    if (els.pageActions) {
      els.pageActions.innerHTML = `
        <button class="fpBtn fpBtnPrimary" id="btnRunAuditHero" type="button">Run SEO audit</button>
        <button class="fpBtn fpBtnSoft" id="btnAddMonitorHero" type="button">Add monitor</button>
        <a class="fpBtn fpBtnGhost" href="./billing.html">Billing</a>
      `;
    }

    if (els.gridMain) {
      els.gridMain.innerHTML = `
        ${renderCard(
          "Performance snapshot",
          "Les indicateurs clés sur la période sélectionnée.",
          `
            <div class="fpKpiGrid">
              <div class="fpKpi">
                <div class="fpKpiLabel">SEO score</div>
                <div class="fpKpiVal">${esc(seoScore)}</div>
                <div class="fpKpiSub">Dernier audit</div>
              </div>

              <div class="fpKpi">
                <div class="fpKpiLabel">Monitors actifs</div>
                <div class="fpKpiVal">${esc(monitorsActive)} / ${esc(usageMonitorsLimit)}</div>
                <div class="fpKpiSub">${esc(monitorsDown)} DOWN actuellement</div>
              </div>

              <div class="fpKpi">
                <div class="fpKpiLabel">Dernier audit</div>
                <div class="fpKpiVal" style="font-size:22px">${esc(lastAudit)}</div>
                <div class="fpKpiSub">${esc(ov.lastAuditUrl || "Aucune URL")}</div>
              </div>
            </div>
          `
        )}

        ${renderCard(
          "SEO trend",
          "Évolution simplifiée du score sur la période.",
          `
            <div class="fpChartArea">
              <canvas id="overviewChart" width="1200" height="500"></canvas>
            </div>
          `
        )}

        ${renderCard(
          "Quick setup",
          "Actions prioritaires pour mettre ton workspace proprement en route.",
          `
            <div class="fpRows" id="missionList"></div>
          `
        )}
      `;
    }

    if (els.gridSide) {
      els.gridSide.innerHTML = `
        ${renderCard(
          "Recent audits",
          "Les derniers audits lancés depuis ton compte.",
          `
            <div class="fpRows" id="recentAudits"></div>
          `
        )}

        ${renderCard(
          "Live monitors",
          "Vue rapide sur l’état courant de tes monitors.",
          `
            <div class="fpRows" id="recentMonitors"></div>
          `
        )}
      `;
    }

    $("#btnRunAuditHero")?.addEventListener("click", safeRunAudit);
    $("#btnAddMonitorHero")?.addEventListener("click", safeAddMonitor);

    renderMissionsList("#missionList");
    renderRecentAudits("#recentAudits");
    renderRecentMonitors("#recentMonitors");
    renderChart(chart);
  }

  function renderMissionsList(selector) {
    const host = $(selector);
    if (!host) return;

    host.innerHTML = state.missions.map((m) => `
      <div class="fpMission">
        <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>
        <div class="fpMissionBody">
          <div class="fpMissionTitle">${esc(m.title)}</div>
          <div class="fpMissionMeta">${esc(m.meta)}</div>
          <div class="fpMissionActions">
            <button class="fpBtn fpBtnPrimary" type="button" data-mission-do="${esc(m.id)}">Faire</button>
          </div>
        </div>
      </div>
    `).join("");
  }

  function renderRecentAudits(selector) {
    const host = $(selector);
    if (!host) return;

    if (!state.audits.length) {
      host.innerHTML = `<div class="fpEmpty">Aucun audit disponible pour le moment.</div>`;
      return;
    }

    host.innerHTML = state.audits.slice(0, 5).map((a) => `
      <div class="fpRowCard">
        <div class="fpRowMain">
          <div class="fpRowTitle">${esc(a.url || "—")}</div>
          <div class="fpRowMeta">Score: ${esc(a.score ?? "—")} · ${esc(a.createdAt ? new Date(a.createdAt).toLocaleString("fr-FR") : "—")}</div>
        </div>
      </div>
    `).join("");
  }

  function renderRecentMonitors(selector) {
    const host = $(selector);
    if (!host) return;

    if (!state.monitors.length) {
      host.innerHTML = `<div class="fpEmpty">Aucun monitor disponible pour le moment.</div>`;
      return;
    }

    host.innerHTML = state.monitors.slice(0, 5).map((m) => {
      const status = String(m.lastStatus || "unknown").toLowerCase();
      return `
        <div class="fpRowCard">
          <div class="fpRowMain">
            <div class="fpRowTitle">${esc(m.url || "—")}</div>
            <div class="fpRowMeta">Interval: ${esc(m.intervalMinutes ?? "—")} min</div>
          </div>
          <div class="fpRowRight">
            <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : ""}">
              <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
            </span>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderChart(points) {
    const canvas = $("#overviewChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const pad = 32;

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(148,163,184,.28)";
    ctx.lineWidth = 1;

    for (let i = 0; i < 5; i++) {
      const y = pad + ((height - pad * 2) / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }

    if (!points.length) {
      ctx.fillStyle = "rgba(148,163,184,.9)";
      ctx.font = "600 18px Inter";
      ctx.fillText("Pas encore de données SEO à afficher.", pad, height / 2);
      return;
    }

    const max = 100;
    const min = 0;
    const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;

    ctx.beginPath();
    points.forEach((val, i) => {
      const x = pad + stepX * i;
      const y = height - pad - ((Math.max(min, Math.min(max, Number(val || 0))) - min) / (max - min)) * (height - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.strokeStyle = "#2f5bff";
    ctx.lineWidth = 4;
    ctx.stroke();

    points.forEach((val, i) => {
      const x = pad + stepX * i;
      const y = height - pad - ((Math.max(min, Math.min(max, Number(val || 0))) - min) / (max - min)) * (height - pad * 2);

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#2449ff";
      ctx.fill();
    });
  }

  function renderPlaceholderPage(title, text, actions = "") {
    if (els.pageTitle) els.pageTitle.textContent = title;
    if (els.pageDesc) els.pageDesc.textContent = text;
    if (els.pageActions) els.pageActions.innerHTML = actions;

    if (els.gridMain) {
      els.gridMain.innerHTML = renderCard(
        title,
        text,
        `<div class="fpEmpty">Je te branche cette page dédiée dans le prochain lot pour éviter les bugs.</div>`
      );
    }

    if (els.gridSide) {
      els.gridSide.innerHTML = renderCard(
        "Workspace",
        "La base visuelle et les endpoints sont maintenant alignés avec ton backend.",
        `
          <div class="fpRows">
            <div class="fpRowCard">
              <div class="fpRowMain">
                <div class="fpRowTitle">Style</div>
                <div class="fpRowMeta">Nouveau layout, nouvelle hiérarchie, ancien dashboard abandonné.</div>
              </div>
            </div>
            <div class="fpRowCard">
              <div class="fpRowMain">
                <div class="fpRowTitle">Mode clair / sombre</div>
                <div class="fpRowMeta">Suit automatiquement les paramètres du navigateur du client.</div>
              </div>
            </div>
          </div>
        `
      );
    }
  }

  function renderPage() {
    setActiveNav();

    if (state.page === "overview") {
      renderOverviewPage();
      return;
    }

    if (state.page === "missions") {
      renderPlaceholderPage("Missions", "Checklist onboarding, quick actions et progression.");
      return;
    }

    if (state.page === "audits") {
      renderPlaceholderPage("Audits", "Historique SEO, lancement d’audit et exports.");
      return;
    }

    if (state.page === "monitors") {
      renderPlaceholderPage("Monitors", "URLs surveillées, uptime, logs et incidents.");
      return;
    }

    if (state.page === "reports") {
      renderPlaceholderPage("Reports", "Exports PDF / CSV et rapports mensuels.");
      return;
    }

    if (state.page === "billing") {
      renderPlaceholderPage("Billing", "Plans, quotas, add-ons et portail Stripe.");
      return;
    }

    if (state.page === "settings") {
      renderPlaceholderPage("Settings", "Emails d’alerte, organisation et préférences.");
      return;
    }

    renderOverviewPage();
  }

  function logout() {
    clearAuth();
    window.location.replace("/login.html");
  }

  function bind() {
    els.menuBtn?.addEventListener("click", openSidebar);
    els.overlay?.addEventListener("click", closeSidebar);
    els.navItems.forEach((item) => item.addEventListener("click", closeSidebar));

    els.btnPortal?.addEventListener("click", openBillingPortal);
    els.btnLogout?.addEventListener("click", logout);

    els.rangeSelect?.addEventListener("change", () => {
      const v = Number(els.rangeSelect.value || 30);
      state.rangeDays = [30, 7, 3].includes(v) ? v : 30;
      loadData();
    });

    $("#btnRefresh")?.addEventListener("click", loadData);

    document.addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-mission-toggle]");
      if (toggle) {
        toggleMission(toggle.getAttribute("data-mission-toggle"));
        renderPage();
        return;
      }

      const doBtn = e.target.closest("[data-mission-do]");
      if (doBtn) {
        doMission(doBtn.getAttribute("data-mission-do"));
        return;
      }

      const monRun = e.target.closest("[data-monitor-run]");
      if (monRun) {
        safeRunMonitor(monRun.getAttribute("data-monitor-run"));
        return;
      }

      const monDel = e.target.closest("[data-monitor-del]");
      if (monDel) {
        safeDeleteMonitor(monDel.getAttribute("data-monitor-del"));
      }
    });
  }

  function init() {
    state.missions = loadMissions();
    saveMissions();
    bind();
    setActiveNav();
    loadData();
  }

  init();
})();
