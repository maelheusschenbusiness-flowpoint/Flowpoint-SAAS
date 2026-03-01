(function () {
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

  // Mobile drawer
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  const btnBurger = $("#btnBurger");

  function openSidebar() {
    sidebar.classList.add("open");
    overlay.classList.add("show");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
  }
  btnBurger?.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });
  overlay?.addEventListener("click", closeSidebar);

  // Range selector
  let days = 30;
  document.querySelectorAll(".seg__btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".seg__btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      days = Number(b.dataset.days || 30);
      $("#rangeLabel").textContent = `LAST ${days} DAYS`;
      refresh();
    });
  });

  // Buttons
  $("#btnLogout").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });

  $("#btnExportAudits").addEventListener("click", () => {
    window.location.href = "/api/export/audits.csv";
  });

  $("#btnExportMonitors").addEventListener("click", () => {
    window.location.href = "/api/export/monitors.csv";
  });

  $("#btnRefresh").addEventListener("click", () => refresh());

  $("#btnSeePlans").addEventListener("click", () => {
    window.location.href = "/pricing.html";
  });

  $("#btnPortal").addEventListener("click", async () => {
    const r = await api("/api/stripe/portal", { method: "POST", body: JSON.stringify({}) });
    if (!r) return;
    const data = await r.json().catch(() => ({}));
    if (data?.url) window.location.href = data.url;
    else alert(data?.error || "Impossible d'ouvrir le portal");
  });

  // Plan CTA -> Stripe checkout
  document.querySelectorAll('[data-action="choose-plan"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const plan = btn.dataset.plan;
      const r = await api("/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      if (!r) return;
      const data = await r.json().catch(() => ({}));
      if (data?.url) window.location.href = data.url;
      else alert(data?.error || "Checkout impossible");
    });
  });

  // Monitors
  $("#btnAddMonitor").addEventListener("click", async () => {
    const url = prompt("URL du site (https://...)");
    if (!url) return;
    const intervalMinutes = Number(prompt("Interval minutes (min 5)", "60") || "60");

    const r = await api("/api/monitors", {
      method: "POST",
      body: JSON.stringify({ url, intervalMinutes }),
    });
    if (!r) return;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return alert(data?.error || "Erreur monitor");
    refreshMonitors();
  });

  // Fake run audit button (tu peux brancher vers ton flow)
  $("#btnRunAudit").addEventListener("click", () => {
    // idéalement: ouvrir la page audits ou ouvrir un modal
    alert("Branche-moi sur ton écran Audits quand tu veux (run audit).");
  });

  // Canvas chart (sans lib)
  const canvas = $("#chart");
  const ctx = canvas.getContext("2d");

  function drawChart(points) {
    const w = canvas.width = canvas.parentElement.clientWidth - 2;
    const h = canvas.height = 130;

    ctx.clearRect(0, 0, w, h);

    const pad = 14;
    const xs = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 1;
    const min = 0;
    const max = 100;

    // grid
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(29,78,216,.25)";
    for (let i = 0; i < 4; i++) {
      const y = pad + (i * (h - pad * 2)) / 3;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (!points || !points.length) {
      // empty state line
      ctx.strokeStyle = "rgba(100,116,139,.7)";
      ctx.beginPath();
      ctx.moveTo(pad, h - pad);
      ctx.lineTo(w - pad, h - pad);
      ctx.stroke();
      return;
    }

    const toY = (v) => {
      const t = (v - min) / (max - min);
      return (h - pad) - t * (h - pad * 2);
    };

    // area fill
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad + i * xs;
      const y = toY(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad + (points.length - 1) * xs, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = "rgba(29,78,216,.12)";
    ctx.fill();

    // line
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad + i * xs;
      const y = toY(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(29,78,216,1)";
    ctx.stroke();
  }

  async function refreshMe() {
    const r = await api("/api/me");
    if (!r) return;
    const me = await r.json().catch(() => ({}));

    $("#helloTitle").textContent = `Bonjour, ${me?.org?.name || me?.companyName || me?.name || "—"}`;
    $("#helloSub").textContent = "SEO · Monitoring · Reports · Billing";

    $("#accPlan").textContent = (me?.plan || "—").toUpperCase();
    $("#accOrg").textContent = me?.org?.name || "—";
    $("#accRole").textContent = me?.role || "—";
    $("#accTrial").textContent = me?.trialEndsAt ? "actif" : "—";

    // avatar
    const initials = (me?.org?.name || "FP")
      .split(" ")
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() || "")
      .join("");
    $("#avatar").textContent = initials || "FP";
  }

  async function refreshOverview() {
    const r = await api(`/api/overview?days=${days}`);
    if (!r) return;
    const data = await r.json().catch(() => ({}));

    $("#seoScore").textContent = String(data?.seoScore ?? 0);
    $("#localVis").textContent = String(data?.localVis ?? "+0%");
    $("#seoScoreSub").textContent = `Last ${days} days`;

    const chart = Array.isArray(data?.chart) ? data.chart : [];
    // badge "Last 3 days" comme ton design
    $("#chartBadge").textContent = "Last 3 days";
    drawChart(chart);

    const ok = true;
    $("#statusText").textContent = ok ? "Dashboard à jour — OK" : "Problème — à vérifier";
  }

  async function refreshMonitors() {
    const r = await api("/api/monitors");
    if (!r) return;
    const data = await r.json().catch(() => ({}));
    const list = Array.isArray(data?.monitors) ? data.monitors : [];

    const tbody = $("#monitorsTbody");
    tbody.innerHTML = "";

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="muted">Aucun monitor.</td></tr>`;
      return;
    }

    list.slice(0, 5).forEach((m) => {
      const st = String(m.lastStatus || "unknown").toLowerCase();
      const badge =
        st === "up" ? `<span class="badge badge--up">Up</span>` :
        st === "down" ? `<span class="badge badge--down">Down</span>` :
        `<span class="badge badge--unk">Unknown</span>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td title="${m.url}">${escapeHtml(shorten(m.url, 40))}</td>
        <td>${badge}</td>
        <td>${Number(m.intervalMinutes || 60)} min</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function shorten(s, n) {
    s = String(s || "");
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + "…";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  async function refresh() {
    await Promise.all([refreshMe(), refreshOverview(), refreshMonitors()]);
  }

  // initial
  refresh();

  // redraw chart on resize
  window.addEventListener("resize", () => refreshOverview());

})();
