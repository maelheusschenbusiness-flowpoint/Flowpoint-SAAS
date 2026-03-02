// pricing.js — FlowPoint Pricing (Plans + Add-ons prefs)
// - Checkout plan via /api/stripe/checkout (backend accepte uniquement "plan")
// - Add-ons via /api/stripe/portal (Customer Portal)
// - On sauvegarde la sélection add-ons en localStorage (préférence UI)

(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
  const ADDON_PREF_KEY = "fp_addon_prefs";
  const PLAN_PREF_KEY  = "fp_plan_pref";

  const $ = (q) => document.querySelector(q);

  // IDs (doivent exister dans pricing.html)
  const authPill = $("#authPill");
  const plansEl = $("#plans");
  const addonsRoot = $("#addonsList");

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
    if (!authPill) return;
    authPill.textContent = getToken() ? "Statut : Connecté" : "Statut : Non connecté";
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
    { id: "standard", name: "Standard", priceLabel: "29€",  per: "/ mois", tag: "Pour démarrer",
      features: ["30 audits / mois", "3 monitors actifs", "30 PDFs + 30 exports"] },
    { id: "pro",      name: "Pro",      priceLabel: "79€",  per: "/ mois", tag: "Populaire",
      features: ["300 audits / mois", "50 monitors actifs", "300 PDFs + 300 exports"] },
    { id: "ultra",    name: "Ultra",    priceLabel: "149€", per: "/ mois", tag: "Team",
      features: ["2000 audits / mois", "300 monitors actifs", "2000 PDFs + 2000 exports", "10 seats inclus"] },
  ];

  // Add-ons UI (ta liste complète)
  const ADDONS = [
    { key: "monitorsPack50",   name: "Monitors Pack +50",   desc: "Ajoute +50 monitors actifs au quota du plan.", price: "19€ / mois", type: "qty",  max: 10 },
    { key: "extraSeat",        name: "Extra Seat",          desc: "Ajoute des seats (membres) à ton organisation.", price: "7€ / mois", type: "qty",  max: 50 },

    { key: "retention90d",     name: "Retention +90 days",  desc: "Rétention des données étendue à 90 jours.",      price: "9€ / mois",  type: "flag", defaultOn: false },
    { key: "retention365d",    name: "Retention +365 days", desc: "Rétention des données étendue à 365 jours.",     price: "19€ / mois", type: "flag", defaultOn: false },

    { key: "auditsPack200",    name: "Audits Pack +200",    desc: "+200 audits / mois.",                            price: "9€ / mois",  type: "flag", defaultOn: false },
    { key: "auditsPack1000",   name: "Audits Pack +1000",   desc: "+1000 audits / mois.",                           price: "29€ / mois", type: "flag", defaultOn: false },

    { key: "pdfPack200",       name: "PDF Pack +200",       desc: "+200 PDFs / mois.",                              price: "9€ / mois",  type: "flag", defaultOn: false },
    { key: "exportsPack1000",  name: "Exports Pack +1000",  desc: "+1000 exports / mois.",                          price: "19€ / mois", type: "flag", defaultOn: false },

    { key: "prioritySupport",  name: "Priority Support",    desc: "Support prioritaire.",                           price: "29€ / mois", type: "flag", defaultOn: false },
    { key: "customDomain",     name: "Custom Domain",       desc: "Utilise ton propre domaine.",                    price: "9€ / mois",  type: "flag", defaultOn: false },

    // whiteLabel gratuit / inclus (forcé ON)
    { key: "whiteLabel",       name: "White label",         desc: "Marque blanche (inclus).",                        price: "Inclus",     type: "flag", defaultOn: true, lockedOn: true },
  ];

  function planCardHTML(p, active){
    return `
      <div class="planCard ${active ? "active" : ""}" data-plan="${p.id}" tabindex="0" role="button" aria-label="Choisir ${p.name}">
        <div class="planTop">
          <div>
            <div class="planName">${p.name}</div>
            ${p.tag ? `<div class="badge">${p.tag}</div>` : ""}
          </div>
          <div style="text-align:right">
            <div class="price">${p.priceLabel} <span class="per">${p.per}</span></div>
          </div>
        </div>
        <ul class="features">
          ${p.features.map(x => `<li>${x}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  function qtyOptions(max){
    let out = "";
    for (let i=0;i<=max;i++){
      out += `<option value="${i}">Qté ${i}</option>`;
    }
    return out;
  }

  function renderPlans(state){
    if (!plansEl) return;
    plansEl.innerHTML = PLANS.map(p => planCardHTML(p, state.plan === p.id)).join("");

    const cards = plansEl.querySelectorAll(".planCard");
    cards.forEach(card => {
      const pick = () => {
        state.plan = card.dataset.plan;
        savePrefs(state);
        renderPlans(state);
        updateSummary(state);
      };
      card.addEventListener("click", pick);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });
    });
  }

  function renderAddons(state){
    if (!addonsRoot) return;

    // force whiteLabel ON
    state.addons.whiteLabel = true;

    addonsRoot.innerHTML = "";

    for (const a of ADDONS){
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
      right.innerHTML = `<div class="addonPrice">${a.price}</div>`;

      if (a.type === "qty"){
        const wrap = document.createElement("div");
        wrap.className = "qtyWrap";

        const sel = document.createElement("select");
        sel.className = "qty";
        sel.setAttribute("aria-label", `Quantité ${a.name}`);
        sel.innerHTML = qtyOptions(a.max || 20);
        sel.value = String(Number(state.addons[a.key] || 0));

        sel.addEventListener("change", () => {
          state.addons[a.key] = parseInt(sel.value, 10) || 0;
          savePrefs(state);
          updateSummary(state);
        });

        wrap.appendChild(sel);
        right.appendChild(wrap);
      } else {
        const toggle = document.createElement("label");
        toggle.className = "toggle";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = a.lockedOn ? true : !!state.addons[a.key];
        if (a.lockedOn) input.disabled = true;

        const track = document.createElement("span");
        track.className = "track";

        input.addEventListener("change", () => {
          state.addons[a.key] = !!input.checked;
          if (a.key === "whiteLabel") state.addons.whiteLabel = true;
          savePrefs(state);
          updateSummary(state);
        });

        toggle.appendChild(input);
        toggle.appendChild(track);
        right.appendChild(toggle);
      }

      row.appendChild(left);
      row.appendChild(right);
      addonsRoot.appendChild(row);
    }
  }

  function updateSummary(state){
    const p = PLANS.find(x => x.id === state.plan) || PLANS[1];
    if (sumPlan) sumPlan.textContent = p.name.toUpperCase();
    if (sumPlanPrice) sumPlanPrice.textContent = `${p.priceLabel} ${p.per}`;

    // list add-ons sélectionnés (hors whiteLabel)
    const parts = [];
    for (const a of ADDONS){
      if (a.key === "whiteLabel") continue;

      if (a.type === "qty"){
        const v = Number(state.addons[a.key] || 0);
        if (v > 0) parts.push(`${a.key} ×${v}`);
      } else {
        if (state.addons[a.key]) parts.push(a.key);
      }
    }
    if (sumAddOns) sumAddOns.textContent = parts.length ? parts.join(", ") : "—";
  }

  async function goCheckout(state){
    const tok = getToken();
    if (!tok){
      localStorage.setItem(PLAN_PREF_KEY, state.plan);
      window.location.href = "/index.html";
      return;
    }

    btnCheckout.disabled = true;
    btnCheckout.textContent = "Redirection…";

    try{
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
    }catch(e){
      alert(e.message || "Erreur");
      btnCheckout.disabled = false;
      btnCheckout.textContent = "Continuer (Checkout Plan)";
    }
  }

  async function openPortal(){
    const tok = getToken();
    if (!tok){
      window.location.href = "/login.html";
      return;
    }

    btnPortal.disabled = true;
    btnPortal.textContent = "Ouverture…";

    try{
      const r = await fetch("/api/stripe/portal", {
        method:"POST",
        headers:{ "Authorization":"Bearer " + tok }
      });
      const j = await r.json().catch(()=> ({}));
      if (!r.ok) throw new Error(j.error || "Erreur portal");
      if (!j.url) throw new Error("URL portal manquante");
      window.location.href = j.url;
    }catch(e){
      alert(e.message || "Erreur");
      btnPortal.disabled = false;
      btnPortal.textContent = "Gérer mes add-ons";
    }
  }

  // init
  const state = loadPrefs();
  if (!["standard","pro","ultra"].includes(state.plan)) state.plan = "pro";
  if (!state.addons || typeof state.addons !== "object") state.addons = {};
  state.addons.whiteLabel = true;

  setAuthBadge();
  renderPlans(state);
  renderAddons(state);
  updateSummary(state);

  if (btnCheckout) btnCheckout.addEventListener("click", () => goCheckout(state));
  if (btnPortal) btnPortal.addEventListener("click", openPortal);
})();
