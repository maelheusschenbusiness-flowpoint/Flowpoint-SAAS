(() => {
  const $ = (q) => document.querySelector(q);

  const token = localStorage.getItem("token") || "";
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

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

  // Sidebar mobile
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  const btnBurger = $("#btnBurger");

  function openSidebar() {
    sidebar.classList.add("open");
    overlay.hidden = false;
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.hidden = true;
  }

  btnBurger?.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });
  overlay?.addEventListener("click", closeSidebar);

  // UI refs
  const helloTitle = $("#helloTitle");
  const avatar = $("#avatar");
  const statusText = $("#statusText");

  const accPlan = $("#accPlan");
  const accOrg = $("#accOrg");
  const accRole = $("#accRole");
  const accTrial = $("#accTrial");

  const seoScore = $("#seoScore");
  const localVis = $("#localVis");
  const rangeLabel = $("#rangeLabel");
  const rangeSmall = $("#rangeSmall");

  const monitorsBody = $("#monitorsBody");

  const btnRefresh = $("#btnRefresh");
  const btnExportAudits = $("#btnExportAudits");
  const btnExportMonitors = $("#btnExportMonitors");
  const btnPortal = $("#btnPortal");
  const btnLogout = $("#btnLogout");
  const btnSeePlans = $("#btnSeePlans");
  const btnRunAudit = $("#btnRunAudit");
  const btnAddMonitor = $("#btnAddMonitor");

  // Range selection
  let days = 30;
  document.querySelectorAll(".segbtn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".segbtn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      days = Number(b.dataset.days || 30);
      refreshAll();
    });
  });

  // Chart
  const canvas = $("#chart");
  const ctx = canvas.getContext("2d");

  function drawChart(points) {
    // points: array numbers
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // padding
    const pad = 22;
    const X0 = pad;
    const Y0 = pad;
    const X1 = w - pad;
    const Y1 = h - pad;

    // background grid
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(15,23,42,.10)";
    for (let i = 0; i <= 4; i++) {
      const y = Y0 + ((Y1 - Y0) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(X0, y);
      ctx.lineTo(X1, y);
      ctx.stroke();
    }

    const arr = Array.isArray(points) && points.length ? points : [0, 0, 0];
    const min = 0;
    const max = 100;

    const n = arr.length;
    const dx = n === 1 ? 0 : (X1 - X0) / (n - 1);

    const mapY = (v) => {
      const t = (v - min) / (max - min);
      return Y1 - t * (Y1 - Y0);
    };

    // area
    ctx.beginPath();
    ctx.moveTo(X0, mapY(arr[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(X0 + dx * i, mapY(arr[i]));
    ctx.lineTo(X0 + dx * (n - 1), Y1);
    ctx.lineTo(X0, Y1);
    ctx.closePath();
    ctx.fillStyle = "rgba(37,99,235,.10)";
    ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(X0, mapY(arr[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(X0 + dx * i, mapY(arr[i]));
    ctx.strokeStyle = "rgba(29,78,216,1)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // points
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(X0 + dx * i, mapY(arr[i]), 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(29,78,216,1)";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function capInitials(s) {
    const t = String(s || "").trim();
    if (!t) return "FP";
    const parts = t.split(/\s+/).filter(Boolean);
    const a = (parts[0] || "F")[0] || "F";
    const b = (parts[1] || "P")[0] || "P";
    return (a + b).toUpperCase();
  }

  function planLabel(p) {
    const x = String(p || "").toLowerCase();
    if (x === "standard") return "STANDARD";
    if (x === "pro") return "PRO";
    if (x === "ultra") return "ULTRA";
    return (x || "—").toUpperCase();
  }

  function setStatus(ok, msg) {
    statusText.textContent = msg || (ok ? "Dashboard à jour — OK" : "Problème à vérifier");
  }

  async function loadMe() {
    const r = await api("/api/me");
    if (!r) return null;
    const data = await r.json().catch(() => null);
    if (!data) return null;

    const displayName = data.companyName || data.name || data.email || "—";
    helloTitle.textContent = `Bonjour, ${displayName}`;

    avatar.textContent = capInitials(data.org?.name || displayName);

    accPlan.textContent = planLabel(data.plan);
    accOrg.textContent = data.org?.name || "—";
    accRole.textContent = String(data.role || "—");
    accTrial.textContent = data.trialEndsAt ? new Date(data.trialEndsAt).toLocaleDateString("fr-FR") : "—";

    // PRO badge on Reports
    const pro = ["pro", "ultra"].includes(String(data.plan || "").toLowerCase());
    const pill = $("#reportsPill");
    if (pill) pill.hidden = !pro;

    return data;
  }

  async function loadOverview() {
    rangeLabel.textContent = `LAST ${days} DAYS`;
    rangeSmall.textContent = String(days);

    const r = await api(`/api/overview?days=${encodeURIComponent(days)}`);
    if (!r) return null;
    const data = await r.json().catch(() => null);
    if (!data) return null;

    seoScore.textContent = String(data.seoScore ?? 0);
    localVis.textContent = String(data.localVis ?? "+0%");

    drawChart(Array.isArray(data.chart) ? data.chart : []);

    return data;
  }

  function renderMonitors(list) {
    monitorsBody.innerHTML = "";

    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
      const row = document.createElement("div");
      row.className = "t-row";
      row.innerHTML = `
        <div class="url" style="opacity:.7">Aucun monitor</div>
        <div><span class="badge unknown">Unknown</span></div>
        <div class="right">—</div>
        <div class="right">—</div>
      `;
      monitorsBody.appendChild(row);
      return;
    }

    for (const m of items) {
      const st = String(m.lastStatus || "unknown").toLowerCase();
      const badgeClass = st === "up" ? "up" : st === "down" ? "down" : "unknown";
      const label = st === "up" ? "Up" : st === "down" ? "Down" : "Unknown";

      const row = document.createElement("div");
      row.className = "t-row";
      row.innerHTML = `
        <div class="url" title="${m.url || ""}">${m.url || "-"}</div>
        <div><span class="badge ${badgeClass}">${label}</span></div>
        <div class="right">${m.intervalMinutes ? `${m.intervalMinutes} min` : "—"}</div>
        <div class="right"><button class="btn btn-ghost" data-run="${m._id}">Run</button></div>
      `;
      monitorsBody.appendChild(row);
    }

    // attach run handlers
    monitorsBody.querySelectorAll("[data-run]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-run");
        b.disabled = true;
        try {
          const rr = await api(`/api/monitors/${id}/run`, { method: "POST" });
          if (!rr) return;
          await rr.json().catch(() => null);
          await refreshMonitors();
          setStatus(true, "Dashboard à jour — OK");
        } catch {
          setStatus(false, "Erreur monitor");
        } finally {
          b.disabled = false;
        }
      });
    });
  }

  async function refreshMonitors() {
    const r = await api("/api/monitors");
    if (!r) return null;
    const data = await r.json().catch(() => null);
    renderMonitors(data?.monitors || []);
    return data;
  }

  async function refreshAll() {
    setStatus(true, "Mise à jour…");
    try {
      await loadMe();
      await loadOverview();
      await refreshMonitors();
      setStatus(true, "Dashboard à jour — OK");
    } catch {
      setStatus(false, "Problème à vérifier");
    }
  }

  // Buttons
  btnRefresh?.addEventListener("click", refreshAll);

  btnExportAudits?.addEventListener("click", () => {
    window.location.href = "/api/export/audits.csv";
  });
  btnExportMonitors?.addEventListener("click", () => {
    window.location.href = "/api/export/monitors.csv";
  });

  btnPortal?.addEventListener("click", async () => {
    const r = await api("/api/stripe/portal", { method: "POST", body: "{}" });
    if (!r) return;
    const data = await r.json().catch(() => null);
    if (data?.url) window.location.href = data.url;
    else alert("Impossible d’ouvrir le portail.");
  });

  btnLogout?.addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });

  btnSeePlans?.addEventListener("click", () => {
    window.location.href = "/pricing.html";
  });

  btnRunAudit?.addEventListener("click", async () => {
    const url = prompt("URL du site (https://...)");
    if (!url) return;
    const r = await api("/api/audits/run", { method: "POST", body: JSON.stringify({ url }) });
    if (!r) return;
    const data = await r.json().catch(() => null);
    if (data?.ok) {
      alert(`Audit lancé ✅ Score: ${data.score ?? "?"}`);
      refreshAll();
    } else {
      alert(data?.error || "Erreur audit");
    }
  });

  btnAddMonitor?.addEventListener("click", async () => {
    const url = prompt("URL à monitor (https://...)");
    if (!url) return;
    const interval = Number(prompt("Interval minutes (min 5)", "60"));
    const payload = { url, intervalMinutes: Number.isFinite(interval) ? interval : 60 };
    const r = await api("/api/monitors", { method: "POST", body: JSON.stringify(payload) });
    if (!r) return;
    const data = await r.json().catch(() => null);
    if (data?.ok) {
      refreshMonitors();
    } else {
      alert(data?.error || "Erreur monitor");
    }
  });

  // Plan buttons => Stripe checkout
  document.querySelectorAll("[data-plan]").forEach((b) => {
    b.addEventListener("click", async () => {
      const plan = b.getAttribute("data-plan");
      const r = await api("/api/stripe/checkout", { method: "POST", body: JSON.stringify({ plan }) });
      if (!r) return;
      const data = await r.json().catch(() => null);
      if (data?.url) window.location.href = data.url;
      else alert(data?.error || "Erreur checkout");
    });
  });

  // Init
  refreshAll();
})();
