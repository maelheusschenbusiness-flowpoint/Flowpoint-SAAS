function $(id){ return document.getElementById(id); }
function token(){ return localStorage.getItem("fp_token") || ""; }

function setMsg(text, type="") {
  const el = $("msg");
  el.className = type === "error" ? "danger" : type === "ok" ? "ok" : "muted";
  el.textContent = text || "";
}

function pct(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
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
  const ids = ["audit","audits","monitor"];
  for (const t of ids) {
    $("tab-"+t).classList.toggle("hidden", t !== name);
  }
  document.querySelectorAll(".tab").forEach(el=>{
    el.classList.toggle("active", el.dataset.tab === name);
  });
}

async function loadMe(){
  const me = await api("/api/me");
  $("email").textContent = me.email || "—";
  $("company").textContent = me.companyName || "—";

  $("planBadge").textContent = "PLAN: " + (me.plan || "standard").toUpperCase();
  $("trialPill").textContent = me.hasTrial ? ("Trial jusqu’au " + fmtDate(me.trialEndsAt)) : "Trial: non démarré";
  $("payPill").textContent = "Paiement: " + (me.lastPaymentStatus || "—");

  if (me.accessBlocked) setMsg("Accès bloqué (paiement échoué / essai terminé). Clique “Gérer / Upgrade”.", "error");
  else setMsg("Accès OK.", "ok");

  const a = me.usage.audits;
  const m = me.usage.monitors;
  const p = me.usage.pdf;

  $("qa").textContent = `${a.used}/${a.limit}`;
  $("qm").textContent = `${m.used}/${m.limit}`;
  $("qp").textContent = `${p.used}/${p.limit}`;

  $("ba").style.width = pct(a.used, a.limit) + "%";
  $("bm").style.width = pct(m.used, m.limit) + "%";
  $("bp").style.width = pct(p.used, p.limit) + "%";

  return me;
}

async function openPortal(){
  const out = await api("/api/stripe/portal", "POST", {});
  window.location.href = out.url;
}

// ----- AUDITS -----
async function runAudit(){
  const url = $("auditUrl").value.trim();
  setMsg("Audit en cours...");
  const out = await api("/api/audits/run", "POST", { url });
  setMsg("✅ Audit terminé", "ok");

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
        <div style="font-weight:900;margin-bottom:8px">Logs (100 derniers)</div>
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

// Tabs
function initTabs(){
  document.querySelectorAll(".tab").forEach(el=>{
    el.addEventListener("click", ()=>{
      const tab = el.dataset.tab;
      showTab(tab);
      if (tab === "audits") loadAudits().catch(()=>{});
      if (tab === "monitor") loadMonitors().catch(()=>{});
    });
  });
}

(function init(){
  if (!token()) { window.location.href = "/index.html"; return; }

  $("btnPortal").addEventListener("click", openPortal);
  $("btnLogout").addEventListener("click", ()=>{ localStorage.removeItem("fp_token"); window.location.href="/index.html"; });
  $("btnPricing").addEventListener("click", ()=> window.location.href="/pricing.html");

  $("btnRunAudit").addEventListener("click", ()=> runAudit().catch(e=>setMsg(e.message,"error")));
  $("btnCreateMon").addEventListener("click", ()=> createMonitor().catch(e=>setMsg(e.message,"error")));

  initTabs();
  loadMe().catch(e=>setMsg(e.message,"error"));
})();
