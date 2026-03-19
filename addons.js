// addons.js — FlowPoint Add-ons UI

(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
  const ADDON_PREF_KEY = "fp_addon_prefs";
  const CHECKOUT_PAYLOAD_KEY = "fp_checkout_payload";

  const $ = (q) => document.querySelector(q);
  const authPill = $("#authPill");
  const root = $("#addonsList");
  const msg = $("#addonsMsg");
  const sumAddOns = $("#sumAddOns");
  const applyBtn = $("#applyBtn");
  const toPayBtn = $("#toPayBtn");

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

  function setMsg(text) {
    if (msg) msg.textContent = text || "";
  }

  function labelize(value) {
    const raw = String(value || "").trim();
    if (!raw) return "—";

    const map = {
      whiteLabel: "White Label",
      customDomain: "Custom Domain",
      prioritySupport: "Priority Support",
      retention90d: "Retention 90 Days",
      retention365d: "Retention 365 Days",
      auditsPack200: "Audits Pack 200",
      auditsPack1000: "Audits Pack 1000",
      pdfPack200: "PDF Pack 200",
      exportsPack1000: "Exports Pack 1000",
      monitorsPack50: "Monitors Pack 50",
      extraSeats: "Extra Seats"
    };

    if (map[raw]) return map[raw];

    return raw
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  const ADDONS = [
    { key: "whiteLabel", name: "White Label", desc: "Marque blanche (inclus).", price: "Inclus (gratuit)", type: "flag", lockedOn: true },
    { key: "customDomain", name: "Custom Domain", desc: "Utilise ton propre domaine.", price: "9€ / mois", type: "flag" },
    { key: "prioritySupport", name: "Priority Support", desc: "Support prioritaire.", price: "29€ / mois", type: "flag" },
    { key: "retention90d", name: "Retention 90 Days", desc: "Rétention 90 jours.", price: "9€ / mois", type: "flag" },
    { key: "retention365d", name: "Retention 365 Days", desc: "Rétention 365 jours.", price: "19€ / mois", type: "flag" },

    { key: "auditsPack200", name: "Audits Pack 200", desc: "+200 audits / mois.", price: "9€ / mois", type: "qty", max: 50 },
    { key: "auditsPack1000", name: "Audits Pack 1000", desc: "+1000 audits / mois.", price: "29€ / mois", type: "qty", max: 20 },
    { key: "pdfPack200", name: "PDF Pack 200", desc: "+200 PDFs / mois.", price: "9€ / mois", type: "qty", max: 50 },
    { key: "exportsPack1000", name: "Exports Pack 1000", desc: "+1000 exports / mois.", price: "19€ / mois", type: "qty", max: 50 },
    { key: "monitorsPack50", name: "Monitors Pack 50", desc: "+50 monitors.", price: "19€ / mois", type: "qty", max: 10 },
    { key: "extraSeats", name: "Extra Seats", desc: "Seats supplémentaires.", price: "7€ / mois", type: "qty", max: 50 }
  ];

  function loadAddons() {
    let addons = {};
    try {
      addons = JSON.parse(localStorage.getItem(ADDON_PREF_KEY) || "{}") || {};
    } catch {}

    for (const a of ADDONS) {
      if (a.type === "flag" && addons[a.key] === undefined) addons[a.key] = a.key === "whiteLabel";
      if (a.type === "qty" && addons[a.key] === undefined) addons[a.key] = 0;
    }

    if (addons.extraSeat != null && addons.extraSeats == null) {
      addons.extraSeats = Number(addons.extraSeat || 0);
      delete addons.extraSeat;
    }

    addons.whiteLabel = true;
    return addons;
  }

  function saveAddons(addons) {
    localStorage.setItem(ADDON_PREF_KEY, JSON.stringify(addons || {}));
  }

  function updateSummary(addons) {
    const lines = [];

    for (const [k, v] of Object.entries(addons || {})) {
      if (k === "whiteLabel") continue;

      if (typeof v === "boolean") {
        if (v) lines.push(labelize(k));
      } else if (Number(v) > 0) {
        lines.push(`${labelize(k)} ×${Number(v)}`);
      }
    }

    if (sumAddOns) {
      sumAddOns.textContent = lines.length ? lines.join(" • ") : "—";
    }
  }

  function render(addons) {
    if (!root) return;
    root.innerHTML = "";

    for (const a of ADDONS) {
      const row = document.createElement("div");
      row.className = "addonRow";

      const left = document.createElement("div");
      left.innerHTML = `
        <p class="addonTitle">${a.name}</p>
        <p class="addonDesc">${a.desc}</p>
        <span class="keyChip">${a.name}</span>
      `;

      const right = document.createElement("div");
      right.className = "addonRight";
      right.innerHTML = `<div class="addonPrice">${a.price}</div>`;

      if (a.type === "qty") {
        const wrap = document.createElement("div");
        wrap.className = "qty";
        wrap.innerHTML = `
          <button class="qtyBtn" type="button" data-act="dec">−</button>
          <input class="qtyInput" type="number" min="0" max="${a.max ?? 999}" step="1" value="${Number(addons[a.key] || 0)}" />
          <button class="qtyBtn" type="button" data-act="inc">+</button>
        `;

        const input = wrap.querySelector(".qtyInput");

        const setVal = (v) => {
          const max = Number(a.max ?? 999);
          const nextVal = Math.max(0, Math.min(max, Number(v || 0)));
          input.value = String(nextVal);
          addons[a.key] = nextVal;
          saveAddons(addons);
          updateSummary(addons);
        };

        wrap.addEventListener("click", (e) => {
          const act = e.target?.dataset?.act;
          if (!act) return;
          const cur = Number(input.value || 0);
          setVal(act === "inc" ? cur + 1 : cur - 1);
        });

        input.addEventListener("change", () => setVal(input.value));
        right.appendChild(wrap);
      } else {
        const toggle = document.createElement("label");
        toggle.className = "toggle";

        const checked = !!addons[a.key];
        toggle.innerHTML = `
          <input type="checkbox" ${checked ? "checked" : ""} ${a.lockedOn ? "disabled" : ""}>
          <span class="track"></span>
        `;

        const input = toggle.querySelector("input");
        input.addEventListener("change", () => {
          addons[a.key] = !!input.checked;
          if (a.key === "whiteLabel") addons.whiteLabel = true;
          saveAddons(addons);
          updateSummary(addons);
        });

        right.appendChild(toggle);
      }

      row.appendChild(left);
      row.appendChild(right);
      root.appendChild(row);
    }
  }

  async function apiApply(addons) {
    const tok = getToken();

    const r = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + tok
      },
      body: JSON.stringify({ plan: null, addons })
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Erreur apply");
    return j;
  }

  function setCheckoutPayloadForPay(addons) {
    localStorage.setItem(CHECKOUT_PAYLOAD_KEY, JSON.stringify({
      mode: "addons",
      plan: null,
      addons,
      ts: Date.now()
    }));
  }

  async function onApply(addons) {
    setMsg("");
    if (toPayBtn) toPayBtn.style.display = "none";

    applyBtn.disabled = true;
    applyBtn.textContent = "Application…";

    try {
      const j = await apiApply(addons);

      if (j.ok && !j.paymentIntentClientSecret) {
        setMsg(j.updated ? "Add-ons mis à jour ✅" : "Aucun changement.");
      } else if (j.paymentIntentClientSecret) {
        setMsg("Add-ons mis à jour ✅ Paiement requis (prorata).");
        setCheckoutPayloadForPay(addons);
        if (toPayBtn) {
          toPayBtn.style.display = "inline-block";
          toPayBtn.onclick = () => window.location.href = "/checkout.html";
        }
      } else {
        setMsg("Réponse inattendue.");
      }
    } catch (e) {
      setMsg(e.message || "Erreur");
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = "Appliquer";
    }
  }

  setAuthBadge();

  if (!getToken()) {
    window.location.href = "/login.html";
    return;
  }

  const addons = loadAddons();
  render(addons);
  updateSummary(addons);

  applyBtn.addEventListener("click", () => onApply(addons));
})();
