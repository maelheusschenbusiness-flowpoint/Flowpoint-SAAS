const email = document.getElementById("email");
const btn = document.getElementById("btn");
const msg = document.getElementById("msg");

function setMsg(t, type="") {
  msg.className = type === "error" ? "error" : type === "ok" ? "ok" : "muted";
  msg.textContent = t || "";
}

btn.addEventListener("click", async () => {
  const v = email.value.trim();
  if (!v) return setMsg("Email requis", "error");

  btn.disabled = true;
  setMsg("Envoi du lien…");

  try {
    const r = await fetch("/api/auth/login-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: v })
    });
    const d = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(d.error || "Erreur");

    setMsg("✅ Lien envoyé. Vérifie ton email.", "ok");
  } catch (e) {
    setMsg(e.message || "Erreur", "error");
  } finally {
    btn.disabled = false;
  }
});
