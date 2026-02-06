const form = document.getElementById("form");
const msg = document.getElementById("msg");

function setMsg(t){ msg.textContent = t; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("Traitement...");

  const firstName = document.getElementById("firstName").value.trim();
  const email = document.getElementById("email").value.trim();
  const companyName = document.getElementById("companyName").value.trim();
  const plan = document.getElementById("plan").value; // standard|pro|ultra

  try {
    // 1) create lead / trial + token
    const leadRes = await fetch("/api/auth/lead", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ firstName, email, companyName, plan })
    });

    const leadData = await leadRes.json().catch(() => ({}));
    if (!leadRes.ok) {
      setMsg("❌ " + (leadData.error || "Erreur lead"));
      return;
    }

    // 2) create stripe checkout session
    const stripeRes = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "Authorization": "Bearer " + leadData.token
      },
      body: JSON.stringify({ plan })
    });

    const stripeData = await stripeRes.json().catch(() => ({}));
    if (!stripeRes.ok) {
      setMsg("❌ " + (stripeData.error || "Erreur Stripe"));
      return;
    }

    // 3) redirect
    window.location.href = stripeData.url;
  } catch (err) {
    setMsg("❌ Serveur indisponible");
  }
});

