// pricing.js — FlowPoint Pricing (Plans + Add-ons prefs)
// - Checkout plan via /api/stripe/checkout (backend accepte uniquement "plan")
// - Add-ons via /api/stripe/portal (Customer Portal)
// - On sauvegarde la sélection add-ons en localStorage (préférence UI)

(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
  const ADDON_PREF_KEY = "fp_addon_prefs";
  const PLAN_PREF_KEY  = "fp_plan_pref";

  const $ = (q) => document.querySelector(q);

  const authState     = $("#authState");
  const plansEl       = $("#plans");
  const addonsEl      = $("#addons");

  const sumPlanName   = $("#sumPlanName");
  const sumPlanPrice  = $("#sumPlanPrice");
  const sumAddons     = $("#sumAddons");

  const btnCheckout   = $("#btnCheckout");
  const btnPortal     = $("#btnPortal");

  function getToken() {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
    return null;
  }

  function setAuthBadge() {
    const tok = getToken();
    if (authState) authState.textContent = tok ? "Statut : Connecté" : "Statut : Non connecté";
  }

  function loadPrefs() {
    let addons = {};
    try { addons = JSON.parse(localStorage.getItem(ADDON_PREF_KEY) || "{}") || {}; } catch {}
    const plan = String(localStorage.getItem(PLAN_PREF_KEY) || "pro");
    return { plan, addons };
  }

  function savePrefs(state) {
    localStorage.setItem(PLAN_PREF_KEY, state.plan);
    localStorage.setItem(ADDON_PREF_KEY, JSON.stringify(state.addons || {}));
  }

  // Plans UI
  const PLANS = [
    { id: "standard", name: "Standard", priceLabel: "29€",  per: "/ mois",
      features: ["30 audits / mois", "3 monitors actifs", "30 PDFs + 30 exports"] },
    { id: "pro", name: "Pro", priceLabel: "79€", per: "/ mois", tag: "Populaire",
      features: ["300 audits / mois", "50 monitors actifs", "300 PDFs + 300 exports"] },
    { id: "ultra", name: "Ultra", priceLabel: "149€", per: "/ mois", tag: "Team",
      features: ["2000 audits / mois", "300 monitors actifs", "2000 PDFs + 2000 exports", "10 seats inclus"] },
  ];

  // Add-ons UI (préférences uniquement)
  const ADDONS = [
    { key: "monitorsPack50",   name: "Monitors Pack +50",   desc: "Ajoute +50 monitors actifs au quota du plan.", price: "19€ / mois", type: "qty",  max: 10 },
    { key: "extraSeat",        name: "Extra Seat",          desc: "Ajoute des seats (membres) à ton organisation.", price: "7€ / mois",  type: "qty",  max: 50 },

    { key: "retention90d",     name: "Retention +90 days",  desc: "Rétention des données étendue à 90 jours.",      price: "9€ / mois",  type: "flag", defaultOn: false },
    { key: "retention365d",    name: "Retention +365 days", desc: "Rétention des données étendue à 365 jours.",     price: "19€ / mois", type: "flag", defaultOn: false },

    { key: "auditsPack200",    name: "Audits Pack +200",    desc: "+200 audits / mois.",                            price: "9€ / mois",  type: "flag", defaultOn: false },
    { key: "auditsPack1000",   name: "Audits Pack +1000",   desc: "+1000 audits / mois.",                           price: "29€ / mois", type: "flag", defaultOn: false },

    { key: "pdfPack200",       name: "PDF Pack +200",       desc: "+200 PDFs / mois.",                              price: "9€ / mois",  type: "flag", defaultOn: false },
    { key: "exportsPack1000",  name: "Exports Pack +1000",  desc: "+1000 exports / mois.",                          price: "19€ / mois", type: "flag", defaultOn: false },

    { key: "prioritySupport",  name: "Priority Support",    desc: "Support prioritaire.",                           price: "29€ / mois", type: "flag", defaultOn: false },
    { key: "customDomain",     name: "Custom Domain",       desc: "Utilise ton propre domaine.",                    price: "9€ / mois",  type: "flag", defaultOn: false },

    // inclus
    { key: "whiteLabel",       name: "White label",         desc: "Marque blanche (inclus).",                       price: "Inclus",     type: "flag", defaultOn: true, lockedOn: true },
  ];

  function clamp(n, min, max){
    n = Number(n || 0);
    if (Number.isNaN(n)) n = 0;
    return Math.max(min, Math.min(max, n));
  }

  function renderPlans(state) {
    plansEl.innerHTML = "";

    for (const p of PLANS) {
      const div = document.createElement("div");
      div.className = "plan" + (state.plan === p.id ? " active" : "");
      div.tabIndex = 0;

      const tag = p.tag ? `<div class="tag">${p.tag}</div>` : "";

      div.innerHTML = `
        <div class="planTop">
          <div>
            <div class="planName">${p.name}</div>
            ${tag}
          </div>
          <div class="planPrice">${p.priceLabel} <span>${p.per}</span></div>
        </div>
        <ul class="features">
          ${p.features.map(x => `<li>${x}</li>`).join("")}
        </ul>
      `;

      div.addEventListener("click", () => {
        state.plan = p.id;
        savePrefs(state);
        renderSummary(state);
        renderPlans(state);
      });

      div.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") div.click();
      });

      plansEl.appendChild(div);
    }
  }

  function renderAddons(state) {
    // whiteLabel forcé ON
    state.addons.whiteLabel = true;

    addonsEl.innerHTML = "";

    for (const a of ADDONS) {
      const row = document.createElement("div");
      row.className = "addon";

      const left = document.createElement("div");
      left.className = "addonLeft";
      left.innerHTML = `
        <div class="addonName">${a.name}</div>
        <div class="addonDesc">${a.desc || ""}</div>
        <div class="addonMeta">
          <span class="keyChip">${a.key}</span>
          <span class="priceLabel">${a.price}</span>
        </div>
      `;

      const right = document.createElement("div");
      right.className = "addonRight";

      if (a.type === "qty") {
        const max = Number(a.max ?? 999);
        const cur = clamp(state.addons[a.key] ?? 0, 0, max);

        const wrap = document.createElement("div");
        wrap.className = "qtyStepper";
        wrap.innerHTML = `
          <button type="button" class="stepBtn" data-act="dec" aria-label="Diminuer">−</button>
          <input class="stepInput" type="number" min="0" max="${max}" step="1" value="${cur}" inputmode="numeric" />
          <button type="button" class="stepBtn" data-act="inc" aria-label="Augmenter">+</button>
        `;

        const input = wrap.querySelector("input");

        const setVal = (v) => {
          const nv = clamp(v, 0, max);
          input.value = String(nv);
          state.addons[a.key] = nv;
          savePrefs(state);
          renderSummary(state);
        };

        wrap.addEventListener("click", (e) => {
          const act = e.target?.dataset?.act;
          if (!act) return;
          const c = Number(input.value || 0);
          setVal(act === "inc" ? c + 1 : c - 1);
        });

        input.addEventListener("change", () => setVal(input.value));
        input.addEventListener("input", () => {
          if (input.value === "") return;
          setVal(input.value);
        });

        right.appendChild(wrap);
      } else {
        const isOn = a.lockedOn ? true : !!state.addons[a.key];
        state.addons[a.key] = isOn;

        const sw = document.createElement("label");
        sw.className = "switch";
        sw.innerHTML = `
          <input type="checkbox" ${isOn ? "checked" : ""} ${a.lockedOn ? "disabled" : ""}>
          <span class="slider"></span>
        `;

        const chk = sw.querySelector("input");
        chk.addEventListener("change", () => {
          state.addons[a.key] = !!chk.checked;
          if (a.key === "whiteLabel") state.addons.whiteLabel = true;
          savePrefs(state);
          renderSummary(state);
        });

        right.appendChild(sw);
      }

      row.appendChild(left);
      row.appendChild(right);
      addonsEl.appendChild(row);
    }

    savePrefs(state);
  }

  function renderSummary(state) {
    const p = PLANS.find(x => x.id === state.plan) || PLANS[1];
    if (sumPlanName)  sumPlanName.textContent = p.name.toUpperCase();
    if (sumPlanPrice) sumPlanPrice.textContent = `${p.priceLabel} ${p.per}`;

    if (sumAddons) {
      const lines = [];

      for (const a of ADDONS) {
        if (a.type === "qty") {
          const q = Number(state.addons?.[a.key] || 0);
          if (q > 0) lines.push(`${a.name} ×${q}`);
        } else {
          const on = !!state.addons?.[a.key];
          if (on) lines.push(a.lockedOn ? `${a.name} (inclus)` : a.name);
        }
      }

      sumAddons.textContent = lines.length ? lines.join(" • ") : "—";
    }
  }

  async function goCheckout(state) {
    const tok = getToken();
    if (!tok) {
      localStorage.setItem(PLAN_PREF_KEY, state.plan);
      window.location.href = "/index.html";
      return;
    }

    btnCheckout.disabled = true;
    btnCheckout.textContent = "Redirection…";

    try {
      const r = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type":"application/json",
          "Authorization": "Bearer " + tok,
        },
        body: JSON.stringify({ plan: state.plan })
      });
      const j = await r.json().catch(()=> ({}));
      if (!r.ok) throw new Error(j.error || "Erreur checkout");
      if (!j.url) throw new Error("URL Stripe manquante");
      window.location.href = j.url;
    } catch (e) {
      alert(e.message || "Erreur");
      btnCheckout.disabled = false;
      btnCheckout.textContent = "Continuer (Checkout Plan)";
    }
  }

  async function openPortal() {
    const tok = getToken();
    if (!tok) {
      window.location.href = "/login.html";
      return;
    }

    btnPortal.disabled = true;
    btnPortal.textContent = "Ouverture…";

    try {
      const r = await fetch("/api/stripe/portal", {
        method:"POST",
        headers: { "Authorization":"Bearer " + tok }
      });
      const j = await r.json().catch(()=> ({}));
      if (!r.ok) throw new Error(j.error || "Erreur portal");
      if (!j.url) throw new Error("URL portal manquante");
      window.location.href = j.url;
    } catch (e) {
      alert(e.message || "Erreur");
      btnPortal.disabled = false;
      btnPortal.textContent = "Gérer mes add-ons";
    }
  }

  function renderAll(state) {
    setAuthBadge();
    renderPlans(state);
    renderAddons(state);
    renderSummary(state);
  }

  // init
  const state = loadPrefs();
  if (!["standard","pro","ultra"].includes(state.plan)) state.plan = "pro";
  if (!state.addons || typeof state.addons !== "object") state.addons = {};
  state.addons.whiteLabel = true;

  renderAll(state);

  btnCheckout.addEventListener("click", () => goCheckout(state));
  btnPortal.addEventListener("click", openPortal);
})();
