// dashboard.js — FlowPoint AI Dashboard (frontend)
(() => {
  console.log("✅ dashboard.js chargé");

  const TOKEN_KEY = "fp_token";

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
    if (el) el.textContent = text ?? "";
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    location.replace("/login.html");
  }

  function humanDate(d) {
    if (!d) return "—";
    try { return new Date(d).toLocaleString("fr-FR"); } catch { return "—"; }
  }

  async function api(path, { method = "GET", body } = {}) {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    console.log("➡️ API", method, path);

    const r = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // IMPORTANT : si 401 => token absent / invalide
    if (r.status === 401) {
      console.log("⛔ 401 sur", path);
      toast("Session", "Non connecté. Retour login…");
      setTimeout(() => logout(), 400);
      return null;
    }

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = j?.error || `Erreur API (${r.status})`;
      throw new Error(err);
    }
    return j;
  }

  // Sidebar mobile
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  function openSidebar() { sidebar?.classList.add("is-open"); overlay?.classList.add("is-open"); }
  function closeSidebar() { sidebar?.classList.remove("is-open"); overlay?.classList.remove("is-open"); }
  $("#btnMenu")?.addEventListener("click", openSidebar);
  overlay?.addEventListener("click", closeSidebar);

  function setActiveSection(name) {
    $$("#nav .nav__item").forEach(btn => btn.classList.toggle("is-active", btn.dataset.section === name));
    $$(".section").forEach(sec => sec.classList.remove("is-active"));
    $(`#section-${name}`)?.classList.add("is-active");
    if (window.matchMedia("(max-width: 880px)").matches) closeSidebar();
  }

  $("#nav")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".nav__item");
    if (!btn) return;
    setActiveSection(btn.dataset.section);
  });

  // Chart simple
  function renderChart(values) {
    const line = $("#linePath");
    const area = $("#areaPath");
    if (!line || !area || !Array.isArray(values) || values.length < 2) return;

    const w = 600, h = 160, padTop = 12, padBottom = 16;
    const min = Math.min(...values), max = Math.max(...values);
    const span = (max - min) || 1;

    const sx = (i) => (i / (values.length - 1)) * w;
    const sy = (v) => (h - padBottom) - ((v - min) / span) * (h - padTop - padBottom);

    let d = "";
    values.forEach((v, i) => {
      d += (i === 0 ? "M" : " L") + sx(i).toFixed(2) + " " + sy(v).toFixed(2);
    });
    const dArea = d + ` L ${w} ${h} L 0 ${h} Z`;

    line.setAttribute("d", d);
    area.setAttribute("d", dArea);
  }

  function renderMonitors(monitors) {
    const tbody = $("#monitorsTbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    (monitors || []).forEach((m) => {
      const tr = document.createElement("tr");

      const st = String(m.lastStatus || "unknown").toLowerCase();
      const statusPill =
        st === "up"
          ? `<span class="pill pill--up">Up</span>`
          : st === "down"
          ? `<span class="pill pill--down">Down</span>`
          : `<span class="pill pill--warn">Unknown</span>`;

      tr.innerHTML = `
        <td><span class="pill pill--soft" style="padding:6px 10px;">•</span></td>
        <td class="mono" style="max-width:260px; overflow:hidden; text-overflow:ellipsis;">${m.url || ""}</td>
        <td>${statusPill}</td>
        <td>${Number(m.intervalMinutes || 60)} min</td>
        <td>${m.lastCheckedAt ? humanDate(m.lastCheckedAt) : "—"}</td>
        <td>—</td>
        <td class="td-actions">
          <button class="btn btn--soft btn--sm" data-act="run" data-id="${m._id}">Run</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function loadAll() {
    const token = getToken();
    if (!token) {
      console.log("⛔ Pas de token => login");
      toast("Session", "Pas de token. Retour login…");
      setTimeout(() => logout(), 300);
      return;
    }

    // ✅ ICI: tu dois voir /api/me dans Network
    const me = await api("/api/me");
    if (!me) return;

    const orgName = me?.org?.name || me.companyName || "—";
    const plan = String(me.plan || "standard").toUpperCase();

    setTextSafe("#helloTitle", `Bonjour, ${orgName}`);
    setTextSafe("#accOrg", orgName);
    setTextSafe("#accPlan", plan);
    setTextSafe("#planPill", plan);
    setTextSafe("#accRole", me.role || "—");
    setTextSafe("#accTrial", me.trialEndsAt ? humanDate(me.trialEndsAt) : "—");

    // Overview (optionnel)
    try {
      const ov = await api("/api/overview?days=30");
      if (ov?.ok) {
        setTextSafe("#seoScore", String(ov.seoScore ?? "—"));
        setTextSafe("#localVis", String(ov.localVis ?? "—"));
        renderChart(Array.isArray(ov.chart) && ov.chart.length >= 2 ? ov.chart : [40, 55, 52, 60, 58, 66, 70]);
      }
    } catch (e) {
      console.log("overview err:", e.message);
    }

    // Monitors
    const mon = await api("/api/monitors");
    if (mon?.ok) renderMonitors(mon.monitors || []);

    setTextSafe("#healthText", "Dashboard à jour — OK");
  }

  // Actions
  $("#toastClose")?.addEventListener("click", () => $("#toast")?.classList.remove("is-open"));
  $("#btnLogout")?.addEventListener("click", logout);

  $("#btnRefresh")?.addEventListener("click", async () => {
    toast("Refresh", "Mise à jour…");
    try { await loadAll(); toast("OK", "Données mises à jour."); }
    catch (e) { toast("Erreur", e.message || "Impossible de charger."); }
  });

  $("#btnPortal")?.addEventListener("click", async () => {
    try {
      const r = await api("/api/stripe/portal", { method: "POST" });
      if (r?.url) location.href = r.url;
      else toast("Billing", "URL Stripe portal manquante.");
    } catch (e) {
      toast("Billing", e.message || "Erreur portal");
    }
  });

  $("#btnExportAudits")?.addEventListener("click", async () => {
    try {
      const token = getToken();
      const r = await fetch("/api/export/audits.csv", { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401) return logout();
      if (!r.ok) throw new Error(`Export impossible (${r.status})`);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "flowpoint-audits.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch (e) {
      toast("Export", e.message || "Erreur export");
    }
  });

  $("#btnExportMonitors")?.addEventListener("click", async () => {
    try {
      const token = getToken();
      const r = await fetch("/api/export/monitors.csv", { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401) return logout();
      if (!r.ok) throw new Error(`Export impossible (${r.status})`);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "flowpoint-monitors.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch (e) {
      toast("Export", e.message || "Erreur export");
    }
  });

  $("#monitorsTbody")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act='run']");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;

    try {
      toast("Monitor", "Check…");
      const r = await api(`/api/monitors/${encodeURIComponent(id)}/run`, { method: "POST" });
      toast("Monitor", `Status: ${r?.result?.status || "?"}`);
      await loadAll();
    } catch (err) {
      toast("Monitor", err.message || "Erreur run");
    }
  });

  $("#periodBtn")?.addEventListener("click", () => {
    const label = $("#periodLabel"), range = $("#rangeLabel"), perf = $("#perfRange");
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

  window.addEventListener("DOMContentLoaded", async () => {
    setActiveSection("overview");
    try {
      await loadAll();
    } catch (e) {
      toast("Erreur", e.message || "Impossible de charger.");
    }
  });
})();
