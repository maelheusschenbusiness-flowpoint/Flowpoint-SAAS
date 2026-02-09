/* dashboard.js — FlowPoint AI (final)
   - Graph uptime (30j) in blue #0052CC
   - Monthly monitoring report + reliability score (Ultra only)
*/

(function () {
  const $ = (id) => document.getElementById(id);

  const token = localStorage.getItem("token") || "";
  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  });

  function fmtDate(d) {
    try { return new Date(d).toLocaleString("fr-FR"); } catch { return String(d || ""); }
  }
  function fmtDay(d) {
    try {
      const x = new Date(d);
      return new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())).toISOString().slice(0, 10);
    } catch { return ""; }
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function pct(n) { return `${(n * 100).toFixed(1)}%`; }
  function ms(n) { return `${Math.round(n)}ms`; }

  function setMsg(text, isError) {
    const el = $("msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = isError ? "danger" : "muted";
  }

  async function apiGet(url) {
    const r = await fetch(url, { headers: headers(), credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur API");
    return j;
  }
  async function apiPost(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body || {}),
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur API");
    return j;
  }
  async function apiPatch(url, body) {
    const r = await fetch(url, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(body || {}),
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur API");
    return j;
  }

  function ensureAuth() {
    if (!token) {
      location.href = "/login.html";
      return false;
    }
    return true;
  }

  // ---------- Charts helpers ----------
  function renderBars(containerId, values01) {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML = "";
    const max = Math.max(1e-9, ...values01);
    for (const v of values01) {
      const wrap = document.createElement("div");
      wrap.className = "bar";
      const inner = document.createElement("i");
      const h = clamp((v / max) * 100, 0, 100);
      inner.style.height = `${h}%`;
      wrap.title = `${(v * 100).toFixed(1)}%`;
      wrap.appendChild(inner);
      el.appendChild(wrap);
    }
  }

  function lastNDaysKeys(n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      out.push(fmtDay(d));
    }
    return out;
  }

  // ---------- Stats from logs ----------
  // We fetch logs per monitor and build:
  // - last 7 days KPI uptime
  // - last 30 days chart uptime/day
  // - downs/day chart (7d) + avg response (7d)
  async function collectMonitoringStats(monitors) {
    const now = Date.now();
    const dayKeys7 = lastNDaysKeys(7);
    const dayKeys30 = lastNDaysKeys(30);

    // per day accum
    const downsByDay7 = Object.fromEntries(dayKeys7.map((k) => [k, 0]));
    const checksByDay7 = Object.fromEntries(dayKeys7.map((k) => [k, 0]));
    const upByDay7 = Object.fromEntries(dayKeys7.map((k) => [k, 0]));
    const msSumByDay7 = Object.fromEntries(dayKeys7.map((k) => [k, 0]));
    const msCntByDay7 = Object.fromEntries(dayKeys7.map((k) => [k, 0]));

    const checksByDay30 = Object.fromEntries(dayKeys30.map((k) => [k, 0]));
    const upByDay30 = Object.fromEntries(dayKeys30.map((k) => [k, 0]));

    // fetch logs (limited to 200) per monitor
    const logsAll = [];
    for (const m of monitors) {
      try {
        const j = await apiGet(`/api/monitors/${m._id}/logs`);
        const logs = (j.logs || []).map((x) => ({ ...x, monitorId: m._id, monitorUrl: m.url }));
        logsAll.push(...logs);
      } catch {
        // ignore per monitor errors
      }
    }

    for (const L of logsAll) {
      const t = new Date(L.checkedAt || L.createdAt || Date.now()).getTime();
      const day = fmtDay(t);
      const st = String(L.status || "").toLowerCase();

      if (checksByDay30[day] !== undefined) {
        checksByDay30[day] += 1;
        if (st === "up") upByDay30[day] += 1;
      }

      if (checksByDay7[day] !== undefined) {
        checksByDay7[day] += 1;
        if (st === "up") upByDay7[day] += 1;
        if (st === "down") downsByDay7[day] += 1;

        const rt = Number(L.responseTimeMs || 0);
        if (rt > 0) {
          msSumByDay7[day] += rt;
          msCntByDay7[day] += 1;
        }
      }
    }

    // uptime 7d global
    const totalChecks7 = Object.values(checksByDay7).reduce((a, b) => a + b, 0);
    const totalUp7 = Object.values(upByDay7).reduce((a, b) => a + b, 0);
    const uptime7 = totalChecks7 > 0 ? totalUp7 / totalChecks7 : 0;

    // avg ms 7d
    const totalMs = Object.values(msSumByDay7).reduce((a, b) => a + b, 0);
    const totalMsCnt = Object.values(msCntByDay7).reduce((a, b) => a + b, 0);
    const avgMs7 = totalMsCnt > 0 ? totalMs / totalMsCnt : 0;

    // downs/day bars (7d)
    const downs7Arr = dayKeys7.map((k) => downsByDay7[k]);
    // normalize downs bars to 0..1 for bar renderer
    const downsMax = Math.max(1, ...downs7Arr);
    const downs7Norm = downs7Arr.map((x) => x / downsMax);

    // uptime/day (30d) bars: 0..1
    const uptime30Arr = dayKeys30.map((k) => {
      const c = checksByDay30[k] || 0;
      const u = upByDay30[k] || 0;
      return c > 0 ? u / c : 0;
    });

    // uptime 30d global
    const totalChecks30 = Object.values(checksByDay30).reduce((a, b) => a + b, 0);
    const totalUp30 = Object.values(upByDay30).reduce((a, b) => a + b, 0);
    const uptime30 = totalChecks30 > 0 ? totalUp30 / totalChecks30 : 0;

    return {
      logsAll,
      dayKeys7,
      dayKeys30,
      uptime7,
      uptime30,
      avgMs7,
      downs7Norm,
      uptime30Arr,
      checksByDay30,
      upByDay30,
    };
  }

  // ---------- Monthly report (Ultra only) ----------
  function computeMonthlyReport(logsAll, monitors) {
    // 30 last days
    const cutoff = Date.now() - 30 * 86400000;
    const logs = logsAll
      .filter((l) => new Date(l.checkedAt || l.createdAt || Date.now()).getTime() >= cutoff)
      .sort((a, b) => new Date(a.checkedAt || 0).getTime() - new Date(b.checkedAt || 0).getTime());

    // per monitor timeline to estimate incidents and MTTR-ish
    const byMon = new Map();
    for (const m of monitors) byMon.set(String(m._id), { url: m.url, logs: [] });
    for (const l of logs) {
      const k = String(l.monitorId || l.monitorId?._id || l.monitorId || "");
      if (!byMon.has(k)) byMon.set(k, { url: l.monitorUrl || "-", logs: [] });
      byMon.get(k).logs.push(l);
    }

    let totalChecks = 0;
    let totalUp = 0;
    let totalDown = 0;
    let rtSum = 0;
    let rtCnt = 0;

    let incidents = 0;       // down transitions
    let recoveries = 0;      // up transitions after down
    let mttrMinutesSum = 0;  // based on first up after down
    let mttrCount = 0;

    for (const [mid, obj] of byMon.entries()) {
      const L = obj.logs;
      let prev = "unknown";
      let downStartedAt = null;

      for (const e of L) {
        const st = String(e.status || "").toLowerCase();
        const t = new Date(e.checkedAt || e.createdAt || Date.now()).getTime();

        totalChecks += 1;
        if (st === "up") totalUp += 1;
        if (st === "down") totalDown += 1;

        const rt = Number(e.responseTimeMs || 0);
        if (rt > 0) { rtSum += rt; rtCnt += 1; }

        if (st === "down" && prev !== "down") {
          incidents += 1;
          downStartedAt = t;
        }
        if (st === "up" && prev === "down") {
          recoveries += 1;
          if (downStartedAt) {
            const minutes = (t - downStartedAt) / 60000;
            if (minutes >= 0 && minutes < 7 * 24 * 60) { // garde-fou
              mttrMinutesSum += minutes;
              mttrCount += 1;
            }
          }
          downStartedAt = null;
        }

        prev = st;
      }
    }

    const uptime = totalChecks > 0 ? totalUp / totalChecks : 0;
    const avgRt = rtCnt > 0 ? rtSum / rtCnt : 0;
    const mttr = mttrCount > 0 ? mttrMinutesSum / mttrCount : 0;

    // Reliability score (0..100), simple + lisible:
    // base = uptime * 100
    // penalty incidents: -2 each (cap 40)
    // penalty latency: - min(20, avgRt/200)
    let score = uptime * 100;
    score -= Math.min(40, incidents * 2);
    score -= Math.min(20, avgRt / 200);
    score = clamp(score, 0, 100);

    let grade = "A";
    if (score < 90) grade = "B";
    if (score < 80) grade = "C";
    if (score < 70) grade = "D";
    if (score < 60) grade = "E";

    return {
      score: Math.round(score),
      grade,
      uptime,
      incidents,
      recoveries,
      avgRt,
      mttrMinutes: mttr,
      totalChecks,
      totalDown,
      totalUp,
    };
  }

  function renderMonthlyReport(report) {
    const el = $("monthlyReport");
    if (!el) return;

    const scoreColor =
      report.score >= 90 ? "ok" :
      report.score >= 75 ? "" : "danger";

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <div class="muted">Période</div>
          <div style="font-weight:900">30 derniers jours</div>
        </div>
        <div style="text-align:right">
          <div class="muted">Score de fiabilité</div>
          <div style="font-weight:900;font-size:28px" class="${scoreColor}">${report.score}/100 <span style="font-size:14px;font-weight:900;color:var(--muted)">(${report.grade})</span></div>
        </div>
      </div>

      <div class="row" style="margin-top:12px">
        <div class="col box">
          <div class="muted">Uptime</div>
          <div style="font-weight:900;font-size:18px">${pct(report.uptime)}</div>
          <div class="muted" style="font-size:12px;margin-top:6px">Basé sur UP / total checks (logs cron).</div>
        </div>
        <div class="col box">
          <div class="muted">Incidents (DOWN →)</div>
          <div style="font-weight:900;font-size:18px">${report.incidents}</div>
          <div class="muted" style="font-size:12px;margin-top:6px">Changements vers DOWN détectés.</div>
        </div>
        <div class="col box">
          <div class="muted">MTTR estimé</div>
          <div style="font-weight:900;font-size:18px">${report.mttrMinutes ? `${report.mttrMinutes.toFixed(1)} min` : "—"}</div>
          <div class="muted" style="font-size:12px;margin-top:6px">Temps moyen jusqu’au retour UP.</div>
        </div>
        <div class="col box">
          <div class="muted">Latence moyenne</div>
          <div style="font-weight:900;font-size:18px">${report.avgRt ? ms(report.avgRt) : "—"}</div>
          <div class="muted" style="font-size:12px;margin-top:6px">Moyenne responseTimeMs (logs).</div>
        </div>
      </div>

      <div class="muted" style="margin-top:12px">
        Détails: checks=${report.totalChecks}, UP=${report.totalUp}, DOWN=${report.totalDown}, recoveries=${report.recoveries}
      </div>
    `;

    el.classList.remove("hidden");
  }

  // ---------- UI ----------
  function setTab(name) {
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));

    const all = ["audit", "audits", "monitor", "settings", "team"];
    all.forEach((k) => {
      const panel = document.getElementById(`tab-${k}`);
      if (!panel) return;
      panel.classList.toggle("hidden", k !== name);
    });
  }

  function bindTabs() {
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => setTab(t.dataset.tab));
    });
  }

  function setPlanUI(me) {
    $("planBadge").textContent = (me.plan || "standard").toUpperCase();
    $("orgPill").textContent = `Org: ${me.org?.name || "—"}`;
    $("rolePill").textContent = `Rôle: ${me.role || "—"}`;

    const trial = me.hasTrial ? (me.trialEndsAt ? `jusqu’au ${fmtDate(me.trialEndsAt)}` : "actif") : "—";
    $("trialPill").textContent = `Trial: ${trial}`;

    const pay = me.accessBlocked ? "bloqué" : (me.subscriptionStatus || "ok");
    $("payPill").textContent = `Paiement: ${pay}`;

    $("email").textContent = me.email || "—";
    $("company").textContent = me.companyName || "—";

    const q = me.usage || {};
    $("qa").textContent = `${q.audits?.used ?? 0}/${q.audits?.limit ?? 0}`;
    $("qm").textContent = `${q.monitors?.used ?? 0}/${q.monitors?.limit ?? 0}`;
    $("qp").textContent = `${q.pdf?.used ?? 0}/${q.pdf?.limit ?? 0}`;
    $("qe").textContent = `${q.exports?.used ?? 0}/${q.exports?.limit ?? 0}`;

    // Team tab visible only on Ultra
    if (me.plan === "ultra") {
      $("teamTab").style.display = "";
    } else {
      $("teamTab").style.display = "none";
    }

    // Monthly report Ultra only
    const lock = $("monthlyLock");
    const btnBuild = $("btnBuildMonthly");
    const btnPrint = $("btnPrintMonthly");

    if (me.plan === "ultra") {
      lock.classList.add("hidden");
      btnBuild.disabled = false;
      btnPrint.disabled = false;
    } else {
      lock.classList.remove("hidden");
      btnBuild.disabled = true;
      btnPrint.disabled = true;
    }
  }

  // ---------- Actions ----------
  async function loadAudits() {
    const j = await apiGet("/api/audits");
    const audits = j.audits || [];
    const tbody = $("auditsTbody");
    tbody.innerHTML = "";

    for (const a of audits) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmtDate(a.createdAt)}</td>
        <td style="max-width:420px;word-break:break-word">${a.url || ""}</td>
        <td><b>${a.score ?? "—"}</b></td>
        <td><a href="/api/audits/${a._id}/pdf" target="_blank">PDF</a></td>
        <td><a href="#" data-id="${a._id}">Voir</a></td>
      `;
      tr.querySelector('a[data-id]').addEventListener("click", async (e) => {
        e.preventDefault();
        const id = e.currentTarget.getAttribute("data-id");
        const det = await apiGet(`/api/audits/${id}`);
        const box = $("auditResult");
        box.classList.remove("hidden");
        box.innerHTML = `
          <div style="font-weight:900">Détails audit</div>
          <div class="muted" style="margin-top:6px">${det.audit?.summary || ""}</div>
          <div style="margin-top:10px">
            <div class="muted" style="font-size:12px;font-weight:900">Recommandations</div>
            <div style="margin-top:6px">${(det.audit?.recommendations || []).map(r => `• ${r}`).join("<br/>") || "—"}</div>
          </div>
        `;
        setTab("audit");
      });
      tbody.appendChild(tr);
    }

    return audits;
  }

  async function runAudit() {
    const url = String($("auditUrl").value || "").trim();
    if (!url) return setMsg("URL manquante.", true);

    setMsg("Audit en cours…");
    const j = await apiPost("/api/audits/run", { url });
    const box = $("auditResult");
    box.classList.remove("hidden");
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <div style="font-weight:900">Résultat audit</div>
          <div class="muted" style="margin-top:6px">${j.summary || ""}</div>
        </div>
        <div class="badge">Score: ${j.score ?? "—"}/100</div>
      </div>
      <div class="muted" style="margin-top:10px">${j.cached ? "✅ Cache utilisé" : "🆕 Audit nouveau"}</div>
      <div style="margin-top:10px">
        <a href="/api/audits/${j.auditId}/pdf" target="_blank">Ouvrir PDF</a>
      </div>
    `;
    setMsg("Audit terminé ✅");
    await loadAudits();
  }

  async function loadMonitors() {
    const j = await apiGet("/api/monitors");
    const monitors = j.monitors || [];
    const tbody = $("monTbody");
    tbody.innerHTML = "";

    for (const m of monitors) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="max-width:420px;word-break:break-word"><b>${m.url || ""}</b><div class="muted" style="font-size:12px">interval: ${m.intervalMinutes || 60} min</div></td>
        <td>${m.active ? '<span class="ok">Oui</span>' : '<span class="muted">Non</span>'}</td>
        <td>${m.lastStatus === "up" ? '<span class="ok">UP</span>' : (m.lastStatus === "down" ? '<span class="danger">DOWN</span>' : '<span class="muted">—</span>')}</td>
        <td>${m.lastCheckedAt ? fmtDate(m.lastCheckedAt) : "—"}</td>
        <td style="white-space:nowrap">
          <button class="btn3" data-act="toggle">${m.active ? "Pause" : "Activer"}</button>
          <button class="btn3" data-act="run">Run</button>
          <button class="btn3" data-act="logs">Logs</button>
        </td>
      `;

      tr.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
        await apiPatch(`/api/monitors/${m._id}`, { active: !m.active });
        await refreshAll();
      });

      tr.querySelector('[data-act="run"]').addEventListener("click", async () => {
        setMsg("Check manuel…");
        await apiPost(`/api/monitors/${m._id}/run`, {});
        await refreshAll();
        setMsg("Check manuel effectué ✅");
      });

      tr.querySelector('[data-act="logs"]').addEventListener("click", async () => {
        const box = $("monLogsBox");
        box.classList.remove("hidden");
        box.innerHTML = `<div class="muted">Chargement logs…</div>`;
        const jl = await apiGet(`/api/monitors/${m._id}/logs`);
        const logs = jl.logs || [];
        box.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="font-weight:900">Logs — ${m.url}</div>
            <div class="muted">${logs.length} entrées (max 200)</div>
          </div>
          <div style="margin-top:10px;overflow:auto">
            <table>
              <thead><tr><th>Date</th><th>Status</th><th>HTTP</th><th>Temps</th><th>Erreur</th></tr></thead>
              <tbody>
                ${logs.map(l => `
                  <tr>
                    <td>${fmtDate(l.checkedAt || l.createdAt)}</td>
                    <td>${String(l.status).toLowerCase()==="up" ? '<span class="ok">UP</span>' : '<span class="danger">DOWN</span>'}</td>
                    <td>${l.httpStatus ?? "—"}</td>
                    <td>${l.responseTimeMs ? ms(l.responseTimeMs) : "—"}</td>
                    <td style="max-width:420px;word-break:break-word">${l.error || ""}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
      });

      tbody.appendChild(tr);
    }

    return monitors;
  }

  async function createMonitor() {
    const url = String($("monUrl").value || "").trim();
    const intervalMinutes = Number($("monInterval").value || 60);
    if (!url) return setMsg("URL monitor manquante.", true);

    setMsg("Création monitor…");
    await apiPost("/api/monitors", { url, intervalMinutes });
    $("monUrl").value = "";
    setMsg("Monitor créé ✅");
    await refreshAll();
  }

  async function exportCsv(path) {
    // open in new tab with auth header? can't.
    // simplest: navigate => backend uses auth, browser will send cookie if any.
    // If you rely only on bearer, keep as fetch blob:
    const r = await fetch(path, { headers: headers(), credentials: "include" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || "Export impossible");
    }
    const blob = await r.blob();
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = path.includes("audits") ? "flowpoint-audits.csv" : "flowpoint-monitors.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function loadTeamIfUltra(me) {
    if (me.plan !== "ultra") return;
    const j = await apiGet("/api/org/members");
    const tbody = $("teamTbody");
    tbody.innerHTML = "";
    for (const u of (j.members || [])) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${u.email || ""}</td>
        <td>${u.name || ""}</td>
        <td><b>${u.role || ""}</b></td>
        <td>${fmtDate(u.createdAt)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  async function inviteMember() {
    const email = String($("inviteEmail").value || "").trim();
    if (!email) return setMsg("Email invite manquant.", true);
    setMsg("Envoi invitation…");
    await apiPost("/api/org/invite", { email });
    $("inviteEmail").value = "";
    setMsg("Invitation envoyée ✅");
  }

  // Settings tab: these endpoints may or may not exist in your backend.
  // If not present, it will show a gentle message.
  async function saveSettings() {
    const recipients = String($("alertRecipients").value || "all");
    const extra = String($("alertExtraEmails").value || "")
      .split(",").map(s => s.trim()).filter(Boolean);

    // If you have /api/org/settings, use it. Otherwise, inform.
    try {
      await apiPost("/api/org/settings", { alertRecipients: recipients, alertExtraEmails: extra });
      setMsg("Réglages enregistrés ✅");
    } catch (e) {
      setMsg("Endpoint /api/org/settings absent côté backend. Ajoute-le si tu veux sauvegarder ces réglages.", true);
    }
  }

  async function loadSettings() {
    try {
      const j = await apiGet("/api/org/settings");
      if (j.settings) {
        $("alertRecipients").value = j.settings.alertRecipients || "all";
        $("alertExtraEmails").value = (j.settings.alertExtraEmails || []).join(", ");
      }
    } catch {
      // silent
    }
  }

  async function stripePortal() {
    const j = await apiPost("/api/stripe/portal", {});
    if (j.url) location.href = j.url;
  }

  // Monthly report actions
  async function buildMonthlyReport(me, monitors, stats) {
    if (me.plan !== "ultra") return;

    const box = $("monthlyReport");
    box.classList.remove("hidden");
    box.innerHTML = `<div class="muted">Génération du rapport…</div>`;

    const report = computeMonthlyReport(stats.logsAll, monitors);
    renderMonthlyReport(report);
    setMsg("Rapport mensuel généré ✅");
  }

  function printMonthly() {
    const wrap = $("monthlyReport");
    if (!wrap || wrap.classList.contains("hidden")) {
      return setMsg("Génère le rapport avant d’imprimer.", true);
    }
    window.print();
  }

  // ---------- Refresh all ----------
  let lastMe = null;
  async function refreshAll() {
    if (!ensureAuth()) return;

    setMsg("Chargement…");
    const me = await apiGet("/api/me");
    lastMe = me;
    setPlanUI(me);

    // audits
    const audits = await loadAudits();

    // monitors
    const monitors = await loadMonitors();

    // team
    await loadTeamIfUltra(me);

    // settings
    await loadSettings();

    // KPI SEO avg (7d): compute from audits createdAt in last 7d
    const cutoff7 = Date.now() - 7 * 86400000;
    const last7Audits = (audits || []).filter(a => new Date(a.createdAt || 0).getTime() >= cutoff7);
    const avgScore =
      last7Audits.length ? (last7Audits.reduce((s, a) => s + (Number(a.score) || 0), 0) / last7Audits.length) : 0;

    $("kpiScore").textContent = last7Audits.length ? `${avgScore.toFixed(1)}/100` : "—";
    $("kpiAudits").textContent = `${last7Audits.length}`;

    // Audits/day chart (7 days)
    const keys7 = lastNDaysKeys(7);
    const auditsByDay = Object.fromEntries(keys7.map(k => [k, 0]));
    for (const a of last7Audits) {
      const d = fmtDay(a.createdAt);
      if (auditsByDay[d] !== undefined) auditsByDay[d] += 1;
    }
    const auditArr = keys7.map(k => auditsByDay[k]);
    const maxA = Math.max(1, ...auditArr);
    renderBars("chartAudits", auditArr.map(x => x / maxA));

    // Monitoring stats
    const stats = await collectMonitoringStats(monitors);

    $("kpiUptime").textContent = stats.uptime7 ? pct(stats.uptime7) : "—";
    $("kpiMs").textContent = stats.avgMs7 ? ms(stats.avgMs7) : "—";

    // downs/day chart (7d)
    renderBars("chartDowns", stats.downs7Norm);

    // uptime 30d chart
    renderBars("chartUptime30", stats.uptime30Arr);
    $("uptime30Badge").textContent = `30j: ${stats.uptime30 ? pct(stats.uptime30) : "—"}`;

    // Monthly report box reset
    $("monthlyReport").classList.add("hidden");
    $("monthlyReport").innerHTML = "";

    setMsg("✅ Dashboard à jour");
  }

  // ---------- Bind buttons ----------
  function bindActions() {
    $("btnRefresh").addEventListener("click", () => refreshAll().catch(e => setMsg(e.message, true)));

    $("btnPricing").addEventListener("click", () => (location.href = "/pricing.html"));
    $("btnPortal").addEventListener("click", () => stripePortal().catch(e => setMsg(e.message, true)));
    $("btnLogout").addEventListener("click", () => { localStorage.removeItem("token"); location.href = "/login.html"; });

    $("btnRunAudit").addEventListener("click", () => runAudit().catch(e => setMsg(e.message, true)));

    $("btnCreateMon").addEventListener("click", () => createMonitor().catch(e => setMsg(e.message, true)));

    $("btnExportAudits").addEventListener("click", () => exportCsv("/api/export/audits.csv").catch(e => setMsg(e.message, true)));
    $("btnExportMonitors").addEventListener("click", () => exportCsv("/api/export/monitors.csv").catch(e => setMsg(e.message, true)));

    $("btnSaveSettings").addEventListener("click", () => saveSettings().catch(e => setMsg(e.message, true)));

    const btnInvite = $("btnInvite");
    if (btnInvite) btnInvite.addEventListener("click", () => inviteMember().catch(e => setMsg(e.message, true)));

    $("btnBuildMonthly").addEventListener("click", async () => {
      try {
        if (!lastMe) lastMe = await apiGet("/api/me");
        const monitors = (await apiGet("/api/monitors")).monitors || [];
        const stats = await collectMonitoringStats(monitors);
        await buildMonthlyReport(lastMe, monitors, stats);
      } catch (e) {
        setMsg(e.message, true);
      }
    });

    $("btnPrintMonthly").addEventListener("click", () => printMonthly());
  }

  // ---------- Boot ----------
  (async function boot() {
    if (!ensureAuth()) return;
    bindTabs();
    bindActions();
    try { await refreshAll(); }
    catch (e) { setMsg(e.message, true); }
  })();
})();
