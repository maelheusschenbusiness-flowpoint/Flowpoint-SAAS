// pricing.js — FlowPoint Pricing (plans + add-ons keys)
// - Checkout plan via POST /api/stripe/checkout (backend accepte seulement "plan")
// - Add-ons via /api/stripe/portal (Customer Portal)
// - On sauvegarde la sélection add-ons en localStorage (préférence UX)

(() => {
  const TOKEN_KEYS = ["token", "fp_token"]; // compat: dashboard.js = token ; app.js = fp_token
  const ADDON_PREF_KEY = "fp_addon_prefs";
  const PLAN_PREF_KEY = "fp_plan_pref";

  const $ = (q) => document.querySelector(q);

  const authState = $("#authState");
  const authDot = $("#authDot");

  const plansWrap = $("#plans");
  const addonsList = $("#addonsList");
  const btnCheckout = $("#btnCheckout");
  const btnPortal = $("#btnPortal");
  const btnHome = $("#btnHome");

  const sumPlan = $("#sumPlan");
  const sumPlanPrice = $("#sumPlanPrice");
  const sumAddons = $("#sumAddons");

  const PRICES = {
    standard: "29€ / mois",
    pro: "79€ / mois",
    ultra: "149€ / mois",
  };

  // ✅ Add-ons (ceux que tu as demandés)
  // White label = inclus gratuit (pas dans Stripe)
  const ADDONS = [
    {
      key: "monitorsPack50",
      name: "Monitors Pack +50",
      priceLabel: "19€ / mois",
      desc: "Ajoute +50 monitors actifs au quota du plan.",
      kind: "qty", // quantité
      max: 50
    },
    {
      key: "extraSeat",
      name: "Extra Seat",
      priceLabel: "7€ / mois",
      desc: "Ajoute des seats (membres) à ton organisation.",
      kind: "qty",
      max: 100
    },
    {
      key: "retention90d",
      name: "Retention +90 days",
      priceLabel: "9€ / mois",
      desc: "Rétention des données étendue à 90 jours.",
      kind: "flag"
    },
    {
      key: "retention365d",
      name: "Retention +365 days",
      priceLabel: "19€ / mois",
      desc: "Rétention des données étendue à 365 jours.",
      kind: "flag"
    },
    {
      key: "auditsPack200",
      name: "Audits Pack +200",
      priceLabel: "9€ / mois",
      desc: "Ajoute +200 audits / mois.",
      kind: "flag"
    },
    {
      key: "auditsPack1000",
      name: "Audits Pack +1000",
      priceLabel: "29€ / mois",
      desc: "Ajoute +1000 audits / mois.",
      kind: "flag"
    },
    {
      key: "pdfPack200",
      name: "PDF Pack +200",
      priceLabel: "9€ / mois",
      desc: "Ajoute +200 PDFs / mois.",
      kind: "flag"
    },
    {
      key: "exportsPack1000",
      name: "Exports Pack +1000",
      priceLabel: "19€ / mois",
      desc: "Ajoute +1000 exports / mois.",
      kind: "flag"
    },
    {
      key: "prioritySupport",
      name: "Priority Support",
      priceLabel: "29€ / mois",
      desc: "Support prioritaire (réponse plus rapide).",
      kind: "flag"
    },
    {
      key: "customDomain",
      name: "Custom Domain",
      priceLabel: "9€ / mois",
      desc: "Utilise ton propre domaine (ex: app.tondomaine.com).",
      kind: "flag"
    }
  ];

  function getToken() {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
    return "";
  }

  function setAuthPill(connected) {
    if (connected) {
      authDot.style.background = "#22c55e";
      authState.textContent = "Statut : Connecté";
    } else {
      authDot.style.background = "#f59e0b";
      authState.textContent = "Statut : Non connecté";
    }
  }

  function loadPrefs() {
    const plan = (localStorage.getItem(PLAN_PREF_KEY) || "pro").toLowerCase();
    let addons = {};
    try { addons = JSON.parse(localStorage.getItem(ADDON_PREF_KEY) || "{}"); } catch {}
    return { plan, addons };
  }

  function savePrefs(plan, addons) {
    localStorage.setItem(PLAN_PREF_KEY, plan);
    localStorage.setItem(ADDON_PREF_KEY, JSON.stringify(addons || {}));
  }

  function renderAddons(state) {
    addonsList.innerHTML = "";

    for (const a of ADDONS) {
      const row = document.createElement("div");
      row.className = "addon";

      const left = document.createElement("div");
      left.style.minWidth = "0";
      left.innerHTML = `
        <div class="name">${a.name}</div>
        <div class="desc">${a.desc}</div>
        <div class="kv">${a.key}</div>
      `;

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.flexDirection = "column";
      right.style.alignItems = "flex-end";
      right.style.gap = "8px";

      const price = document.createElement("div");
      price.style.fontWeight = "1000";
      price.textContent = a.priceLabel;

      if (a.kind === "qty") {
        const sel = document.createElement("select");
        sel.className = "btn";
        sel.style.height = "36px";
        sel.style.padding = "0 10px";
        const current = Number(state.addons?.[a.key] || 0);

        // options 0..10 (tu peux augmenter)
        const max = Math.min(a.max || 100, 50);
        for (let i = 0; i <= 10; i++) {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent = i === 0 ? "Qté 0" : `Qté ${i}`;
          if (i === current) opt.selected = true;
          sel.appendChild(opt);
        }

        sel.addEventListener("change", () => {
          const v = Number(sel.value || 0);
          state.addons[a.key] = v;
          savePrefs(state.plan, state.addons);
          renderSummary(state);
        });

        right.appendChild(price);
        right.appendChild(sel);
      } else {
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!state.addons?.[a.key];
        chk.style.transform = "scale(1.2)";
        chk.style.cursor = "pointer";

        chk.addEventListener("change", () => {
          state.addons[a.key] = chk.checked ? 1 : 0;
          savePrefs(state.plan, state.addons);
          renderSummary(state);
        });

        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.gap = "10px";

        const lbl = document.createElement("div");
        lbl.style.fontSize = "12px";
        lbl.style.fontWeight = "900";
        lbl.style.opacity = "0.9";
        lbl.textContent = "Pré-selection";

        wrap.appendChild(chk);
        wrap.appendChild(lbl);

        right.appendChild(price);
        right.appendChild(wrap);
      }

      row.appendChild(left);
      row.appendChild(right);
      addonsList.appendChild(row);
    }
  }

  function setActivePlanUI(plan) {
    plansWrap.querySelectorAll(".plan").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-plan") === plan);
    });
  }

  function renderSummary(state) {
    sumPlan.textContent = String(state.plan || "pro").toUpperCase();
    sumPlanPrice.textContent = PRICES[state.plan] || PRICES.pro;

    const picked = [];
    for (const a of ADDONS) {
      const v = Number(state.addons?.[a.key] || 0);
      if (a.kind === "qty" && v > 0) picked.push(`${a.name} x${v}`);
      if (a.kind === "flag" && v > 0) picked.push(a.name);
    }
    sumAddons.textContent = picked.length ? picked.join(", ") : "—";
  }

  async function postJSON(url, body, token) {
    const headers = { "Content-Type": "application/json", "Accept": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur API (${r.status})`);
    return j;
  }

  async function openCheckout(state) {
    // si pas token -> renvoie vers index (signup) avec plan pré-sélectionné
    const token = getToken();
    if (!token) {
      const p = encodeURIComponent(state.plan || "pro");
      window.location.href = `/index.html?plan=${p}`;
      return;
    }

    const out = await postJSON("/api/stripe/checkout", { plan: state.plan }, token);
    if (!out?.url) throw new Error("URL Stripe manquante.");
    window.location.href = out.url;
  }

  async function openPortal() {
    const token = getToken();
    if (!token) {
      window.location.href = "/login.html";
      return;
    }
    const out = await postJSON("/api/stripe/portal", {}, token);
    if (!out?.url) throw new Error("URL Portal manquante.");
    window.location.href = out.url;
  }

  // INIT
  const state = loadPrefs();
  if (!["standard", "pro", "ultra"].includes(state.plan)) state.plan = "pro";
  if (!state.addons || typeof state.addons !== "object") state.addons = {};

  setAuthPill(!!getToken());
  setActivePlanUI(state.plan);
  renderAddons(state);
  renderSummary(state);

  plansWrap.querySelectorAll(".plan").forEach((el) => {
    el.addEventListener("click", () => {
      state.plan = el.getAttribute("data-plan");
      savePrefs(state.plan, state.addons);
      setActivePlanUI(state.plan);
      renderSummary(state);
    });
  });

  btnCheckout.addEventListener("click", async () => {
    btnCheckout.disabled = true;
    try {
      await openCheckout(state);
    } catch (e) {
      alert(e?.message || "Erreur checkout");
    } finally {
      btnCheckout.disabled = false;
    }
  });

  btnPortal.addEventListener("click", async () => {
    btnPortal.disabled = true;
    try {
      await openPortal();
    } catch (e) {
      alert(e?.message || "Erreur portal");
    } finally {
      btnPortal.disabled = false;
    }
  });

  btnHome.addEventListener("click", () => (window.location.href = "/"));
})();
