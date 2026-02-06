console.log("✅ app.js loaded");

window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("form");
  const msg = document.getElementById("msg");

  if (!form) {
    console.error("❌ Form #form introuvable");
    return;
  }

  function setMsg(t){ if (msg) msg.textContent = t; }

  form.addEventListener("submit", async (e) => {
    e.preventDefault(); // empêche le refresh
    setMsg("Traitement...");

    const firstName = document.getElementById("firstName").value.trim();
    const email = document.getElementById("email").value.trim();
    const companyName = document.getElementById("companyName").value.trim();
    const plan = document.getElementById("plan").value;

    console.log("submit", { firstName, email, companyName, plan });

    try {
      const leadRes = await fetch("/api/auth/lead", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ firstName, email, companyName, plan })
      });

      const leadData = await leadRes.json().catch(() => ({}));
      if (!leadRes.ok) return setMsg("❌ " + (leadData.error || "Erreur lead"));

      const stripeRes = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type":"application/json",
          "Authorization": "Bearer " + leadData.token
        },
        body: JSON.stringify({ plan })
      });

      const stripeData = await stripeRes.json().catch(() => ({}));
      if (!stripeRes.ok) return setMsg("❌ " + (stripeData.error || "Erreur Stripe"));

      window.location.href = stripeData.url;
    } catch (err) {
      console.error(err);
      setMsg("❌ Serveur indisponible");
    }
  });
});


