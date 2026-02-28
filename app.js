// app.js — FlowPoint AI Signup (Frontend)
// Flow: POST /api/auth/lead -> store JWT -> POST /api/stripe/checkout -> redirect to Stripe
// Token stored in localStorage under "fp_token" (same as dashboard.js + login-verify.html)

(() => {
  const TOKEN_KEY = "fp_token";

  const form = document.getElementById("signupForm");
  const btn = document.getElementById("btn");
  const msg = document.getElementById("msg");

  const firstNameEl = document.getElementById("firstName");
  const emailEl = document.getElementById("email");
  const companyEl = document.getElementById("companyName");
  const planEl = document.getElementById("plan");

  function setMsg(text, type) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "";
    if (type === "ok") msg.classList.add("ok");
    if (type === "error") msg.classList.add("error");
  }

  function setLoading(isLoading) {
    if (!btn) return;
    btn.disabled = !!isLoading;
    btn.textContent = isLoading ? "Traitement…" : "Commencer l’essai";
  }

  function normalizePlan(p) {
    const v = String(p || "").toLowerCase();
    if (v === "standard" || v === "pro" || v === "ultra") return v;
    return "pro";
  }

  async function postJSON(url, body, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur API (${r.status})`);
    return j;
  }

  async function startTrial(e) {
    e?.preventDefault?.();

    const firstName = String(firstNameEl?.value || "").trim();
    const email = String(emailEl?.value || "").trim();
    const companyName = String(companyEl?.value || "").trim();
    const plan = normalizePlan(planEl?.value);

    if (!email || !companyName) {
      setMsg("Email + entreprise requis.", "error");
      return;
    }
    if (!/^.+@.+\..+$/.test(email)) {
      setMsg("Email invalide.", "error");
      return;
    }

    setLoading(true);
    setMsg("Création du compte…");

    try {
      // 1) Lead -> JWT
      const lead = await postJSON("/api/auth/lead", {
        firstName,
        email,
        companyName,
        plan,
      });

      if (!lead?.token) throw new Error("Token manquant (lead).");
      localStorage.setItem(TOKEN_KEY, lead.token);

      // 2) Checkout Stripe -> redirect
      setMsg("Redirection vers Stripe (paiement) …");

      const checkout = await postJSON(
        "/api/stripe/checkout",
        { plan },
        lead.token
      );

      if (!checkout?.url) throw new Error("URL Stripe manquante.");
      window.location.href = checkout.url;
    } catch (err) {
      const m = err?.message || "Erreur.";
      setMsg(m, "error");
      // fallback: si token existe, au moins on peut aller dashboard
      const tok = localStorage.getItem(TOKEN_KEY);
      if (tok) {
        setMsg(
          m + " — Tu peux essayer d’ouvrir le dashboard et relancer le checkout.",
          "error"
        );
      }
    } finally {
      setLoading(false);
    }
  }

  form?.addEventListener("submit", startTrial);
})();
