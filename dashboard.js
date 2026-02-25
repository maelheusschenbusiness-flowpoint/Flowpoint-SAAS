(() => {
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));

  // ----- Token -----
  function getToken() {
    return localStorage.getItem("fp_token") || localStorage.getItem("token") || "";
  }

  function authHeaders() {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  function fmtDate(d) {
    try {
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return "—";
      return dt.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "—";
    }
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(opts.headers || {}),
      },
    });

    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  // ----- Sidebar mobile -----
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  const openBtn = $("#openSidebar");
  const closeBtn = $("#closeSidebar");

  function openSidebar() {
    sidebar.classList.add("isOpen");
    overlay.classList.add("isOpen");
    overlay.setAttribute("aria-hidden", "false");
  }
  function closeSidebar() {
    sidebar.classList.remove("isOpen");
    overlay.classList.remove("isOpen");
    overlay.setAttribute("aria-hidden", "true");
  }

  openBtn?.addEventListener("click", openSidebar);
  closeBtn?.addEventListener("click", closeSidebar);
  overlay?.addEventListener("click", closeSidebar);

  // ----- View switching -----
  function showView(name) {
    $$(".navItem").forEach(b => b.classList.toggle("isActive", b.dataset.view === name));
    $$(".view").forEach(v => v.classList.remove("isShown"));
    const target = $(`#view-${name}`);
    if (target) target.classList.add("isShown");
    closeSidebar();
  }

  $$(".navItem").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  // ----- Chart (stable mock but clean) -----
  function setChart(points) {
    // points: [0..100]
    const W = 600, H = 180;
    const padX = 20, padY = 18;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;

    const xs = points.map((_, i) => padX + (innerW * (i / (points.length - 1))));
    const ys = points.map(v => {
      const vv = Math.max(0, Math.min(100, v));
      return padY + innerH * (1 - vv / 100);
    });

    const line = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(" ");
    const area = `${line} L ${xs[xs.length - 1].toFixed(2)} ${(H - padY).toFixed(2)} L ${xs[0].toFixed(2)} ${(H - padY).toFixed(2)} Z`;

    $("#chartLine").setAttribute("d", line);
    $("#chartArea").setAttribute("d", area);

    const dots = $("#chartDots");
    dots.innerHTML = "";
    xs.forEach((x, i) => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", x);
      c.setAttribute("cy", ys[i]);
      c.setAttribute("r", 4);
      c.setAttribute("class", "chartDot");
      dots.appendChild(c);
    });
  }

  // ----- Render -----
  function setStatus(ok) {
    const dot = $("#statusDot");
    const txt = $("#statusText");
    if (!dot || !txt) return;
    if (ok) {
      dot.style.background = "var(--green)";
      dot.style.boxShadow = "0 0 0 5px rgba(22,163,74,.12)";
      txt.textContent = "Dashboard à jour — OK";
    } else {
      dot.style.background = "#EF4444";
      dot.style.boxShadow = "0 0 0 5px rgba(239,68,68,.12)";
      txt.textContent = "Problème de chargement — vérifie le token / API";
    }
  }

  function planToLabel(p) {
    const x = String(p || "").toLowerCase();
    if (x === "standard") return "STANDARD";
    if (x === "pro") return "PRO";
    if (x === "ultra") return "ULTRA";
    return "—";
  }

  function safeText(el, v) {
    if (!el) return;
    el.textContent = (v === null || v === undefined || v === "") ? "—" : String(v);
  }

  function statusBadge(status) {
    const s = String(status || "unknown").toLowerCase();
    if (s === "up") return `<span class="badge badgeUp">● Up</span>`;
    if (s === "down") return `<span class="badge badgeDown">● Down</span>`;
    return `<span class="badge badgeUnk">Unknown</span>`;
  }

  async function loadMe() {
    const me = await api("/api/me");
    safeText($("#userEmail"), me.email || "—");
    safeText($("#kvPlan"), planToLabel(me.plan));
    safeText($("#kvOrg"), me.org?.name || "—");
    safeText($("#kvRole"), me.role || "—");

    const t = me.trialEndsAt ? new Date(me.trialEndsAt) : null;
    safeText($("#kvTrial"), t ? t.toLocaleDateString("fr-FR") : "—");

    // Hello block
    const orgName = me.org?.name || me.companyName || "—";
    $("#helloTitle").textContent = `Bonjour, ${orgName}`;
    $("#helloSub").textContent = "SEO · Monitoring · Reports · Billing";

    return me;
  }

  async function loadAudits() {
    const out = await api("/api/audits");
    const list = out.audits || [];
    const body = $("#auditsBody");
    if (!body) return;

    if (!list.length) {
      body.innerHTML = `<tr><td colspan="5" class="tdMuted">No audits yet.</td></tr>`;
      return;
    }

    body.innerHTML = list.slice(0, 50).map(a => {
      const status = (a.status === "ok")
        ? `<span class="badge badgeUp">● OK</span>`
        : `<span class="badge badgeDown">● Error</span>`;
      return `
        <tr>
          <td>${fmtDate(a.createdAt)}</td>
          <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.url || "—"}</td>
          <td>${status}</td>
          <td>${(a.score ?? "—")}</td>
          <td style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.summary || "—"}</td>
        </tr>
      `;
    }).join("");
  }

  async function loadMonitors() {
    const out = await api("/api/monitors");
    const list = out.monitors || [];

    const body = $("#monitorsBody");
    const mini = $("#monitorsMiniBody");

    const kpiMon = $("#kpiMonitors");
    const kpiMonSub = $("#kpiMonitorsSub");

    safeText(kpiMon, list.length);
    safeText(kpiMonSub, `${list.filter(m => (m.lastStatus || "unknown") === "up").length} up · ${list.filter(m => (m.lastStatus || "unknown") === "down").length} down`);

    if (body) {
      if (!list.length) {
        body.innerHTML = `<tr><td colspan="6" class="tdMuted">No monitors yet.</td></tr>`;
      } else {
        body.innerHTML = list.map(m => `
          <tr>
            <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.url || "—"}</td>
            <td>${statusBadge(m.lastStatus)}</td>
            <td>${m.intervalMinutes || 60} min</td>
            <td>${m.lastCheckedAt ? fmtDate(m.lastCheckedAt) : "—"}</td>
            <td>${m.lastStatus && m.lastStatus !== "unknown" ? "—" : "—"}</td>
            <td>
              <div class="rowBtns">
                <button class="btn btnGhost btnMini" data-run="${m._id}">Run</button>
                <button class="btn btnGhost btnMini" data-toggle="${m._id}" data-active="${m.active ? "1" : "0"}">${m.active ? "Pause" : "Resume"}</button>
              </div>
            </td>
          </tr>
        `).join("");
      }
    }

    if (mini) {
      if (!list.length) {
        mini.innerHTML = `<tr><td colspan="5" class="tdMuted">No monitors yet.</td></tr>`;
      } else {
        mini.innerHTML = list.slice(0, 6).map(m => `
          <tr>
            <td style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.url || "—"}</td>
            <td>${statusBadge(m.lastStatus)}</td>
            <td>${m.intervalMinutes || 60} min</td>
            <td>${m.lastCheckedAt ? "—" : "—"}</td>
            <td>${"—"}</td>
          </tr>
        `).join("");
      }
    }

    // Bind row actions
    $$("#monitorsBody [data-run]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-run");
        btn.disabled = true;
        try {
          await api(`/api/monitors/${id}/run`, { method: "POST" });
          await loadMonitors();
        } catch (e) {
          alert(`Run monitor: ${e.message}`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    $$("#monitorsBody [data-toggle]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-toggle");
        const isActive = btn.getAttribute("data-active") === "1";
        btn.disabled = true;
        try {
          await api(`/api/monitors/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ active: !isActive })
          });
          await loadMonitors();
        } catch (e) {
          alert(`Toggle monitor: ${e.message}`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Overview KPIs
    safeText($("#kpiIncidents"), 0);
    safeText($("#kpiLocal"), "+12%");
    safeText($("#kpiSeo"), "—");
  }

  async function refreshAll() {
    try {
      setStatus(true);
      const me = await loadMe();

      // range affects only labels for now (stable)
      const range = $("#rangeSelect").value;
      $("#chartMeta").textContent = `Last ${range} days`;

      // Nice looking chart points
      const base = range === "7" ? [55,58,57,60,62,61,64] :
                   range === "90" ? [58,60,62,61,59,55,50,46,40,44,49,52,57,60,62] :
                   [60,60,61,62,61,58,52,45,40,43,48,52,57,62,66];

      setChart(base);

      await Promise.allSettled([loadAudits(), loadMonitors()]);
      setStatus(true);

      // Show current plan highlight
      const plan = String(me.plan || "").toLowerCase();
      const proCard = $("#planPro");
      if (proCard) {
        proCard.classList.toggle("planActive", plan === "pro");
      }
    } catch (e) {
      setStatus(false);
      console.log(e);
      alert(`Erreur: ${e.message}\n\nVérifie que tu es connecté (token) et que /api/me répond.`);
    }
  }

  // ----- Buttons -----
  $("#btnRefresh")?.addEventListener("click", refreshAll);
  $("#rangeSelect")?.addEventListener("change", refreshAll);

  $("#btnExportAudits")?.addEventListener("click", () => {
    window.location.href = "/api/export/audits.csv";
  });
  $("#btnExportMonitors")?.addEventListener("click", () => {
    window.location.href = "/api/export/monitors.csv";
  });

  $("#btnPortal")?.addEventListener("click", async () => {
    try {
      const out = await api("/api/stripe/portal", { method: "POST", body: JSON.stringify({}) });
      if (out.url) window.location.href = out.url;
    } catch (e) {
      alert(`Portal: ${e.message}`);
    }
  });

  $("#btnLogout")?.addEventListener("click", () => {
    localStorage.removeItem("fp_token");
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  });

  $("#btnAddMonitor")?.addEventListener("click", async () => {
    const url = $("#monitorUrl").value.trim();
    const intervalMinutes = Number($("#monitorInterval").value || 60);
    if (!/^https?:\/\//i.test(url)) return alert("URL invalide (http/https)");
    try {
      await api("/api/monitors", { method: "POST", body: JSON.stringify({ url, intervalMinutes }) });
      $("#monitorUrl").value = "";
      await loadMonitors();
      showView("monitors");
    } catch (e) {
      alert(`Add monitor: ${e.message}`);
    }
  });

  $("#btnAddMonitorQuick")?.addEventListener("click", () => showView("monitors"));

  $("#btnRunAudit")?.addEventListener("click", async () => {
    const url = $("#auditUrl").value.trim();
    if (!/^https?:\/\//i.test(url)) return alert("URL invalide (http/https)");
    try {
      await api("/api/audits/run", { method: "POST", body: JSON.stringify({ url }) });
      await loadAudits();
      showView("audits");
    } catch (e) {
      alert(`Run audit: ${e.message}`);
    }
  });

  $("#btnRunAuditTop")?.addEventListener("click", () => showView("audits"));

  // Plans buttons (simple)
  $("#btnSeePlans")?.addEventListener("click", () => showView("billing"));
  $("#btnManageStandard")?.addEventListener("click", () => showView("billing"));
  $("#btnUpgradePro")?.addEventListener("click", () => showView("billing"));
  $("#btnUpdatePayment")?.addEventListener("click", () => showView("billing"));

  // ----- Start -----
  (async () => {
    // If no token => go login (avoid broken UI)
    if (!getToken()) {
      alert("Tu n’es pas connecté (token manquant). Je te renvoie vers /login.html");
      window.location.href = "/login.html";
      return;
    }
    await refreshAll();
  })();
})();
