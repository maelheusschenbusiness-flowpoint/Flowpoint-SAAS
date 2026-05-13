const form = document.getElementById("signupForm");

if (form) {
  const btn = document.getElementById("btn");
  const msg = document.getElementById("msg");

  function setMsg(text, ok = false) {
    msg.innerHTML = `
      <div style="
        padding:12px;
        border-radius:12px;
        margin-top:12px;
        font-weight:600;
        background:${ok ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.12)"};
        color:${ok ? "#22c55e" : "#ef4444"};
        border:1px solid ${ok ? "rgba(34,197,94,.25)" : "rgba(239,68,68,.25)"};
      ">
        ${text}
      </div>
    `;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const firstName = document.getElementById("firstName").value.trim();
    const email = document.getElementById("email").value.trim();
    const companyName = document.getElementById("companyName").value.trim();
    const plan = document.getElementById("plan").value;

    if (!firstName || !email || !companyName) {
      return setMsg("Tous les champs sont requis.");
    }

    const password = prompt("Choisis un mot de passe FlowPoint");

    if (!password || password.length < 6) {
      return setMsg("Mot de passe invalide.");
    }

    btn.disabled = true;
    btn.textContent = "Création du compte...";

    try {
      // REGISTER
      const registerRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          firstName,
          email,
          password,
          companyName
        })
      });

      const registerData = await registerRes.json();

      if (!registerRes.ok) {
        throw new Error(registerData.error || "Erreur création compte");
      }

      setMsg("Compte créé. Préparation du checkout Stripe...", true);

      // CHECKOUT STRIPE
      const checkoutRes = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          plan
        })
      });

      const checkoutData = await checkoutRes.json();

      if (!checkoutRes.ok) {
        throw new Error(checkoutData.error || "Erreur Stripe");
      }

      if (!checkoutData.url) {
        throw new Error("URL Stripe manquante");
      }

      window.location.href = checkoutData.url;

    } catch (err) {
      console.error(err);
      setMsg(err.message || "Erreur inconnue");
    } finally {
      btn.disabled = false;
      btn.textContent = "Commencer l’essai";
    }
  });
}
