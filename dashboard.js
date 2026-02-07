const statusEl = document.getElementById("status");
const nameEl = document.getElementById("name");
const emailEl = document.getElementById("email");
const planEl = document.getElementById("plan");
const subStatusEl = document.getElementById("subStatus");
const trialEndEl = document.getElementById("trialEnd");
const accessEl = document.getElementById("access");

function setError(txt) {
  statusEl.textContent = txt || "";
}

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR");
}

async function loadMe() {
  setError("");
  const token = localStorage.getItem("fp_token");
  if (!token) {
    setError("Pas connecté. Va sur / (inscription) ou /success.html après paiement.");
    return;
  }

  const r = await fetch("/api/me", {
    headers: { "Authorization": "Bearer " + token }
  });

  const d = await r.json();
  if (!r.ok) {
    setError(d.error || "Impossible de charger le profil.");
    return;
  }

  nameEl.textContent = d.user.firstName || "—";
  emailEl.textContent = d.user.email || "—";
  planEl.textContent = (d.user.plan || "—").toUpperCase();
  subStatusEl.textContent = d.user.subscriptionStatus || "—";
  trialEndEl.textContent = fmtDate(d.user.trialEndsAt);
  accessEl.textContent = d.user.accessBlocked ? "Bloqué" : "OK";
}

document.getElementById("refresh").addEventListener("click", loadMe);
document.getElementById("logout").addEventListener("click", () => {
  localStorage.removeItem("fp_token");
  location.href = "/index.html";
});

loadMe();
