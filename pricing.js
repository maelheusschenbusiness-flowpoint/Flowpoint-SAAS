// pricing.js — FlowPoint Pricing (UI only)
// - Pricing = choix plan + add-ons (localStorage)
// - "Continuer" => /checkout.html (page FlowPoint custom qui fait le paiement)
// - "Gérer mes add-ons" => /addons.html (page FlowPoint custom qui update + paye si besoin)

(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
  const ADDON_PREF_KEY = "fp_addon_prefs";
  const PLAN_PREF_KEY = "fp_plan_pref";

  const $ = (q) => document.querySelector(q);

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

  function setAuthBadge(extra) {
    const tok = getToken();
    if (!authPill) return;
    authPill.textContent = tok ? `Statut : Connecté${extra ? " (" + extra + ")" : ""}` : "Statut : Non connecté";
  }

  function loadPrefs() {
    let addons = {};
    try {
      addons = JSON.parse(localStorage.getItem(ADDON_PREF_KEY) || "{}") || {};
    } catch {}
    const plan = String(localStorage.getItem(PLAN_PREF_KEY) || "pro");
    return { plan, addons };
  }

  function savePrefs(state) {
    localStorage.setItem(PLAN_PREF_KEY, state.plan);
    localStorage.setItem(ADDON_PREF_KEY, JSON.stringify(state.addons || {}));
  }

  const PLANS = [
    {
      id: "standard",
      name: "Standard",
      priceLabel: "29€",
      per: "/ mois",
      // ✅ tu veux que ce badge soit moins large => soit tu changes le texte ici
      tag: "Starter",
      features: [
        "30 audits / mois (SEO instantané)",
        "3 monitors actifs (uptime)",
        "30 PDFs + 30 exports (CSV)",
        "Rapports partageables (clients / équipe)",
        "Alertes email + historique de base",
        "White label inclus (gratuit)",
      ],
    },
    {
      id: "pro",
      name: "Pro",
      priceLabel: "79€",
      per: "/ mois",
      tag: "Populaire",
      features: [
        "300 audits / mois (optimisation continue)",
        "50 monitors actifs + logs",
        "300 PDFs + 300 exports (CSV)",
        "Pages de rapports + partage client",
        "Alertes email + incidents",
        "White label inclus (gratuit)",
      ],
    },
    {
      id: "ultra",
      name: "Ultra",
      priceLabel: "149€",
      per: "/ mois",
      tag: "Team",
      features: [
        "2000 audits / mois (volume)",
        "300 monitors actifs (SLA / scalabilité)",
        "2000 PDFs + 2000 exports (CSV)",
        "10 seats inclus (team)",
        "Organisation + invites + rôles (workflow équipe)",
        "White label inclus (gratuit)",
      ],
    },
  ];

  const ADDONS = [
    { key: "whiteLabel", name: "White label", desc: "Marque blanche (inclus).", price: "Inclus (gratuit)", type: "flag", defaultOn: true, lockedOn: true },
    { key: "customDomain", name: "Custom Domain", desc: "Utilise ton propre domaine (brand pro).", price: "9€ / mois", type: "flag", defaultOn: false },
    { key: "prioritySupport", name: "Priority Support", desc: "Support prioritaire (réponse plus rapide, meilleur suivi).", price: "29€ / mois", type: "flag", defaultOn: false },
    { key: "retention90d", name: "Retention +90 days", desc: "Rétention des données étendue à 90 jours (plus d’historique).", price: "9€ / mois", type: "flag", defaultOn: false },
    { key: "retention365d", name: "Retention +365 days", desc: "Rétention des données étendue à 365 jours (idéal reporting annuel).", price: "19€ / mois", type: "flag", defaultOn: false },
    { key: "auditsPack200", name: "Audits Pack +200", desc: "Ajoute +200 audits / mois (en plus du plan).", price: "9€ / mois", type: "qty", max: 50, unitLabel: "+200 audits" },
    { key: "auditsPack1000", name: "Audits Pack +1000", desc: "Ajoute +1000 audits / mois (gros volume).", price: "29€ / mois", type: "qty", max: 20, unitLabel: "+1000 audits" },
    { key: "pdfPack200", name: "PDF Pack +200", desc: "Ajoute +200 PDFs / mois (rapports clients).", price: "9€ / mois", type: "qty", max: 50, unitLabel: "+200 PDFs" },
    { key: "exportsPack1000", name: "Exports Pack +1000", desc: "Ajoute +1000 exports / mois (CSV, analyses, reporting).", price: "19€ / mois", type: "qty", max: 50, unitLabel: "+1000 exports" },
    { key: "monitorsPack50", name: "Monitors Pack +50", desc: "Ajoute +50 monitors actifs au quota du plan (idéal quand tu scales).", price: "19€ / mois", type: "qty", max: 10, unitLabel: "+50 monitors" },
    { key: "extraSeats", name: "Extra Seats", desc: "Ajoute des seats (membres) à ton organisation (collaboration équipe).", price: "7€ / mois", type: "qty", max: 50, unitLabel: "seat" },
  ];

  function ensureDefaults(state) {
    if (!["standard", "pro", "ultra"].includes(state.plan)) state.plan = "pro";
    if (!state.addons || typeof state.addons !== "object") state.addons = {};

    for (const a of ADDONS) {
      if (a.type === "flag" && state.addons[a.key] === undefined) state.addons[a.key] = !!a.defaultOn;
      if (a.type === "qty" && state.addons[a.key] === undefined) state.addons[a.key] = 0;
    }

    state.addons.whiteLabel = true;

    // migration ancienne clé
    if (state.addons.extraSeat != null && state.addons.extraSeats == null) {
      state.addons.extraSeats = Number(state.addons.extraSeat || 0);
      delete state.addons.extraSeat;
    }
  }

  function renderPlans(state) {
    if (!plansEl) return;
    plansEl.innerHTML = "";

    for (const p of PLANS) {
      const card = document.createElement("div");
      card.className = "planCard" + (state.plan === p.id ? " active" : "");
      card.tabIndex = 0;

      card.innerHTML = `
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
          ${p.features.map((f) => `<li>${f}</li>`).join("")}
        </ul>
      `;

      const choose = () => {
        state.plan = p.id;
        savePrefs(state);
        renderAll(state);
      };

      card.addEventListener("click", choose);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") choose();
      });

      plansEl.appendChild(card);
    }
  }

  function renderAddons(state) {
    if (!addonsRoot) return;
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

  function updateSummary(state) {
    const p = PLANS.find((x) => x.id === state.plan) || PLANS[1];
    if (sumPlan) sumPlan.textContent = p.name;
    if (sumPlanPrice) sumPlanPrice.textContent = `${p.priceLabel} ${p.per}`;

    const lines = [];
    for (const a of ADDONS) {
      if (a.key === "whiteLabel") continue;

      if (a.type === "qty") {
        const q = Number(state.addons[a.key] || 0);
        if (q > 0) lines.push(a.unitLabel ? `${a.name} × ${q} (${a.unitLabel})` : `${a.name} × ${q}`);
      } else {
        if (state.addons[a.key]) lines.push(a.name);
      }
    }

    if (sumAddOns) sumAddOns.textContent = lines.length ? lines.join(" • ") : "—";
  }

  function renderAll(state) {
    renderPlans(state);
    renderAddons(state);
    updateSummary(state);
  }

  // init
  const state = loadPrefs();
  ensureDefaults(state);
  savePrefs(state);
  renderAll(state);
  setAuthBadge();

  // ✅ Continuer = va sur checkout.html (custom FlowPoint)
  if (btnCheckout) {
    // ✅ texte du bouton comme tu veux
    btnCheckout.textContent = "Continuer";
    btnCheckout.addEventListener("click", () => {
      const tok = getToken();
      if (!tok) return (window.location.href = "/login.html");
      savePrefs(state);
      window.location.href = "/checkout.html";
    });
  }

  // ✅ Gérer add-ons = va sur addons.html (custom FlowPoint)
  if (btnPortal) {
    btnPortal.addEventListener("click", () => {
      const tok = getToken();
      if (!tok) return (window.location.href = "/login.html");
      savePrefs(state);
      window.location.href = "/addons.html";
    });
  }
})();
