// checkout.js — FlowPoint UI (AUTO light/dark Stripe)
// - Lit payload depuis localStorage (plan + addons)
// - Appelle /api/stripe/checkout (update) puis fallback /api/stripe/checkout-embedded (nouveau)
// - Si update renvoie paymentIntentClientSecret => affiche Payment Element et paye
// ✅ Stripe suit le thème système (clair/sombre) via appearance

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
      if (typeof v === "boolean") {
        if (v) lines.push(k);
      } else if (Number(v) > 0) {
        lines.push(`${k}×${Number(v)}`);
      }
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
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur API");
    return j;
  }

  // ✅ Stripe appearance auto selon thème système
  function stripeAppearance() {
    const isDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return { theme: isDark ? "night" : "stripe" };
  }

  async function start() {
    setAuthBadge();

    const tok = getToken();
    if (!tok) {
      window.location.href = "/login.html";
      return;
    }

    const pk = window.STRIPE_PUBLISHABLE_KEY;
    if (!pk || typeof pk !== "string" || !pk.startsWith("pk_")) {
      setMsg(
        "Clé Stripe publique manquante dans checkout.html (window.STRIPE_PUBLISHABLE_KEY)."
      );
      if (retryBtn) retryBtn.style.display = "none";
      return;
    }

    const payload = readPayload();
    if (!payload) {
      setMsg("Aucune sélection trouvée. Retourne sur pricing.");
      return;
    }

    summarize(payload);

    const stripe = Stripe(pk);

    // 1) tentative update via /api/stripe/checkout
    try {
      setMsg("Préparation…");

      const j = await api("/api/stripe/checkout", {
        plan: payload.mode === "addons" ? null : payload.plan,
        addons: payload.addons,
      });

      // ✅ update sans paiement requis
      if (j.ok && !j.paymentIntentClientSecret) {
        setMsg(j.updated ? "Abonnement mis à jour ✅" : "Aucun changement.");
        setTimeout(() => (window.location.href = "/dashboard.html"), 800);
        return;
      }

      // ✅ prorata à payer (PaymentIntent)
      if (j.paymentIntentClientSecret) {
        setMsg("Paiement requis (prorata).");
        if (embeddedContainer) embeddedContainer.innerHTML = "";
        if (piForm) piForm.style.display = "block";

        // ✅ appearance ici
        const elements = stripe.elements({
          clientSecret: j.paymentIntentClientSecret,
          appearance: stripeAppearance(),
        });

        const pe = elements.create("payment");
        pe.mount("#payment-element");

        // évite double listener si reload partiel
        piForm.onsubmit = async (e) => {
          e.preventDefault();
          if (payBtn) payBtn.disabled = true;

          const { error } = await stripe.confirmPayment({
            elements,
            confirmParams: {
              return_url:
                window.location.origin + "/success.html?next=/dashboard.html",
            },
          });

          if (error) {
            setMsg(error.message || "Erreur paiement");
            if (payBtn) payBtn.disabled = false;
          }
        };

        return;
      }

      // ✅ si backend renvoie url (checkout classique), on ignore et on préfère embedded
    } catch (e) {
      console.log("checkout update -> fallback embedded:", e.message);
    }

    // 2) embedded checkout (nouvelle subscription)
    try {
      setMsg("Ouverture du paiement…");

      const j2 = await api("/api/stripe/checkout-embedded", {
        plan: payload.plan,
        addons: payload.addons,
      });

      // déjà abonné => update direct
      if (j2.ok) {
        // ✅ si prorata à payer (et ton backend renvoie le client_secret ici aussi)
        if (j2.paymentIntentClientSecret) {
          setMsg("Paiement requis (prorata).");
          if (embeddedContainer) embeddedContainer.innerHTML = "";
          if (piForm) piForm.style.display = "block";

          const elements = stripe.elements({
            clientSecret: j2.paymentIntentClientSecret,
            appearance: stripeAppearance(),
          });

          const pe = elements.create("payment");
          pe.mount("#payment-element");

          piForm.onsubmit = async (e) => {
            e.preventDefault();
            if (payBtn) payBtn.disabled = true;

            const { error } = await stripe.confirmPayment({
              elements,
              confirmParams: {
                return_url:
                  window.location.origin + "/success.html?next=/dashboard.html",
              },
            });

            if (error) {
              setMsg(error.message || "Erreur paiement");
              if (payBtn) payBtn.disabled = false;
            }
          };

          return;
        }

        setMsg(j2.updated ? "Abonnement mis à jour ✅" : "Aucun changement.");
        setTimeout(() => (window.location.href = "/dashboard.html"), 800);
        return;
      }

      if (!j2.clientSecret) throw new Error("clientSecret manquant (embedded)");
      if (piForm) piForm.style.display = "none";

      // ✅ appearance ici
      const checkout = await stripe.initEmbeddedCheckout({
        clientSecret: j2.clientSecret,
        appearance: stripeAppearance(),
      });

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
