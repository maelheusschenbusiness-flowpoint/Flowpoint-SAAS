/* dashboard.js — FlowPoint AI (stable)
   - Token localStorage key: "fp_token"
   - Tabs + actions audits/monitors/settings
   - Fix: buttons not responding = IDs aligned with dashboard.html
*/

(function () {
  const $ = (id) => document.getElementById(id);

  const TOKEN_KEY = "fp_token";
  const token = () => localStorage.getItem(TOKEN_KEY) || "";

  function setMsg(text, type = "") {
    const el = $("msg");
    if (!el) return;
    el.className = "msg" + (type ? " " + type : "");
    el.textContent = text || "";
  }

  function ensureAuth() {
    if (!token()) {
      location.replace("/login.html");
      return false;
    }
    return true;
  }

  function headersJSON() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
    };
  }

  async function apiGet(url) {
    const r = await fetch(url, { headers: headersJSON() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur API");
    return j;
  }
  async function apiPost(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: headersJSON(),
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur API");
    return j;
  }
  async function apiPatch(url, body) {
    const r = await fetch(url, {
      method: "PATCH",
      headers: headersJSON(),
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur API");
    return j;
  }

  function fmtDate(d) {
    try { return new Date(d).toLocaleString("fr-FR"); } catch { return String(d || ""); }
  }

  function setTab(name) {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    ["overview", "audits", "monitors", "settings"].forEach((k) => {
      const panel = document.getElementById(`tab-${k}`);
      if (panel) panel.classList.toggle("hidden", k !== name);
    });
  }

  async function exportFile(path, filename) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token()}` } });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || "Export impossible");
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function openPdfWithBearer(url, filename) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!r.ok) throw new Error(`PDF indisponible (${r.status})`);
    const blob = await r.blob();
    const obj = URL.createObjectURL(blob);
    const w = window.open(obj, "_blank");
    if (!w) {
      const a = document.createElement("a");
      a.href = obj;
      a.download = filename || "file.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(obj), 60000);
  }

  // ----------------- UI populate -----------------
  function setSideInfo(me) {
    if ($("planBadge")) $("planBadge").textContent = String(me.plan || "standard").toUpperCase();
    if ($("rolePill")) $("rolePill").textContent = me.role || "—";
    if ($("orgPill")) $("orgPill").textContent = me.org?.name || "—";
    if ($("emailPill")) $("emailPill").textContent = me.email || "—";

    const pay = me.accessBlocked ? "bloqué" : (me.subscriptionStatus || "ok");
    if ($("payPill")) $("payPill").textContent = pay;

    const trial = me.hasTrial ? (me.trialEndsAt ? fmtDate(me.trialEndsAt) : "actif") : "—";
    if ($("trialPill")) $("trialPill").textContent = trial;
  }

  function setOverviewKPIs({ audits, monitors }) {
    const last7 = (audits || []).filter(a => {
      const t = new Date(a.createdAt || 0).getTime();
      return t > Date.now() - 7 * 86400000;
    });

    const avgSeo = last7.length
      ? last7.reduce((s, a) => s + (Number(a.score) || 0), 0) / last7.length
      : null;

    $("kpiSeo").textContent = avgSeo == null ? "—" : `${avgSeo.toFixed(1)}/100`;
    $("kpiMonitors").textContent = `${(monitors || []).length}`;

    // Uptime & latency best-effort from last logs
    // (If no logs yet => show —)
    // We'll compute quick from /logs (limit 200 per monitor)
  }

  async function computeUptimeAndLatency(monitors) {
    // minimal, fast: take at most 5 monitors for KPI calc to avoid heavy load
    const sample = (monitors || []).slice(0, 5);
    let checks = 0, up = 0, msSum = 0, msCnt = 0;

    for (const m of sample) {
      try {
        const j = await apiGet(`/api/monitors/${m._id}/logs`);
        for (const L of (j.logs || [])) {
          checks += 1;
          if (String(L.status).toLowerCase() === "up") up += 1;
          const rt = Number(L.responseTimeMs || 0);
          if (rt > 0) { msSum += rt; msCnt += 1; }
        }
      } catch { /* ignore */ }
    }

    const uptime = checks ? (up / checks) : null;
    const avgMs = msCnt ? (msSum / msCnt) : null;

    $("kpiUptime").textContent = uptime == null ? "—" : `${(uptime * 100).toFixed(1)}%`;
    $("kpiMs").textContent = avgMs == null ? "—" : `${Math.round(avgMs)}ms`;
  }

  function renderLastAudits(audits) {
    const box = $("lastAudits");
    if (!box) return;
    const list = (audits || []).slice(0, 5);
    if (!list.length) { box.textContent = "—"; return; }

    box.innerHTML = list.map(a => `
      <div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #e6eaf2">
        <div style="min-width:0">
          <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.url || ""}</div>
          <div class="muted" style="font-size:12px">${fmtDate(a.createdAt)}</div>
        </div>
        <div style="font-weight:1000">${a.score ?? "—"}</div>
      </div>
    `).join("");
  }

  function renderMonitorsState(monitors) {
    const box = $("monitorsState");
    if (!box) return;
    const list = (monitors || []).slice(0, 6);
    if (!list.length) { box.textContent = "—"; return; }

    box.innerHTML = list.map(m => {
      const st = String(m.lastStatus || "unknown").toLowerCase();
      const cls = st === "up" ? "ok" : (st === "down" ? "bad" : "");
      const label = st === "up" ? "UP" : (st === "down" ? "DOWN" : "—");
      return `
        <div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #e6eaf2">
          <div style="min-width:0">
            <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.url || ""}</div>
            <div class="muted" style="font-size:12px">${m.lastCheckedAt ? fmtDate(m.lastCheckedAt) : "—"}</div>
          </div>
          <span class="tag ${cls}">${label}</span>
        </div>
      `;
    }).join("");
  }

  // ----------------- Audits -----------------
  async function loadAudits() {
    const j = await apiGet("/api/audits");
    const audits = j.audits || [];
    const tbody = $("auditsTbody");
    if (!tbody) return audits;

    tbody.innerHTML = "";
    for (const a of audits) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmtDate(a.createdAt)}</td>
        <td style="max-width:420px;word-break:break-word">${a.url || ""}</td>
        <td><b>${a.score ?? "—"}</b></td>
        <td><a href="#" data-pdf="${a._id}">PDF</a></td>
        <td><a href="#" data-view="${a._id}">Voir</a></td>
      `;

      tr.querySelector('[data-pdf]')?.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          setMsg("Ouverture PDF…");
          await openPdfWithBearer(`/api/audits/${a._id}/pdf`, `flowpoint-audit-${a._id}.pdf`);
          setMsg("✅ PDF ouvert", "ok");
        } catch (err) {
          setMsg(err.message || "PDF impossible", "danger");
        }
      });

      tr.querySelector('[data-view]')?.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          const det = await apiGet(`/api/audits/${a._id}`);
          const box = $("auditResult");
          if (!box) return;
          box.classList.remove("hidden");
          box.innerHTML = `
            <h2>Détails audit</h2>
            <div class="muted">${det.audit?.summary || ""}</div>
            <div style="margin-top:10px;font-weight:900">Recommandations</div>
            <div style="margin-top:6px">
              ${(det.audit?.recommendations || []).map(r => `• ${r}`).join("<br/>") || "—"}
            </div>
          `;
          setTab("audits");
        } catch (err) {
          setMsg(err.message || "Erreur audit", "danger");
        }
      });

      tbody.appendChild(tr);
    }
    return audits;
  }

  async function runAudit() {
    const url = String($("auditUrl")?.value || "").trim();
    if (!url) return setMsg("URL manquante.", "danger");

    setMsg("Audit en cours…");
    const j = await apiPost("/api/audits/run", { url });

    const box = $("auditResult");
    if (box) {
      box.classList.remove("hidden");
      box.innerHTML = `
        <h2>Résultat audit</h2>
        <div class="muted">${j.summary || ""}</div>
        <div style="margin-top:10px;font-weight:1000">Score: ${j.score ?? "—"}/100</div>
        <div style="margin-top:10px">
          <a href="#" id="openLastAuditPdf">Ouvrir PDF</a>
        </div>
      `;
      $("openLastAuditPdf")?.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          setMsg("Ouverture PDF…");
          await openPdfWithBearer(`/api/audits/${j.auditId}/pdf`, `flowpoint-audit-${j.auditId}.pdf`);
          setMsg("✅ PDF ouvert", "ok");
        } catch (err) {
          setMsg(err.message || "PDF impossible", "danger");
        }
      });
    }

    await loadAudits();
    setMsg("✅ Audit terminé", "ok");
  }

  // ----------------- Monitors -----------------
  async function loadMonitors() {
    const j = await apiGet("/api/monitors");
    const monitors = j.monitors || [];
    const tbody = $("monTbody");
    if (!tbody) return monitors;

    tbody.innerHTML = "";
    for (const m of monitors) {
      const st = String(m.lastStatus || "unknown").toLowerCase();
      const statusTag =
        st === "up" ? `<span class="tag ok">UP</span>` :
        st === "down" ? `<span class="tag bad">DOWN</span>` :
        `<span class="tag">—</span>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="max-width:420px;word-break:break-word">
          <b>${m.url || ""}</b><br/>
          <small>interval: ${m.intervalMinutes || 60} min</small>
        </td>
        <td>${m.active ? '<span class="ok">Oui</span>' : '<span class="muted">Non</span>'}</td>
        <td>${statusTag}</td>
        <td>${m.lastCheckedAt ? fmtDate(m.lastCheckedAt) : "—"}</td>
        <td style="white-space:nowrap">
          <button class="btnSm" data-act="toggle">${m.active ? "Pause" : "Activer"}</button>
          <button class="btnSm" data-act="run">Run</button>
          <button class="btnSm" data-act="logs">Logs</button>
        </td>
      `;

      tr.querySelector('[data-act="toggle"]')?.addEventListener("click", async () => {
        try {
          setMsg("Mise à jour monitor…");
          await apiPatch(`/api/monitors/${m._id}`, { active: !m.active });
          await refreshAll();
          setMsg("✅ Monitor mis à jour", "ok");
        } catch (err) {
          setMsg(err.message || "Erreur monitor", "danger");
        }
      });

      tr.querySelector('[data-act="run"]')?.addEventListener("click", async () => {
        try {
          setMsg("Check manuel…");
          await apiPost(`/api/monitors/${m._id}/run`, {});
          await refreshAll();
          setMsg("✅ Check effectué", "ok");
        } catch (err) {
          setMsg(err.message || "Erreur check", "danger");
        }
      });

      tr.querySelector('[data-act="logs"]')?.addEventListener("click", async () => {
        const box = $("monLogsBox");
        if (!box) return;
        box.classList.remove("hidden");
        box.innerHTML = `<div class="muted">Chargement logs…</div>`;
        try {
          const jl = await apiGet(`/api/monitors/${m._id}/logs`);
          const logs = jl.logs || [];
          box.innerHTML = `
            <h2>Logs — ${m.url}</h2>
            <div class="muted">${logs.length} entrées (max 200)</div>
            <div style="margin-top:10px;overflow:auto">
              <table>
                <thead><tr><th>Date</th><th>Status</th><th>HTTP</th><th>Temps</th><th>Erreur</th></tr></thead>
                <tbody>
                  ${logs.map(l => `
                    <tr>
                      <td>${fmtDate(l.checkedAt || l.createdAt)}</td>
                      <td>${String(l.status).toLowerCase()==="up" ? '<span class="ok">UP</span>' : '<span class="danger">DOWN</span>'}</td>
                      <td>${l.httpStatus ?? "—"}</td>
                      <td>${l.responseTimeMs ? `${Math.round(l.responseTimeMs)}ms` : "—"}</td>
                      <td style="max-width:420px;word-break:break-word">${l.error || ""}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          `;
        } catch (err) {
          box.innerHTML = `<div class="danger">Erreur logs: ${err.message || "—"}</div>`;
        }
      });

      tbody.appendChild(tr);
    }

    return monitors;
  }

  async function createMonitor() {
    const url = String($("monUrl")?.value || "").trim();
    const intervalMinutes = Number($("monInterval")?.value || 60);
    if (!url) return setMsg("URL monitor manquante.", "danger");

    setMsg("Création monitor…");
    await apiPost("/api/monitors", { url, intervalMinutes });

    if ($("monUrl")) $("monUrl").value = "";
    await refreshAll();
    setMsg("✅ Monitor créé", "ok");
  }

  // ----------------- Settings -----------------
  async function loadSettings() {
    // ton backend stocke ça dans Org directement (/api/org/monitor-settings ou /api/org/settings selon version)
    // On tente monitor-settings d’abord, puis fallback settings
    try {
      const j = await apiGet("/api/org/monitor-settings");
      if (j.settings) {
        $("alertRecipients").value = j.settings.alertRecipients || "all";
        $("alertExtraEmails").value = (j.settings.alertExtraEmails || []).join(", ");
        return;
      }
    } catch {}
    try {
      const j = await apiGet("/api/org/settings");
      if (j.settings) {
        $("alertRecipients").value = j.settings.alertRecipients || "all";
        $("alertExtraEmails").value = (j.settings.alertExtraEmails || []).join(", ");
      }
    } catch {}
  }

  async function saveSettings() {
    const recipients = String($("alertRecipients")?.value || "all");
    const extra = String($("alertExtraEmails")?.value || "")
      .split(",").map(s => s.trim()).filter(Boolean);

    setMsg("Enregistrement…");
    try {
      await apiPost("/api/org/monitor-settings", { alertRecipients: recipients, alertExtraEmails: extra });
    } catch {
      await apiPost("/api/org/settings", { alertRecipients: recipients, alertExtraEmails: extra });
    }
    setMsg("✅ Settings enregistrés", "ok");
  }

  // ----------------- Billing -----------------
  async function openPortal() {
    const j = await apiPost("/api/stripe/portal", {});
    if (j.url) location.href = j.url;
  }

  // ----------------- Refresh all -----------------
  let lastMe = null;

  async function refreshAll() {
    if (!ensureAuth()) return;

    setMsg("Chargement…");
    const me = await apiGet("/api/me");
    lastMe = me;
    setSideInfo(me);

    const audits = await loadAudits();
    const monitors = await loadMonitors();

    setOverviewKPIs({ audits, monitors });
    await computeUptimeAndLatency(monitors);
    renderLastAudits(audits);
    renderMonitorsState(monitors);

    setMsg("✅ Dashboard à jour", "ok");
  }

  // ----------------- Bind -----------------
  function bind() {
    document.querySelectorAll(".tab").forEach((b) => {
      b.addEventListener("click", () => setTab(b.dataset.tab));
    });

    $("btnRefresh")?.addEventListener("click", () => refreshAll().catch(e => setMsg(e.message, "danger")));

    $("btnRunAudit")?.addEventListener("click", () => runAudit().catch(e => setMsg(e.message, "danger")));
    $("btnCreateMon")?.addEventListener("click", () => createMonitor().catch(e => setMsg(e.message, "danger")));

    $("btnExportAudits")?.addEventListener("click", () =>
      exportFile("/api/export/audits.csv", "flowpoint-audits.csv").catch(e => setMsg(e.message, "danger"))
    );
    $("btnExportMonitors")?.addEventListener("click", () =>
      exportFile("/api/export/monitors.csv", "flowpoint-monitors.csv").catch(e => setMsg(e.message, "danger"))
    );

    $("btnSaveSettings")?.addEventListener("click", () => saveSettings().catch(e => setMsg(e.message, "danger")));

    $("btnPortal")?.addEventListener("click", () => openPortal().catch(e => setMsg(e.message, "danger")));
    $("btnPortal2")?.addEventListener("click", () => openPortal().catch(e => setMsg(e.message, "danger")));

    $("btnLogout")?.addEventListener("click", () => {
      localStorage.removeItem(TOKEN_KEY);
      location.replace("/login.html");
    });
  }

  // ----------------- Boot -----------------
  document.addEventListener("DOMContentLoaded", async () => {
    if (!ensureAuth()) return;
    bind();
    try {
      await refreshAll();
      await loadSettings();
    } catch (e) {
      setMsg(e.message || "Erreur dashboard", "danger");
    }
  });
})();
