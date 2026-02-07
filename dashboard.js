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
    headers: {
      "Authorization": "Bearer " + t,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : null
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("Erreur " + res.status));
  return data;
}

function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("fr-FR"); } catch { return "—"; }
}

async function loadMe() {
  const me = await api("/api/me");
  $("email").textContent = me.email || "—";
  $("company").textContent = me.companyName || "—";

  const plan = (me.plan || "standard").toUpperCase();
  $("planBadge").textContent = "PLAN: " + plan;

  $("trialPill").textContent = me.hasTrial ? ("Trial jusqu’au " + fmtDate(me.trialEndsAt)) : "Trial: non démarré";
  $("payPill").textContent = "Paiement: " + (me.lastPaymentStatus || "—");

  if (me.accessBlocked) {
    setMsg("Accès bloqué (paiement échoué / essai terminé). Clique “Gérer / Upgrade”.", "error");
  } else {
    setMsg("Accès OK.", "ok");
  }

  // quotas
  const a = me.usage.audits;
  const c = me.usage.chat;
  const m = me.usage.monitors;

  $("qa").textContent = `${a.used}/${a.limit}`;
  $("qc").textContent = `${c.used}/${c.limit}`;
  $("qm").textContent = `${m.used}/${m.limit}`;

  $("ba").style.width = pct(a.used, a.limit) + "%";
  $("bc").style.width = pct(c.used, c.limit) + "%";
  $("bm").style.width = pct(m.used, m.limit) + "%";

  // premium boxes
  const p = (me.plan || "standard").toLowerCase();
  $("standardUpsell").classList.toggle("hidden", p !== "standard");
  $("proBox").classList.toggle("hidden", p !== "pro");
  $("ultraBox").classList.toggle("hidden", p !== "ultra");

  return me;
}

async function openPortal() {
  const out = await api("/api/stripe/portal", "POST", {});
  window.location.href = out.url;
}

async function runFeature(endpoint) {
  try {
    setMsg("Traitement…");
    const out = await api(endpoint, "POST", {});
    setMsg(out.message || "OK", "ok");
    await loadMe();
  } catch (e) {
    setMsg(e.message, "error");
    await loadMe().catch(()=>{});
  }
}

(function init(){
  if (!token()) {
    window.location.href = "/index.html";
    return;
  }

  $("btnPortal").addEventListener("click", openPortal);
  $("btnUpgrade2").addEventListener("click", openPortal);

  $("btnPricing").addEventListener("click", () => window.location.href = "/pricing.html");

  $("btnLogout").addEventListener("click", () => {
    localStorage.removeItem("fp_token");
    window.location.href = "/index.html";
  });

  $("btnAudit").addEventListener("click", () => runFeature("/api/features/audit"));
  $("btnChat").addEventListener("click", () => runFeature("/api/features/chat"));
  $("btnMonitor").addEventListener("click", () => runFeature("/api/features/monitor"));
  $("btnUltra").addEventListener("click", () => runFeature("/api/features/ultra-only"));

  loadMe().catch(e => setMsg(e.message, "error"));
})();
