(() => {
  const TOKEN_KEY = "fp_token";
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => [...el.querySelectorAll(s)];
  const getToken = () => localStorage.getItem(TOKEN_KEY);

  const api = async (path, opts = {}) => {
    const token = getToken();
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      token ? { Authorization: `Bearer ${token}` } : {},
      opts.headers || {}
    );

    const res = await fetch(path, { ...opts, headers });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

    if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
    return data;
  };

  const escapeHtml = (s) => (s ?? "").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  const fmtDate = (ts) => {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, { year:"2-digit", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  };

  /* ------- Drawer (mobile) ------- */
  const drawer = qs("#drawer");
  const drawerOverlay = qs("#drawerOverlay");
  qs("#btnOpenDrawer")?.addEventListener("click", () => {
    drawerOverlay.classList.add("show");
    drawer.classList.add("show");
  });
  const closeDrawer = () => {
    drawerOverlay.classList.remove("show");
    drawer.classList.remove("show");
  };
  drawerOverlay?.addEventListener("click", closeDrawer);

  /* ------- Router views ------- */
  const views = {
    overview: qs("#view-overview"),
    audits: qs("#view-audits"),
    monitors: qs("#view-monitors"),
    localseo: qs("#view-localseo"),
    competitors: qs("#view-competitors"),
    reports: qs("#view-reports"),
    billing: qs("#view-billing"),
    settings: qs("#view-settings"),
  };

  const setActiveNav = (viewName) => {
    qsa("[data-view]").forEach(a => a.classList.toggle("active", a.dataset.view === viewName));
  };

  const showView = (viewName) => {
    if (!views[viewName]) viewName = "overview";
    Object.entries(views).forEach(([k, el]) => el && el.classList.toggle("active", k === viewName));
    setActiveNav(viewName);
    closeDrawer();
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const getViewFromHash = () => (location.hash || "#overview").replace("#","").trim() || "overview";

  qsa("[data-view]").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const v = a.dataset.view;
      history.replaceState({}, "", `#${v}`);
      showView(v);
    });
  });
  window.addEventListener("hashchange", () => showView(getViewFromHash()));

  /* ------- Auth actions ------- */
  const doLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/login.html";
  };
  qs("#btnLogout")?.addEventListener("click", doLogout);
  qs("#btnLogoutM")?.addEventListener("click", doLogout);

  /* ------- Stripe Portal (YOUR ROUTE) ------- */
  const openPortal = async () => {
    try {
      const j = await api("/api/stripe/portal", { method: "POST", body: JSON.stringify({}) });
      if (j?.url) location.href = j.url;
      else alert("Portal non configuré.");
    } catch (e) {
      alert(e.message || "Erreur portal");
    }
  };
  qs("#btnPortal")?.addEventListener("click", openPortal);
  qs("#btnPortalM")?.addEventListener("click", openPortal);
  qs("#btnOpenPortal2")?.addEventListener("click", openPortal);

  /* ------- Exports (YOUR ROUTES) ------- */
  qs("#btnExportAudits")?.addEventListener("click", () => (window.location.href = "/api/export/audits.csv"));
  qs("#btnExportMonitors")?.addEventListener("click", () => (window.location.href = "/api/export/monitors.csv"));

  /* ------- Monitor modal ------- */
  const monitorModal = qs("#monitorModal");
  const openMonitorModal = () => monitorModal.classList.add("show");
  const closeMonitorModal = () => monitorModal.classList.remove("show");

  qs("#btnAddMonitorTop")?.addEventListener("click", openMonitorModal);
  qs("#btnAddMonitor2")?.addEventListener("click", openMonitorModal);

  qs("#mmClose")?.addEventListener("click", closeMonitorModal);
  qs("#mmCancel")?.addEventListener("click", closeMonitorModal);
  monitorModal?.addEventListener("click", (e) => { if (e.target === monitorModal) closeMonitorModal(); });

  qs("#mmCreate")?.addEventListener("click", async () => {
    const url = (qs("#mmUrl")?.value || "").trim();
    const intervalMinutes = Number(qs("#mmInterval")?.value || 60);
    if (!/^https?:\/\//i.test(url)) return alert("URL invalide (http/https)");
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) return alert("intervalMinutes min = 5");

    try {
      await api("/api/monitors", { method: "POST", body: JSON.stringify({ url, intervalMinutes }) });
      closeMonitorModal();
      await refreshAll();
      showView("monitors");
    } catch (e) {
      alert(e.message || "Erreur création monitor");
    }
  });

  /* ------- Render helpers ------- */
  const setText = (sel, txt) => { const el = qs(sel); if (el) el.textContent = txt; };

  const renderMe = (me) => {
    const plan = (me?.plan || "—").toString().toUpperCase();
    const org = (me?.org?.name || me?.companyName || "—").toString();
    const role = (me?.role || "—").toString();
    const trial = me?.trialEndsAt ? fmtDate(me.trialEndsAt) : "—";

    setText("#accPlan", plan); setText("#accOrg", org); setText("#accRole", role); setText("#accTrial", trial);
    setText("#accPlanM", plan); setText("#accOrgM", org); setText("#accRoleM", role); setText("#accTrialM", trial);

    setText("#helloTitle", `Bonjour, ${org}`);

    const isUltra = (me?.plan || "").toLowerCase() === "ultra";
    const pill = qs("#pillReports"); const pillM = qs("#pillReportsMobile");
    if (pill) pill.style.display = isUltra ? "inline-flex" : "none";
    if (pillM) pillM.style.display = isUltra ? "inline-flex" : "none";

    // usage KPIs
    const seoScore = "—"; // ton backend ne renvoie pas de score global "SEO Score" => tu peux le calculer à partir du dernier audit si tu veux
    setText("#kpiSeo", seoScore);

    // local visibility placeholder (comme ta maquette)
    setText("#kpiLocal", "+12%");
  };

  const renderMonitors = (monitors) => {
    const list = monitors || [];
    const rows = list.map(m => {
      const st = (m.lastStatus || "unknown").toLowerCase();
      const isUp = st === "up";
      const badge = isUp
        ? `<span class="badge bUp"><span class="bDot"></span>Up</span>`
        : `<span class="badge bDown"><span class="bDot"></span>${st === "down" ? "Down" : "Unknown"}</span>`;

      return `
        <tr>
          <td>${escapeHtml(m.url || "")}</td>
          <td>${badge}</td>
          <td>${escapeHtml(String(m.intervalMinutes ?? 60))} min</td>
          <td>${fmtDate(m.lastCheckedAt)}</td>
          <td>—</td>
        </tr>
      `;
    }).join("");

    const html = rows || `<tr><td colspan="5" class="small">No monitors yet.</td></tr>`;
    const tb1 = qs("#monitorsBody");
    const tb2 = qs("#monitorsBody2");
    if (tb1) tb1.innerHTML = html;
    if (tb2) tb2.innerHTML = html;

    const up = list.filter(x => (x.lastStatus || "").toLowerCase() === "up").length;
    const down = list.filter(x => (x.lastStatus || "").toLowerCase() === "down").length;
    setText("#kpiMonitors", String(list.length));
    setText("#kpiMonitorsSub", `${up} up · ${down} down`);
  };

  const renderAudits = (audits) => {
    const list = audits || [];
    const tb = qs("#auditsBody");
    if (!tb) return;

    tb.innerHTML = list.length ? list.map(a => `
      <tr>
        <td>${escapeHtml(a.url || "")}</td>
        <td class="kpi">${escapeHtml(String(a.score ?? "—"))}</td>
        <td>${fmtDate(a.createdAt)}</td>
        <td>
          <button class="btn small" data-pdf="${escapeHtml(a._id)}">PDF</button>
        </td>
      </tr>
    `).join("") : `<tr><td colspan="4" class="small">No audits yet.</td></tr>`;

    // PDF click => /api/audits/:id/pdf
    qsa("[data-pdf]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-pdf");
        if (!id) return;
        window.open(`/api/audits/${encodeURIComponent(id)}/pdf`, "_blank");
      });
    });

    // KPI SEO Score = dernier audit score
    if (list.length) {
      const last = list[0];
      if (typeof last.score === "number") setText("#kpiSeo", `${last.score}/100`);
    }
  };

  /* ------- Run audit (YOUR ROUTE) ------- */
  const runAudit = async () => {
    const url = prompt("URL à auditer (http/https):");
    if (!url) return;
    try {
      await api("/api/audits/run", { method: "POST", body: JSON.stringify({ url }) });
      await refreshAll();
      showView("audits");
    } catch (e) {
      alert(e.message || "Erreur audit");
    }
  };
  qs("#btnRunAudit")?.addEventListener("click", runAudit);
  qs("#btnRunAudit2")?.addEventListener("click", runAudit);

  /* ------- Refresh ------- */
  const refreshAll = async () => {
    if (!getToken()) return (location.href = "/login.html");

    try {
      const me = await api("/api/me", { method: "GET" });
      renderMe(me);

      const monitorsRes = await api("/api/monitors", { method: "GET" });
      renderMonitors(monitorsRes.monitors || []);

      const auditsRes = await api("/api/audits", { method: "GET" });
      renderAudits(auditsRes.audits || []);

      setText("#kpiIncidents", "0");
    } catch (e) {
      console.error(e);
      alert(e.message || "Erreur refresh");
    }
  };

  qs("#btnRefresh")?.addEventListener("click", refreshAll);

  // init
  showView(getViewFromHash());
  refreshAll();
})();
