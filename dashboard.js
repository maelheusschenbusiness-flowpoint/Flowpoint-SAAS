// dashboard.js — FlowPoint AI Dashboard (frontend)
// Requires backend routes from your index.js
// Token key must match login-verify.html: fp_token

(() => {
  const TOKEN_KEY = "fp_token";

  // ---------- tiny DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function toast(title, msg) {
    const t = $("#toast");
    const tt = $("#toastTitle");
    const tm = $("#toastMsg");
    if (!t || !tt || !tm) return;
    tt.textContent = title ?? "Info";
    tm.textContent = msg ?? "";
    t.classList.add("is-open");
    window.clearTimeout(window.__toastTimer);
    window.__toastTimer = window.setTimeout(() => t.classList.remove("is-open"), 4200);
  }

  function setTextSafe(sel, text) {
    const el = $(sel);
    if (el) el.textContent = text;
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "/login.html";
  }

  // ---------- Auth fetch ----------
  async function api(path, { method = "GET", body, headers } = {}) {
    const token = getToken();
    const h = {
      ...(headers || {}),
      "Content-Type": "application/json",
    };
    if (token) h.Authorization = `Bearer ${token}`;

    const r = await fetch(path, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
    });

    // If unauthorized => redirect to login
    if (r.status === 401) {
      toast("Session", "Tu n’es pas connecté. Redirection…");
      setTimeout(() => (window.location.href = "/login.html"), 400);
      return null;
    }

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = j?.error || `Erreur API (${r.status})`;
      throw new Error(err);
    }
    return j;
  }

  // ---------- Sidebar mobile ----------
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");

  function openSidebar() {
    sidebar?.classList.add("is-open");
    overlay?.classList.add("is-open");
  }
  function closeSidebar() {
    sidebar?.classList.remove("is-open");
    overlay?.classList.remove("is-open");
  }
  $("#btnMenu")?.addEventListener("click", openSidebar);
  overlay?.addEventListener("click", closeSidebar);

  function setActiveSection(name) {
    $$("#nav .nav__item").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.section === name);
    });

    $$(".section").forEach((sec) => sec.classList.remove("is-active"));
    const target = $(`#section-${name}`);
    if (target) target.classList.add("is-active");

    if (window.matchMedia("(max-width: 880px)").matches) closeSidebar();
  }

  $("#nav")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".nav__item");
    if (!btn) return;
    const name = btn.dataset.section;
    if (!name) return;
    setActiveSection(name);
  });

  // ---------- Chart ----------
  function renderChart(values) {
    const line = $("#linePath");
    const area = $("#areaPath");
    if (!line || !area || !Array.isArray(values) || values.length < 2) return;

    const w = 600,
      h = 160;
    const padTop = 12,
      padBottom = 16;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    const sx = (i) => (i / (values.length - 1)) * w;
    const sy = (v) => {
      const t = (v - min) / span; // 0..1
      return (h - padBottom) - t * (h - padTop - padBottom);
    };

    let d = "";
    values.forEach((v, i) => {
      d += (i === 0 ? "M" : " L") + sx(i).toFixed(2) + " " + sy(v).toFixed(2);
    });

    const dArea = d + ` L ${w} ${h} L 0 ${h} Z`;
    line.setAttribute("d", d);
    area.setAttribute("d", dArea);
  }

  // ---------- Render monitors ----------
  function humanDate(d) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString("fr-FR");
    } catch {
      return "—";
    }
  }

  function renderMonitors(monitors) {
    const tbody = $("#monitorsTbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    (monitors || []).forEach((m) => {
      const tr = document.createElement("tr");

      const st = String(m.lastStatus || m.status || "unknown").toLowerCase();
      const statusPill =
        st === "up"
          ? `<span class="pill pill--up">Up</span>`
          : st === "down"
          ? `<span class="pill pill--down">Down</span>`
          : `<span class="pill pill--warn">Unknown</span>`;

      const interval = `${Number(m.intervalMinutes || 60)} min`;
      const last = humanDate(m.lastCheckedAt);
      const resp = m.responseTimeMs ? `${m.responseTimeMs} ms` : "—";

      tr.innerHTML = `
        <td><span class="pill pill--soft" style="padding:6px 10px;">•</span></td>
        <td class="mono" style="max-width:260px; overflow:hidden; text-overflow:ellipsis;">${m.url || ""}</td>
        <td>${statusPill}</td>
        <td>${interval}</td>
        <td>${last}</td>
        <td>${resp}</td>
        <td class="td-actions">
          <button class="btn btn--soft btn--sm" data-act="run" data-id="${m._id}">Run</button>
          <button class="btn btn--soft btn--sm" data-act="toggle" data-id="${m._id}" data-active="${m.active}">
            ${m.active ? "Pause" : "Resume"}
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  // ---------- Load all ----------
  async function load() {
    const token = getToken();
    if (!token) {
      toast("Session", "Pas de token. Redirection vers login…");
      setTimeout(() => (window.location.href = "/login.html"), 400);
      return;
    }

    // ME
    const me = await api("/api/me");
    if (!me) return;

    const orgName = me?.org?.name || "—";
    setTextSafe("#helloTitle", `Bonjour, ${orgName}`);
    setTextSafe("#accOrg", orgName);

    const plan = String(me.plan || "standard").toUpperCase();
    setTextSafe("#accPlan", plan);
    setTextSafe("#planPill", plan);
    setTextSafe("#accRole", me.role || "—");
    setTextSafe("#accTrial", me.trialEndsAt ? humanDate(me.trialEndsAt) : "—");

    // simple KPI from last audits (approx)
    let auditsScore = 0;
    let auditsCount = 0;

    // MONITORS
    const mon = await api("/api/monitors");
    const monitors = mon?.monitors || [];
    renderMonitors(monitors);

    // AUDITS
    const auditsRes = await api("/api/audits");
    const audits = auditsRes?.audits || [];
    audits.slice(0, 10).forEach((a) => {
      if (typeof a.score === "number") {
        auditsScore += a.score;
        auditsCount += 1;
      }
    });

    const avg = auditsCount ? Math.round(auditsScore / auditsCount) : "—";
    setTextSafe("#seoScore", String(avg));

    // chart demo based on audits (fallback)
    const chart = audits.slice(0, 12).reverse().map((a) => (typeof a.score === "number" ? a.score : 50));
    renderChart(chart.length >= 2 ? chart : [40, 55, 52, 60, 58, 66, 70]);

    // “Local Visibility” placeholder (you can wire later)
    setTextSafe("#localVis", "+—%");

    // health chip
    setTextSafe("#healthText", "Dashboard à jour — OK");
  }

  // ---------- Actions ----------
  $("#toastClose")?.addEventListener("click", () => $("#toast")?.classList.remove("is-open"));

  $("#btnLogout")?.addEventListener("click", logout);

  $("#btnRefresh")?.addEventListener("click", async () => {
    toast("Refresh", "Mise à jour…");
    try {
      await load();
      toast("OK", "Données mises à jour.");
    } catch (e) {
      toast("Erreur", e.message || "Impossible de charger.");
    }
  });

  $("#btnExportAudits")?.addEventListener("click", () => {
    // IMPORTANT: ton backend = /api/export/audits.csv (pas /api/exports)
    const token = getToken();
    if (!token) return logout();
    // download via fetch+blob to include auth
    downloadWithAuth("/api/export/audits.csv", "flowpoint-audits.csv");
  });

  $("#btnExportMonitors")?.addEventListener("click", () => {
    const token = getToken();
    if (!token) return logout();
    downloadWithAuth("/api/export/monitors.csv", "flowpoint-monitors.csv");
  });

  async function downloadWithAuth(url, filename) {
    try {
      const token = getToken();
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401) return logout();
      if (!r.ok) throw new Error(`Export impossible (${r.status})`);

      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      toast("Export", e.message || "Erreur export.");
    }
  }

  // Run audit (real)
  $("#btnRunAudit")?.addEventListener("click", async () => {
    const url = prompt("URL à auditer (https://...)");
    if (!url) return;
    try {
      toast("Audit", "Lancement…");
      const res = await api("/api/audits/run", { method: "POST", body: { url } });
      toast("Audit", res?.cached ? `Cache: ${res.summary}` : `OK: ${res.summary}`);
      await load();
    } catch (e) {
      toast("Audit", e.message || "Erreur audit");
    }
  });

  // Add monitor (real)
  $("#btnAddMonitor")?.addEventListener("click", async () => {
    const url = prompt("URL à monitor (https://...)");
    if (!url) return;
    const intervalMinutes = Number(prompt("Interval minutes (min 5)", "60") || 60);
    try {
      toast("Monitor", "Création…");
      await api("/api/monitors", { method: "POST", body: { url, intervalMinutes } });
      toast("Monitor", "✅ Ajouté.");
      await load();
    } catch (e) {
      toast("Monitor", e.message || "Erreur monitor");
    }
  });

  // table actions (run / toggle)
  $("#monitorsTbody")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;

    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (!id) return;

    if (act === "run") {
      try {
        toast("Monitor", "Check…");
        const res = await api(`/api/monitors/${encodeURIComponent(id)}/run`, { method: "POST" });
        toast("Monitor", `Status: ${res?.result?.status || "?"}`);
        await load();
      } catch (err) {
        toast("Monitor", err.message || "Erreur run");
      }
    }

    if (act === "toggle") {
      const cur = btn.dataset.active === "true";
      try {
        toast("Monitor", cur ? "Pause…" : "Resume…");
        await api(`/api/monitors/${encodeURIComponent(id)}`, { method: "PATCH", body: { active: !cur } });
        toast("Monitor", "✅ OK");
        await load();
      } catch (err) {
        toast("Monitor", err.message || "Erreur toggle");
      }
    }
  });

  // Stripe portal (real)
  $("#btnPortal")?.addEventListener("click", async () => {
    try {
      const r = await api("/api/stripe/portal", { method: "POST" });
      if (r?.url) window.location.href = r.url;
      else toast("Billing", "URL Stripe portal manquante.");
    } catch (e) {
      toast("Billing", e.message || "Erreur portal");
    }
  });

  // CTA plans -> checkout Pro (example)
  $("#btnUpgrade")?.addEventListener("click", async () => {
    try {
      const r = await api("/api/stripe/checkout", { method: "POST", body: { plan: "pro" } });
      if (r?.url) window.location.href = r.url;
      else toast("Stripe", "URL checkout manquante.");
    } catch (e) {
      toast("Stripe", e.message || "Erreur checkout");
    }
  });

  $("#btnManage")?.addEventListener("click", async () => {
    // manage => portal
    $("#btnPortal")?.click();
  });

  // Period toggle (UI only)
  $("#periodBtn")?.addEventListener("click", () => {
    const label = $("#periodLabel");
    const range = $("#rangeLabel");
    const perf = $("#perfRange");
    if (!label || !range || !perf) return;

    const cur = label.textContent.trim();
    if (cur === "Last 30 days") {
      label.textContent = "Last 7 days";
      range.textContent = "LAST 7 DAYS";
      perf.textContent = "7 days";
    } else {
      label.textContent = "Last 30 days";
      range.textContent = "LAST 30 DAYS";
      perf.textContent = "30 days";
    }
  });

  // init
  window.addEventListener("DOMContentLoaded", async () => {
    setActiveSection("overview");
    try {
      await load();
    } catch (e) {
      toast("Erreur", e.message || "Impossible de charger.");
    }
  });
})();
