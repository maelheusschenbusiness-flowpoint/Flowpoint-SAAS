// app.js — FlowPoint AI (frontend)
// Flux: lead -> token -> checkout -> redirect Stripe

const form = document.getElementById("signupForm");
const msg = document.getElementById("msg");
const btn = document.getElementById("btn");

function setMsg(text = "", type = "") {
  if (!msg) return;
  msg.textContent = text;

  // Si tu utilises des classes CSS "ok" / "error" dans ton HTML
  msg.className = "";
  if (type === "ok") msg.classList.add("ok");
  if (type === "error") msg.classList.add("error");
}

function setLoading(isLoading) {
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Traitement..." : "Commencer l’essai";
}

async function postJSON(url, body, headers = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  let data = {};
  try {
    data = await r.json();
  } catch {
    // parfois le serveur peut renvoyer autre chose que JSON
  }

  if (!r.ok) {
    const errMsg = data?.error || `Erreur ${r.status}`;
    throw new Error(errMsg);
  }
  return data;
}

function normalizePlan(v) {
  const p = String(v || "").trim().toLowerCase();
  // Plans EXACTS attendus par le backend
  if (["standard", "pro", "ultra"].includes(p)) return p;
  return "pro";
}

function requireEl(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} introuvable dans la page`);
  return el;
}

if (!form) {
  console.warn("⚠️ signupForm introuvable (id='signupForm')");
} else {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");
    setLoading(true);

    try {
      const firstName = requireEl("firstName").value.trim();
      const email = requireEl("email").value.trim();
      const companyName = requireEl("companyName").value.trim();
      const plan = normalizePlan(requireEl("plan").value);

      if (!email) throw new Error("Email requis");
      if (!companyName) throw new Error("Nom d’entreprise requis");

      // 1) Lead -> token
      const lead = await postJSON("/api/auth/lead", {
        firstName,
        email,
        companyName,
        plan,
      });

      if (!lead.token) throw new Error("Token manquant (lead)");

      // On stocke aussi le token tout de suite (pratique)
      localStorage.setItem("fp_token", lead.token);

      // 2) Checkout Stripe -> url
      const checkout = await postJSON(
        "/api/stripe/checkout",
        { plan },
        { Authorization: "Bearer " + lead.token }
      );

      if (!checkout.url) throw new Error("URL Stripe manquante");

      // 3) Redirect Stripe
      window.location.href = checkout.url;
    } catch (err) {
      setMsg(err?.message || "Erreur", "error");
      setLoading(false);
    }
  });
}
