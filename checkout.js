// checkout.js — FlowPoint Embedded Checkout
// - lit plan + addons depuis localStorage (venant de pricing.js)
// - appelle /api/stripe/checkout-embedded { plan, addons }
// - si {ok:true} => update fait côté backend (déjà abonné) => message + boutons
// - si {clientSecret} => mount Embedded Checkout

(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
  const PLAN_PREF_KEY = "fp_plan_pref";
  const ADDON_PREF_KEY = "fp_addon_prefs";

  const $ = (q) => document.querySelector(q);

  const authPill = $("#authPill");
  const backLink = $("#backLink");

  const checkoutMsg = $("#checkoutMsg");
  const mountEl = $("#embedded-checkout");

  const sumPlan = $("#sumPlan");
  const sumAddons = $("#sumAddons");

  const btnRetry = $("#btnRetry");
  const btnGoDashboard = $("#btnGoDashboard");
  const btnGoPricing = $("#btnGoPricing");

  function getToken() {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
    return "";
  }

  function setAuth() {
    const tok = getToken();
    if (authPill) authPill.textContent = tok ? "Statut : Connecté" : "Statut : Non connecté";
  }

  function setMsg(t) {
    if (checkoutMsg) checkoutMsg.textContent = t || "";
  }

  function loadSelection() {
    const plan = String(localStorage.getItem(PLAN_PREF_KEY) || "");
    let addons = {};
    try { addons = JSON.parse(localStorage.getItem(ADDON_PREF_KEY) || "{}") || {}; } catch {}
    return { plan: plan || null, addons: addons || {} };
  }

  function summarizeAddons(addons) {
    if (!addons || typeof addons !== "object") return "—";
    const lines = [];

    for (const [k, v] of Object.entries(addons)) {
      if (k === "whiteLabel") continue;
      if (typeof v === "boolean") {
        if (v) lines.push(k);
      } else {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) lines.push(`${k} × ${n}`);
      }
    }

    return lines.length ? lines.join(" • ") : "—";
  }

  async function api(path, method, body) {
    const tok = getToken();
    const r = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + tok,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur API");
    return j;
  }

  function showPostActions() {
    if (btnGoDashboard) btnGoDashboard.style.display = "";
    if (btnGoPricing) btnGoPricing.style.display = "";
  }

  function wireButtons() {
    if (btnGoDashboard) btnGoDashboard.addEventListener("click", () => (location.href = "/dashboard.html"));
    if (btnGoPricing) btnGoPricing.addEventListener("click", () => (location.href = "/pricing.html"));
    if (btnRetry) btnRetry.addEventListener("click", () => start());
  }

  async function start() {
    setAuth();
    wireButtons();

    const tok = getToken();
    if (!tok) {
      // pas connecté => retour login/pricing
      setMsg("Connecte-toi pour payer ou modifier ton abonnement.");
      showPostActions();
      if (btnGoPricing) btnGoPricing.textContent = "Aller au pricing";
      if (btnGoDashboard) btnGoDashboard.style.display = "none";
      return;
    }

    const { plan, addons } = loadSelection();

    if (sumPlan) sumPlan.textContent = plan ? plan : "—";
    if (sumAddons) sumAddons.textContent = summarizeAddons(addons);

    // Stripe init
    const pk = window.STRIPE_PUBLISHABLE_KEY;
    if (!pk || pk.includes("XXXX")) {
      setMsg("❌ Clé Stripe publique manquante dans checkout.html (STRIPE_PUBLISHABLE_KEY).");
      if (btnRetry) btnRetry.style.display = "";
      return;
    }
    const stripe = Stripe(pk);

    // Call backend embedded checkout
    setMsg("Préparation du paiement…");

    try {
      const data = await api("/api/stripe/checkout-embedded", "POST", {
        plan: plan || null,
        addons: addons || {},
      });

      // Cas: déjà abonné => backend update direct
      if (data && data.ok) {
        setMsg(data.updated ? "✅ Abonnement / options mis à jour." : "✅ Aucun changement.");
        showPostActions();
        return;
      }

      if (!data.clientSecret) {
        setMsg("❌ clientSecret manquant (réponse backend).");
        if (btnRetry) btnRetry.style.display = "";
        return;
      }

      // Mount embedded checkout
      mountEl.innerHTML = "";
      const checkout = await stripe.initEmbeddedCheckout({ clientSecret: data.clientSecret });
      checkout.mount("#embedded-checkout");

      setMsg(""); // clean
    } catch (e) {
      setMsg("❌ " + (e?.message || "Erreur checkout"));
      if (btnRetry) btnRetry.style.display = "";
      showPostActions();
    }
  }

  // back link safe
  if (backLink) backLink.addEventListener("click", (e) => {
    // laisse le href fonctionner
  });

  document.addEventListener("DOMContentLoaded", start);
})();
