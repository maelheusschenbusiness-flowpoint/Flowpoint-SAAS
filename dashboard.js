(function () {
  const $ = (id) => document.getElementById(id);

  const token = localStorage.getItem("token") || "";
  const headers = token ? { Authorization: "Bearer " + token } : {};

  let days = 30;

  // --- Mobile drawer
  const sidebar = $("sidebar");
  const overlay = $("overlay");
  const btnMenu = $("btnMenu");

  function openSidebar() {
    sidebar.classList.add("open");
    overlay.hidden = false;
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.hidden = true;
  }
  btnMenu?.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });
  overlay?.addEventListener("click", closeSidebar);

  // --- Range dropdown
  const rangeBtn = $("rangeBtn");
  const rangeMenu = $("rangeMenu");
  function setRangeLabel() {
    $("rangeLabel").textContent = `Last ${days} days`;
    $("rangeTitle").textContent = `LAST ${days} DAYS`;
    $("seoHint").textContent = `Last ${days} days`;
  }

  rangeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    rangeMenu.hidden = !rangeMenu.hidden;
  });

  document.addEventListener("click", () => { if (rangeMenu) rangeMenu.hidden = true; });

  rangeMenu?.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-days]");
    if (!b) return;
    days = Number(b.dataset.days || 30);
    setRangeLabel();
    rangeMenu.hidden = true;
    await refreshAll();
  });

  // --- API helpers
  async function apiGet(path) {
    const r = await fetch(path, { headers });
    if (r.status === 401) {
      localStorage.removeItem("token");
      location.href = "/login.html";
      return null;
    }
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) return r.json();
    return r.text();
  }

  function setStatus(ok, msg) {
    const pill = $("statusPill");
    const text = $("statusText");
    if (!pill || !text) return;
    text.textContent = msg || (ok ? "Dashboard à jour — OK" : "Erreur de chargement");
    const dot = pill.querySelector(".dot");
    if (dot) dot.style.background = ok ? "var(--green)" : "#ef4444";
  }

  // --- Chart (simple line)
  function drawChart(values) {
    const canvas = $("chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const padding = 18;
    const innerW = w - padding * 2;
    const innerH = h - padding * 2;

    const data = Array.isArray(values) && values.length ? values : [0, 0, 0, 0, 0];
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);

    const xStep = innerW / Math.max(1, data.length - 1);

    function yScale(v) {
      const t = (v - min) / (max - min || 1);
      return padding + innerH - t * innerH;
    }

    // grid
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#94a3b8";
    for (let i = 0; i <= 4; i++) {
      const y = padding + (innerH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // line
    ctx.strokeStyle = "#1d4ed8";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = padding + i * xStep;
      const y = yScale(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // fill
    const grad = ctx.createLinearGradient(0, padding, 0, h - padding);
    grad.addColorStop(0, "rgba(29,78,216,.22)");
    grad.addColorStop(1, "rgba(29,78,216,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = padding + i * xStep;
      const y = yScale(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(w - padding, h - padding);
    ctx.lineTo(padding, h - padding);
    ctx.closePath();
    ctx.fill();
  }

  // --- Render monitors
  function renderMonitors(monitors) {
    const wrap = $("monitorsList");
    if (!wrap) return;
    wrap.innerHTML = "";

    const list = Array.isArray(monitors) ? monitors.slice(0, 4) : [];

    if (!list.length) {
      wrap.innerHTML = `<div class="trow"><div class="url">Aucun monitor</div><div class="status unk">—</div><div>—</div><div></div></div>`;
      return;
    }

    for (const m of list) {
      const st = (m.lastStatus || "unknown").toLowerCase();
      const cls = st === "up" ? "up" : st === "down" ? "down" : "unk";
      const interval = (m.intervalMinutes ?? 60) + " min";

      const row = document.createElement("div");
      row.className = "trow";
      row.innerHTML = `
        <div class="url" title="${m.url || ""}">${m.url || ""}</div>
        <div class="status ${cls}">${st === "unknown" ? "Unknown" : st.toUpperCase()}</div>
        <div>${interval}</div>
        <button class="runBtn" data-id="${m._id}">Run</button>
      `;
      wrap.appendChild(row);
    }

    wrap.addEventListener("click", async (e) => {
      const btn = e.target.closest("button.runBtn");
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id) return;
      btn.disabled = true;
      btn.textContent = "…";
      try {
        const r = await fetch(`/api/monitors/${id}/run`, { method: "POST", headers });
        const data = await r.json().catch(() => null);
        await refreshMonitors();
        setStatus(true, "Dashboard à jour — OK");
      } catch {
        setStatus(false, "Erreur monitor");
      } finally {
        btn.disabled = false;
        btn.textContent = "Run";
      }
    }, { once: true });
  }

  // --- Plans
  function renderPlans(me) {
    const grid = $("plansGrid");
    if (!grid) return;

    const current = (me?.plan || "standard").toLowerCase();

    const plans = [
      { key: "standard", name: "Standard", price: "29€", items: ["SEO audits: 30", "Monitors: 3", "PDF exports"] },
      { key: "pro", name: "Pro", price: "79€", items: ["SEO audits: 300", "Monitors: 50", "Email alerts", "PDF & CSV"] },
      { key: "ultra", name: "Ultra", price: "149€", items: ["SEO audits: 2000", "Monitors: 300", "Team + Reports", "White-label"] },
    ];

    grid.innerHTML = plans.map(p => {
      const highlight = p.key === current ? "highlight" : "";
      const btnText = p.key === current ? "Actuel" : (p.key === "standard" ? "Choisir Standard" : `Passer en ${p.name}`);
      return `
        <div class="plan ${highlight}">
          <div class="planTop">
            <div class="planName">${p.name}</div>
            <div class="planPrice">${p.price}<span>/mo</span></div>
          </div>
          <ul class="planList">
            ${p.items.map(i => `<li>${i}</li>`).join("")}
          </ul>
          <button class="planBtn" data-plan="${p.key}" ${p.key === current ? "disabled" : ""}>${btnText}</button>
        </div>
      `;
    }).join("");

    grid.addEventListener("click", async (e) => {
      const b = e.target.closest("button.planBtn");
      if (!b) return;
      const plan = b.dataset.plan;
      if (!plan) return;

      b.disabled = true;
      b.textContent = "Redirect…";
      try {
        // checkout
        const r = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ plan })
        });
        const data = await r.json();
        if (data?.url) location.href = data.url;
        else setStatus(false, data?.error || "Stripe checkout error");
      } catch {
        setStatus(false, "Stripe checkout error");
      } finally {
        b.disabled = false;
      }
    }, { once: true });
  }

  // --- Loaders
  async function refreshMe() {
    const me = await apiGet("/api/me");
    if (!me) return null;

    $("helloTitle").textContent = `Bonjour, ${me.org?.name || me.companyName || me.email || ""}`;
    $("accPlan").textContent = (me.plan || "—").toUpperCase();
    $("accOrg").textContent = me.org?.name || "—";
    $("accRole").textContent = me.role || "—";
    $("accTrial").textContent = me.hasTrial ? "ON" : "—";
    $("avatar").textContent = (me.org?.name || "FP").slice(0,2).toUpperCase();

    renderPlans(me);
    return me;
  }

  async function refreshOverview() {
    const data = await apiGet(`/api/overview?days=${days}`);
    if (!data) return null;

    $("seoScore").textContent = String(data.seoScore ?? 0);
    $("localVis").textContent = String(data.localVis ?? "+0%");
    drawChart(data.chart || []);
    return data;
  }

  async function refreshMonitors() {
    const data = await apiGet("/api/monitors");
    if (!data) return null;
    renderMonitors(data.monitors || []);
    return data;
  }

  async function refreshAll() {
    try {
      setStatus(true, "Chargement…");
      await refreshMe();
      await refreshOverview();
      await refreshMonitors();
      setStatus(true, "Dashboard à jour — OK");
    } catch {
      setStatus(false, "Erreur de chargement");
    }
  }

  // --- Buttons
  $("btnRefresh")?.addEventListener("click", refreshAll);

  $("btnExportAudits")?.addEventListener("click", () => {
    window.location.href = "/api/export/audits.csv";
  });
  $("btnExportMonitors")?.addEventListener("click", () => {
    window.location.href = "/api/export/monitors.csv";
  });

  $("btnPortal")?.addEventListener("click", async () => {
    try {
      const r = await fetch("/api/stripe/portal", { method: "POST", headers });
      const data = await r.json();
      if (data?.url) location.href = data.url;
      else setStatus(false, data?.error || "Portal error");
    } catch {
      setStatus(false, "Portal error");
    }
  });

  $("btnLogout")?.addEventListener("click", () => {
    localStorage.removeItem("token");
    location.href = "/login.html";
  });

  $("btnSeePlans")?.addEventListener("click", () => {
    document.getElementById("plans")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("btnAddMonitor")?.addEventListener("click", async () => {
    const url = prompt("URL du monitor (https://...)");
    if (!url) return;
    const intervalMinutes = Number(prompt("Interval (minutes, min 5)", "60") || "60");
    try {
      const r = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ url, intervalMinutes })
      });
      const data = await r.json();
      if (!r.ok) return setStatus(false, data?.error || "Erreur monitor");
      await refreshMonitors();
      setStatus(true, "Monitor ajouté");
    } catch {
      setStatus(false, "Erreur monitor");
    }
  });

  $("btnRunAudit")?.addEventListener("click", async () => {
    const url = prompt("URL à auditer (https://...)");
    if (!url) return;
    try {
      const r = await fetch("/api/audits/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ url })
      });
      const data = await r.json();
      if (!r.ok) return setStatus(false, data?.error || "Erreur audit");
      setStatus(true, `Audit OK — Score ${data.score ?? "?"}/100`);
      await refreshOverview();
    } catch {
      setStatus(false, "Erreur audit");
    }
  });

  // init
  setRangeLabel();
  refreshAll();
})();
