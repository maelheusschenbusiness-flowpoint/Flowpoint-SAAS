const form = document.getElementById("loginForm");
const msg = document.getElementById("msg");
const btn = document.getElementById("btn");

function setMsg(text="", type="") {
  msg.textContent = text;
  msg.className = type === "ok" ? "ok" : type === "error" ? "error" : "";
}
function setLoading(v) {
  btn.disabled = v;
  btn.textContent = v ? "Connexion..." : "Se connecter";
}

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("");
  setLoading(true);

  try {
    const email = document.getElementById("email").value.trim().toLowerCase();
    const data = await postJSON("/api/auth/login", { email });
    localStorage.setItem("fp_token", data.token);
    setMsg("Connexion OK. Redirection…", "ok");
    setTimeout(() => location.href = "/dashboard.html", 700);
  } catch (e) {
    setMsg(e.message || "Erreur", "error");
    setLoading(false);
  }
});
