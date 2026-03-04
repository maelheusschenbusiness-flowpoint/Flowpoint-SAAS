// addons.js — FlowPoint Add-ons management (custom UI)
// - UI add-ons (comme pricing.js mais sans plans)
// - sauvegarde localStorage (prefs)
// - applique via POST /api/stripe/checkout avec { plan:null, addons } (si abonnement actif => updateExistingSubscription)

(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
  const ADDON_PREF_KEY = "fp_addon_prefs";

  const $ = (q) => document.querySelector(q);

  const authPill = $("#authPill");
  const addonsRoot = $("#addonsList");
  const addonsMsg = $("#addonsMsg");
  const sumAddons = $("#sumAddons");

  const btnApply = $("#btnApply");
  const btnDashboard = $("#btnDashboard");

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
    if (addonsMsg) addonsMsg.textContent = t || "";
  }

  function loadPrefs() {
    let addons = {};
    try { addons = JSON.parse(localStorage.getItem(ADDON_PREF_KEY) || "{}") || {}; } catch {}
    return { addons };
  }

  function savePrefs(state) {
    localStorage.setItem(ADDON_PREF_KEY, JSON.stringify(state.addons || {}));
  }

  const ADDONS = [
    { key: "whiteLabel", name: "White label", desc: "Marque blanche (inclus).", price: "Inclus (gratuit)", type: "flag", defaultOn: true, lockedOn: true },
    { key: "customDomain", name: "Custom Domain", desc: "Utilise ton propre domaine (brand pro).", price: "9€ / mois", type: "flag", defaultOn: false },
    { key: "prioritySupport", name: "Priority Support", desc: "Support prioritaire.", price: "29€ / mois", type: "flag", defaultOn: false },
    { key: "retention90d", name: "Retention +90 days", desc: "Rétention 90 jours.", price: "9€ / mois", type: "flag", defaultOn: false },
    { key: "retention365d", name: "Retention +365 days", desc: "Rétention 365 jours.", price: "19€ / mois", type: "flag", defaultOn: false },

    { key: "auditsPack200", name: "Audits Pack +200", desc: "Ajoute +200 audits / mois.", price: "9€ / mois", type: "qty", max: 50, unitLabel: "+200 audits" },
    { key: "auditsPack1000", name: "Audits Pack +1000", desc: "Ajoute +1000 audits / mois.", price: "29€ / mois", type: "qty", max: 20, unitLabel: "+1000 audits" },
    { key: "pdfPack200", name: "PDF Pack +200", desc: "Ajoute +200 PDFs / mois.", price: "9€ / mois", type: "qty", max: 50, unitLabel: "+200 PDFs" },
    { key: "exportsPack1000", name: "Exports Pack +1000", desc: "Ajoute +1000 exports / mois.", price: "19€ / mois", type: "qty", max: 50, unitLabel: "+1000 exports" },
    { key: "monitorsPack50", name: "Monitors Pack +50", desc: "Ajoute +50 monitors.", price: "19€ / mois", type: "qty", max: 10, unitLabel: "+50 monitors" },
    { key: "extraSeats", name: "Extra Seats", desc: "Ajoute des seats.", price: "7€ / mois", type: "qty", max: 50, unitLabel: "seat" },
  ];

  function ensureDefaults(state) {
    if (!state.addons || typeof state.addons !== "object") state.addons = {};

    for (const a of ADDONS) {
      if (a.type === "flag" && state.addons[a.key] === undefined) state.addons[a.key] = !!a.defaultOn;
      if (a.type === "qty" && state.addons[a.key] === undefined) state.addons[a.key] = 0;
    }

    // whiteLabel always on
    state.addons.whiteLabel = true;

    // compat old key
    if (state.addons.extraSeat != null && state.addons.extraSeats == null) {
      state.addons.extraSeats = Number(state.addons.extraSeat || 0);
      delete state.addons.extraSeat;
    }
  }

  function summarize(addons) {
    const lines = [];
    for (const a of ADDONS) {
      if (a.key === "whiteLabel") continue;
      const v = addons[a.key];
      if (a.type === "flag") {
        if (v) lines.push(a.name);
      } else {
        const n = Number(v || 0);
        if (n > 0) lines.push(`${a.name} × ${n}`);
      }
    }
    return lines.length ? lines.join(" • ") : "—";
  }

  function updateSummary(state) {
    if (sumAddons) sumAddons.textContent = summarize(state.addons);
  }

  function renderAddons(state) {
    addonsRoot.innerHTML = "";

    for (const a of ADDONS) {
      const row = document.createElement("div");
      row.className = "addonRow";
      row.dataset.key = a.key;

      const left = document.createElement("div");
      left.innerHTML = `
        <p class="addonTitle">${a.name}</p>
        <p class="addonDesc">${a.desc || ""}</p>
        <span class="keyChip">${a.key}</span>
      `;

      const right = document.createElement("div");
      right.className = "addonRight";
      right.innerHTML = `<div class="addonPrice">${a.price}</div>`;

      if (a.type === "qty") {
        const qty = Number(state.addons[a.key] || 0);
        const wrap = document.createElement("div");
        wrap.className = "qty";
        wrap.innerHTML = `
          <button class="qtyBtn" type="button" data-act="dec">−</button>
          <input class="qtyInput" type="number" min="0" max="${a.max ?? 999}" step="1" value="${qty}" inputmode="numeric" />
          <button class="qtyBtn" type="button" data-act="inc">+</button>
        `;

        const input = wrap.querySelector(".qtyInput");
        const setVal = (v) => {
          const max = Number(a.max ?? 999);
          const nv = Math.max(0, Math.min(max, Number(v || 0)));
          input.value = String(nv);
          state.addons[a.key] = nv;
          savePrefs(state);
          updateSummary(state);
        };

        wrap.addEventListener("click", (e) => {
          const act = e.target?.dataset?.act;
          if (!act) return;
          const cur = Number(input.value || 0);
          setVal(act === "inc" ? cur + 1 : cur - 1);
        });

        input.addEventListener("change", () => setVal(input.value));
        input.addEventListener("input", () => {
          if (input.value === "") return;
          setVal(input.value);
        });

        right.appendChild(wrap);
      } else {
        const isOn = !!state.addons[a.key];

        const toggle = document.createElement("label");
        toggle.className = "toggle";
        toggle.innerHTML = `
          <input type="checkbox" ${isOn ? "checked" : ""} ${a.lockedOn ? "disabled" : ""} />
          <span class="track"></span>
        `;

        const input = toggle.querySelector("input");
        input.addEventListener("change", () => {
          state.addons[a.key] = !!input.checked;
          if (a.key === "whiteLabel") state.addons.whiteLabel = true;
          savePrefs(state);
          updateSummary(state);
        });

        right.appendChild(toggle);
      }

      row.appendChild(left);
      row.appendChild(right);
      addonsRoot.appendChild(row);
    }
  }

  async function applyAddons(state) {
    const tok = getToken();
    if (!tok) {
      location.href = "/login.html";
      return;
    }

    btnApply.disabled = true;
    btnApply.textContent = "Application…";
    setMsg("");

    try {
      // ✅ Ton backend: /api/stripe/checkout
      // - si abonnement actif => updateExistingSubscription + {ok:true, updated}
      // - si pas abonné => ça créerait un checkout session (mais ici plan=null => addons seuls => possible si tu veux)
      const r = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + tok,
        },
        body: JSON.stringify({ plan: null, addons: state.addons }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Erreur");

      if (j.ok) {
        setMsg(j.updated ? "✅ Add-ons mis à jour." : "✅ Aucun changement.");
        btnApply.disabled = false;
        btnApply.textContent = "Appliquer les add-ons";
        return;
      }

      // Si jamais backend renvoie une url (si pas abonné et addons only)
      if (j.url) {
        location.href = j.url;
        return;
      }

      setMsg("✅ OK.");
      btnApply.disabled = false;
      btnApply.textContent = "Appliquer les add-ons";
    } catch (e) {
      setMsg("❌ " + (e?.message || "Erreur"));
      btnApply.disabled = false;
      btnApply.textContent = "Appliquer les add-ons";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    setAuth();

    const state = loadPrefs();
    ensureDefaults(state);
    savePrefs(state);

    renderAddons(state);
    updateSummary(state);

    if (btnApply) btnApply.addEventListener("click", () => applyAddons(state));
    if (btnDashboard) btnDashboard.addEventListener("click", () => (location.href = "/dashboard.html"));
  });
})();
