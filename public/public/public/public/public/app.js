const form = document.getElementById("form");
const msg = document.getElementById("msg");

function setMsg(t){ msg.textContent = t; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("Traitement...");

  const firstName = document.getElementById("firstName").value.trim();
  const email = document.getElementById("email").value.trim();
  const companyName = document.getElementById("companyName").value.trim();
  const plan = document.getElementById("plan").value;

  try {
    // 1) lead
    const leadRes = await fetch("/api/auth/lead", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ firstName, email, companyName, plan })
    });
    const leadData = await leadRes.json();
    if (!leadRes.ok) return setMsg("❌ " + (leadData.error || "Erreur lead"));

    // 2) checkout session
    const stripeRes = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "Authorization": "Bearer " + leadData.token
      },
      body: JSON.stringify({ plan })
    });
    const stripeData = await stripeRes.json();
    if (!stripeRes.ok) return setMsg("❌ " + (stripeData.error || "Erreur Stripe"));

    // 3) redirect
    window.location.href = stripeData.url;
  } catch(e) {
    setMsg("❌ Serveur indisponible");
  }
});
