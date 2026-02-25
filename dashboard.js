/* Flowpoint dashboard.js
   - SPA navigation (sans scroll foireux)
   - Layout identique au mock (photo 1)
   - Branché sur ton backend: /api/me, /api/audits, /api/monitors, /api/stripe/portal, exports CSV
*/

(function () {
  const TOKEN_KEY = "fp_token";
  const token = localStorage.getItem(TOKEN_KEY);

  // Redirect if not logged
  if (!token) {
    location.replace("/login.html");
    return;
  }

  // Helpers
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));

  async function api(path, opts = {}) {
    const r = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // Mobile sidebar
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  const btnMenu = $("#btnMenu");

  function openSidebar() {
    sidebar.classList.add("open");
    overlay.classList.add("show");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
  }
  btnMenu?.addEventListener("click", openSidebar);
  overlay?.addEventListener("click", closeSidebar);

  // Navigation (SPA)
  const navItems = $$(".nav-item");
  const pages = {
    overview: $("#page-overview"),
    audits: $("#page-audits"),
    monitors: $("#page-monitors"),
    local: $("#page-local"),
    competitors: $("#page-competitors"),
    reports: $("#page-reports"),
    billing: $("#page-billing"),
    settings: $("#page-settings"),
  };

  function showPage(name) {
    navItems.forEach((b) => b.classList.toggle("active", b.dataset.page === name));
    Object.entries(pages).forEach(([k, el]) => {
      if (!el) return;
      el.classList.toggle("show", k === name);
    });
    // ferme le drawer mobile
    closeSidebar();
    // top de page (propre)
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  navItems.forEach((b) => b.addEventListener("click", () => showPage(b.dataset.page)));

  // Page jump buttons (View all, See plans, etc.)
  $$("[data-page-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-page-jump");
      if (p) showPage(p);
    });
  });

  // UI refs
  const helloName = $("#helloName");
  const avatarLetter = $("#avatarLetter");
  const pillEmailMobile = $("#pillEmailMobile");

  const accPlan = $("#accPlan");
  const accOrg = $("#accOrg");
  const accRole = $("#accRole");
  const accTrial = $("#accTrial");

  const kpiSeo = $("#kpiSeo");
  const kpiSeoSub = $("#kpiSeoSub");
  const kpiMonitors = $("#kpiMonitors");
  const kpiUp = $("#kpiUp");
  const kpiDown = $("#kpiDown");
  const kpiIncidents = $("#kpiIncidents");
  const chartRange = $("#chartRange");
  const rangeSel = $("#range");

  const monList = $("#monList");
  const monitorsList2 = $("#monitorsList2");

  const auditsList = $("#auditsList");
  const auditUrl = $("#auditUrl");
  const auditMsg = $("#auditMsg");

  const monUrl = $("#monUrl");
  const monInterval = $("#monInterval");
  const monMsg = $("#monMsg");

  // Buttons
  $("#btnLogout")?.addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.replace("/login.html");
  });

  async function openPortal() {
    const j = await api("/api/stripe/portal", { method: "POST", body: JSON.stringify({}) });
    if (j.url) location.href = j.url;
  }
  $("#btnPortal")?.addEventListener("click", openPortal);
  $("#btnPortal2")?.addEventListener("click", openPortal);

  // Exports
  $("#btnExportAudits")?.addEventListener("click", () => {
    window.location.href = "/api/export/audits.csv?token=1"; // (le vrai auth est via header; donc on fait fetch download ci-dessous)
    // => on remplace par un vrai download via fetch:
    downloadAuthed("/api/export/audits.csv", "flowpoint-audits.csv");
  });
  $("#btnExportMonitors")?.addEventListener("click", () => {
    downloadAuthed("/api/export/monitors.csv", "flowpoint-monitors.csv");
  });

  async function downloadAuthed(url, filename) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return alert("Export impossible (auth/quota).");
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  // Quick actions
  $("#btnRefresh")?.addEventListener("click", () => refreshAll());
  $("#btnRunAudit")?.addEventListener("click", () => showPage("audits"));
  $("#btnAuditRunFromAudits")?.addEventListener("click", () => auditUrl?.focus());
  $("#btnAddMonitor")?.addEventListener("click", () => showPage("monitors"));
  $("#btnAddMonitor2")?.addEventListener("click", () => monUrl?.focus());

  // Plan buttons (option: ouvrir billing portal)
  $$("[data-plan]").forEach((b) => b.addEventListener("click", openPortal));

  // Chart
  let chart = null;
  function makeFakeSeries(days) {
    // juste pour coller au mock (tu pourras brancher sur de vraies stats après)
    const pts = [];
    let v = 60;
    for (let i = 0; i < days; i++) {
      v += (Math.random() - 0.45) * 8;
      v = Math.max(20, Math.min(95, v));
      pts.push(Math.round(v));
    }
    return pts;
  }

  function renderChart(days = 30) {
    const ctx = $("#chartCanvas");
    if (!ctx) return;
    const labels = Array.from({ length: days }, (_, i) => `${i + 1}`);
    const data = makeFakeSeries(days);

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "SEO Performance",
          data,
          tension: 0.35,
          fill: true,
          pointRadius: 2.5,
          pointHoverRadius: 4,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { intersect: false, mode: "index" } },
        scales: {
          x: { grid: { display: false }, ticks: { display: false } },
          y: { grid: { color: "rgba(203,213,225,.35)" }, ticks: { display: false }, border: { display: false } },
        },
      },
    });
  }

  rangeSel?.addEventListener("change", () => {
    const days = Number(rangeSel.value || 30);
    chartRange.textContent = `Last ${days} days`;
    kpiSeoSub.textContent = `Last ${days} days`;
    renderChart(days);
  });

  // Render helpers
  function fmtDate(d) {
    if (!d) return "—";
    try { return new Date(d).toLocaleString("fr-FR"); } catch { return "—"; }
  }
  function pillStatus(status) {
    const s = String(status || "").toLowerCase();
    if (s === "up") return `<span class="pill pill-soft">Up</span>`;
    if (s === "down") return `<span class="pill pill-pending">Down</span>`;
    return `<span class="pill pill-warn">Unknown</span>`;
  }

  function renderMonitorsCompact(list) {
    if (!monList) return;
    if (!list.length) {
      monList.innerHTML = `<div class="tr"><div class="muted">No monitors yet.</div><div></div><div></div><div></div><div></div><div></div></div>`;
      return;
    }
    monList.innerHTML = list.map((m) => {
      return `
        <div class="tr" style="grid-template-columns: 2.2fr .9fr .9fr .9fr .6fr .9fr">
          <div style="word-break:break-word">${escapeHtml(m.url || "")}</div>
          <div>${pillStatus(m.lastStatus)}</div>
          <div>${(m.intervalMinutes || 60)} min</div>
          <div>${fmtDate(m.lastCheckedAt)}</div>
          <div class="muted">—</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-outline btn-sm" data-run="${m._id}">Run</button>
          </div>
        </div>`;
    }).join("");

    monList.querySelectorAll("[data-run]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api(`/api/monitors/${btn.getAttribute("data-run")}/run`, { method: "POST", body: "{}" });
          await loadMonitors();
        } catch (e) {
          alert(e.message || "Run failed");
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function renderMonitorsFull(list) {
    if (!monitorsList2) return;
    if (!list.length) {
      monitorsList2.innerHTML = `<div class="tr" style="grid-template-columns:2.2fr .9fr .9fr .9fr .6fr 1.2fr"><div class="muted">No monitors yet.</div><div></div><div></div><div></div><div></div><div></div></div>`;
      return;
    }
    monitorsList2.innerHTML = list.map((m) => `
      <div class="tr" style="grid-template-columns:2.2fr .9fr .9fr .9fr .6fr 1.2fr">
        <div style="word-break:break-word">${escapeHtml(m.url || "")}</div>
        <div>${pillStatus(m.lastStatus)}</div>
        <div>${(m.intervalMinutes || 60)} min</div>
        <div>${fmtDate(m.lastCheckedAt)}</div>
        <div class="muted">—</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" data-run="${m._id}">Run</button>
          <button class="btn btn-outline btn-sm" data-toggle="${m._id}" data-active="${m.active}">${m.active ? "Pause" : "Resume"}</button>
        </div>
      </div>
    `).join("");

    monitorsList2.querySelectorAll("[data-run]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api(`/api/monitors/${btn.getAttribute("data-run")}/run`, { method: "POST", body: "{}" });
          await loadMonitors();
        } catch (e) {
          alert(e.message || "Run failed");
        } finally {
          btn.disabled = false;
        }
      });
    });

    monitorsList2.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const id = btn.getAttribute("data-toggle");
          const active = btn.getAttribute("data-active") === "true";
          await api(`/api/monitors/${id}`, { method: "PATCH", body: JSON.stringify({ active: !active }) });
          await loadMonitors();
        } catch (e) {
          alert(e.message || "Update failed");
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function renderAudits(list) {
    if (!auditsList) return;
    if (!list.length) {
      auditsList.innerHTML = `<div class="tr" style="grid-template-columns:.9fr 2.2fr .9fr .6fr 2.2fr .8fr"><div class="muted">No audits yet.</div><div></div><div></div><div></div><div></div><div></div></div>`;
      return;
    }
    auditsList.innerHTML = list.map((a) => `
      <div class="tr" style="grid-template-columns:.9fr 2.2fr .9fr .6fr 2.2fr .8fr">
        <div class="muted">${fmtDate(a.createdAt)}</div>
        <div style="word-break:break-word">${escapeHtml(a.url || "")}</div>
        <div>${a.status === "ok" ? `<span class="pill pill-soft">OK</span>` : `<span class="pill pill-pending">Error</span>`}</div>
        <div><b>${a.score ?? "—"}</b></div>
        <div class="muted">${escapeHtml((a.summary || "").slice(0, 90))}</div>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-outline btn-sm" data-pdf="${a._id}">PDF</button>
        </div>
      </div>
    `).join("");

    auditsList.querySelectorAll("[data-pdf]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-pdf");
        // téléchargement direct (header auth)
        const r = await fetch(`/api/audits/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return alert("PDF impossible (quota/auth).");
        const blob = await r.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `flowpoint-audit-${id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      });
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Data loaders
  let me = null;
  async function loadMe() {
    me = await api("/api/me");
    const orgName = me?.org?.name || me.companyName || "—";
    const displayName = me.companyName || me.name || orgName || "—";
    helloName.textContent = displayName;
    accPlan.textContent = String(me.plan || "—").toUpperCase();
    accOrg.textContent = orgName;
    accRole.textContent = me.role || "—";
    accTrial.textContent = me.trialEndsAt ? fmtDate(me.trialEndsAt) : "—";

    const email = me.email || "—";
    pillEmailMobile.textContent = email;

    const letter = (orgName || email || "F").trim().slice(0, 1).toUpperCase();
    avatarLetter.textContent = letter;
  }

  async function loadAudits() {
    const j = await api("/api/audits");
    const list = (j.audits || []);
    renderAudits(list);

    // KPI SEO = dernier score
    const latest = list[0];
    if (latest && typeof latest.score === "number") kpiSeo.textContent = `${latest.score}/100`;
    else kpiSeo.textContent = "—";
  }

  async function loadMonitors() {
    const j = await api("/api/monitors");
    const list = (j.monitors || []);
    renderMonitorsCompact(list);
    renderMonitorsFull(list);

    // KPI monitors / up down
    const up = list.filter(m => String(m.lastStatus).toLowerCase() === "up").length;
    const down = list.filter(m => String(m.lastStatus).toLowerCase() === "down").length;
    kpiMonitors.textContent = String(list.length);
    kpiUp.textContent = String(up);
    kpiDown.textContent = String(down);

    // Incidents = down (simple)
    kpiIncidents.textContent = String(down);
  }

  async function refreshAll() {
    try {
      $("#statusText").textContent = "Mise à jour…";
      await loadMe();
      await Promise.allSettled([loadAudits(), loadMonitors()]);
      $("#statusText").textContent = "Dashboard à jour — OK";
    } catch (e) {
      $("#statusText").textContent = "Erreur de chargement";
      console.error(e);
      alert(e.message || "Erreur");
    }
  }

  // Create monitor
  $("#btnMonCreate")?.addEventListener("click", async () => {
    monMsg.textContent = "";
    const url = String(monUrl.value || "").trim();
    const intervalMinutes = Number(monInterval.value || 60);

    if (!/^https?:\/\//i.test(url)) {
      monMsg.textContent = "URL invalide (doit commencer par http/https).";
      return;
    }
    try {
      $("#btnMonCreate").disabled = true;
      await api("/api/monitors", { method: "POST", body: JSON.stringify({ url, intervalMinutes }) });
      monUrl.value = "";
      monMsg.textContent = "✅ Monitor créé.";
      await loadMonitors();
    } catch (e) {
      monMsg.textContent = e.message || "Erreur";
    } finally {
      $("#btnMonCreate").disabled = false;
    }
  });

  // Run audit
  async function runAuditFromInput() {
    auditMsg.textContent = "";
    const url = String(auditUrl.value || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      auditMsg.textContent = "URL invalide (doit commencer par http/https).";
      return;
    }
    try {
      $("#btnAuditRun").disabled = true;
      const j = await api("/api/audits/run", { method: "POST", body: JSON.stringify({ url }) });
      auditMsg.textContent = `✅ ${j.cached ? "Cache" : "Nouveau"} — Score ${j.score}/100`;
      await loadAudits();
    } catch (e) {
      auditMsg.textContent = e.message || "Erreur";
    } finally {
      $("#btnAuditRun").disabled = false;
    }
  }

  $("#btnAuditRun")?.addEventListener("click", runAuditFromInput);

  // Init
  const days = Number(rangeSel?.value || 30);
  chartRange.textContent = `Last ${days} days`;
  renderChart(days);

  refreshAll();
})();
