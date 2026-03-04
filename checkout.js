// checkout.js — FlowPoint UI
// - Lit payload depuis localStorage (plan + addons)
// - Appelle /api/stripe/checkout-embedded (nouveau) OU /api/stripe/checkout (update)
// - Si update renvoie paymentIntentClientSecret => affiche Payment Element et paye
// - Si annulation: Stripe renverra vers /cancel.html (config backend)

(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
  const CHECKOUT_PAYLOAD_KEY = "fp_checkout_payload";

  const $ = (q) => document.querySelector(q);

  const authPill = $("#authPill");
  const msg = $("#checkoutMsg");
  const retryBtn = $("#retryBtn");

  const embeddedContainer = $("#embedded-checkout");
  const piForm = $("#piForm");
  const payBtn = $("#payBtn");
  const paymentEl = $("#payment-element");

  const sumPlan = $("#sumPlan");
  const sumAddOns = $("#sumAddOns");

  function getToken() {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
    return null;
  }

  function setAuthBadge() {
    const tok = getToken();
    if (!authPill) return;
    authPill.textContent = tok ? "Statut : Connecté" : "Statut : Non connecté";
  }

  function setMsg(t) {
    if (msg) msg.textContent = t || "";
  }

  function readPayload() {
    try {
      return JSON.parse(localStorage.getItem(CHECKOUT_PAYLOAD_KEY) || "null");
    } catch {
      return null;
    }
  }

  function summarize(payload) {
    if (!payload) return;

    if (sumPlan) sumPlan.textContent = payload.plan || "—";

    const addons = payload.addons || {};
    const lines = [];
    for (const [k, v] of Object.entries(addons)) {
      if (k === "whiteLabel") continue;
      if (typeof v === "boolean") { if (v) lines.push(k); }
      else if (Number(v) > 0) lines.push(`${k}×${Number(v)}`);
    }
    if (sumAddOns) sumAddOns.textContent = lines.length ? lines.join(" • ") : "—";
  }

  async function api(path, body) {
    const tok = getToken();
    const r = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + tok,
      },
      body: JSON.stringify(body || {})
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur API");
    return j;
  }

  async function start() {
    setAuthBadge();

    const tok = getToken();
    if (!tok) {
      window.location.href = "/login.html";
      return;
    }

    if (!window.STRIPE_PUBLISHABLE_KEY || !String(window.STRIPE_PUBLISHABLE_KEY).startsWith("pk_")) {
      setMsg("Clé Stripe publique manquante dans checkout.html (STRIPE_PUBLISHABLE_KEY).");
      if (retryBtn) retryBtn.style.display = "none";
      return;
    }

    const payload = readPayload();
    if (!payload) {
      setMsg("Aucune sélection trouvée. Retourne sur pricing.");
      return;
    }
    summarize(payload);

    const stripe = Stripe(window.STRIPE_PUBLISHABLE_KEY);

    // 1) On tente d'abord un update via /api/stripe/checkout (si déjà abonné => ok/updated + peut renvoyer un paymentIntent)
    //    Si pas abonné => backend renvoie { url } (checkout stripe classique) -> on préfère embedded, donc on passe au point 2.
    try {
      setMsg("Préparation…");

      const j = await api("/api/stripe/checkout", {
        plan: payload.mode === "addons" ? null : payload.plan,
        addons: payload.addons
      });

      // Cas: update direct sans paiement requis
      if (j.ok && !j.paymentIntentClientSecret) {
        setMsg(j.updated ? "Abonnement mis à jour ✅" : "Aucun changement.");
        setTimeout(() => window.location.href = "/dashboard.html", 800);
        return;
      }

      // Cas: update avec prorata à payer (PaymentIntent)
      if (j.paymentIntentClientSecret) {
        setMsg("Paiement requis (prorata).");
        embeddedContainer.innerHTML = "";
        piForm.style.display = "block";

        const elements = stripe.elements({ clientSecret: j.paymentIntentClientSecret });
        const pe = elements.create("payment");
        pe.mount("#payment-element");

        piForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          payBtn.disabled = true;

          const { error } = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: window.location.origin + "/success.html" }
          });

          if (error) {
            setMsg(error.message || "Erreur paiement");
            payBtn.disabled = false;
          }
        });

        return;
      }

      // Cas: backend te renvoie encore une URL checkout Stripe (ancien flow)
      // => on préfère Embedded Checkout (FlowPoint UI) donc on continue au point 2.
      if (j.url) {
        // on ignore et on fait embedded
      }
    } catch (e) {
      // on tente embedded quand même
      console.log("checkout update -> fallback embedded:", e.message);
    }

    // 2) Embedded checkout (nouvelle souscription) via /api/stripe/checkout-embedded
    try {
      setMsg("Ouverture du paiement…");

      const j2 = await api("/api/stripe/checkout-embedded", {
        plan: payload.plan,
        addons: payload.addons
      });

      // si déjà abonné => update direct
      if (j2.ok) {
        setMsg(j2.updated ? "Abonnement mis à jour ✅" : "Aucun changement.");
        setTimeout(() => window.location.href = "/dashboard.html", 800);
        return;
      }

      if (!j2.clientSecret) throw new Error("clientSecret manquant (embedded)");
      piForm.style.display = "none";

      const checkout = await stripe.initEmbeddedCheckout({ clientSecret: j2.clientSecret });
      checkout.mount("#embedded-checkout");
      setMsg("");
    } catch (e) {
      setMsg(e.message || "Erreur checkout");
      if (retryBtn) {
        retryBtn.style.display = "inline-block";
        retryBtn.onclick = () => window.location.reload();
      }
    }
  }

  start();
})();
