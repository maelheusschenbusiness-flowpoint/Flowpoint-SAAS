(() => {
  const TOKEN_KEY = "fp_token";

  const qs = (s, el=document) => el.querySelector(s);
  const qsa = (s, el=document) => [...el.querySelectorAll(s)];

  const state = {
    me: null,
    monitors: [],
    audits: [],
  };

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  async function api(path, opts={}) {
    const tok = getToken();
    const headers = Object.assign({}, opts.headers || {}, {
      "Content-Type": "application/json",
      "Authorization": tok ? `Bearer ${tok}` : "",
    });

    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || `Erreur API (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  function fmtDate(d) {
    if (!d) return "—";
    try { return new Date(d).toLocaleString("fr-FR"); } catch { return "—"; }
  }

  function setActiveNav(view) {
    qsa(".nav__item").forEach(b => b.classList.toggle("is-active", b.dataset.view === view));
  }

  function showSection(view) {
    // left column sections (overview, audits, etc.)
    qsa("[data-section]").forEach(sec => {
      const isMonitorsRight = sec.closest(".col") && sec.closest(".col").nextElementSibling === null && sec.dataset.section === "monitors";
      // keep right column monitors always visible (like mock)
      if (sec.dataset.section === "monitors" && sec.closest(".col") && sec.closest(".col").classList.contains("col") && sec.closest(".grid")) {
        // do nothing
      }
    });

    // Hide/show only LEFT-column sections by name
    const leftSections = qsa(".grid > .col:first-child [data-section]");
    leftSections.forEach(sec => {
      sec.hidden = sec.dataset.section !== view;
    });

    // If user clicks "Monitors" in nav, we also scroll to monitors card on right
    if (view === "monitors") {
      const m = qs('.grid > .col:last-child [data-section="monitors"]');
      if (m) m.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      const sec = qs(`.grid > .col:first-child [data-section="${view}"]`);
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function openSidebar(open) {
    const sb = qs("#sidebar");
    const ov = qs("#overlay");
    if (!sb || !ov) return;
    sb.classList.toggle("is-open", !!open);
    ov.hidden = !open;
  }

  function renderMe(me) {
    qs("#helloTitle").textContent = `Bonjour, ${me?.companyName || me?.name || "—"}`;
    qs("#chipEmail").textContent = me?.email || "—";

    qs("#accPlan").textContent = (me?.plan || "—").toUpperCase();
    qs("#accOrg").textContent = me?.org?.name || me?.companyName || "—";
    qs("#accRole").textContent = me?.role || "—";

    if (me?.trialEndsAt) {
      const dt = new Date(me.trialEndsAt);
      const left = Math.max(0, Math.ceil((dt.getTime() - Date.now()) / (24*60*60*1000)));
      qs("#accTrial").textContent = left ? `${left}j` : "—";
    } else {
      qs("#accTrial").textContent = "—";
    }
  }

  function renderMonitors(list) {
    const tb = qs("#monitorsTbody");
    if (!tb) return;

    if (!list || !list.length) {
      tb.innerHTML = `<tr><td colspan="5" class="muted">No monitors yet.</td></tr>`;
      qs("#kpiMonitors").textContent = "0";
      qs("#kpiUpDown").textContent = "0 up · 0 down";
      return;
    }

    let up = 0, down = 0;
    tb.innerHTML = list.map(m => {
      const st = (m.lastStatus || "unknown").toLowerCase();
      if (st === "up") up++;
      if (st === "down") down++;

      const pill =
        st === "up" ? `<span class="pill pill--up">Up</span>` :
        st === "down" ? `<span class="pill pill--down">Down</span>` :
        `<span class="pill pill--soft">Unknown</span>`;

      const interval = m.intervalMinutes ? `${m.intervalMinutes} min` : "—";
      const last = m.lastCheckedAt ? fmtDate(m.lastCheckedAt) : "—";

      return `
        <tr>
          <td style="max-width:260px;word-break:break-word">${escapeHtml(m.url || "")}</td>
          <td>${pill}</td>
          <td>${interval}</td>
          <td>${last}</td>
          <td>—</td>
        </tr>
      `;
    }).join("");

    qs("#kpiMonitors").textContent = String(list.length);
    qs("#kpiUpDown").textContent = `${up} up · ${down} down`;
  }

  function renderAudits(list) {
    const tb = qs("#auditsTbody");
    if (!tb) return;

    if (!list || !list.length) {
      tb.innerHTML = `<tr><td colspan="4" class="muted">No audits yet.</td></tr>`;
      qs("#kpiSeo").textContent = "—";
      return;
    }

    const latest = list[0];
    qs("#kpiSeo").textContent = (latest?.score ?? "—");

    tb.innerHTML = list.map(a => {
      const st = (a.status || "").toLowerCase();
      const pill =
        st === "ok" ? `<span class="pill pill--up">OK</span>` :
        st === "error" ? `<span class="pill pill--down">Error</span>` :
        `<span class="pill pill--soft">${escapeHtml(a.status || "—")}</span>`;

      return `
        <tr>
          <td style="max-width:360px;word-break:break-word">${escapeHtml(a.url || "")}</td>
          <td>${pill}</td>
          <td>${a.score ?? "—"}</td>
          <td>${a.createdAt ? fmtDate(a.createdAt) : "—"}</td>
        </tr>
      `;
    }).join("");
  }

  // simple chart (no lib)
  function drawSeoChart(values) {
    const c = qs("#seoChart");
    if (!c) return;
    const ctx = c.getContext("2d");

    const w = c.width = c.parentElement.clientWidth * devicePixelRatio;
    const h = c.height = 120 * devicePixelRatio;
    c.style.width = "100%";
    c.style.height = "120px";

    const pad = 14 * devicePixelRatio;
    const xs = values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);

    // grid
    ctx.clearRect(0,0,w,h);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1 * devicePixelRatio;
    ctx.strokeStyle = "rgba(148,163,184,.35)";
    for (let i=1;i<=3;i++){
      const y = pad + (h-2*pad)*(i/4);
      ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke();
    }

    // line
    ctx.strokeStyle = "rgba(37,99,235,1)";
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath();
    for (let i=0;i<xs;i++){
      const x = pad + (w-2*pad)*(i/(xs-1));
      const y = pad + (h-2*pad)*(1 - ((values[i]-min)/span));
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();

    // dots
    ctx.fillStyle = "rgba(37,99,235,1)";
    for (let i=0;i<xs;i++){
      const x = pad + (w-2*pad)*(i/(xs-1));
      const y = pad + (h-2*pad)*(1 - ((values[i]-min)/span));
      ctx.beginPath(); ctx.arc(x,y,3.2*devicePixelRatio,0,Math.PI*2); ctx.fill();
    }

    // soft fill
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = "rgba(37,99,235,1)";
    ctx.beginPath();
    for (let i=0;i<xs;i++){
      const x = pad + (w-2*pad)*(i/(xs-1));
      const y = pad + (h-2*pad)*(1 - ((values[i]-min)/span));
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.lineTo(w-pad, h-pad);
    ctx.lineTo(pad, h-pad);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  async function loadAll() {
    qs("#dashStatus").textContent = "Loading…";

    const me = await api("/api/me");
    state.me = me;
    renderMe(me);

    const monitors = await api("/api/monitors");
    state.monitors = monitors.monitors || [];
    renderMonitors(state.monitors);

    const audits = await api("/api/audits");
    state.audits = audits.audits || [];
    renderAudits(state.audits);

    // faux curve proche du mock si pas de data
    const vals = state.audits.length
      ? Array.from({length: 14}, (_,i) => 40 + Math.sin(i/2)*8 + i*1.2)
      : [52,52,54,55,54,50,44,38,41,45,52,60,64,65];

    drawSeoChart(vals);

    qs("#dashStatus").textContent = "Dashboard à jour — OK";
  }

  function bind() {
    // nav clicks
    qsa(".nav__item").forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        setActiveNav(view);
        showSection(view);
        openSidebar(false);
      });
    });

    // sidebar mobile
    const openBtn = qs("#sidebarOpen");
    const closeBtn = qs("#sidebarClose");
    const overlay = qs("#overlay");
    if (openBtn) openBtn.addEventListener("click", () => openSidebar(true));
    if (closeBtn) closeBtn.addEventListener("click", () => openSidebar(false));
    if (overlay) overlay.addEventListener("click", () => openSidebar(false));

    // refresh
    qs("#btnRefresh")?.addEventListener("click", () => loadAll().catch(err => alert(err.message)));

    // exports
    qs("#btnExportAudits")?.addEventListener("click", () => window.location.href = "/api/export/audits.csv");
    qs("#btnExportMonitors")?.addEventListener("click", () => window.location.href = "/api/export/monitors.csv");

    // portal
    qs("#btnPortal")?.addEventListener("click", async () => {
      try{
        const j = await api("/api/stripe/portal", { method:"POST", body: JSON.stringify({}) });
        if (j.url) window.location.href = j.url;
      }catch(e){ alert(e.message); }
    });

    // logout
    qs("#btnLogout")?.addEventListener("click", () => {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = "/login.html";
    });

    // run audit
    qs("#btnRunAudit")?.addEventListener("click", () => {
      setActiveNav("audits");
      showSection("audits");
    });
    qs("#btnRunAuditInline")?.addEventListener("click", () => {
      setActiveNav("audits");
      showSection("audits");
    });

    // audit submit
    qs("#btnAuditGo")?.addEventListener("click", async () => {
      const url = (qs("#auditUrl")?.value || "").trim();
      if (!url) return alert("URL requise");
      try{
        await api("/api/audits/run", { method:"POST", body: JSON.stringify({ url }) });
        await loadAll();
        alert("Audit lancé ✅");
      }catch(e){ alert(e.message); }
    });

    // add monitor
    qs("#btnAddMonitor")?.addEventListener("click", async () => {
      const url = prompt("URL monitor (https://...)");
      if (!url) return;
      const intervalMinutes = Number(prompt("Interval minutes (min 5)", "60") || "60");
      try{
        await api("/api/monitors", { method:"POST", body: JSON.stringify({ url, intervalMinutes }) });
        await loadAll();
      }catch(e){ alert(e.message); }
    });

    // Tabs (cosmetic like mock)
    qsa(".tab").forEach(t => {
      t.addEventListener("click", () => {
        qsa(".tab").forEach(x => x.classList.remove("is-active"));
        t.classList.add("is-active");
      });
    });

    // keep chart crisp on resize
    window.addEventListener("resize", () => {
      drawSeoChart([52,52,54,55,54,50,44,38,41,45,52,60,64,65]);
    });
  }

  // Boot
  (async () => {
    try{
      bind();
      await loadAll();
      // default view = overview
      setActiveNav("overview");
      showSection("overview");
    }catch(e){
      alert(e.message || "Erreur dashboard");
      // if token missing/invalid
      if ((e.message || "").toLowerCase().includes("token")) {
        window.location.href = "/login.html";
      }
    }
  })();
})();
