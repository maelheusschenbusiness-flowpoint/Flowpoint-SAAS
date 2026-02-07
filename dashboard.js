function $(id){ return document.getElementById(id); }

function setMsg(t){ $("msg").textContent = t || ""; }

function getToken(){
  return localStorage.getItem("fp_token") || "";
}

function mustLogin(){
  // Si pas de token, on renvoie sur la page d’accueil (signup)
  window.location.href = "/index.html";
}

async function api(path, opts = {}){
  const token = getToken();
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    opts.headers || {},
    token ? { "Authorization": "Bearer " + token } : {}
  );
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(data.error || "Erreur API");
  return data;
}

function fmtDate(d){
  if (!d) return "—";
  try {
    const dt = new Date(d);
    return dt.toLocaleString("fr-FR");
  } catch {
    return "—";
  }
}

async function loadMe(){
  const me = await api("/api/me", { method:"GET" });

  $("name").textContent = me.name || "—";
  $("email").textContent = me.email || "—";
  $("planBadge").textContent = "Plan: " + (me.plan || "standard").toUpperCase();

  $("trialStatus").textContent = me.hasTrial ? "Oui" : "Non";
  $("trialEnds").textContent = fmtDate(me.trialEndsAt);

  if (me.accessBlocked) {
    $("access").innerHTML = `<span class="danger">Accès bloqué : paiement en échec.</span>`;
  } else {
    $("access").innerHTML = `<span class="ok">Accès OK</span>`;
  }

  // Premium gating
  const plan = (me.plan || "standard").toLowerCase();
  const isPremium = plan === "pro" || plan === "ultra";
  $("standardUpsell").classList.toggle("hidden", isPremium);
  $("premiumContent").classList.toggle("hidden", !isPremium);
}

async function openPortal(){
  const out = await api("/api/stripe/portal", { method:"POST", body:"{}" });
  window.location.href = out.url;
}

(function init(){
  if (!getToken()) return mustLogin();

  $("btnPortal").addEventListener("click", openPortal);
  $("btnUpgrade2").addEventListener("click", openPortal);

  $("btnRefresh").addEventListener("click", async ()=>{
    try { setMsg("Chargement..."); await loadMe(); setMsg("✅ OK"); }
    catch(e){ setMsg("❌ " + e.message); }
  });

  $("btnLogout").addEventListener("click", ()=>{
    localStorage.removeItem("fp_token");
    mustLogin();
  });

  loadMe().catch(e => setMsg("❌ " + e.message));
})();
