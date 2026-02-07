const msg = document.getElementById("msg");
const btn = document.getElementById("btn");

function setMsg(text, type = "error") {
  msg.className = type === "ok" ? "ok" : "error";
  msg.textContent = text;
}

document.getElementById("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("");
  btn.disabled = true;

  const firstName = document.getElementById("firstName").value.trim();
  const email = document.getElementById("email").value.trim();
  const companyName = document.getElementById("companyName").value.trim();
  const plan = document.getElementById("plan").value;

  try {
    // 1) Lead + token
    const r1 = await fetch("/api/auth/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, email, companyName, plan })
    });

    const d1 = await r1.json();
    if (!r1.ok) {
      setMsg(d1.error || "Erreur lead");
      btn.disabled = false;
      return;
    }

    // 2) Stripe checkout session
    const r2 = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + d1.token
      },
      body: JSON.stringify({ plan })
    });

    const d2 = await r2.json();
    if (!r2.ok) {
      setMsg(d2.error || "Erreur Stripe");
      btn.disabled = false;
      return;
    }

    // 3) Redirect
    window.location.href = d2.url;

  } catch (err) {
    setMsg("Serveur indisponible");
    btn.disabled = false;
  }
});
