function $(id){ return document.getElementById(id); }
function token(){ return localStorage.getItem("fp_token") || ""; }

function setMsg(text, type="") {
  const el = $("msg");
  el.className = type === "error" ? "danger" : type === "ok" ? "ok" : "muted";
  el.textContent = text || "";
}

async function api(path, method="GET", body=null) {
  const t = token();
  if (!t) throw new Error("Non connecté");
  const res = await fetch(path, {
    method,
    headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("Erreur " + res.status));
  return data;
}

function fmtDate(d){ if(!d) return "—"; try{return new Date(d).toLocaleString("fr-FR");}catch{return "—"} }

function showTab(name){
  const ids = ["audit","audits","monitor","settings","team"];
  for (const t of ids) $("tab-"+t).classList.toggle("hidden", t !== name);
  document.querySelectorAll(".tab").forEach(el=> el.classList.toggle("active", el.dataset.tab === name));
}

async function downloadWithAuth(url, filename) {
  const t = token();
  const r = await fetch(url, { headers: { "Authorization": "Bearer " + t } });
  if (!r.ok) {
    const d = await r.json().catch(()=> ({}));
    throw new Error(d.error || "Export échoué");
  }
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
}

// ---- charts (bars) ----
function renderBars(containerId, series){
  const el = $(containerId);
  el.innerHTML = "";
  const max = Math.max(1, ...series.map(x => Number(x.value)||0));
  for (const s of series) {
    const bar = document.createElement("div");
    bar.className = "bar";
    const i = document.createElement("i");
    i.style.height = Math.round(((Number(s.value)||0) / max) * 100) + "%";
    bar.title = `${s.day}: ${s.value}`;
    bar.appendChild(i);
    el.appendChild(bar);
  }
}

async function loadMe(){
  const me = await api("/api/me");

  $("email").textContent = me.email || "—";
  $("company").textContent = me.companyName || "—";

  $("planBadge").textContent = "PLAN: " + (me.plan || "standard").toUpperCase();
  $("orgPill").textContent = "Org: " + (me.org?.name || "—");
  $("rolePill").textContent = "Rôle: " + (me.role || "—");
  $("trialPill").textContent = me.hasTrial ? ("Trial jusqu’au " + fmtDate(me.trialEndsAt)) : "Trial: non démarré";
  $("payPill").textContent = "Paiement: " + (me.lastPaymentStatus || me.subscriptionStatus || "—");

  const teamTab = $("teamTab");
  if (String(me.plan).toLowerCase() === "ultra") teamTab.style.display = "inline-block";
  else teamTab.style.display = "none";

  if (me.accessBlocked) setMsg("Accès bloqué (paiement échoué / essai terminé). Clique “Gérer / Upgrade”.", "error");
  else setMsg("Accès OK.", "ok");

  const a = me.usage.audits;
  const m = me.usage.monitors;
  const p = me.usage.pdf;
  const e = me.usage.exports || { used: 0, limit: 0 };

  $("qa").textContent = `${a.used}/${a.limit}`;
  $("qm").textContent = `${m.used}/${m.limit}`;
  $("qp").textContent = `${p.used}/${p.limit}`;
  $("qe").textContent = `${e.used}/${e.limit}`;

  return me;
}

async function openPortal(){
  const out = await api("/api/stripe/portal", "POST", {});
  window.location.href = out.url;
}

// ----- STATS -----
async function loadStats(){
  const out = await api("/api/stats");

  $("kpiScore").textContent = out.kpis.avgScore ? (out.kpis.avgScore + "/100") : "—";
  $("kpiUptime").textContent = out.kpis.uptimePct ? (out.kpis.uptimePct + "%") : "—";
  $("kpiMs").textContent = out.kpis.avgResponseMs ? (out.kpis.avgResponseMs + " ms") : "—";
  $("kpiAudits").textContent = String(out.kpis.auditsCount ?? 0);

  renderBars("chartAudits", out.series.auditsByDay || []);
  renderBars("chartDowns", out.series.downsByDay || []);
}

// ----- SETTINGS -----
async function loadSettings(){
  const out = await api("/api/org/settings");
  $("alertRecipients").value = out.settings.alertRecipients || "all";
  $("alertExtraEmails").value = (out.settings.alertExtraEmails || []).join(", ");
}

async function saveSettings(){
  const alertRecipients = $("alertRecipients").value;
  const alertExtraEmails = $("alertExtraEmails").value;
  setMsg("Enregistrement…");
  await api("/api/org/settings", "POST", { alertRecipients, alertExtraEmails });
  setMsg("✅ Réglages enregistrés", "ok");
}

// ----- AUDITS -----
async function runAudit(){
  const url = $("auditUrl").value.trim();
  setMsg("Audit en cours...");
  const out = await api("/api/audits/run", "POST", { url });
  setMsg(out.cached ? "✅ Audit (cache) terminé" : "✅ Audit terminé", "ok");

  $("auditResult").classList.remove("hidden");
  $("auditResult").innerHTML = `
    <div style="font-weight:900">Score: ${out.score}/100</div>
    <div class="muted">${out.summary}</div>
    <div style="margin-top:10px">
      <a href="/api/audits/${out.auditId}/pdf" target="_blank">Ouvrir le PDF</a>
      <span class="muted"> (consomme 1 quota PDF)</span>
    </div>
  `;

  await loadAudits();
  await loadMe();
  await loadStats();
}

async function loadAudits(){
  const out = await api("/api/audits");
  const tb = $("auditsTbody");
  tb.innerHTML = "";

  for (const a of out.audits) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(a.createdAt)}</td>
      <td>${a.url}</td>
      <td><b>${a.score ?? "-"}</b></td>
      <td><a href="/api/audits/${a._id}/pdf" target="_blank">PDF</a></td>
      <td><a href="#" data-id="${a._id}" class="auditDetails">Voir</a></td>
    `;
    tb.appendChild(tr);
  }

  tb.querySelectorAll(".auditDetails").forEach(el=>{
    el.addEventListener("click", async (e)=>{
      e.preventDefault();
      const id = el.getAttribute("data-id");
      const d = await api("/api/audits/" + id);
      alert(
        `URL: ${d.audit.url}\nScore: ${d.audit.score}\n\nRésumé:\n${d.audit.summary}\n\nRecommandations:\n- ${(d.audit.recommendations||[]).join("\n- ")}`
      );
    });
  });
}

// ----- MONITORS -----
async function createMonitor(){
  const url = $("monUrl").value.trim();
  const intervalMinutes = Number($("monInterval").value || 60);
  setMsg("Création du monitor...");
  await api("/api/monitors", "POST", { url, intervalMinutes });
  setMsg("✅ Monitor créé", "ok");
  $("monUrl").value = "";
  await loadMonitors();
  await loadMe();
}

async function loadMonitors(){
  const out = await api("/api/monitors");
  const tb = $("monTbody");
  tb.innerHTML = "";

  for (const m of out.monitors) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m.url}</td>
      <td>${m.active ? "✅" : "❌"}</td>
      <td><b>${m.lastStatus}</b></td>
      <td>${fmtDate(m.lastCheckedAt)}</td>
      <td>
        <a href="#" data-act="${m.active ? "0":"1"}" data-id="${m._id}" class="toggleMon">${m.active ? "Désactiver" : "Activer"}</a>
        &nbsp;|&nbsp;
        <a href="#" data-id="${m._id}" class="runMon">Run</a>
        &nbsp;|&nbsp;
        <a href="#" data-id="${m._id}" class="logsMon">Logs</a>
      </td>
    `;
    tb.appendChild(tr);
  }

  tb.querySelectorAll(".toggleMon").forEach(el=>{
    el.addEventListener("click", async (e)=>{
      e.preventDefault();
      const id = el.getAttribute("data-id");
      const active = el.getAttribute("data-act") === "1";
      setMsg("Mise à jour...");
      await api("/api/monitors/" + id, "PATCH", { active });
      setMsg("✅ OK", "ok");
      await loadMonitors();
    });
  });

  tb.querySelectorAll(".runMon").forEach(el=>{
    el.addEventListener("click", async (e)=>{
      e.preventDefault();
      const id = el.getAttribute("data-id");
      setMsg("Check en cours...");
      const out = await api("/api/monitors/" + id + "/run", "POST", {});
      setMsg(`✅ ${out.result.status.toUpperCase()} (HTTP ${out.result.httpStatus}, ${out.result.responseTimeMs}ms)`, "ok");
      await loadMonitors();
      await loadStats();
    });
  });

  tb.querySelectorAll(".logsMon").forEach(el=>{
    el.addEventListener("click", async (e)=>{
      e.preventDefault();
      const id = el.getAttribute("data-id");
      const out = await api("/api/monitors/" + id + "/logs");
      const box = $("monLogsBox");
      box.classList.remove("hidden");
      box.innerHTML = `
        <div style="font-weight:900;margin-bottom:8px">Logs (200 derniers)</div>
        <table>
          <thead><tr><th>Date</th><th>Status</th><th>HTTP</th><th>ms</th><th>error</th></tr></thead>
          <tbody>
            ${out.logs.map(l=>`
              <tr>
                <td>${fmtDate(l.checkedAt)}</td>
                <td><b>${l.status}</b></td>
                <td>${l.httpStatus}</td>
                <td>${l.responseTimeMs}</td>
                <td>${l.error || ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    });
  });
}

// ----- TEAM (Ultra) -----
async function loadTeam(){
  const out = await api("/api/org/members");
  const tb = $("teamTbody");
  tb.innerHTML = "";
  for (const m of out.members) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m.email}</td>
      <td>${m.name || ""}</td>
      <td><b>${m.role}</b></td>
      <td>${fmtDate(m.createdAt)}</td>
    `;
    tb.appendChild(tr);
  }
}

async function inviteMember(){
  const email = $("inviteEmail").value.trim();
  if (!email) return setMsg("Email membre requis", "error");
  setMsg("Envoi invitation…");
  await api("/api/org/invite", "POST", { email });
  setMsg("✅ Invitation envoyée", "ok");
  $("inviteEmail").value = "";
  await loadTeam();
}

// Tabs
function initTabs(){
  document.querySelectorAll(".tab").forEach(el=>{
    el.addEventListener("click", ()=>{
      const tab = el.dataset.tab;
      showTab(tab);

      if (tab === "audits") loadAudits().catch(()=>{});
      if (tab === "monitor") loadMonitors().catch(()=>{});
      if (tab === "settings") loadSettings().catch(e=>setMsg(e.message,"error"));
      if (tab === "team") loadTeam().catch(e=>setMsg(e.message,"error"));
    });
  });
}

(async function init(){
  if (!token()) { window.location.href = "/index.html"; return; }

  $("btnPortal").addEventListener("click", openPortal);
  $("btnLogout").addEventListener("click", ()=>{ localStorage.removeItem("fp_token"); window.location.href="/index.html"; });
  $("btnPricing").addEventListener("click", ()=> window.location.href="/pricing.html");
  $("btnRefresh").addEventListener("click", async ()=> {
    try { setMsg("Rafraîchissement…"); await loadMe(); await loadStats(); setMsg("✅ OK", "ok"); }
    catch(e){ setMsg(e.message, "error"); }
  });

  $("btnExportAudits").addEventListener("click", async ()=>{
    try { setMsg("Export audits…"); await downloadWithAuth("/api/export/audits.csv", "flowpoint-audits.csv"); setMsg("✅ Export audits téléchargé", "ok"); await loadMe(); }
    catch(e){ setMsg(e.message, "error"); }
  });

  $("btnExportMonitors").addEventListener("click", async ()=>{
    try { setMsg("Export monitors…"); await downloadWithAuth("/api/export/monitors.csv", "flowpoint-monitors.csv"); setMsg("✅ Export monitors téléchargé", "ok"); await loadMe(); }
    catch(e){ setMsg(e.message, "error"); }
  });

  $("btnRunAudit").addEventListener("click", ()=> runAudit().catch(e=>setMsg(e.message,"error")));
  $("btnCreateMon").addEventListener("click", ()=> createMonitor().catch(e=>setMsg(e.message,"error")));
  $("btnInvite").addEventListener("click", ()=> inviteMember().catch(e=>setMsg(e.message,"error")));
  $("btnSaveSettings").addEventListener("click", ()=> saveSettings().catch(e=>setMsg(e.message,"error")));

  initTabs();

  try {
    await loadMe();
    await loadStats();
  } catch(e){
    setMsg(e.message, "error");
  }
})();
