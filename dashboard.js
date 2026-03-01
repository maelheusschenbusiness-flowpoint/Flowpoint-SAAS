/* Flowpoint Dashboard — UI/Routes/Responsive
   Fix: overlay ne bloque plus les clics (pointer-events: none quand fermé)
*/

(function () {
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));

  const token = localStorage.getItem("token") || "";
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  // ---------- API ----------
  const api = async (path, opts = {}) => {
    const r = await fetch(path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (r.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login.html";
      return null;
    }
    return r;
  };

  // ---------- Icons (blue style) ----------
  const icons = {
    overview: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 19V5m0 14h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 15l3-3 3 2 5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    audits: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M7 3h8l2 2v16H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 9h6M9 13h6M9 17h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    monitors: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12l4-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`,
    local: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 22s7-5.5 7-12a7 7 0 1 0-14 0c0 6.5 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
    competitors: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 20h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 20V10m5 10V4m5 16v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    reports: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M7 3h10l2 2v16H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 12h6M9 16h6M9 8h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    billing: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 7h16v10H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M4 10h16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 14h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    settings: `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a7.7 7.7 0 0 0 .1-1 7.7 7.7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7.4 7.4 0 0 0-1.7-1l-.3-2.6H11l-.3 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.5L6.6 13a7.7 7.7 0 0 0-.1 1 7.7 7.7 0 0 0 .1 1l-2 1.5 2 3.5 2.4-1a7.4 7.4 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`
  };

  $$("[data-ico]").forEach(el => {
    const k = el.getAttribute("data-ico");
    el.innerHTML = icons[k] || "";
  });

  // ---------- UI elements ----------
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  const btnMenu = $("#btnMenu");

  const exportsDropdown = $("#exportsDropdown");
  const exportsMenu = $("#exportsMenu");
  const btnExports = $("#btnExports");

  const plansCard = $("#plansCard");
  const monitorsCard = $("#monitorsCard");
  const overviewHero = $("#overviewHero");
  const pageContainer = $("#pageContainer");

  // Fix: menu mobile
  const openSidebar = () => {
    sidebar.classList.add("open");
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
  };
  const closeSidebar = () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
  };

  btnMenu.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });
  overlay.addEventListener("click", closeSidebar);

  // Dropdown exports
  const closeExports = () => {
    exportsMenu.classList.remove("show");
    exportsMenu.setAttribute("aria-hidden", "true");
  };
  btnExports.addEventListener("click", (e) => {
    e.stopPropagation();
    exportsMenu.classList.toggle("show");
    exportsMenu.setAttribute("aria-hidden", exportsMenu.classList.contains("show") ? "false" : "true");
  });
  document.addEventListener("click", closeExports);

  // ---------- Routing ----------
  const routes = ["overview","audits","monitors","local","competitors","reports","billing","settings"];

  function setActiveRoute(route) {
    $$("[data-route]").forEach(a => {
      a.classList.toggle("active", a.getAttribute("data-route") === route);
    });

    // Plans only on Overview + Billing
    const showPlans = (route === "overview" || route === "billing");
    plansCard.style.display = showPlans ? "" : "none";

    // On non-overview pages: hide the big overview hero and show page view
    if (route === "overview") {
      overviewHero.style.display = "";
      monitorsCard.style.display = "";
      pageContainer.innerHTML = "";
    } else {
      overviewHero.style.display = "none";
      // monitors table stays visible on monitors route + overview only
      monitorsCard.style.display = (route === "monitors") ? "" : "none";
      renderPage(route);
    }

    // On mobile, close sidebar after nav click
    if (window.matchMedia("(max-width: 900px)").matches) closeSidebar();
  }

  function renderPage(route) {
    // Pages “différentes” (Settings & Reports style différent)
    if (route === "audits") return renderAudits();
    if (route === "monitors") return renderMonitorsPage();
    if (route === "billing") return renderBilling();
    if (route === "settings") return renderSettings();
    if (route === "reports") return renderReports();
    if (route === "local") return renderLocal();
    if (route === "competitors") return renderCompetitors();

    pageContainer.innerHTML = "";
  }

  function cardHTML(title, inner, extraClass="") {
    return `
      <div class="card ${extraClass}">
        <div class="cardHead">
          <div class="cardTitle">${title}</div>
        </div>
        <div style="margin-top:10px">${inner}</div>
      </div>
    `;
  }

  // ---------- Data fetch ----------
  async function fetchMe() {
    const r = await api("/api/me");
    if (!r) return null;
    return r.json().catch(() => null);
  }
  async function fetchOverview(days) {
    const r = await api(`/api/overview?days=${encodeURIComponent(days)}`);
    if (!r) return null;
    return r.json().catch(() => null);
  }
  async function fetchMonitors() {
    const r = await api("/api/monitors");
    if (!r) return null;
    return r.json().catch(() => null);
  }
  async function fetchAudits() {
    const r = await api("/api/audits");
    if (!r) return null;
    return r.json().catch(() => null);
  }

  // ---------- KPI + header ----------
  function initials(str) {
    const s = String(str || "").trim();
    if (!s) return "FP";
    const parts = s.split(" ").filter(Boolean);
    if (parts.length === 1) return (parts[0][0] || "F").toUpperCase() + "P";
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function setAccount(me) {
    $("#helloTitle").textContent = `Bonjour, ${me?.companyName || me?.name || "—"}`;
    $("#avatarText").textContent = initials(me?.companyName || me?.name || "FP");

    $("#accPlan").textContent = (me?.plan || "—").toUpperCase();
    $("#accOrg").textContent = me?.org?.name || "—";
    $("#accRole").textContent = me?.role || "—";

    const trial = me?.trialEndsAt ? new Date(me.trialEndsAt).toLocaleDateString("fr-FR") : "—";
    $("#accTrial").textContent = me?.hasTrial ? trial : "—";
  }

  // ---------- Simple chart (canvas) ----------
  function drawChart(points) {
    const canvas = $("#chart");
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;

    ctx.clearRect(0, 0, w, h);

    const pad = 18 * devicePixelRatio;
    const max = Math.max(100, ...points);
    const min = 0;

    // grid
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1 * devicePixelRatio;
    ctx.strokeStyle = "rgba(15,23,42,.10)";
    for (let i = 0; i <= 4; i++) {
      const y = pad + (h - pad*2) * (i/4);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }

    // line
    const n = Math.max(2, points.length);
    const stepX = (w - pad*2) / (n - 1);
    const toY = (v) => {
      const t = (v - min) / (max - min || 1);
      return pad + (h - pad*2) * (1 - t);
    };

    // area
    ctx.beginPath();
    ctx.moveTo(pad, toY(points[0] || 0));
    for (let i = 1; i < n; i++) {
      ctx.lineTo(pad + stepX * i, toY(points[i] || points[points.length-1] || 0));
    }
    ctx.lineTo(pad + stepX * (n - 1), h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = "rgba(47,107,255,.10)";
    ctx.fill();

    // stroke
    ctx.beginPath();
    ctx.moveTo(pad, toY(points[0] || 0));
    for (let i = 1; i < n; i++) {
      ctx.lineTo(pad + stepX * i, toY(points[i] || points[points.length-1] || 0));
    }
    ctx.strokeStyle = "rgba(47,107,255,.95)";
    ctx.lineWidth = 3.2 * devicePixelRatio;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // ---------- Monitors table ----------
  function fmtWhen(d) {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString("fr-FR", { dateStyle:"short", timeStyle:"short" });
  }

  function renderMonitorsRows(list) {
    const wrap = $("#monitorsRows");
    const empty = $("#monitorsEmpty");

    wrap.innerHTML = "";

    if (!list?.length) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";

    for (const m of list) {
      const st = (m.lastStatus || "unknown").toLowerCase();
      const klass = st === "up" ? "up" : st === "down" ? "down" : "";

      const row = document.createElement("div");
      row.className = "tr row";

      // Mobile labels handled via CSS data-label on each cell (only visible on 520px)
      row.innerHTML = `
        <div data-label="URL">${m.url || "—"}</div>
        <div data-label="Status">
          <span class="badgeStatus ${klass}">
            <span class="sDot"></span>
            <span>${st === "unknown" ? "Unknown" : st.toUpperCase()}</span>
          </span>
        </div>
        <div data-label="Interval">${m.intervalMinutes || 60} min</div>
        <div data-label="Last Check">${fmtWhen(m.lastCheckedAt)}</div>
        <div data-label="Response Time">${m.lastResponseTimeMs ? `${m.lastResponseTimeMs} ms` : "—"}</div>
        <div data-label="">
          <button class="btn small" data-run="${m._id}">Run</button>
        </div>
      `;
      wrap.appendChild(row);
    }

    // run buttons
    wrap.querySelectorAll("[data-run]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-run");
        btn.disabled = true;
        btn.textContent = "…";
        try {
          const r = await api(`/api/monitors/${id}/run`, { method:"POST" });
          const data = await r.json().catch(()=>null);
          if (!r.ok) alert(data?.error || "Erreur monitor");
          await refreshMonitors();
        } finally {
          btn.disabled = false;
          btn.textContent = "Run";
        }
      });
    });
  }

  async function refreshMonitors() {
    const data = await fetchMonitors();
    const list = data?.monitors || [];
    renderMonitorsRows(list);
  }

  // ---------- Pages ----------
  async function renderAudits() {
    pageContainer.innerHTML = cardHTML("Audits", `
      <div class="smallMuted" style="margin-bottom:10px">Derniers audits SEO. Exporte en CSV via “Exports”.</div>
      <div id="auditsBox" class="empty">Chargement…</div>
    `);
    const box = $("#auditsBox");
    const data = await fetchAudits();
    const list = data?.audits || [];
    if (!list.length) {
      box.className = "empty";
      box.textContent = "Aucun audit pour le moment.";
      return;
    }
    box.className = "";
    box.innerHTML = `
      <div class="table">
        <div class="tr th" style="grid-template-columns:1.4fr .6fr .6fr 1fr;">
          <div>URL</div><div>Score</div><div>Status</div><div>Date</div>
        </div>
        ${list.slice(0,30).map(a => `
          <div class="tr row" style="grid-template-columns:1.4fr .6fr .6fr 1fr;">
            <div data-label="URL">${a.url || "—"}</div>
            <div data-label="Score"><b>${a.score ?? 0}</b>/100</div>
            <div data-label="Status">${(a.status || "—").toUpperCase()}</div>
            <div data-label="Date">${fmtWhen(a.createdAt)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  async function renderMonitorsPage() {
    pageContainer.innerHTML = cardHTML("Monitoring", `
      <div class="smallMuted">Gère tes monitors ici. Le tableau à droite reste visible sur cette page.</div>
    `);
  }

  async function renderBilling() {
    pageContainer.innerHTML = cardHTML("Billing", `
      <div class="smallMuted" style="margin-bottom:10px">
        Gère ton abonnement. Les Plans sont visibles ici + sur Overview.
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn primary" id="billingPortalBtn" type="button">Open Customer Portal</button>
        <button class="btn" id="billingSeePlansBtn" type="button">Go to Pricing</button>
      </div>
    `);
    $("#billingPortalBtn").addEventListener("click", async () => {
      const r = await api("/api/stripe/portal", { method:"POST", body:"{}" });
      const data = await r.json().catch(()=>null);
      if (!r.ok) return alert(data?.error || "Impossible d'ouvrir le portal");
      window.location.href = data.url;
    });
    $("#billingSeePlansBtn").addEventListener("click", () => {
      window.location.href = "/pricing.html";
    });
  }

  async function renderSettings() {
    // Style différent: “panel” plus produit, plus de champs (branding/alerts)
    pageContainer.innerHTML = `
      <div class="card" style="border-radius:26px;background:linear-gradient(180deg, rgba(15,23,42,.04), rgba(255,255,255,.78));">
        <div class="cardHead">
          <div class="cardTitle">Settings</div>
          <div class="smallMuted">Alerting · Branding · Organisation</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          <div class="card" style="padding:14px;border-radius:22px;">
            <div class="cardTitle" style="font-size:16px">Alert recipients</div>
            <div class="smallMuted" style="margin:8px 0 10px;">Choisis qui reçoit les alertes monitors.</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn small" id="setAll" type="button">All members</button>
              <button class="btn small" id="setOwner" type="button">Owner only</button>
            </div>
            <div class="smallMuted" style="margin-top:10px">Emails additionnels (plus tard): support@…</div>
          </div>

          <div class="card" style="padding:14px;border-radius:22px;">
            <div class="cardTitle" style="font-size:16px">Branding</div>
            <div class="smallMuted" style="margin:8px 0 10px;">White-label prêt (selon ton backend).</div>
            <div style="display:grid;gap:8px">
              <label class="smallMuted">App name</label>
              <input id="brandName" class="inp" placeholder="Flowpoint" />
              <label class="smallMuted">Support email</label>
              <input id="brandSupport" class="inp" placeholder="support@tondomaine.com" />
              <button class="btn primary" id="saveBrand" type="button">Save</button>
            </div>
          </div>
        </div>

        <style>
          .inp{
            height:42px;border-radius:14px;border:1px solid rgba(15,23,42,.10);
            padding:0 12px;background:rgba(255,255,255,.85);font-weight:800;outline:none;
          }
          .inp:focus{ border-color: rgba(47,107,255,.35); }
          @media (max-width: 900px){ .card > div[style*="grid-template-columns:1fr 1fr"]{ grid-template-columns:1fr !important; } }
        </style>
      </div>
    `;

    // Alert recipients
    $("#setAll").addEventListener("click", async () => {
      const r = await api("/api/org/settings", { method:"POST", body: JSON.stringify({ alertRecipients:"all", alertExtraEmails:[] })});
      if (!r.ok) alert("Erreur settings");
      else alert("OK: alerts = all");
    });
    $("#setOwner").addEventListener("click", async () => {
      const r = await api("/api/org/settings", { method:"POST", body: JSON.stringify({ alertRecipients:"owner", alertExtraEmails:[] })});
      if (!r.ok) alert("Erreur settings");
      else alert("OK: alerts = owner");
    });

    // Branding (si tu branches un endpoint plus tard)
    $("#saveBrand").addEventListener("click", () => {
      alert("Branding: prêt côté UI. On branche l’API quand tu veux.");
    });
  }

  async function renderReports() {
    // Plus “original”: aperçu + stats + actions
    pageContainer.innerHTML = `
      <div class="card" style="border-radius:26px;">
        <div class="cardHead">
          <div>
            <div class="cardTitle">Reports</div>
            <div class="smallMuted">Exports · PDF · Résumés automatiques</div>
          </div>
          <button class="btn primary small" id="genReport" type="button">Generate report</button>
        </div>

        <div style="display:grid;grid-template-columns:1.2fr .8fr;gap:12px;margin-top:12px">
          <div class="card" style="padding:14px;border-radius:22px;">
            <div class="cardTitle" style="font-size:16px">This week summary</div>
            <div class="smallMuted" style="margin:8px 0 10px;">Automatique (SEO + monitors + actions)</div>
            <div class="empty" style="border-style:solid">
              Rapport hebdo bientôt: on l’alimente avec tes audits + incidents.
            </div>
          </div>

          <div class="card" style="padding:14px;border-radius:22px;background:linear-gradient(180deg, rgba(47,107,255,.10), rgba(255,255,255,.86));border-color:rgba(47,107,255,.22)">
            <div class="cardTitle" style="font-size:16px">Quick exports</div>
            <div class="smallMuted" style="margin:8px 0 10px;">CSV/ PDF en 1 clic</div>
            <div style="display:grid;gap:10px">
              <button class="btn" id="repAudits" type="button">Export audits CSV</button>
              <button class="btn" id="repMon" type="button">Export monitors CSV</button>
              <button class="btn primary" id="repPdf" type="button">PDF summary</button>
            </div>
          </div>
        </div>

        <style>
          @media (max-width: 900px){
            .card > div[style*="grid-template-columns:1.2fr .8fr"]{ grid-template-columns:1fr !important; }
          }
        </style>
      </div>
    `;

    $("#genReport").addEventListener("click", () => alert("On branche la génération PDF/Email ensuite (déjà prêt côté backend PDF audits)."));
    $("#repAudits").addEventListener("click", () => $("#btnExportAudits").click());
    $("#repMon").addEventListener("click", () => $("#btnExportMonitors").click());
    $("#repPdf").addEventListener("click", () => alert("PDF summary: on peut ajouter un endpoint /api/reports/weekly.pdf ensuite."));
  }

  async function renderLocal() {
    pageContainer.innerHTML = cardHTML("Local SEO", `
      <div class="empty" style="border-style:solid">
        On branche ici tes métriques Google Business Profile (à venir).
      </div>
    `);
  }

  async function renderCompetitors() {
    pageContainer.innerHTML = cardHTML("Competitors", `
      <div class="empty" style="border-style:solid">
        On branche ici l’analyse concurrentielle (à venir).
      </div>
    `);
  }

  // ---------- Actions / Buttons ----------
  $("#btnLogout").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });

  $("#btnPortal").addEventListener("click", async () => {
    const r = await api("/api/stripe/portal", { method:"POST", body:"{}" });
    const data = await r.json().catch(()=>null);
    if (!r.ok) return alert(data?.error || "Impossible d'ouvrir le portal");
    window.location.href = data.url;
  });

  $("#btnExportAudits").addEventListener("click", async () => {
    closeExports();
    window.location.href = "/api/export/audits.csv";
  });

  $("#btnExportMonitors").addEventListener("click", async () => {
    closeExports();
    window.location.href = "/api/export/monitors.csv";
  });

  $("#btnRefresh").addEventListener("click", async () => {
    await refreshAll();
  });

  $("#btnAddMonitor").addEventListener("click", async () => {
    const url = prompt("URL du site (https://...)");
    if (!url) return;
    const interval = Number(prompt("Interval minutes (min 5)", "60") || "60");
    const r = await api("/api/monitors", { method:"POST", body: JSON.stringify({ url, intervalMinutes: interval }) });
    const data = await r.json().catch(()=>null);
    if (!r.ok) return alert(data?.error || "Erreur add monitor");
    await refreshMonitors();
    alert("Monitor ajouté ✅");
  });

  $("#btnRunAudit").addEventListener("click", async () => {
    const url = prompt("URL à auditer (https://...)");
    if (!url) return;
    const r = await api("/api/audits/run", { method:"POST", body: JSON.stringify({ url }) });
    const data = await r.json().catch(()=>null);
    if (!r.ok) return alert(data?.error || "Erreur audit");
    alert(`Audit OK ✅ Score: ${data.score}/100`);
    await refreshAll();
  });

  $("#btnSeePlans").addEventListener("click", () => {
    window.location.href = "/pricing.html";
  });

  // Plans buttons => vers pricing (ou checkout selon toi)
  function goCheckout(plan) {
    // Si tu veux ouvrir checkout direct:
    // api("/api/stripe/checkout",{method:"POST",body:JSON.stringify({plan})}).then(r=>r.json()).then(d=>location.href=d.url)
    window.location.href = "/pricing.html";
  }
  $("#btnChooseStandard").addEventListener("click", () => goCheckout("standard"));
  $("#btnChoosePro").addEventListener("click", () => goCheckout("pro"));
  $("#btnChooseUltra").addEventListener("click", () => goCheckout("ultra"));

  // ---------- Range ----------
  $("#rangeSelect").addEventListener("change", () => refreshAll());

  function setRangeLabels(days) {
    $("#kpiRange").textContent = `LAST ${days} DAYS`;
    $("#seoHint").textContent = `Last ${days} days`;
    $("#perfRange").textContent = `${days} days`;
  }

  // ---------- Refresh all ----------
  async function refreshAll() {
    const days = Number($("#rangeSelect").value || 30);
    setRangeLabels(days);

    $("#statusText").textContent = "Refreshing…";
    $("#statusPill .dot").style.background = "#f59e0b";

    const [me, ov] = await Promise.all([fetchMe(), fetchOverview(days)]);
    if (me) setAccount(me);

    if (ov?.ok) {
      $("#seoScore").textContent = String(ov.seoScore ?? 0);
      $("#localVis").textContent = String(ov.localVis ?? "+0%");
      $("#monActive").textContent = String(ov.monitors?.active ?? 0);
      $("#monInc").textContent = String(ov.monitors?.down ?? 0);
      drawChart(Array.isArray(ov.chart) ? ov.chart : []);
    } else {
      drawChart([0, 10, 15, 12, 18, 22, 30]);
    }

    await refreshMonitors();

    $("#statusText").textContent = "Dashboard à jour — OK";
    $("#statusPill .dot").style.background = "#22c55e";
  }

  // ---------- Init route ----------
  function currentRoute() {
    const h = (location.hash || "#overview").replace("#","");
    return routes.includes(h) ? h : "overview";
  }

  window.addEventListener("hashchange", () => setActiveRoute(currentRoute()));
  $$("[data-route]").forEach(a => {
    a.addEventListener("click", () => {
      // handled by hashchange
    });
  });

  // initial
  setActiveRoute(currentRoute());
  refreshAll();

})();
