(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
  const CHECKOUT_PAYLOAD_KEY = "fp_checkout_payload";

  const $ = (q) => document.querySelector(q);

  const authPill = $("#authPill");
  const msg = $("#checkoutMsg");
  const retryBtn = $("#retryBtn");
  const goEmbeddedBtn = $("#goEmbeddedBtn");

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

  function start() {
    setAuthBadge();

    const tok = getToken();
    if (!tok) {
      window.location.href = "/login.html";
      return;
    }

    const payload = readPayload();
    if (!payload) {
      setMsg("Aucune sélection trouvée. Retourne sur pricing.");
      if (retryBtn) {
        retryBtn.style.display = "inline-block";
        retryBtn.onclick = () => {
          window.location.href = "/pricing.html";
        };
      }
      return;
    }

    summarize(payload);
    setMsg("Sélection prête. Tu peux continuer vers le paiement intégré.");

    if (goEmbeddedBtn) {
      goEmbeddedBtn.addEventListener("click", () => {
        window.location.href = "/checkout-embedded.html";
      });
    }
  }

  start();
})();
