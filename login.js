// login.js — FlowPoint  Magic Link request (frontend)
// Works with backend: POST /api/auth/login-request { email }

(() => {
  const emailEl = document.getElementById("email");
  const btn = document.getElementById("btn");
  const msg = document.getElementById("msg");

  const setMsg = (text, type) => {
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "muted";
    if (type === "ok") msg.classList.add("ok");
    if (type === "error") msg.classList.add("error");
  };

  async function requestLink() {
    const email = String(emailEl?.value || "").trim();
    if (!email) return setMsg("Email requis.", "error");

    btn && (btn.disabled = true);
    setMsg("Envoi du lien…");

    try {
      const r = await fetch("/api/auth/login-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Impossible d’envoyer le lien.");

      // Mode debug (si DEBUG_LOGIN_LINK=true côté backend)
      if (j.debugLink) {
        setMsg("Mode debug: lien généré. Ouverture…", "ok");
        window.location.href = j.debugLink;
        return;
      }

      setMsg("✅ Lien envoyé. Vérifie ta boîte mail (et spam).", "ok");
    } catch (e) {
      setMsg(e?.message || "Erreur.", "error");
    } finally {
      btn && (btn.disabled = false);
    }
  }

  btn?.addEventListener("click", requestLink);
  emailEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") requestLink();
  });
})();
