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
    menuBtn: $("#fpMenuBtn"),
    sidebarClose: $("#fpSidebarClose"),

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

    pageHeroTitle: $("#pageHeroTitle"),
    pageHeroText: $("#pageHeroText"),
    pageHeroActions: $("#pageHeroActions"),

    gridMain: $("#gridMain"),
    gridSide: $("#gridSide"),

    btnPortal: $("#btnPortal"),
    btnLogout: $("#btnLogout"),

    navItems: $$(".fpNavItem"),
  };

  const MISSIONS_KEY = "fp_dashboard_v4_missions";

  const defaultMissions = [
    { id: "m1", title: "Créer ton premier monitor", meta: "Monitoring", done: false, action: "add_monitor" },
    { id: "m2", title: "Lancer un audit SEO", meta: "Audits", done: false, action: "run_audit" },
    { id: "m3", title: "Exporter un rapport audits", meta: "Reports", done: false, action: "export_audits" },
    { id: "m4", title: "Ouvrir le portail Stripe", meta: "Billing", done: false, action: "open_billing" }
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
      const page = (item.getAttribute("data-page") || "").toLowerCase();
      item.classList.toggle("active", page === state.page);
    });
  }

  function formatUsage(v) {
    if (!v) return "—";
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (typeof v === "object") {
      const used = v.used ?? null;
      const limit = v.limit ?? null;
      if (used != null && limit != null) return `${used}/${limit}`;
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
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;
    m.done = !m.done;
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

  function setHero(title, text, actions = "") {
    if (els.pageHeroTitle) els.pageHeroTitle.textContent = title;
    if (els.pageHeroText) els.pageHeroText.textContent = text;
    if (els.pageHeroActions) els.pageHeroActions.innerHTML = actions;
  }

  function setMain(html) {
    if (els.gridMain) els.gridMain.innerHTML = html;
  }

  function setSide(html) {
    if (els.gridSide) els.gridSide.innerHTML = html;
  }

  async function openBillingPortal() {
    setStatus("Ouverture du portail Stripe…", "warn");
    try {
      const r = await fetchWithAuth("/api/stripe/portal", { method: "POST" });
      if (!r.ok) throw new Error("Portal failed");

      const data = await r.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url;
        return true;
      }

      setStatus("URL du portail manquante", "danger");
      return false;
    } catch (e) {
      console.error(e);
      setStatus("Erreur Billing Portal", "danger");
      return false;
    }
  }

  async function safeRunAudit() {
    const url = prompt("URL à auditer (ex: https://site.com) ?");
    if (!url) return false;

    setStatus("Lancement de l’audit…", "warn");
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
    const url = prompt("URL à monitorer (ex: https://site.com) ?");
    if (!url) return false;

    setStatus("Création du monitor…", "warn");
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

  async function safeExport(endpoint, filename) {
    setStatus("Préparation de l’export…", "warn");
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
    setStatus("Test du monitor…", "warn");
    try {
      const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/run`, {
        method: "POST",
      });
      if (!r.ok) throw new Error("Run failed");
      setStatus("Test monitor terminé — OK", "ok");
      await loadData();
    } catch (e) {
      console.error(e);
      setStatus("Test monitor échoué", "danger");
    }
  }

  async function safeDeleteMonitor(id) {
    if (!confirm("Supprimer ce monitor ?")) return;

    setStatus("Suppression du monitor…", "warn");
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

  function logout() {
    clearAuth();
    window.location.replace("/login.html");
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
      setStatus("Dashboard à jour — OK", "ok");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setStatus("Erreur réseau / session", "danger");
    }
  }

  function renderMissionList(hostSelector, withViewLink = false) {
    const host = $(hostSelector);
    if (!host) return;

    host.innerHTML = state.missions.map((m) => `
      <div class="fpMission">
        <div class="fpCheck ${m.done ? "done" : ""}" data-mission-toggle="${esc(m.id)}">${m.done ? "✓" : ""}</div>

        <div style="min-width:0;flex:1">
          <div class="fpMissionTitle">${esc(m.title)}</div>
          <div class="fpMissionMeta">${esc(m.meta)}</div>

          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="fpBtn fpBtnPrimary sm" type="button" data-mission-do="${esc(m.id)}">Faire</button>
            ${withViewLink ? `<a class="fpBtn fpBtnGhost sm" href="./missions.html">Voir</a>` : ""}
          </div>
        </div>
      </div>
    `).join("");
  }

  function renderOverview() {
    const ov = state.overview || {};
    const activeMonitors = ov.monitors?.active ?? state.monitors.length;
    const downMonitors = ov.monitors?.down ?? 0;
    const seoScore = ov.seoScore ?? 0;
    const monitorLimit = state.me?.usage?.monitors?.limit ?? 0;

    setHero(
      "Overview",
      "Vue générale de ton compte, de tes performances et des actions prioritaires.",
      `
        <button class="fpBtn fpBtnPrimary" id="btnRunAudit">Run SEO audit</button>
        <button class="fpBtn fpBtnSoft" id="btnAddMonitor">Add monitor</button>
        <a class="fpBtn fpBtnGhost" href="./billing.html">Billing</a>
      `
    );

    setMain(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpCardTitle">Performance globale</div>
            <div class="fpCardSub">Les indicateurs principaux de ton activité.</div>
          </div>
        </div>

        <div class="fpKpis">
          <div class="fpKpi">
            <div class="fpKpiLabel">SEO Score</div>
            <div class="fpKpiVal">${esc(seoScore)}<span class="fpKpiUnit">/100</span></div>
            <div class="fpKpiHint">Dernier audit disponible</div>
          </div>

          <div class="fpKpi">
            <div class="fpKpiLabel">Monitors actifs</div>
            <div class="fpKpiVal">${esc(activeMonitors)}<span class="fpKpiUnit">/ ${esc(monitorLimit)}</span></div>
            <div class="fpKpiHint">${esc(downMonitors)} monitor(s) DOWN</div>
          </div>

          <div class="fpKpi">
            <div class="fpKpiLabel">Plan</div>
            <div class="fpKpiVal">${esc(state.me?.plan || "—")}</div>
            <div class="fpKpiHint">${esc(state.me?.subscriptionStatus || "Sans statut")}</div>
          </div>
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpCardTitle">Missions rapides</div>
            <div class="fpCardSub">Checklist d’onboarding et de setup.</div>
          </div>
        </div>
        <div class="fpMissionGrid" id="overviewMissionList"></div>
      </div>
    `);

    setSide(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpCardTitle">Derniers audits</div>
            <div class="fpCardSub">Historique récent récupéré via l’API.</div>
          </div>
        </div>
        <div class="fpRows">
          ${
            state.audits.length
              ? state.audits.slice(0, 4).map((a) => `
                <div class="fpRowCard">
                  <div class="fpRowMain">
                    <div class="fpRowTitle">${esc(a.url || "—")}</div>
                    <div class="fpRowMeta">Score : ${esc(a.score ?? "—")}</div>
                  </div>
                </div>
              `).join("")
              : `<div class="fpEmpty">Aucun audit disponible.</div>`
          }
        </div>
      </div>

      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpCardTitle">Monitors</div>
            <div class="fpCardSub">État rapide des URLs surveillées.</div>
          </div>
        </div>
        <div class="fpRows">
          ${
            state.monitors.length
              ? state.monitors.slice(0, 4).map((m) => {
                  const status = String(m.lastStatus || "unknown").toLowerCase();
                  return `
                    <div class="fpRowCard">
                      <div class="fpRowMain">
                        <div class="fpRowTitle">${esc(m.url || "—")}</div>
                        <div class="fpRowMeta">Interval : ${esc(m.intervalMinutes || 60)} min</div>
                      </div>
                      <div class="fpRowRight">
                        <span class="fpBadge ${status === "up" ? "up" : status === "down" ? "down" : ""}">
                          <span class="fpBadgeDot"></span>${esc(status.toUpperCase())}
                        </span>
                      </div>
                    </div>
                  `;
                }).join("")
              : `<div class="fpEmpty">Aucun monitor disponible.</div>`
          }
        </div>
      </div>
    `);

    $("#btnRunAudit")?.addEventListener("click", safeRunAudit);
    $("#btnAddMonitor")?.addEventListener("click", safeAddMonitor);
    renderMissionList("#overviewMissionList", true);
  }

  function renderMissionsPage() {
    const done = state.missions.filter((m) => m.done).length;

    setHero(
      "Missions",
      "Checklist complète pour configurer proprement le compte client.",
      `
        <button class="fpBtn fpBtnSoft" id="btnResetMissions">Reset</button>
        <button class="fpBtn fpBtnPrimary" id="btnSaveMissions">Save</button>
      `
    );

    setMain(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpCardTitle">Checklist principale</div>
            <div class="fpCardSub">${done}/${state.missions.length} mission(s) complétée(s).</div>
          </div>
        </div>
        <div class="fpMissionGrid" id="missionsFullList"></div>
      </div>
    `);

    setSide(`
      <div class="fpCard">
        <div class="fpCardTitle">Progression</div>
        <div class="fpCardSub">Commence par monitors, puis audits, puis billing.</div>
        <div class="fpRows" style="margin-top:12px">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Terminées</div>
              <div class="fpRowMeta">${done} sur ${state.missions.length}</div>
            </div>
          </div>
        </div>
      </div>
    `);

    renderMissionList("#missionsFullList", false);

    $("#btnResetMissions")?.addEventListener("click", () => {
      state.missions = JSON.parse(JSON.stringify(defaultMissions));
      saveMissions();
      renderPage();
      setStatus("Missions réinitialisées", "ok");
    });

    $("#btnSaveMissions")?.addEventListener("click", () => {
      saveMissions();
      setStatus("Missions sauvegardées", "ok");
    });
  }

  function renderAuditsPage() {
    setHero(
      "Audits",
      "Historique des audits SEO, lancement manuel et export CSV.",
      `
        <button class="fpBtn fpBtnPrimary" id="btnAuditRun">Run SEO audit</button>
        <button class="fpBtn fpBtnSoft" id="btnAuditExport">Export audits CSV</button>
      `
    );

    setMain(`
      <div class="fpCard">
        <div class="fpCardHead">
          <div>
            <div class="fpCardTitle">Historique des audits</div>
            <div class="fpCardSub">Derniers audits récupérés depuis ton API.</div>
          </div>
        </div>
        <div class="fpRows">
          ${
            state.audits.length
              ? state.audits.slice(0, 20).map((a) => `
                <div class="fpRowCard">
                  <div class="fpRowMain">
                    <div class="fpRowTitle">${esc(a.url || "—")}</div>
                    <div class="fpRowMeta">
                      Score : ${esc(a.score ?? "—")} • ${esc(a.createdAt ? new Date(a.createdAt).toLocaleString("fr-FR") : "—")}
                    </div>
                  </div>
                  <div class="fpRowRight">
                    <span class="fpBadge"><span class="fpBadgeDot"></span>Audit</span>
                  </div>
                </div>
              `).join("")
              : `<div class="fpEmpty">Aucun audit disponible pour le moment.</div>`
          }
        </div>
      </div>
    `);

    setSide(`
      <div class="fpCard">
        <div class="fpCardTitle">Actions rapides</div>
        <div class="fpCardSub">Lance un nouvel audit ou exporte ton historique.</div>
        <div class="fpRows" style="margin-top:12px">
          <div class="fpRowCard">
            <div class="fpRowMain">
              <div class="fpRowTitle">Route lancement</div>
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
  }

  function renderPage() {
    setActiveNav();

    if (state.page === "overview") return renderOverview();
    if (state.page === "missions") return renderMissionsPage();
    if (state.page === "audits") return renderAuditsPage();

    setHero(
      "Page en préparation",
      "La base visuelle est prête. Cette section sera branchée dans le même style.",
      ""
    );

    setMain(`
      <div class="fpCard">
        <div class="fpCardTitle">Section : ${esc(state.page)}</div>
        <div class="fpCardSub">Cette page sera fournie dans le prochain lot.</div>
      </div>
    `);

    setSide(`
      <div class="fpCard">
        <div class="fpCardTitle">Style actif</div>
        <div class="fpCardSub">Même shell, mêmes couleurs, light/dark automatique.</div>
      </div>
    `);
  }

  function bind() {
    els.menuBtn?.addEventListener("click", openSidebar);
    els.sidebarClose?.addEventListener("click", closeSidebar);
    els.overlay?.addEventListener("click", closeSidebar);

    els.navItems.forEach((a) => {
      a.addEventListener("click", () => closeSidebar());
    });

    els.btnPortal?.addEventListener("click", openBillingPortal);
    els.btnLogout?.addEventListener("click", logout);

    document.addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-mission-toggle]");
      if (toggle) {
        toggleMission(toggle.getAttribute("data-mission-toggle"));
        renderPage();
        return;
      }

      const action = e.target.closest("[data-mission-do]");
      if (action) {
        doMission(action.getAttribute("data-mission-do"));
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
