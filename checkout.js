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

  function labelize(value) {
    const raw = String(value || "").trim();
    if (!raw) return "—";

    if (raw === "standard") return "Standard";
    if (raw === "pro") return "Pro";
    if (raw === "ultra") return "Ultra";
    if (raw === "customDomain") return "Custom Domain";
    if (raw === "prioritySupport") return "Priority Support";
    if (raw === "whiteLabel") return "White Label";
    if (raw === "retention90d") return "Retention 90 Days";
    if (raw === "retention365d") return "Retention 365 Days";
    if (raw === "monitorsPack50") return "Monitors Pack 50";
    if (raw === "auditsPack200") return "Audits Pack 200";
    if (raw === "auditsPack1000") return "Audits Pack 1000";
    if (raw === "pdfPack200") return "PDF Pack 200";
    if (raw === "exportsPack1000") return "Exports Pack 1000";
    if (raw === "extraSeats") return "Extra Seats";

    return raw
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function summarize(payload) {
    if (!payload) return;

    if (sumPlan) {
      sumPlan.textContent = payload.plan ? labelize(payload.plan) : "—";
    }

    const addons = payload.addons || {};
    const lines = [];

    for (const [k, v] of Object.entries(addons)) {
      if (k === "whiteLabel") continue;

      if (typeof v === "boolean") {
        if (v) lines.push(labelize(k));
      } else if (Number(v) > 0) {
        lines.push(`${labelize(k)} × ${Number(v)}`);
      }
    }

    if (sumAddOns) {
      sumAddOns.textContent = lines.length ? lines.join(" • ") : "—";
    }
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
