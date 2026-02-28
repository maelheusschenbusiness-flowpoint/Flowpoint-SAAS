(function () {
  const TOKEN_KEY = "fp_token";

  const emailInput = document.getElementById("email");
  const btn = document.getElementById("btn");
  const msg = document.getElementById("msg");

  function setMsg(text, type){
    if(!msg) return;
    msg.textContent = text || "";
    msg.className = "muted";
    if(type === "error") msg.className = "muted error";
    if(type === "ok") msg.className = "muted ok";
  }

  async function postJSON(url, body){
    const res = await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body || {})
    });
    const j = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  }

  btn?.addEventListener("click", async () => {
    try{
      const email = String(emailInput?.value || "").trim();
      if(!email) return setMsg("Email requis", "error");

      setMsg("Envoi du lien…");
      const r = await postJSON("/api/auth/login-request", { email });

      // debug mode returns debugLink
      if(r.debugLink){
        setMsg("DEBUG: lien généré. Copie-colle ce lien dans ton navigateur.", "ok");
        console.log("DEBUG LINK:", r.debugLink);
      } else {
        setMsg("✅ Lien envoyé. Vérifie tes emails.", "ok");
      }
    }catch(e){
      setMsg(e.message || "Erreur", "error");
    }
  });

  // Option: si token déjà présent => dashboard
  const existing = localStorage.getItem(TOKEN_KEY);
  if(existing){
    // Pas de redirection forcée, mais tu peux activer si tu veux :
    // location.replace("/dashboard.html");
  }
})();
