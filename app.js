const form = document.getElementById("signupForm");
const msg = document.getElementById("msg");
const btn = document.getElementById("btn");

function setMsg(text = "", type = "") {
  msg.textContent = text;
  msg.className = type === "ok" ? "ok" : type === "error" ? "error" : "";
}

function setLoading(isLoading) {
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Traitement..." : "Commencer l’essai";
}

async function postJSON(url, body, headers = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
  return d;
}

function normalizePlan(v) {
  const p = String(v || "").trim().toLowerCase();
  if (["standard", "pro", "ultra"].includes(p)) return p;
  return "pro";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("");
  setLoading(true);

  try {
    const firstName = document.getElementById("firstName").value.trim();
    const email = document.getElementById("email").value.trim();
    const companyName = document.getElementById("companyName").value.trim();
    const plan = normalizePlan(document.getElementById("plan").value);

    const lead = await postJSON("/api/auth/lead", { firstName, email, companyName, plan });
    localStorage.setItem("fp_token", lead.token);

    const checkout = await postJSON(
      "/api/stripe/checkout",
      { plan },
      { Authorization: "Bearer " + lead.token }
    );

    window.location.href = checkout.url;
  } catch (err) {
    setMsg(err.message || "Erreur", "error");
    setLoading(false);
  }
});
