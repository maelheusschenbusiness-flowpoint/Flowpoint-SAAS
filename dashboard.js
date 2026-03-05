/* ===========================
   FlowPoint AI — dashboard.js
   Hash router + theme + toasts + mission (done/not done)
   + fetchWithAuth (auto refresh/retry) to stop “request expired”
   =========================== */

(() => {
  "use strict";

  // ---------- Config ----------
  const API_BASE = ""; // keep "" if same domain. otherwise "https://api.yourdomain.com"
  const ROUTES = [
    { hash: "#overview", label: "Overview" },
    { hash: "#monitors", label: "Monitoring" },
    { hash: "#reports", label: "Reports" },
    { hash: "#logs", label: "Logs" },
    { hash: "#billing", label: "Billing" },
    { hash: "#settings", label: "Settings" },
    { hash: "#mission", label: "Mission" },
  ];

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    app: $("#app") || document.body,
    view: $("#view"),
    nav: $("#sidebarNav"),
    topTitle: $("#pageTitle"),
    themeToggle: $("#themeToggle"),
    toast: $("#toast"),
    toastMsg: $("#toastMsg"),
  };

  // If your HTML doesn't have these, the code still works, but you should add:
  // <div id="view"></div> somewhere, and #sidebarNav for nav highlight.

  // ---------- State ----------
  const state = {
    route: location.hash || "#overview",
    loading: false,
    controller: null,
    user: null,
    org: null,
  };

  // ---------- Theme ----------
  function getTheme() {
    return localStorage.getItem("fp_theme") || "dark";
  }
  function setTheme(theme) {
    localStorage.setItem("fp_theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    if (els.themeToggle) {
      els.themeToggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      els.themeToggle.textContent = theme === "dark" ? "🌙" : "☀️";
      els.themeToggle.title = theme === "dark" ? "Dark mode" : "Light mode";
    }
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(message = "Done.", type = "info") {
    if (!els.toast) return;
    els.toast.dataset.type = type;
    if (els.toastMsg) els.toastMsg.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  // ---------- Auth / Token helpers ----------
  function getAccessToken() {
    return localStorage.getItem("fp_access_token") || "";
  }
  function setAccessToken(token) {
    if (token) localStorage.setItem("fp_access_token", token);
  }
  function clearTokens() {
    localStorage.removeItem("fp_access_token");
    localStorage.removeItem("fp_refresh_token");
  }

  async function refreshToken() {
    // Try refresh endpoint if you have one. If not, this will fail gracefully.
    const refresh = localStorage.getItem("fp_refresh_token");
    if (!refresh) throw new Error("No refresh token");

    const r = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });

    if (!r.ok) throw new Error("Refresh failed");
    const data = await r.json().catch(() => ({}));
    if (data?.accessToken) setAccessToken(data.accessToken);
    if (data?.refreshToken) localStorage.setItem("fp_refresh_token", data.refreshToken);
    return true;
  }

  // ---------- fetchWithAuth (fix “request expired”) ----------
  async function fetchWithAuth(path, options = {}) {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const headers = new Headers(options.headers || {});
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");

    // Abort previous view requests
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();

    const doFetch = () =>
      fetch(url, {
        ...options,
        headers,
        signal: state.controller.signal,
        credentials: "include", // helps if you use cookies too
      });

    let res = await doFetch();

    // If token expired, attempt refresh then retry once
    if (res.status === 401 || res.status === 403) {
      try {
        await refreshToken();
        const token2 = getAccessToken();
        if (token2) headers.set("Authorization", `Bearer ${token2}`);
        res = await doFetch();
      } catch (e) {
        // Logout UX
        toast("Session expired. Please log in again.", "error");
        clearTokens();
        // Optional redirect
        // location.href = "/login";
        throw e;
      }
    }

    // Handle rate limits / transient errors
    if (res.status === 429) {
      await sleep(700);
      res = await doFetch();
    }

    return res;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---------- Router ----------
  function setActiveNav(hash) {
    if (!els.nav) return;
    $$("a[data-route]", els.nav).forEach((a) => {
      a.classList.toggle("active", a.getAttribute("data-route") === hash);
    });
  }

  function setTitle(text) {
    if (els.topTitle) els.topTitle.textContent = text;
    document.title = `FlowPoint AI — ${text}`;
  }

  function routeLabel(hash) {
    return ROUTES.find((r) => r.hash === hash)?.label || "Dashboard";
  }

  async function navigate(hash) {
    const h = hash || "#overview";
    if (!ROUTES.some((r) => r.hash === h)) {
      location.hash = "#overview";
      return;
    }

    state.route = h;
    setActiveNav(h);
    setTitle(routeLabel(h));

    // Render
    if (!els.view) return;
    els.view.classList.add("fadeIn");
    try {
      if (h === "#overview") await renderOverview();
      else if (h === "#monitors") await renderMonitors();
      else if (h === "#reports") await renderReports();
      else if (h === "#logs") await renderLogs();
      else if (h === "#billing") await renderBilling();
      else if (h === "#settings") await renderSettings();
      else if (h === "#mission") await renderMission();
    } finally {
      setTimeout(() => els.view && els.view.classList.remove("fadeIn"), 250);
    }
  }

  // ---------- Render helpers ----------
  function view(html) {
    if (!els.view) return;
    els.view.innerHTML = html;
  }

  function card({ title, subtitle = "", right = "", body = "" }) {
    return `
      <section class="card">
        <div class="card__head">
          <div>
            <h3 class="card__title">${escapeHtml(title)}</h3>
            ${subtitle ? `<p class="card__sub">${escapeHtml(subtitle)}</p>` : ""}
          </div>
          ${right ? `<div class="card__right">${right}</div>` : ""}
        </div>
        <div class="card__body">${body}</div>
      </section>
    `;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtPct(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return `${Math.round(Number(n) * 100)}%`;
  }

  function fmtMs(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    if (v < 1000) return `${Math.round(v)} ms`;
    return `${(v / 1000).toFixed(2)} s`;
  }

  // ---------- Data loaders ----------
  async function loadMe() {
    // Optional endpoint. If you don’t have it, it’ll fail quietly.
    try {
      const r = await fetchWithAuth("/api/me");
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  async function loadOverview() {
    try {
      const r = await fetchWithAuth("/api/dashboard/overview");
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  async function loadMonitors() {
    try {
      const r = await fetchWithAuth("/api/monitors");
      if (!r.ok) return [];
      return await r.json();
    } catch {
      return [];
    }
  }

  async function loadLogs() {
    try {
      const r = await fetchWithAuth("/api/logs?limit=50");
      if (!r.ok) return [];
      return await r.json();
    } catch {
      return [];
    }
  }

  // ---------- Pages ----------
  async function renderOverview() {
    view(`
      <div class="grid">
        ${skeletonCard("Quick stats")}
        ${skeletonCard("Uptime")}
        ${skeletonCard("Latest events")}
      </div>
    `);

    if (!state.user) state.user = await loadMe();

    const data = await loadOverview();

    const stats = data?.stats || {
      sites: data?.sites ?? 0,
      monitors: data?.monitors ?? 0,
      alerts: data?.alerts ?? 0,
      avgResponseMs: data?.avgResponseMs ?? null,
      uptime7d: data?.uptime7d ?? null,
    };

    const events = data?.events || [];

    view(`
      <div class="grid">
        ${card({
          title: "Quick stats",
          subtitle: state.user?.email ? `Signed in as ${state.user.email}` : "Your workspace at a glance",
          body: `
            <div class="kpis">
              <div class="kpi"><div class="kpi__label">Sites</div><div class="kpi__value">${escapeHtml(stats.sites)}</div></div>
              <div class="kpi"><div class="kpi__label">Monitors</div><div class="kpi__value">${escapeHtml(stats.monitors)}</div></div>
              <div class="kpi"><div class="kpi__label">Alerts (7d)</div><div class="kpi__value">${escapeHtml(stats.alerts)}</div></div>
              <div class="kpi"><div class="kpi__label">Avg response</div><div class="kpi__value">${escapeHtml(fmtMs(stats.avgResponseMs))}</div></div>
            </div>
            <div class="card__actions">
              <button class="btn" data-action="go" data-to="#monitors">View monitoring</button>
              <button class="btn btn--ghost" data-action="go" data-to="#reports">Open reports</button>
            </div>
          `,
        })}
        ${card({
          title: "Uptime",
          subtitle: "Rolling 7 days",
          body: `
            <div class="uptime">
              <div class="uptime__big">${escapeHtml(fmtPct(stats.uptime7d))}</div>
              <div class="uptime__meta">
                <div class="pill">Auto-retry on auth expiry ✅</div>
                <div class="pill pill--soft">Hash routes enabled</div>
              </div>
            </div>
          `,
        })}
        ${card({
          title: "Latest events",
          subtitle: "Most recent activity",
          body: events?.length
            ? `<div class="list">
                ${events
                  .slice(0, 8)
                  .map(
                    (e) => `
                  <div class="row">
                    <div class="dot ${escapeHtml(e.type || "info")}"></div>
                    <div class="row__main">
                      <div class="row__title">${escapeHtml(e.title || "Event")}</div>
                      <div class="row__sub">${escapeHtml(e.time || e.createdAt || "")}</div>
                    </div>
                    ${e.ctaHash ? `<button class="btn btn--xs" data-action="go" data-to="${escapeHtml(e.ctaHash)}">Open</button>` : ""}
                  </div>`
                  )
                  .join("")}
              </div>`
            : `<div class="empty">
                <div class="empty__title">No events yet</div>
                <div class="empty__sub">Once monitors and reports run, you'll see them here.</div>
              </div>`,
        })}
      </div>
    `);
  }

  async function renderMonitors() {
    view(`
      <div class="grid">
        ${skeletonCard("Monitors")}
        ${skeletonCard("Health")}
      </div>
    `);

    const monitors = await loadMonitors();

    const up = monitors.filter((m) => (m.status || "").toLowerCase() === "up").length;
    const down = monitors.filter((m) => (m.status || "").toLowerCase() === "down").length;

    view(`
      <div class="grid">
        ${card({
          title: "Monitors",
          subtitle: "Your endpoints & site checks",
          right: `<button class="btn" data-action="addMonitor">+ New monitor</button>`,
          body: monitors.length
            ? `<div class="table">
                <div class="table__row table__head">
                  <div>Name</div><div>Status</div><div>Response</div><div>Actions</div>
                </div>
                ${monitors
                  .map((m) => {
                    const s = (m.status || "unknown").toLowerCase();
                    return `
                      <div class="table__row">
                        <div class="mono">${escapeHtml(m.name || m.url || "Monitor")}</div>
                        <div><span class="badge badge--${escapeHtml(s)}">${escapeHtml(s.toUpperCase())}</span></div>
                        <div>${escapeHtml(fmtMs(m.lastResponseMs))}</div>
                        <div class="table__actions">
                          <button class="btn btn--xs btn--ghost" data-action="ping" data-id="${escapeHtml(m.id)}">Test</button>
                          <button class="btn btn--xs btn--ghost" data-action="editMonitor" data-id="${escapeHtml(m.id)}">Edit</button>
                          <button class="btn btn--xs btn--danger" data-action="deleteMonitor" data-id="${escapeHtml(m.id)}">Delete</button>
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>`
            : `<div class="empty">
                <div class="empty__title">No monitors</div>
                <div class="empty__sub">Create your first monitor to track uptime and performance.</div>
                <div class="card__actions">
                  <button class="btn" data-action="addMonitor">+ New monitor</button>
                </div>
              </div>`,
        })}
        ${card({
          title: "Health",
          subtitle: "Current snapshot",
          body: `
            <div class="kpis">
              <div class="kpi"><div class="kpi__label">UP</div><div class="kpi__value">${escapeHtml(up)}</div></div>
              <div class="kpi"><div class="kpi__label">DOWN</div><div class="kpi__value">${escapeHtml(down)}</div></div>
              <div class="kpi"><div class="kpi__label">TOTAL</div><div class="kpi__value">${escapeHtml(monitors.length)}</div></div>
              <div class="kpi"><div class="kpi__label">Retry</div><div class="kpi__value">ON</div></div>
            </div>
            <div class="hint">Tip: if your API uses short-lived JWTs, keep <span class="mono">/api/auth/refresh</span> enabled.</div>
          `,
        })}
      </div>
    `);
  }

  async function renderReports() {
    view(`
      <div class="grid">
        ${card({
          title: "Reports",
          subtitle: "Exports & monthly summaries",
          right: `<button class="btn" data-action="exportPdf">Export PDF</button>`,
          body: `
            <div class="empty">
              <div class="empty__title">Ready when you are</div>
              <div class="empty__sub">Generate a report, then export it as PDF / CSV.</div>
              <div class="card__actions">
                <button class="btn" data-action="generateReport">Generate report</button>
                <button class="btn btn--ghost" data-action="go" data-to="#logs">See logs</button>
              </div>
            </div>
          `,
        })}
        ${card({
          title: "Automations",
          subtitle: "Cron + alerts",
          body: `
            <div class="list">
              <div class="row">
                <div class="dot success"></div>
                <div class="row__main">
                  <div class="row__title">Cron runner</div>
                  <div class="row__sub">Secured endpoint for monitor runs</div>
                </div>
                <button class="btn btn--xs btn--ghost" data-action="runCron">Run now</button>
              </div>
              <div class="row">
                <div class="dot info"></div>
                <div class="row__main">
                  <div class="row__title">Email alerts</div>
                  <div class="row__sub">UP/DOWN notifications</div>
                </div>
                <button class="btn btn--xs btn--ghost" data-action="go" data-to="#settings">Configure</button>
              </div>
            </div>
          `,
        })}
      </div>
    `);
  }

  async function renderLogs() {
    view(`
      <div class="grid">
        ${skeletonCard("Latest logs")}
      </div>
    `);

    const logs = await loadLogs();

    view(`
      <div class="grid">
        ${card({
          title: "Latest logs",
          subtitle: "Last 50 entries",
          right: `<button class="btn btn--ghost" data-action="refreshLogs">Refresh</button>`,
          body: logs.length
            ? `<div class="loglist">
                ${logs
                  .slice(0, 50)
                  .map(
                    (l) => `
                  <div class="log">
                    <div class="log__lvl lvl-${escapeHtml((l.level || "info").toLowerCase())}">${escapeHtml(
                      (l.level || "INFO").toUpperCase()
                    )}</div>
                    <div class="log__msg">${escapeHtml(l.message || l.msg || "—")}</div>
                    <div class="log__ts mono">${escapeHtml(l.time || l.createdAt || "")}</div>
                  </div>`
                  )
                  .join("")}
              </div>`
            : `<div class="empty">
                <div class="empty__title">No logs</div>
                <div class="empty__sub">Once cron runs and monitoring starts, logs will appear here.</div>
              </div>`,
        })}
      </div>
    `);
  }

  async function renderBilling() {
    view(`
      <div class="grid">
        ${card({
          title: "Billing",
          subtitle: "Plan & invoices",
          body: `
            <div class="empty">
              <div class="empty__title">Manage your plan</div>
              <div class="empty__sub">Update plan, view invoices, and manage trial status.</div>
              <div class="card__actions">
                <button class="btn" data-action="openStripePortal">Open customer portal</button>
              </div>
            </div>
          `,
        })}
      </div>
    `);
  }

  async function renderSettings() {
    view(`
      <div class="grid">
        ${card({
          title: "Settings",
          subtitle: "Theme, notifications, org configuration",
          body: `
            <div class="form">
              <div class="field">
                <label>Theme</label>
                <div class="seg">
                  <button class="seg__btn" data-action="setTheme" data-theme="light">Light</button>
                  <button class="seg__btn" data-action="setTheme" data-theme="dark">Dark</button>
                </div>
              </div>
              <div class="field">
                <label>Alerts recipients</label>
                <input class="input" id="alertRecipients" placeholder="name@domain.com, name2@domain.com" />
                <div class="hint">Comma-separated emails. Saved locally unless your endpoint exists.</div>
              </div>
              <div class="field">
                <button class="btn" data-action="saveSettings">Save</button>
                <button class="btn btn--ghost" data-action="testEmail">Send test email</button>
              </div>
            </div>
          `,
        })}
      </div>
    `);

    // hydrate saved local setting
    const saved = localStorage.getItem("fp_alert_recipients");
    const input = $("#alertRecipients");
    if (input && saved) input.value = saved;
    // mark active theme button
    const t = getTheme();
    $$(`.seg__btn[data-theme="${t}"]`).forEach((b) => b.classList.add("active"));
  }

  // ✅ Mission page (done/not done)
  async function renderMission() {
    const key = "fp_missions_v1";
    const defaults = [
      { id: "m1", title: "Setup at least 1 monitor", done: false },
      { id: "m2", title: "Run cron manually once", done: false },
      { id: "m3", title: "Enable email alerts", done: false },
      { id: "m4", title: "Export a PDF report", done: false },
      { id: "m5", title: "Invite a teammate (Ultra)", done: false },
    ];

    const missions = (() => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "null");
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch {}
      return defaults;
    })();

    const doneCount = missions.filter((m) => m.done).length;

    view(`
      <div class="grid">
        ${card({
          title: "Mission",
          subtitle: "Mark as done or not done ✔️",
          right: `<div class="pill">${doneCount}/${missions.length} done</div>`,
          body: `
            <div class="mission">
              ${missions
                .map(
                  (m) => `
                <label class="mission__item">
                  <input type="checkbox" data-action="toggleMission" data-id="${escapeHtml(m.id)}" ${
                    m.done ? "checked" : ""
                  } />
                  <span class="mission__check"></span>
                  <span class="mission__text">${escapeHtml(m.title)}</span>
                </label>
              `
                )
                .join("")}
            </div>
            <div class="card__actions">
              <button class="btn btn--ghost" data-action="resetMissions">Reset</button>
              <button class="btn" data-action="saveMissions">Save</button>
            </div>
          `,
        })}
        ${card({
          title: "Tips",
          subtitle: "To keep everything stable",
          body: `
            <div class="list">
              <div class="row">
                <div class="dot success"></div>
                <div class="row__main">
                  <div class="row__title">No more “request expired”</div>
                  <div class="row__sub">Auto refresh + retry on 401/403</div>
                </div>
              </div>
              <div class="row">
                <div class="dot info"></div>
                <div class="row__main">
                  <div class="row__title">Hash router</div>
                  <div class="row__sub">Fast navigation without reload</div>
                </div>
              </div>
            </div>
          `,
        })}
      </div>
    `);

    // store missions in memory for toggles
    state._missions = missions;
  }

  function skeletonCard(title) {
    return `
      <section class="card">
        <div class="card__head">
          <div>
            <h3 class="card__title">${escapeHtml(title)}</h3>
            <p class="card__sub">Loading…</p>
          </div>
        </div>
        <div class="card__body">
          <div class="skeleton sk1"></div>
          <div class="skeleton sk2"></div>
          <div class="skeleton sk3"></div>
        </div>
      </section>
    `;
  }

  // ---------- Actions (buttons that “did nothing” before) ----------
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action");

    try {
      if (action === "go") {
        const to = btn.getAttribute("data-to") || "#overview";
        location.hash = to;
      }

      if (action === "setTheme") {
        const t = btn.getAttribute("data-theme");
        if (t === "light" || t === "dark") {
          setTheme(t);
          $$(".seg__btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          toast(`Theme set to ${t}`, "success");
        }
      }

      if (action === "refreshLogs") {
        await renderLogs();
        toast("Logs refreshed", "success");
      }

      if (action === "addMonitor") {
        toast("Add monitor: connect this to your modal/form.", "info");
      }

      if (action === "ping") {
        const id = btn.getAttribute("data-id");
        btn.disabled = true;
        btn.textContent = "Testing…";
        const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}/ping`, { method: "POST" });
        btn.disabled = false;
        btn.textContent = "Test";
        toast(r.ok ? "Ping OK" : "Ping failed", r.ok ? "success" : "error");
      }

      if (action === "deleteMonitor") {
        const id = btn.getAttribute("data-id");
        btn.disabled = true;
        const r = await fetchWithAuth(`/api/monitors/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast(r.ok ? "Deleted" : "Delete failed", r.ok ? "success" : "error");
        await renderMonitors();
      }

      if (action === "generateReport") {
        toast("Generating…", "info");
        const r = await fetchWithAuth(`/api/reports/generate`, { method: "POST" });
        toast(r.ok ? "Report generated" : "Failed", r.ok ? "success" : "error");
      }

      if (action === "exportPdf") {
        toast("Preparing PDF…", "info");
        const r = await fetchWithAuth(`/api/reports/export/pdf`, { method: "GET" });
        if (!r.ok) return toast("Export failed", "error");
        // Download
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "flowpoint-report.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast("PDF downloaded", "success");
      }

      if (action === "runCron") {
        toast("Running cron…", "info");
        const r = await fetchWithAuth(`/api/cron/run`, { method: "POST" });
        toast(r.ok ? "Cron executed" : "Cron failed", r.ok ? "success" : "error");
      }

      if (action === "openStripePortal") {
        const r = await fetchWithAuth(`/api/billing/portal`, { method: "POST" });
        if (!r.ok) return toast("Portal error", "error");
        const data = await r.json().catch(() => ({}));
        if (data?.url) location.href = data.url;
        else toast("Portal URL missing", "error");
      }

      if (action === "saveSettings") {
        const input = $("#alertRecipients");
        const value = (input?.value || "").trim();
        localStorage.setItem("fp_alert_recipients", value);
        // Optional: push to backend if exists
        try {
          await fetchWithAuth("/api/org/settings", {
            method: "POST",
            body: JSON.stringify({ alertRecipients: value }),
          });
        } catch {}
        toast("Settings saved", "success");
      }

      if (action === "testEmail") {
        toast("Sending…", "info");
        const r = await fetchWithAuth(`/api/email/test`, { method: "POST" });
        toast(r.ok ? "Test email sent" : "Email failed", r.ok ? "success" : "error");
      }

      // Mission actions
      if (action === "toggleMission") {
        // handled in change event (checkbox), but keep safe
      }
      if (action === "resetMissions") {
        localStorage.removeItem("fp_missions_v1");
        toast("Missions reset", "success");
        await renderMission();
      }
      if (action === "saveMissions") {
        if (state._missions) {
          localStorage.setItem("fp_missions_v1", JSON.stringify(state._missions));
          toast("Missions saved ✔️", "success");
        }
      }
    } catch (err) {
      console.error(err);
      toast("Something went wrong", "error");
    }
  });

  document.addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"][data-action="toggleMission"]');
    if (!cb) return;
    const id = cb.getAttribute("data-id");
    const missions = state._missions || [];
    const m = missions.find((x) => x.id === id);
    if (m) m.done = !!cb.checked;
  });

  // ---------- Init ----------
  function buildNavIfMissing() {
    if (!els.nav) return;
    // If your HTML already has links, skip.
    if ($$("a[data-route]", els.nav).length) return;

    els.nav.innerHTML = ROUTES.map(
      (r) => `<a class="nav__link" href="${r.hash}" data-route="${r.hash}">
                <span class="nav__dot"></span>
                <span>${r.label}</span>
              </a>`
    ).join("");
  }

  function init() {
    setTheme(getTheme());

    if (els.themeToggle) {
      els.themeToggle.addEventListener("click", () => {
        setTheme(getTheme() === "dark" ? "light" : "dark");
      });
    }

    buildNavIfMissing();
    window.addEventListener("hashchange", () => navigate(location.hash || "#overview"));

    // First route
    navigate(location.hash || "#overview").catch(() => navigate("#overview"));
  }

  init();
})();
