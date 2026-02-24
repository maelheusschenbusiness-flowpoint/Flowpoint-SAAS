/* FlowPoint Dashboard JS — hash routing + API wiring */
(() => {
  const TOKEN_KEY = "fp_token";
  const token = localStorage.getItem(TOKEN_KEY);

  // If token missing -> go login
  if (!token) {
    location.replace("/login.html");
    return;
  }

  // Helpers
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));

  const api = async (path, opts = {}) => {
    const r = await fetch(path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };

  function setActiveRoute(route) {
    $$("#nav a").forEach(a => a.classList.toggle("active", a.dataset.route === route));
    $$(".section").forEach(s => s.classList.remove("active"));
    const sec = document.getElementById(`sec-${route}`);
    if (sec) sec.classList.add("active");
  }

  function currentRoute() {
    const h = (location.hash || "#overview").replace("#", "");
    const allowed = new Set(["overview","audits","monitors","local","competitors","reports","billing","settings"]);
    return allowed.has(h) ? h : "overview";
  }

  // Mobile drawer clones sidebar content
  function mountDrawer() {
    const mount = $("#drawerMount");
    const sidebarCard = document.querySelector(".sidebar .sidebar-card");
    if (!mount || !sidebarCard) return;
    mount.innerHTML = "";
    const clone = sidebarCard.cloneNode(true);
    clone.style.height = "auto";
    clone.style.boxShadow = "none";
    mount.appendChild(clone);

    // wire drawer nav click close
    mount.querySelectorAll("a[data-route]").forEach(a => {
      a.addEventListener("click", () => closeDrawer());
    });
    // wire buttons in drawer
    mount.querySelector("#btnPortal")?.addEventListener("click", openPortal);
    mount.querySelector("#btnLogout")?.addEventListener("click", logout);
  }

  function openDrawer() { $("#drawer").classList.add("open"); }
  function closeDrawer() { $("#drawer").classList.remove("open"); }

  // UI references
  const dashStatus = $("#dashStatus");
  const dashStatusTxt = $("#dashStatusTxt");

  const kSeo = $("#kSeo");
  const kLocal = $("#kLocal");
  const kMonitors = $("#kMonitors");
  const kMonitorsSub = $("#kMonitorsSub");
  const kIncidents = $("#kIncidents");

  const hello = $("#hello");
  const whoMobile = $("#whoMobile");

  const accPlan = $("#accPlan");
  const accOrg = $("#accOrg");
  const accRole = $("#accRole");
  const accTrial = $("#accTrial");

  // Chart (simple canvas line chart)
  function drawChart(points) {
    const canvas = $("#chart");
    if (!canvas) return;

    // handle HiDPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, Math.floor(rect.width * dpr));
    canvas.height = Math.max(160, Math.floor(rect.height * dpr));

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // grid
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(16,24,40,.10)";
    for (let i = 0; i <= 4; i++) {
      const y = (rect.height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }

    const min = Math.min(...points);
    const max = Math.max(...points);
    const pad = 18;
    const W = rect.width - pad * 2;
    const H = rect.height - pad * 2;

    const X = (i) => pad + (W * i) / (points.length - 1);
    const Y = (v) => pad + (H * (1 - (v - min) / (max - min || 1)));

    // area fill
    ctx.beginPath();
    ctx.moveTo(X(0), Y(points[0]));
    for (let i = 1; i < points.length; i++) ctx.lineTo(X(i), Y(points[i]));
    ctx.lineTo(X(points.length - 1), pad + H);
    ctx.lineTo(X(0), pad + H);
    ctx.closePath();
    ctx.fillStyle = "rgba(45,107,255,.10)";
    ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(X(0), Y(points[0]));
    for (let i = 1; i < points.length; i++) ctx.lineTo(X(i), Y(points[i]));
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = "rgba(45,107,255,.95)";
    ctx.stroke();

    // dots
    for (let i = 0; i < points.length; i += Math.ceil(points.length / 10)) {
      ctx.beginPath();
      ctx.arc(X(i), Y(points[i]), 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(45,107,255,.95)";
      ctx.fill();
    }
  }

  // Data loaders
  async function loadMe() {
    const me = await api("/api/me");
    hello.textContent = `Bonjour, ${me.companyName || me.name || "—"}`;
    whoMobile.textContent = me.email || "—";

    accPlan.textContent = (me.plan || "—").toUpperCase();
    accOrg.textContent = me.org?.name ? `${me.org.name}` : "—";
    accRole.textContent = me.role || "—";
    accTrial.textContent = me.trialEndsAt ? new Date(me.trialEndsAt).toLocaleDateString("fr-FR") : "—";

    // update drawer clone if open / mounted
    mountDrawer();

    return me;
  }

  function setDashboardStatus(ok) {
    dashStatus.classList.remove("ok","bad");
    dashStatus.classList.add(ok ? "ok" : "bad");
    dashStatusTxt.textContent = ok ? "Dashboard à jour — OK" : "Problème détecté";
  }

  async function loadMonitorsInto(tbody) {
    const data = await api("/api/monitors");
    const list = data.monitors || [];

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted)">No monitors yet.</td></tr>`;
      return { up: 0, down: 0, total: 0 };
    }

    tbody.innerHTML = list.map(m => {
      const st = (m.lastStatus || "unknown").toLowerCase();
      const tag =
        st === "up" ? `<span class="tag up">Up</span>` :
        st === "down" ? `<span class="tag down">Down</span>` :
        `<span class="tag pending">Unknown</span>`;

      const last = m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleString("fr-FR") : "—";
      const interval = `${m.intervalMinutes || 60} min`;

      return `
        <tr>
          <td class="mono">${escapeHtml(m.url || "")}</td>
          <td>${tag}</td>
          <td>${interval}</td>
          <td>${last}</td>
          <td>${st === "unknown" ? "—" : ""}</td>
          <td>
            <button class="smallbtn" data-run="${m._id}">Run</button>
            <button class="smallbtn" data-toggle="${m._id}" data-active="${m.active ? "1":"0"}">${m.active ? "Pause" : "Resume"}</button>
          </td>
        </tr>
      `;
    }).join("");

    // bind actions
    tbody.querySelectorAll("[data-run]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-run");
        btn.disabled = true;
        btn.textContent = "Running…";
        try {
          await api(`/api/monitors/${id}/run`, { method: "POST" });
          await refreshAll();
        } catch (e) {
          alert(e.message);
        } finally {
          btn.disabled = false;
          btn.textContent = "Run";
        }
      });
    });

    tbody.querySelectorAll("[data-toggle]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-toggle");
        const active = btn.getAttribute("data-active") === "1";
        btn.disabled = true;
        try {
          await api(`/api/monitors/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ active: !active }),
          });
          await refreshAll();
        } catch (e) {
          alert(e.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    const up = list.filter(m => (m.lastStatus || "").toLowerCase() === "up").length;
    const down = list.filter(m => (m.lastStatus || "").toLowerCase() === "down").length;
    return { up, down, total: list.length };
  }

  async function loadAuditsInto(tbody) {
    const data = await api("/api/audits");
    const list = data.audits || [];

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted)">No audits yet.</td></tr>`;
      return { lastScore: null, total: 0 };
    }

    tbody.innerHTML = list.map(a => {
      const st = (a.status || "ok").toLowerCase();
      const tag =
        st === "ok" ? `<span class="tag up">OK</span>` :
        `<span class="tag down">Error</span>`;

      const dt = a.createdAt ? new Date(a.createdAt).toLocaleString("fr-FR") : "—";
      const score = Number.isFinite(a.score) ? a.score : "—";

      return `
        <tr>
          <td>${dt}</td>
          <td class="mono">${escapeHtml(a.url || "")}</td>
          <td>${tag}</td>
          <td style="font-weight:850">${score}</td>
          <td>
            <button class="smallbtn" data-open="${a._id}">View</button>
            <a class="smallbtn" href="/api/audits/${a._id}/pdf" target="_blank" style="text-decoration:none;display:inline-flex;align-items:center">PDF</a>
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("[data-open]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-open");
        btn.disabled = true;
        try {
          const one = await api(`/api/audits/${id}`);
          alert(`Score ${one.audit?.score}/100\n\n${one.audit?.summary || ""}`);
        } catch (e) {
          alert(e.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    const lastScore = Number.isFinite(list[0].score) ? list[0].score : null;
    return { lastScore, total: list.length };
  }

  async function loadOrgSettings() {
    try {
      const r = await api("/api/org/settings");
      const s = r.settings || {};
      $("#alertRecipients").value = (s.alertRecipients || "all").toLowerCase();
      $("#alertExtraEmails").value = Array.isArray(s.alertExtraEmails) ? s.alertExtraEmails.join(", ") : "";
      $("#settingsMsg").textContent = "Loaded.";
    } catch (e) {
      $("#settingsMsg").textContent = e.message;
    }
  }

  async function saveOrgSettings() {
    $("#settingsMsg").textContent = "Saving…";
    try {
      const alertRecipients = $("#alertRecipients").value;
      const alertExtraEmails = ($("#alertExtraEmails").value || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      await api("/api/org/settings", {
        method: "POST",
        body: JSON.stringify({ alertRecipients, alertExtraEmails })
      });
      $("#settingsMsg").textContent = "Saved ✅";
    } catch (e) {
      $("#settingsMsg").textContent = e.message;
    }
  }

  // Billing
  async function checkout(plan) {
    try {
      const r = await api("/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ plan })
      });
      if (r.url) location.href = r.url;
    } catch (e) {
      alert(e.message);
    }
  }

  async function openPortal() {
    try {
      const r = await api("/api/stripe/portal", { method: "POST" });
      if (r.url) location.href = r.url;
    } catch (e) {
      alert(e.message);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    location.replace("/login.html");
  }

  // Add monitor modal
  function openAddMonitor() {
    $("#modalAdd").classList.add("open");
    $("#mMsg").textContent = "—";
  }
  function closeAddMonitor() {
    $("#modalAdd").classList.remove("open");
  }

  async function createMonitor() {
    const url = ($("#mUrl").value || "").trim();
    const intervalMinutes = Number($("#mInterval").value || 60);

    $("#mCreate").disabled = true;
    $("#mMsg").textContent = "Creating…";
    try {
      await api("/api/monitors", {
        method: "POST",
        body: JSON.stringify({ url, intervalMinutes })
      });
      $("#mMsg").textContent = "Created ✅";
      closeAddMonitor();
      await refreshAll();
    } catch (e) {
      $("#mMsg").textContent = e.message;
    } finally {
      $("#mCreate").disabled = false;
    }
  }

  async function testMonitorNow() {
    const url = ($("#mUrl").value || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      $("#mMsg").textContent = "URL invalide (http/https)";
      return;
    }
    $("#mTest").disabled = true;
    $("#mMsg").textContent = "Test… (tip: crée le monitor puis Run pour logs)";
    setTimeout(() => { $("#mTest").disabled = false; }, 600);
  }

  // Run audit
  async function runAuditFromInput() {
    const url = ($("#auditUrl").value || "").trim();
    $("#auditsStatus").textContent = "Running…";
    try {
      const r = await api("/api/audits/run", { method: "POST", body: JSON.stringify({ url }) });
      $("#auditsStatus").textContent = r.cached ? `Cached ✅ Score ${r.score}` : `Done ✅ Score ${r.score}`;
      await refreshAll();
    } catch (e) {
      $("#auditsStatus").textContent = e.message;
      alert(e.message);
    }
  }

  // Main refresh
  async function refreshAll() {
    // range affects labels only for now
    const days = Number($("#range").value || 30);
    $("#perfLabel").textContent = `Last ${days} days`;

    try {
      setDashboardStatus(true);

      const me = await loadMe();

      // load monitors (overview + monitors section)
      const stats1 = await loadMonitorsInto($("#monitorsBody"));
      const stats2 = await loadMonitorsInto($("#monitorsBody2"));

      kMonitors.textContent = String(stats1.total);
      kMonitorsSub.textContent = `${stats1.up} up · ${stats1.down} down`;

      // load audits
      const audits = await loadAuditsInto($("#auditsBody"));
      $("#auditsStatus").textContent = `${audits.total} audits`;

      // KPI SEO
      kSeo.textContent = audits.lastScore == null ? "—" : `${audits.lastScore}/100`;

      // Local KPI (placeholder consistent with your screenshot)
      kLocal.textContent = "+12%";

      // Incidents (placeholder from monitor logs would be next step)
      kIncidents.textContent = stats1.down ? String(stats1.down) : "0";

      // chart points (fake but stable-looking; replace later with real metric)
      const pts = makeSeries(days);
      drawChart(pts);

      // blocked status
      if (me.accessBlocked) setDashboardStatus(false);
    } catch (e) {
      setDashboardStatus(false);
      dashStatusTxt.textContent = e.message;
      console.error(e);
    }
  }

  function makeSeries(days) {
    // generate a smooth deterministic series based on day count (no random)
    const n = Math.min(30, Math.max(14, Math.floor(days / 2)));
    const out = [];
    let v = 65;
    for (let i = 0; i < n; i++) {
      const drift = (i < n * 0.6) ? -0.35 : 0.55;
      v = v + drift + (Math.sin(i * 0.7) * 0.6);
      v = Math.max(35, Math.min(92, v));
      out.push(Math.round(v * 10) / 10);
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Events
  window.addEventListener("hashchange", () => setActiveRoute(currentRoute()));

  $("#btnRefresh").addEventListener("click", refreshAll);
  $("#btnExportAudits").addEventListener("click", () => window.open("/api/export/audits.csv", "_blank"));
  $("#btnExportMonitors").addEventListener("click", () => window.open("/api/export/monitors.csv", "_blank"));

  $("#btnPortal").addEventListener("click", openPortal);
  $("#btnPortal2").addEventListener("click", openPortal);
  $("#btnLogout").addEventListener("click", logout);

  $("#btnOpenAddMonitor").addEventListener("click", openAddMonitor);
  $("#btnOpenAddMonitor2").addEventListener("click", openAddMonitor);
  $("#mCancel").addEventListener("click", closeAddMonitor);
  $("#mCreate").addEventListener("click", createMonitor);
  $("#mTest").addEventListener("click", testMonitorNow);
  $("#modalAdd").addEventListener("click", (e) => {
    if (e.target.id === "modalAdd") closeAddMonitor();
  });

  $("#btnRunAudit").addEventListener("click", () => {
    location.hash = "#audits";
    setTimeout(() => $("#auditUrl").focus(), 50);
  });
  $("#btnRunAudit2").addEventListener("click", runAuditFromInput);

  $("#btnSaveSettings").addEventListener("click", saveOrgSettings);

  // drawer
  $("#openDrawer").addEventListener("click", () => { mountDrawer(); openDrawer(); });
  $("#closeDrawer").addEventListener("click", closeDrawer);
  $("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") closeDrawer(); });

  // Plans checkout buttons
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-checkout]");
    if (!btn) return;
    const plan = btn.getAttribute("data-checkout");
    checkout(plan);
  });

  // Init
  setActiveRoute(currentRoute());
  loadOrgSettings();
  refreshAll();

  // Resize chart
  window.addEventListener("resize", () => {
    drawChart(makeSeries(Number($("#range").value || 30)));
  });
})();
