/* Flowpoint dashboard.js
   - SPA navigation (no weird scroll to bottom)
   - Responsive sidebar (mobile)
   - Calls your existing API:
     GET  /api/me
     GET  /api/audits
     POST /api/audits/run
     GET  /api/monitors
     POST /api/monitors
     POST /api/monitors/:id/run
     PATCH /api/monitors/:id
     GET  /api/export/*.csv
     POST /api/stripe/portal
*/

(() => {
  const TOKEN_KEY = "fp_token";

  const qs = (s) => document.querySelector(s);
  const qsa = (s) => [...document.querySelectorAll(s)];
  const token = () => localStorage.getItem(TOKEN_KEY);

  function setMsg(el, text, type = "") {
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("ok", "err");
    if (type) el.classList.add(type);
  }

  function authHeaders() {
    const t = token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function api(path, opts = {}) {
    const r = await fetch(path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        ...authHeaders(),
        "Content-Type": opts.body ? "application/json" : (opts.headers && opts.headers["Content-Type"]) || undefined,
      },
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return j;
  }

  // ----- SPA NAV -----
  const views = ["overview","audits","monitors","localseo","competitors","reports","billing","settings"];

  function showView(name) {
    if (!views.includes(name)) name = "overview";

    qsa(".view").forEach(v => v.classList.remove("active"));
    const v = qs(`#view-${name}`);
    if (v) v.classList.add("active");

    qsa(".navItem").forEach(b => b.classList.toggle("active", b.dataset.view === name));

    // update hash without scrolling
    history.replaceState({}, "", `/dashboard.html#${name}`);

    // close mobile nav
    closeNav();
  }

  function getHashView() {
    const h = (location.hash || "").replace("#", "").trim();
    return views.includes(h) ? h : "overview";
  }

  // ----- Mobile nav -----
  const sidebar = qs("#sidebar");
  const overlay = qs("#navOverlay");
  function openNav(){
    sidebar?.classList.add("open");
    overlay?.classList.add("show");
  }
  function closeNav(){
    sidebar?.classList.remove("open");
    overlay?.classList.remove("show");
  }
  qs("#btnOpenNav")?.addEventListener("click", openNav);
  qs("#btnCloseNav")?.addEventListener("click", closeNav);
  overlay?.addEventListener("click", closeNav);

  qsa(".navItem").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  window.addEventListener("hashchange", () => showView(getHashView()));

  // ----- Chart (no external lib) -----
  function drawLineChart(canvas, points) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;

    ctx.clearRect(0,0,w,h);

    // frame
    const pad = 18 * devicePixelRatio;
    const innerW = w - pad*2;
    const innerH = h - pad*2;

    // grid lines
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1 * devicePixelRatio;
    ctx.strokeStyle = "rgba(15,23,42,.10)";
    for (let i=0;i<4;i++){
      const y = pad + (innerH/3)*i;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad+innerW, y);
      ctx.stroke();
    }

    if (!points || points.length < 2) return;

    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = Math.max(1, max - min);

    const toXY = (i, v) => {
      const x = pad + (innerW/(points.length-1))*i;
      const y = pad + innerH - ((v - min)/range)*innerH;
      return [x,y];
    };

    // area
    ctx.fillStyle = "rgba(37,99,235,.10)";
    ctx.beginPath();
    let [x0,y0] = toXY(0, points[0]);
    ctx.moveTo(x0, y0);
    for (let i=1;i<points.length;i++){
      const [x,y] = toXY(i, points[i]);
      ctx.lineTo(x,y);
    }
    ctx.lineTo(pad+innerW, pad+innerH);
    ctx.lineTo(pad, pad+innerH);
    ctx.closePath();
    ctx.fill();

    // line
    ctx.strokeStyle = "rgba(37,99,235,.95)";
    ctx.lineWidth = 2.4 * devicePixelRatio;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0,y0);
    for (let i=1;i<points.length;i++){
      const [x,y] = toXY(i, points[i]);
      ctx.lineTo(x,y);
    }
    ctx.stroke();

    // dots
    ctx.fillStyle = "rgba(37,99,235,.95)";
    for (let i=0;i<points.length;i++){
      const [x,y] = toXY(i, points[i]);
      ctx.beginPath();
      ctx.arc(x,y, 3.2*devicePixelRatio, 0, Math.PI*2);
      ctx.fill();
    }
  }

  function samplePoints(days){
    // just to look like mock
    if (days === 7) return [62,62,63,62,61,62,64];
    if (days === 90) return [70,71,72,71,69,67,66,65,66,68,69,70,72];
    // 30
    return [60,60,61,61,60,59,57,56,55,54,53,52,50,49,51,52,53,55,56,57,58,58,59,60,62,64,66,67,68,69];
  }

  // ----- Render helpers -----
  function fmtDate(d) {
    try { return new Date(d).toLocaleString("fr-FR"); } catch { return "-"; }
  }
  function shortUrl(u) {
    try { return new URL(u).host.replace(/^www\./,""); } catch { return (u||"").slice(0,32); }
  }

  function monitorStatusPill(status){
    const s = String(status||"unknown").toLowerCase();
    const cls = s === "up" ? "pill ok" : s === "down" ? "pill danger" : "pill pending";
    const label = s === "up" ? "Up" : s === "down" ? "Down" : "Unknown";
    return `<span class="${cls}">${label}</span>`;
  }

  // ----- Actions -----
  async function loadMe(){
    const me = await api("/api/me");
    const email = me.email || "—";
    qs("#pillEmail").textContent = email;

    qs("#helloName").textContent = (me.companyName || me.name || email || "—");
    qs("#accPlan").textContent = String(me.plan || "—").toUpperCase();
    qs("#accOrg").textContent = me.org?.name || "—";
    qs("#accRole").textContent = me.role || "—";

    let trial = "—";
    if (me.hasTrial && me.trialEndsAt) {
      trial = new Date(me.trialEndsAt).toLocaleDateString("fr-FR");
    }
    qs("#accTrial").textContent = trial;

    // KPI SEO Score: last audit score if exists (loaded later too)
    return me;
  }

  async function loadAudits(){
    const j = await api("/api/audits");
    const audits = Array.isArray(j.audits) ? j.audits : [];

    qs("#auditsCount").textContent = `${audits.length} audits`;

    const rows = audits.slice(0, 30).map(a => {
      const status = (a.status || "").toLowerCase() === "ok"
        ? `<span class="pill" style="background:rgba(34,197,94,.10);border-color:rgba(34,197,94,.18);color:#15803d">OK</span>`
        : `<span class="pill danger">Error</span>`;

      const score = Number.isFinite(a.score) ? `${a.score}` : "—";

      return `
        <div class="tr">
          <div class="td">${fmtDate(a.createdAt)}</div>
          <div class="td" title="${a.url || ""}">${a.url || "—"}</div>
          <div class="td">${status}</div>
          <div class="td"><b>${score}</b></div>
          <div class="td">
            <button class="btn ghost" data-pdf="${a._id}">PDF</button>
          </div>
        </div>
      `;
    }).join("");

    qs("#auditsRows").innerHTML = rows || `
      <div class="tr">
        <div class="td muted">No audits yet.</div><div class="td">—</div><div class="td">—</div><div class="td">—</div><div class="td">—</div>
      </div>
    `;

    // KPI score
    const last = audits[0];
    if (last && Number.isFinite(last.score)) {
      qs("#kpiSeoScore").textContent = `${last.score}`;
      qs("#kpiSeoMeta").textContent = "Last audit";
    } else {
      qs("#kpiSeoScore").textContent = "—";
      qs("#kpiSeoMeta").textContent = "Last 30 days";
    }

    // PDF actions
    qsa('[data-pdf]').forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-pdf");
        window.open(`/api/audits/${id}/pdf`, "_blank");
      });
    });

    return audits;
  }

  function renderMonitorsRows(monitors){
    if (!monitors.length) {
      return `
        <div class="tr">
          <div class="td muted">No monitors yet.</div><div class="td">—</div><div class="td">—</div><div class="td">—</div><div class="td">—</div><div class="td"></div>
        </div>
      `;
    }

    return monitors.map(m => {
      const last = m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleString("fr-FR") : "—";
      const resp = "—"; // (tu peux le remplir avec un dernier log si tu veux)
      return `
        <div class="tr">
          <div class="td" title="${m.url}">${m.url}</div>
          <div class="td">${monitorStatusPill(m.lastStatus)}</div>
          <div class="td">${m.intervalMinutes || 60} min</div>
          <div class="td">${last}</div>
          <div class="td">${resp}</div>
          <div class="td" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
            <button class="btn ghost" data-run="${m._id}">Run</button>
            <button class="btn ghost" data-toggle="${m._id}">${m.active ? "Pause" : "Resume"}</button>
          </div>
        </div>
      `;
    }).join("");
  }

  async function loadMonitors(){
    const j = await api("/api/monitors");
    const monitors = Array.isArray(j.monitors) ? j.monitors : [];

    // KPI monitors / up / down
    const up = monitors.filter(m => String(m.lastStatus).toLowerCase() === "up").length;
    const down = monitors.filter(m => String(m.lastStatus).toLowerCase() === "down").length;
    qs("#kpiMonitors").textContent = `${monitors.length}`;
    qs("#kpiUp").textContent = `${up}`;
    qs("#kpiDown").textContent = `${down}`;

    // overview table + page table
    qs("#monitorsRows").innerHTML = renderMonitorsRows(monitors.slice(0, 8));
    qs("#monitorsRowsPage").innerHTML = renderMonitorsRows(monitors);

    // bind actions
    qsa("[data-run]").forEach(b => {
      b.addEventListener("click", async () => {
        try{
          b.disabled = true;
          await api(`/api/monitors/${b.getAttribute("data-run")}/run`, { method:"POST" });
          await refreshAll();
        }catch(e){
          setMsg(qs("#monitorsMsg"), e.message, "err");
        }finally{
          b.disabled = false;
        }
      });
    });

    qsa("[data-toggle]").forEach(b => {
      b.addEventListener("click", async () => {
        try{
          b.disabled = true;
          const id = b.getAttribute("data-toggle");
          // find current state from DOM text (simple)
          const wantPause = b.textContent.trim().toLowerCase() === "pause";
          await api(`/api/monitors/${id}`, {
            method:"PATCH",
            body: JSON.stringify({ active: !wantPause })
          });
          await refreshAll();
        }catch(e){
          setMsg(qs("#monitorsMsg"), e.message, "err");
        }finally{
          b.disabled = false;
        }
      });
    });

    return monitors;
  }

  async function runAudit(url){
    const msg = qs("#auditMsg");
    setMsg(msg, "Running audit…");
    const j = await api("/api/audits/run", { method:"POST", body: JSON.stringify({ url }) });
    setMsg(msg, j.cached ? `✅ ${j.summary}` : `✅ ${j.summary}`, "ok");
  }

  // ----- Modal add monitor -----
  const modal = qs("#modalAddMonitor");
  function openModal(){
    modal?.classList.add("show");
    modal?.setAttribute("aria-hidden","false");
    setMsg(qs("#addMonitorMsg"), "");
  }
  function closeModal(){
    modal?.classList.remove("show");
    modal?.setAttribute("aria-hidden","true");
  }
  qs("#btnAddMonitor")?.addEventListener("click", openModal);
  qs("#btnAddMonitor2")?.addEventListener("click", openModal);

  qsa("[data-close]").forEach(el => el.addEventListener("click", closeModal));

  qs("#btnCreateMonitor")?.addEventListener("click", async () => {
    const url = (qs("#inpMonitorUrl").value || "").trim();
    const intervalMinutes = Number(qs("#inpMonitorInterval").value || 60);
    const msg = qs("#addMonitorMsg");

    if (!/^https?:\/\//i.test(url)) return setMsg(msg, "URL invalide (http/https)", "err");

    try{
      setMsg(msg, "Creating…");
      await api("/api/monitors", { method:"POST", body: JSON.stringify({ url, intervalMinutes }) });
      setMsg(msg, "✅ Monitor créé", "ok");
      qs("#inpMonitorUrl").value = "";
      await refreshAll();
      setTimeout(closeModal, 300);
    }catch(e){
      setMsg(msg, e.message, "err");
    }
  });

  // ----- Top actions -----
  qs("#btnRefresh")?.addEventListener("click", () => refreshAll(true));

  qs("#btnExportAudits")?.addEventListener("click", () => {
    window.location.href = "/api/export/audits.csv";
  });
  qs("#btnExportMonitors")?.addEventListener("click", () => {
    window.location.href = "/api/export/monitors.csv";
  });

  qs("#btnPortal")?.addEventListener("click", async () => {
    try{
      const j = await api("/api/stripe/portal", { method:"POST" });
      if (j?.url) location.href = j.url;
    }catch(e){
      alert(e.message);
    }
  });

  qs("#btnLogout")?.addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/login.html";
  });

  // Plans buttons (checkout)
  qsa("[data-upgrade]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const plan = btn.getAttribute("data-upgrade");
      try{
        btn.disabled = true;
        const j = await api("/api/stripe/checkout", { method:"POST", body: JSON.stringify({ plan }) });
        if (j?.url) location.href = j.url;
      }catch(e){
        alert(e.message);
      }finally{
        btn.disabled = false;
      }
    });
  });

  // Quick links
  qs("#btnRunAuditFromActions")?.addEventListener("click", () => showView("audits"));
  qs("#btnSeePlans")?.addEventListener("click", () => showView("billing"));

  // Range selector -> chart label
  qs("#rangeSelect")?.addEventListener("change", () => {
    const days = Number(qs("#rangeSelect").value || 30);
    qs("#chartRangeLabel").textContent = days === 7 ? "Last 7 days" : days === 90 ? "Last 90 days" : "Last 30 days";
    drawLineChart(qs("#seoChart"), samplePoints(days));
  });

  async function refreshAll(fromButton=false){
    // if no token => redirect
    if (!token()) return (location.href = "/login.html");

    try{
      if (fromButton) qs("#statusText").textContent = "Refreshing…";
      await loadMe();
      const days = Number(qs("#rangeSelect").value || 30);
      drawLineChart(qs("#seoChart"), samplePoints(days));

      await loadAudits();
      await loadMonitors();

      qs("#statusText").textContent = "Dashboard à jour — OK";
    }catch(e){
      qs("#statusText").textContent = `Erreur — ${e.message}`;
    }
  }

  // ----- Boot -----
  (async function init(){
    showView(getHashView());
    await refreshAll();
  })();
})();
