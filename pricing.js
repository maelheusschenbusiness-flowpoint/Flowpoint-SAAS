// pricing.js — FlowPoint Pricing (Plans + Add-ons prefs)
// - Checkout plan via /api/stripe/checkout (backend accepte uniquement "plan")
// - Add-ons via /api/stripe/portal (Customer Portal)
// - On sauvegarde la sélection add-ons en localStorage (préférence UI)

(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
  const ADDON_PREF_KEY = "fp_addon_prefs";
  const PLAN_PREF_KEY  = "fp_plan_pref";

  const $ = (q) => document.querySelector(q);

  // Elements (doivent exister dans pricing.html)
  const authPill = $("#authPill");
  const backBtn = $("#btnBackHome");

  const plansEl = $("#plans");
  const addonsListEl = $("#addonsList");

  const sumPlan = $("#sumPlan");
  const sumPlanPrice = $("#sumPlanPrice");
  const sumAddOns = $("#sumAddOns");

  const btnCheckout = $("#btnCheckout");
  const btnPortal = $("#btnPortal");

  function getToken() {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
    return null;
  }

  function setAuthBadge() {
    const tok = getToken();
    if (authPill) authPill.textContent = tok ? "Statut : Connecté" : "Statut : Non connecté";
  }

  function loadPrefs() {
    let addons = {};
    try { addons = JSON.parse(localStorage.getItem(ADDON_PREF_KEY) || "{}") || {}; } catch {}
    const plan = String(localStorage.getItem(PLAN_PREF_KEY) || "pro");
    return { plan, addons };
  }

  function savePrefs(next) {
    localStorage.setItem(PLAN_PREF_KEY, next.plan);
    localStorage.setItem(ADDON_PREF_KEY, JSON.stringify(next.addons || {}));
  }

  // Plans (UI)
  const PLANS = [
    { id:"standard", name:"Standard", priceLabel:"29€", per:"/ mois", features:["30 audits / mois","3 monitors actifs","30 PDFs + 30 exports"] },
    { id:"pro", name:"Pro", priceLabel:"79€", per:"/ mois", tag:"Populaire", features:["300 audits / mois","50 monitors actifs","300 PDFs + 300 exports"] },
    { id:"ultra", name:"Ultra", priceLabel:"149€", per:"/ mois", tag:"Team", features:["2000 audits / mois","300 monitors actifs","2000 PDFs + 2000 exports","10 seats inclus"] },
  ];

  // Add-ons (tous)
  const ADDONS = [
    { key:"monitorsPack50",  name:"Monitors Pack +50",   desc:"Ajoute +50 monitors actifs au quota du plan.", price:"19€ / mois", type:"qty",  max:10 },
    { key:"extraSeat",       name:"Extra Seat",          desc:"Ajoute des seats (membres) à ton organisation.", price:"7€ / mois",  type:"qty",  max:50 },

    { key:"retention90d",    name:"Retention +90 days",  desc:"Rétention des données étendue à 90 jours.",      price:"9€ / mois",  type:"flag", defaultOn:false },
    { key:"retention365d",   name:"Retention +365 days", desc:"Rétention des données étendue à 365 jours.",     price:"19€ / mois", type:"flag", defaultOn:false },

    { key:"auditsPack200",   name:"Audits Pack +200",    desc:"+200 audits / mois.",                            price:"9€ / mois",  type:"flag", defaultOn:false },
    { key:"auditsPack1000",  name:"Audits Pack +1000",   desc:"+1000 audits / mois.",                           price:"29€ / mois", type:"flag", defaultOn:false },

    { key:"pdfPack200",      name:"PDF Pack +200",       desc:"+200 PDFs / mois.",                              price:"9€ / mois",  type:"flag", defaultOn:false },
    { key:"exportsPack1000", name:"Exports Pack +1000",  desc:"+1000 exports / mois.",                          price:"19€ / mois", type:"flag", defaultOn:false },

    { key:"prioritySupport", name:"Priority Support",    desc:"Support prioritaire.",                           price:"29€ / mois", type:"flag", defaultOn:false },
    { key:"customDomain",    name:"Custom Domain",       desc:"Utilise ton propre domaine.",                    price:"9€ / mois",  type:"flag", defaultOn:false },

    // whiteLabel gratuit / inclus (forcé)
    { key:"whiteLabel",      name:"White label",         desc:"Marque blanche (inclus).",                        price:"Inclus",     type:"flag", defaultOn:true, lockedOn:true },
  ];

  function moneyLabel(p){ return `${p.priceLabel} ${p.per}`; }

  function renderPlans(state) {
    plansEl.innerHTML = "";

    for (const p of PLANS) {
      const div = document.createElement("div");
      div.className = "planCard" + (state.plan === p.id ? " active" : "");
      div.tabIndex = 0;
      div.setAttribute("role","button");
      div.setAttribute("aria-label", `Choisir le plan ${p.name}`);

      div.innerHTML = `
        <div class="planTop">
          <div>
            <div class="planName">${p.name}</div>
            ${p.tag ? `<div class="badge">${p.tag}</div>` : ``}
          </div>
          <div style="text-align:right">
            <div class="price">${p.priceLabel} <span class="per">${p.per}</span></div>
          </div>
        </div>
        <ul class="features">
          ${p.features.map(x => `<li>${x}</li>`).join("")}
        </ul>
      `;

      const select = () => {
        state.plan = p.id;
        savePrefs(state);
        updateSummary(state);
        renderPlans(state); // refresh active state
      };

      div.addEventListener("click", select);
      div.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
      });

      plansEl.appendChild(div);
    }
  }

  function ensureDefaults(state) {
    if (!state.addons || typeof state.addons !== "object") state.addons = {};

    // defaults flags
    for (const a of ADDONS) {
      if (a.type === "flag" && state.addons[a.key] === undefined) {
        state.addons[a.key] = !!a.defaultOn;
      }
      if (a.type === "qty" && state.addons[a.key] === undefined) {
        state.addons[a.key] = 0;
      }
    }

    // whiteLabel forcé ON
    state.addons.whiteLabel = true;
  }

  function renderAddons(state) {
    addonsListEl.innerHTML = "";

    for (const a of ADDONS) {
      const row = document.createElement("div");
      row.className = "addonRow";

      const left = document.createElement("div");
      left.innerHTML = `
        <p class="addonTitle">${a.name}</p>
        <p class="addonDesc">${a.desc || ""}</p>
        <span class="keyChip">${a.key}</span>
      `;

      const right = document.createElement("div");
      right.className = "addonRight";
      right.innerHTML = `<div class="addonPrice">${a.price || ""}</div>`;

      // qty UI: − [input] +
      if (a.type === "qty") {
        const qty = Number(state.addons[a.key] || 0);

        const wrap = document.createElement("div");
        wrap.className = "qty";

        wrap.innerHTML = `
          <button type="button" class="qtyBtn" data-act="dec" aria-label="Diminuer ${a.name}">−</button>
          <input class="qtyInput" type="number" inputmode="numeric" min="0" max="${a.max ?? 999}" step="1" value="${qty}">
          <button type="button" class="qtyBtn" data-act="inc" aria-label="Augmenter ${a.name}">+</button>
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
        // flag toggle
        const checked = !!state.addons[a.key];
        const toggle = document.createElement("label");
        toggle.className = "toggle";

        toggle.innerHTML = `
          <input type="checkbox" ${checked ? "checked" : ""} ${a.lockedOn ? "disabled" : ""}>
          <span class="track" aria-hidden="true"></span>
        `;

        const chk = toggle.querySelector("input");
        chk.addEventListener("change", () => {
          state.addons[a.key] = !!chk.checked;
          if (a.key === "whiteLabel") state.addons.whiteLabel = true;
          savePrefs(state);
          updateSummary(state);
        });

        right.appendChild(toggle);
      }

      row.appendChild(left);
      row.appendChild(right);
      addonsListEl.appendChild(row);
    }
  }

  function updateSummary(state) {
    const p = PLANS.find(x => x.id === state.plan) || PLANS[1];
    if (sumPlan) sumPlan.textContent = p.name.toUpperCase();
    if (sumPlanPrice) sumPlanPrice.textContent = moneyLabel(p);

    // list addons selected
    const picked = [];
    for (const a of ADDONS) {
      if (a.type === "qty") {
        const q = Number(state.addons[a.key] || 0);
        if (q > 0) picked.push(`${a.key} ×${q}`);
      } else {
        const on = !!state.addons[a.key];
        if (on && a.key !== "whiteLabel") picked.push(a.key);
      }
    }
    if (sumAddOns) sumAddOns.textContent = picked.length ? picked.join(", ") : "—";
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
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":"Bearer " + tok
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
    if (!tok) { window.location.href = "/login.html"; return; }

    btnPortal.disabled = true;
    btnPortal.textContent = "Ouverture…";

    try {
      const r = await fetch("/api/stripe/portal", {
        method:"POST",
        headers:{ "Authorization":"Bearer " + tok }
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

  function guardBackHome() {
    if (!backBtn) return;
    backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const tok = getToken();
      // ✅ évite le “flash” dashboard
      window.location.href = tok ? "/dashboard.html" : "/login.html";
    });
  }

  // init
  const state = loadPrefs();
  if (!["standard","pro","ultra"].includes(state.plan)) state.plan = "pro";
  ensureDefaults(state);
  savePrefs(state);

  setAuthBadge();
  renderPlans(state);
  renderAddons(state);
  updateSummary(state);
  guardBackHome();

  btnCheckout?.addEventListener("click", () => goCheckout(state));
  btnPortal?.addEventListener("click", openPortal);
})();
