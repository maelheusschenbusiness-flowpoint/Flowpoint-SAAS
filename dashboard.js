/* dashboard.js — FlowPoint UI (modern like your screenshot)
   - Uses localStorage fp_token
   - Hash router (#overview, #audits, #monitors...)
   - Loads /api/me, /api/monitors, /api/audits (if available)
*/

(() => {
  const TOKEN_KEY = "fp_token";

  // ---------- Helpers ----------
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));

  function toast(title, msg) {
    const t = qs("#toast");
    qs("#toastTitle").textContent = title;
    qs("#toastMsg").textContent = msg || "";
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2800);
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }

  function safeUrl(u) {
    try {
      const x = new URL(u);
      return x.toString();
    } catch {
      return u || "";
    }
  }

  async function api(path, opts = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {},
      token ? { "Authorization": `Bearer ${token}` } : {}
    );

    const r = await fetch(path, { ...opts, headers });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

    if (!r.ok) {
      const err = (json && (json.error || json.message)) || `HTTP ${r.status}`;
      throw new Error(err);
    }
    return json;
  }

  function requireAuth() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      location.replace("/login.html");
      return false;
    }
    return true;
  }

  // ---------- Router ----------
  const routes = ["overview","audits","monitors","localseo","competitors","reports","billing","settings"];

  function setActiveRoute(route) {
    // nav
    qsa("#nav a").forEach(a => a.classList.toggle("active", a.dataset.route === route));

    // sections
    routes.forEach(r => {
      const sec = qs(`#sec-${r}`);
      if (sec) sec.classList.toggle("active", r === route);
    });

    // right overview panel only visible on overview
    const right = qs("#sec-right-overview");
    if (right) right.classList.toggle("active", route === "overview");
  }

  function getRouteFromHash() {
    const h = (location.hash || "#overview").replace("#","");
    return routes.includes(h) ? h : "overview";
  }

  window.addEventListener("hashchange", () => setActiveRoute(getRouteFromHash()));

  // ---------- Charts ----------
  function drawLineChart(canvas, points) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    // clear
    ctx.clearRect(0,0,w,h);

    // background grid
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(148,163,184,.35)";
    for (let i=1;i<=4;i++){
      const y = Math.round((h/5)*i);
      ctx.beginPath();
      ctx.moveTo(0,y);
      ctx.lineTo(w,y);
      ctx.stroke();
    }

    if (!points || points.length < 2) {
      // text
      ctx.fillStyle = "rgba(100,116,139,.9)";
      ctx.font = "700 16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("No data yet", 18, 42);
      return;
    }

    const min = Math.min(...points);
    const max = Math.max(...points);
    const pad = 20;

    const xStep = (w - pad*2) / (points.length - 1);
    const norm = (v) => {
      if (max === min) return h/2;
      const t = (v - min) / (max - min);
      return (h - pad) - t * (h - pad*2);
    };

    // area
    ctx.beginPath();
    ctx.moveTo(pad, norm(points[0]));
    for (let i=1;i<points.length;i++){
      ctx.lineTo(pad + xStep*i, norm(points[i]));
    }
    ctx.lineTo(pad + xStep*(points.length-1), h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = "rgba(37,99,235,.10)";
    ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(pad, norm(points[0]));
    for (let i=1;i<points.length;i++){
      ctx.lineTo(pad + xStep*i, norm(points[i]));
    }
    ctx.strokeStyle = "rgba(37,99,235,.95)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // points
    ctx.fillStyle = "#2563eb";
    for (let i=0;i<points.length;i++){
      const x = pad + xStep*i;
      const y = norm(points[i]);
      ctx.beginPath();
      ctx.arc(x,y,3.5,0,Math.PI*2);
      ctx.fill();
    }
  }

  // ---------- UI fill ----------
  function setStatus(ok, text) {
    const b = qs("#statusBadge");
    if (!b) return;
    b.textContent = (ok ? "● Dashboard à jour" : "● Problème réseau") + (text ? ` — ${text}` : "");
    b.style.color = ok ? "rgba(22,163,74,.95)" : "rgba(239,68,68,.95)";
  }

  function fillUser(me) {
    const company = me?.company || me?.orgName || me?.org?.name || me?.name || "—";
    qs("#helloTitle").textContent = `Bonjour, ${company}`;
    qs("#sideOrg").textContent = me?.orgName || me?.org?.name || company || "—";
    qs("#sideRole").textContent = me?.role || me?.orgRole || "—";
    qs("#sidePlan").textContent = (me?.plan || me?.subscription?.plan || "—").toUpperCase?.() || (me?.plan || "—");
    qs("#sideTrial").textContent = me?.trial ? "active" : (me?.trialing ? "trialing" : "—");
  }

  function calcOverview(monitors, audits) {
    const total = monitors?.length || 0;
    const up = (monitors || []).filter(m => (m.status || "").toLowerCase() === "up").length;
    const down = (monitors || []).filter(m => (m.status || "").toLowerCase() === "down").length;

    qs("#kpiMonitors").textContent = String(total);
    qs("#kpiUp").textContent = String(up);
    qs("#kpiDown").textContent = String(down);

    // SEO score: take last audit score if exists
    let seoScore = "—";
    let incidents = 0;

    if (Array.isArray(audits) && audits.length) {
      const last = audits[0];
      const s = last.score ?? last.seoScore ?? last.totalScore;
      if (typeof s === "number") seoScore = `${Math.round(s)}/100`;
      else if (typeof s === "string") seoScore = s;
      incidents = audits.filter(a => a.status === "failed" || a.error).length;
    }

    qs("#kpiSeo").textContent = seoScore;
    qs("#kpiIncidents").textContent = String(incidents);
    qs("#kpiLocal").textContent = "+12%"; // placeholder (branch later to GBP/local signals)
  }

  function fillMonitorsTable(tbodyId, monitors) {
    const tb = qs(tbodyId);
    if (!tb) return;

    if (!monitors || !monitors.length) {
      tb.innerHTML = `<tr><td colspan="6" style="color:var(--muted);font-weight:700;padding:14px">No monitors yet.</td></tr>`;
      return;
    }

    const rows = monitors.slice(0, 8).map(m => {
      const url = m.url || m.target || m.website || "";
      const status = (m.status || "unknown").toLowerCase();
      const dotClass = status === "up" ? "up" : status === "down" ? "down" : "warn";
      const interval = m.interval || m.intervalMin || m.everyMin || m.period || "—";
      const last = m.lastChecked || m.last_run || m.updatedAt || m.checkedAt || null;
      const resp = m.responseTime ?? m.ms ?? m.latency ?? "—";

      return `
        <tr>
          <td style="font-weight:800">${escapeHtml(url)}</td>
          <td><span class="status"><span class="dot ${dotClass}"></span>${cap(status)}</span></td>
          <td style="color:var(--muted);font-weight:700">${escapeHtml(String(interval))}</td>
          <td style="color:var(--muted);font-weight:700">${escapeHtml(fmtDate(last))}</td>
          <td style="color:var(--muted);font-weight:800">${escapeHtml(String(resp))}</td>
        </tr>
      `;
    }).join("");

    // for monitors page we need actions
    if (tbodyId === "#monitorsTable2") {
      tb.innerHTML = (monitors || []).slice(0, 20).map(m => {
        const id = m._id || m.id || m.monitorId;
        const url = m.url || m.target || m.website || "";
        const status = (m.status || "unknown").toLowerCase();
        const dotClass = status === "up" ? "up" : status === "down" ? "down" : "warn";
        const interval = m.interval || m.intervalMin || m.everyMin || m.period || "—";
        const last = m.lastChecked || m.last_run || m.updatedAt || m.checkedAt || null;
        const resp = m.responseTime ?? m.ms ?? m.latency ?? "—";

        return `
          <tr>
            <td style="font-weight:800">${escapeHtml(url)}</td>
            <td><span class="status"><span class="dot ${dotClass}"></span>${cap(status)}</span></td>
            <td style="color:var(--muted);font-weight:700">${escapeHtml(String(interval))}</td>
            <td style="color:var(--muted);font-weight:700">${escapeHtml(fmtDate(last))}</td>
            <td style="color:var(--muted);font-weight:800">${escapeHtml(String(resp))}</td>
            <td>
              <button class="btn" data-act="run" data-id="${escapeHtml(String(id||""))}">Run</button>
              <button class="btn" data-act="pause" data-id="${escapeHtml(String(id||""))}">Pause</button>
              <button class="btn danger" data-act="delete" data-id="${escapeHtml(String(id||""))}">Delete</button>
            </td>
          </tr>
        `;
      }).join("");

      // bind action buttons
      tb.querySelectorAll("button[data-act]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const act = btn.dataset.act;
          const id = btn.dataset.id;
          try {
            if (!id) throw new Error("Missing monitor id");

            if (act === "run") {
              // try common endpoints
              await tryMany([
                () => api(`/api/monitors/${id}/run`, { method:"POST" }),
                () => api(`/api/monitors/${id}/check`, { method:"POST" }),
              ]);
              toast("Monitor", "Check launched");
            } else if (act === "pause") {
              await tryMany([
                () => api(`/api/monitors/${id}`, { method:"PATCH", body: JSON.stringify({ paused:true }) }),
                () => api(`/api/monitors/${id}/pause`, { method:"POST" }),
              ]);
              toast("Monitor", "Paused");
            } else if (act === "delete") {
              await tryMany([
                () => api(`/api/monitors/${id}`, { method:"DELETE" }),
                () => api(`/api/monitors/${id}/remove`, { method:"POST" }),
              ]);
              toast("Monitor", "Deleted");
            }
            await loadAll();
          } catch (e) {
            toast("Error", e.message || "Action failed");
          }
        });
      });

      return;
    }

    tb.innerHTML = rows;
  }

  function fillAuditsTable(audits) {
    const tb = qs("#auditsTable");
    if (!tb) return;
    if (!audits || !audits.length) {
      tb.innerHTML = `<tr><td colspan="5" style="color:var(--muted);font-weight:700;padding:14px">No audits yet.</td></tr>`;
      return;
    }

    tb.innerHTML = audits.slice(0, 30).map(a => {
      const url = a.url || a.target || a.website || "—";
      const score = a.score ?? a.seoScore ?? a.totalScore ?? "—";
      const when = a.createdAt || a.created_at || a.ts || a.date || null;
      const st = (a.status || (a.error ? "failed" : "done")).toLowerCase();
      const dotClass = st.includes("fail") ? "down" : st.includes("run") ? "warn" : "up";
      const id = a._id || a.id || a.auditId || "";

      return `
        <tr>
          <td style="font-weight:800">${escapeHtml(url)}</td>
          <td style="font-weight:900">${escapeHtml(String(score))}</td>
          <td style="color:var(--muted);font-weight:700">${escapeHtml(fmtDate(when))}</td>
          <td><span class="status"><span class="dot ${dotClass}"></span>${cap(st)}</span></td>
          <td>
            <button class="btn" data-a="view" data-id="${escapeHtml(String(id))}">View</button>
            <button class="btn" data-a="pdf" data-id="${escapeHtml(String(id))}">PDF</button>
          </td>
        </tr>
      `;
    }).join("");

    tb.querySelectorAll("button[data-a]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const a = btn.dataset.a;
        const id = btn.dataset.id;
        try {
          if (!id) throw new Error("Missing audit id");
          if (a === "pdf") {
            // try common endpoints (open new tab)
            const url = `/api/audits/${encodeURIComponent(id)}/pdf`;
            window.open(url, "_blank");
          } else if (a === "view") {
            // could be /api/audits/:id
            const data = await tryMany([
              () => api(`/api/audits/${id}`, { method:"GET" }),
              () => api(`/api/audits/${id}/detail`, { method:"GET" }),
            ]);
            toast("Audit", `Loaded: ${data?.url || "details"}`);
          }
        } catch (e) {
          toast("Error", e.message || "Failed");
        }
      });
    });
  }

  function fillIncidents(monitors) {
    const tb = qs("#incidentsTable");
    if (!tb) return;

    // Build pseudo-incidents from DOWN monitors
    const downs = (monitors || []).filter(m => (m.status || "").toLowerCase() === "down");
    if (!downs.length) {
      tb.innerHTML = `<tr><td colspan="4" style="color:var(--muted);font-weight:700;padding:14px">No incidents yet.</td></tr>`;
      return;
    }

    tb.innerHTML = downs.slice(0, 8).map(m => {
      const url = m.url || m.target || "—";
      const when = m.lastChecked || m.updatedAt || null;
      return `
        <tr>
          <td style="font-weight:800">${escapeHtml(url)}</td>
          <td><span class="status"><span class="dot down"></span>Down</span></td>
          <td style="color:var(--muted);font-weight:700">${escapeHtml(fmtDate(when))}</td>
          <td><button class="btn" data-open="${escapeHtml(url)}">View</button></td>
        </tr>
      `;
    }).join("");

    tb.querySelectorAll("button[data-open]").forEach(btn => {
      btn.addEventListener("click", () => {
        const u = btn.dataset.open;
        if (u) window.open(safeUrl(u), "_blank");
      });
    });
  }

  function genFakeSeries(days) {
    const n = Math.max(7, Math.min(90, Number(days) || 30));
    const arr = [];
    let v = 60 + Math.random()*10;
    for (let i=0;i<n;i++){
      v += (Math.random()-0.5)*6;
      v = Math.max(30, Math.min(95, v));
      arr.push(Math.round(v));
    }
    return arr;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function cap(s){
    if (!s) return "—";
    return String(s).charAt(0).toUpperCase() + String(s).slice(1);
  }

  async function tryMany(fns) {
    let lastErr = null;
    for (const fn of fns) {
      try { return await fn(); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("All endpoints failed");
  }

  // ---------- Modal Add Monitor ----------
  function openModal() { qs("#modalAdd").classList.add("show"); }
  function closeModal() { qs("#modalAdd").classList.remove("show"); }

  async function createMonitor() {
    const url = qs("#mUrl").value.trim();
    const interval = Number(qs("#mInterval").value || 60);
    const type = qs("#mType").value || "http";

    if (!url) { toast("Error", "URL is required"); return; }

    try {
      // try multiple payload formats (because backends differ)
      await tryMany([
        () => api("/api/monitors", {
          method: "POST",
          body: JSON.stringify({ url, interval, type })
        }),
        () => api("/api/monitors", {
          method: "POST",
          body: JSON.stringify({ target: url, intervalMin: interval, kind: type })
        }),
        () => api("/api/monitor", {
          method: "POST",
          body: JSON.stringify({ url, interval, type })
        }),
      ]);

      toast("Monitor", "Created successfully");
      closeModal();
      qs("#mUrl").value = "";
      await loadAll();
    } catch (e) {
      toast("Error", e.message || "Cannot create monitor");
    }
  }

  // ---------- Actions ----------
  function bindUI() {
    // modal buttons
    qs("#btnAddMonitor")?.addEventListener("click", openModal);
    qs("#btnAddMonitor2")?.addEventListener("click", openModal);
    qs("#modalClose")?.addEventListener("click", closeModal);
    qs("#modalCancel")?.addEventListener("click", closeModal);
    qs("#modalAdd")?.addEventListener("click", (e) => { if (e.target.id === "modalAdd") closeModal(); });
    qs("#modalCreate")?.addEventListener("click", createMonitor);

    // refresh
    qs("#btnRefresh")?.addEventListener("click", async () => {
      await loadAll();
      toast("Refresh", "Dashboard updated");
    });

    // export
    qs("#btnExportAudits")?.addEventListener("click", () => {
      window.open("/api/audits/export.csv", "_blank");
      toast("Export", "Audits CSV opened");
    });
    qs("#btnExportMonitors")?.addEventListener("click", () => {
      window.open("/api/monitors/export.csv", "_blank");
      toast("Export", "Monitors CSV opened");
    });

    // audits page actions
    qs("#btnAuditsReload")?.addEventListener("click", loadAll);
    qs("#btnAuditsRun")?.addEventListener("click", runAudit);
    qs("#btnRunAudit")?.addEventListener("click", runAudit);

    // monitors reload
    qs("#btnMonitorsReload")?.addEventListener("click", loadAll);

    // view incidents -> go monitors
    qs("#btnViewAllIncidents")?.addEventListener("click", () => location.hash = "#monitors");

    // range change
    qs("#range")?.addEventListener("change", () => {
      const days = qs("#range").value;
      qs("#kpiDays1").textContent = days;
      qs("#kpiDays2").textContent = days;
      qs("#chartDays").textContent = days;
      // redraw chart (fake or from data)
      drawLineChart(qs("#seoChart"), genFakeSeries(days));
    });

    // billing / portal
    qs("#btnPortal")?.addEventListener("click", openPortal);
    qs("#btnOpenPortal2")?.addEventListener("click", openPortal);

    // logout
    qs("#btnLogout")?.addEventListener("click", () => {
      localStorage.removeItem(TOKEN_KEY);
      location.replace("/login.html");
    });

    // plans buttons
    qsa("[data-plan]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const plan = btn.dataset.plan;
        try {
          // try portal/checkout endpoints if exist
          const out = await tryMany([
            () => api(`/api/billing/checkout`, { method:"POST", body: JSON.stringify({ plan }) }),
            () => api(`/api/stripe/checkout`, { method:"POST", body: JSON.stringify({ plan }) }),
            () => api(`/api/billing/portal`, { method:"POST" }),
          ]);

          // redirect if url
          if (out?.url) location.href = out.url;
          else toast("Billing", "No redirect url returned");
        } catch (e) {
          toast("Billing", e.message || "Not configured");
        }
      });
    });

    // settings save (optional)
    qs("#btnSaveSettings")?.addEventListener("click", async () => {
      const email = qs("#setEmail").value.trim();
      const interval = Number(qs("#setInterval").value || 60);
      try {
        await tryMany([
          () => api("/api/org/settings", { method:"POST", body: JSON.stringify({ alertEmail: email, defaultInterval: interval }) }),
          () => api("/api/org/monitor-settings", { method:"POST", body: JSON.stringify({ alertEmail: email, defaultInterval: interval }) }),
          () => api("/api/org/monitor-settings", { method:"PATCH", body: JSON.stringify({ alertEmail: email, defaultInterval: interval }) }),
        ]);
        toast("Settings", "Saved");
      } catch (e) {
        toast("Settings", e.message || "Backend not configured");
      }
    });

    // local scan placeholder
    qs("#btnLocalScan")?.addEventListener("click", () => toast("Local SEO", "Scan feature: connect GBP later"));
    qs("#btnAddCompetitor")?.addEventListener("click", () => toast("Competitors", "Feature: add competitor later"));
    qs("#btnGenReport")?.addEventListener("click", () => toast("Reports", "Feature: monthly report (Ultra)"));
  }

  async function openPortal() {
    try {
      const out = await tryMany([
        () => api("/api/billing/portal", { method:"POST" }),
        () => api("/api/stripe/portal", { method:"POST" }),
      ]);
      if (out?.url) location.href = out.url;
      else toast("Billing", "Portal not configured");
    } catch (e) {
      toast("Billing", e.message || "Portal not configured");
    }
  }

  async function runAudit() {
    try {
      // try different endpoints
      await tryMany([
        () => api("/api/audits/run", { method:"POST", body: JSON.stringify({}) }),
        () => api("/api/audits", { method:"POST", body: JSON.stringify({ action:"run" }) }),
      ]);
      toast("Audit", "Audit launched");
      await loadAll();
    } catch (e) {
      toast("Audit", e.message || "Cannot run audit");
    }
  }

  // ---------- Loaders ----------
  async function loadMe() {
    // common endpoints
    return await tryMany([
      () => api("/api/me", { method:"GET" }),
      () => api("/api/user", { method:"GET" }),
      () => api("/api/auth/me", { method:"GET" }),
    ]);
  }

  async function loadMonitors() {
    return await tryMany([
      () => api("/api/monitors", { method:"GET" }),
      () => api("/api/monitor", { method:"GET" }),
    ]);
  }

  async function loadAudits() {
    return await tryMany([
      () => api("/api/audits", { method:"GET" }),
      () => api("/api/audit", { method:"GET" }),
    ]);
  }

  async function loadAll() {
    if (!requireAuth()) return;

    setStatus(true, "Loading…");

    const range = Number(qs("#range")?.value || 30);
    qs("#kpiDays1").textContent = String(range);
    qs("#kpiDays2").textContent = String(range);
    qs("#chartDays").textContent = String(range);

    let me = null;
    let monitors = [];
    let audits = [];

    try {
      // parallel but safe
      const [a,b,c] = await Promise.allSettled([loadMe(), loadMonitors(), loadAudits()]);
      if (a.status === "fulfilled") me = a.value;
      if (b.status === "fulfilled") monitors = normalizeArray(b.value);
      if (c.status === "fulfilled") audits = normalizeArray(c.value);

      if (me) fillUser(me);

      // fill tables/cards
      fillMonitorsTable("#monitorsTable", monitors);
      fillMonitorsTable("#monitorsTable2", monitors);
      fillAuditsTable(audits);
      fillIncidents(monitors);
      calcOverview(monitors, audits);

      // chart: if you have seo series from backend, map it here
      drawLineChart(qs("#seoChart"), genFakeSeries(range));

      // status
      setStatus(true, "OK");
    } catch (e) {
      setStatus(false, e.message || "Error");
      // show fallback
      fillMonitorsTable("#monitorsTable", monitors);
      fillMonitorsTable("#monitorsTable2", monitors);
      fillAuditsTable(audits);
      fillIncidents(monitors);
      drawLineChart(qs("#seoChart"), genFakeSeries(range));
    }
  }

  function normalizeArray(x) {
    // Some APIs return { items: [] } or { data: [] }
    if (Array.isArray(x)) return x;
    if (Array.isArray(x?.items)) return x.items;
    if (Array.isArray(x?.data)) return x.data;
    if (Array.isArray(x?.results)) return x.results;
    return [];
  }

  // ---------- Boot ----------
  function boot() {
    if (!requireAuth()) return;

    // route init
    setActiveRoute(getRouteFromHash());

    // bind
    bindUI();

    // initial chart
    drawLineChart(qs("#seoChart"), genFakeSeries(Number(qs("#range")?.value || 30)));

    // load
    loadAll();
  }

  boot();
})();
