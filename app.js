const form = document.getElementById("signup-form");
const msg = document.getElementById("message");
const btn = document.getElementById("btn");

function setMsg(text, ok = false) {
  msg.textContent = text || "";
  msg.className = ok ? "ok" : "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("");
  btn.disabled = true;

  const firstName = document.getElementById("firstName").value.trim();
  const email = document.getElementById("email").value.trim();
  const companyName = document.getElementById("companyName").value.trim();
  const plan = document.getElementById("plan").value;

  try {
    setMsg("Création du compte...");

    // 1) Lead + token (anti-abus)
    const leadRes = await fetch("/api/auth/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, email, companyName, plan })
    });

    const leadData = await leadRes.json().catch(() => ({}));
    if (!leadRes.ok) throw new Error(leadData.error || "Erreur lead");

    setMsg("Redirection Stripe...");

    // 2) Checkout Stripe
    const stripeRes = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + leadData.token
      },
      body: JSON.stringify({ plan })
    });

    const stripeData = await stripeRes.json().catch(() => ({}));
    if (!stripeRes.ok) throw new Error(stripeData.error || "Erreur Stripe");

    window.location.href = stripeData.url;
  } catch (err) {
    setMsg("❌ " + (err?.message || "Erreur inconnue"));
    btn.disabled = false;
  }
});
