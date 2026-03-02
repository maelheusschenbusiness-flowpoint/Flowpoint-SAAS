// pricing.js — FlowPoint Pricing (Plans + Add-ons prefs)
// - Checkout plan via /api/stripe/checkout (backend accepte uniquement "plan")
// - Add-ons via /api/stripe/portal (Customer Portal)
// - On sauvegarde la sélection add-ons en localStorage (préférence UI)

(() => {
  const TOKEN_KEYS = ["token", "fp_token"];      // compat
  const ADDON_PREF_KEY = "fp_addon_prefs";
  const PLAN_PREF_KEY  = "fp_plan_pref";

  const $ = (q) => document.querySelector(q);

  const authState = $("#authState");
  const plansEl = $("#plans");
  const addonsEl = $("#addons");

  const sumPlanName = $("#sumPlanName");
  const sumPlanPrice = $("#sumPlanPrice");
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
    authState.textContent = tok ? "Statut : Connecté" : "Statut : Non connecté";
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

  // ✅ Plans (tes prix UI)
  const PLANS = [
    {
      id: "standard",
      name: "Standard",
      priceLabel: "29€",
      per: "/ mois",
      features: ["30 audits / mois", "3 monitors actifs", "30 PDFs + 30 exports"],
    },
    {
      id: "pro",
      name: "Pro",
      priceLabel: "79€",
      per: "/ mois",
      tag: "Populaire",
      features: ["300 audits / mois", "50 monitors actifs", "300 PDFs + 300 exports"],
    },
    {
      id: "ultra",
      name: "Ultra",
      priceLabel: "149€",
      per: "/ mois",
      tag: "Team",
      features: ["2000 audits / mois", "300 monitors actifs", "2000 PDFs + 2000 exports", "10 seats inclus"],
    },
  ];

  // ✅ Add-ons affichés (préférences UI)
  // IMPORTANT: le vrai achat/gestion se fait dans le portail Stripe
  const ADDONS = [
    { key: "monitorsPack50",   name: "Monitors Pack +50",   desc: "Ajoute +50 monitors actifs au quota du plan.", price: "19€ / mois", type: "qty", max: 10 },
    { key: "extraSeat",        name: "Extra Seat",          desc: "Ajoute des seats (membres) à ton organisation.", price: "7€ / mois", type: "qty", max: 50 },

    { key: "retention90d",     name: "Retention +90 days",  desc: "Rétention des données étendue à 90 jours.",      price: "9€ / mois", type: "flag", defaultOn: false },
    { key: "retention365d",    name: "Retention +365 days", desc: "Rétention des données étendue à 365 jours.",     price: "19€ / mois", type: "flag", defaultOn: false },

    { key: "auditsPack200",    name: "Audits Pack +200",    desc: "+200 audits / mois.",                            price: "9€ / mois", type: "flag", defaultOn: false },
    { key: "auditsPack1000",   name: "Audits Pack +1000",   desc: "+1000 audits / mois.",                           price: "29€ / mois", type: "flag", defaultOn: false },

    { key: "pdfPack200",       name: "PDF Pack +200",       desc: "+200 PDFs / mois.",                              price: "9€ / mois", type: "flag", defaultOn: false },
    { key: "exportsPack1000",  name: "Exports Pack +1000",  desc: "+1000 exports / mois.",                          price: "19€ / mois", type: "flag", defaultOn: false },

    { key: "prioritySupport",  name: "Priority Support",    desc: "Support prioritaire.",                            price: "29€ / mois", type: "flag", defaultOn: false },
    { key: "customDomain",     name: "Custom Domain",       desc: "Utilise ton propre domaine.",                     price: "9€ / mois", type: "flag", defaultOn: false },

    // ✅ whiteLabel gratuit / inclus
    { key: "whiteLabel",       name: "White label",         desc: "Marque blanche (inclus).",                        price: "Inclus",     type: "flag", defaultOn: true, lockedOn: true },
  ];

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
        renderAll(state);
      });

      div.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") div.click();
      });

      plansEl.appendChild(div);
    }
  }

  function qtyOptions(max) {
    const opts = [];
    for (let i=0;i<=max;i++){
      opts.push(`<option value="${i}">Qté ${i}</option>`);
    }
    return opts.join("");
  }

function renderAddons(addons, state) {
  const root = document.getElementById("addonsList");
  root.innerHTML = "";

  for (const a of addons) {
    const qty = Number(state.addons?.[a.key] || 0);

    const el = document.createElement("div");
    el.className = "addon";
    el.innerHTML = `
      <div class="addonLeft">
        <div class="addonName">${a.name}</div>
        <div class="addonDesc">${a.desc || ""}</div>
        <div class="addonKey">${a.key}</div>
      </div>

      <div class="addonRight">
        <div class="addonPrice">${a.priceLabel || ""}</div>

        <div class="qty" data-key="${a.key}">
          <button type="button" data-act="dec">−</button>
          <input type="number" min="0" max="${a.max ?? 999}" step="1" value="${qty}" inputmode="numeric">
          <button type="button" data-act="inc">+</button>
        </div>
      </div>
    `;

    // events
    const wrap = el.querySelector(".qty");
    const input = wrap.querySelector("input");

    function setVal(v){
      const max = Number(a.max ?? 999);
      const nv = Math.max(0, Math.min(max, Number(v || 0)));
      input.value = String(nv);

      state.addons = state.addons || {};
      state.addons[a.key] = nv;

      savePrefs(state);     // <= ta fonction localStorage
      updateSummary(state); // <= ta fonction résumé
    }

    wrap.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      const cur = Number(input.value || 0);
      setVal(act === "inc" ? cur + 1 : cur - 1);
    });

    input.addEventListener("change", () => setVal(input.value));
    input.addEventListener("input", () => {
      // évite les valeurs vides bizarres
      if (input.value === "") return;
      setVal(input.value);
    });

    root.appendChild(el);
  }
}
    // whiteLabel forcé ON
    state.addons.whiteLabel = true;

    addonsEl.innerHTML = "";
    for (const a of ADDONS) {
      const row = document.createElement("div");
      row.className = "addon";

      const left = document.createElement("div");
      left.innerHTML = `
        <h3>${a.name}</h3>
        <p>${a.desc}</p>
        <div class="metaRow">
          <span class="keyChip">${a.key}</span>
          <span class="priceLabel">${a.price}</span>
        </div>
      `;

      const right = document.createElement("div");
      right.className = "controls";

      if (a.type === "qty") {
        const wrap = document.createElement("div");
        wrap.className = "selectWrap";

        const sel = document.createElement("select");
        sel.className = "qtySelect";
        sel.innerHTML = qtyOptions(a.max || 20);
        sel.value = String(state.addons[a.key] || 0);

        sel.addEventListener("change", () => {
          state.addons[a.key] = parseInt(sel.value, 10) || 0;
          savePrefs(state);
        });

        wrap.appendChild(sel);
        right.appendChild(wrap);
      } else {
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.className = "check";
        chk.checked = !!state.addons[a.key];

        if (a.lockedOn) {
          chk.disabled = true;
          chk.checked = true;
        }

        chk.addEventListener("change", () => {
          state.addons[a.key] = !!chk.checked;
          if (a.key === "whiteLabel") state.addons.whiteLabel = true;
          savePrefs(state);
        });

        right.appendChild(chk);
      }

      row.appendChild(left);
      row.appendChild(right);
      addonsEl.appendChild(row);
    }

    savePrefs(state);
  }

  function renderSummary(state) {
    const p = PLANS.find(x => x.id === state.plan) || PLANS[1];
    sumPlanName.textContent = p.name.toUpperCase();
    sumPlanPrice.textContent = `${p.priceLabel} ${p.per}`;
  }

  async function goCheckout(state) {
    const tok = getToken();
    if (!tok) {
      // si pas connecté => renvoyer à l'inscription en pré-sélectionnant le plan
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
  // hard safety
  if (!["standard","pro","ultra"].includes(state.plan)) state.plan = "pro";
  if (!state.addons || typeof state.addons !== "object") state.addons = {};
  state.addons.whiteLabel = true;

  renderAll(state);

  btnCheckout.addEventListener("click", () => goCheckout(state));
  btnPortal.addEventListener("click", openPortal);
})();
