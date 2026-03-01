// pricing.js — FlowPoint Pricing (Plans + Add-ons keys)
// - Checkout plan via /api/stripe/checkout (backend accepte uniquement "plan")
// - Add-ons via /api/stripe/portal (Customer Portal)
// - On sauvegarde la sélection add-ons en localStorage (préférence UI)

(() => {
  const TOKEN_KEYS = ["token", "fp_token"]; // compat: dashboard.js = token ; app.js = fp_token
  const ADDON_PREF_KEY = "fp_addon_prefs";
  const PLAN_PREF_KEY = "fp_plan_pref";

  const $ = (q) => document.querySelector(q);

  const authPill = $("#authPill");
  const authState = $("#authState");
  const msg = $("#msg");

  const plansWrap = $("#plans");
  const sumPlan = $("#sumPlan");
  const sumPlanPrice = $("#sumPlanPrice");
  const sumAddons = $("#sumAddons");

  const btnCheckout = $("#btnCheckout");
  const btnPortal = $("#btnPortal");
  const addonsList = $("#addonsList");

  function setMsg(text, type) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.color =
      type === "ok" ? "#bbf7d0" :
      type === "error" ? "#fecaca" :
      type === "warn" ? "#fde68a" : "#94a3b8";
  }

  function getToken() {
    for (const k of TOKEN_KEYS) {
      const t = localStorage.getItem(k);
      if (t) return t;
    }
    return "";
  }

  function setAuthUI() {
    const t = getToken();
    if (t) {
      authState.textContent = "Connecté";
      authState.style.color = "#bbf7d0";
      btnPortal.disabled = false;
    } else {
      authState.textContent = "Non connecté";
      authState.style.color = "#fde68a";
      btnPortal.disabled = true;
    }
  }

  const ADDONS = [
    {
      key: "monitorsPack50",
      name: "Monitors Pack +50",
      priceLabel: "19€ / mois",
      desc: "Ajoute +50 monitors actifs au quota du plan.",
      type: "qty",
      defaultQty: 0,
    },
    {
      key: "extraSeat",
      name: "Extra Seat",
      priceLabel: "7€ / mois",
      desc: "Ajoute des seats (membres) à ton organisation.",
      type: "qty",
      defaultQty: 0,
    },
    {
      key: "retention90d",
      name: "Retention +90 days",
      priceLabel: "9€ / mois",
      desc: "Rétention des données étendue à 90 jours.",
      type: "bool",
      defaultOn: false,
    },
    {
      key: "retention365d",
      name: "Retention +365 days",
      priceLabel: "19€ / mois",
      desc: "Rétention des données étendue à 365 jours.",
      type: "bool",
      defaultOn: false,
    },
    {
      key: "auditsPack200",
      name: "Audits Pack +200",
      priceLabel: "9€ / mois",
      desc: "Ajoute +200 crédits audits / mois.",
      type: "qty",
      defaultQty: 0,
    },
    {
      key: "auditsPack1000",
      name: "Audits Pack +1000",
      priceLabel: "29€ / mois",
      desc: "Ajoute +1000 crédits audits / mois.",
      type: "qty",
      defaultQty: 0,
    },
    {
      key: "pdfPack200",
      name: "PDF Pack +200",
      priceLabel: "9€ / mois",
      desc: "Ajoute +200 crédits PDF / mois.",
      type: "qty",
      defaultQty: 0,
    },
    {
      key: "exportsPack1000",
      name: "Exports Pack +1000",
      priceLabel: "19€ / mois",
      desc: "Ajoute +1000 crédits exports CSV / mois.",
      type: "qty",
      defaultQty: 0,
    },
    {
      key: "prioritySupport",
      name: "Priority Support",
      priceLabel: "29€ / mois",
      desc: "Support prioritaire (SLA, réponse plus rapide).",
      type: "bool",
      defaultOn: false,
    },
    {
      key: "customDomain",
      name: "Custom Domain",
      priceLabel: "9€ / mois",
      desc: "Utilise un domaine personnalisé pour ton dashboard.",
      type: "bool",
      defaultOn: false,
    },
  ];

  function loadAddonPrefs() {
    try {
      const raw = localStorage.getItem(ADDON_PREF_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  function saveAddonPrefs(prefs) {
    localStorage.setItem(ADDON_PREF_KEY, JSON.stringify(prefs || {}));
  }

  function renderAddons() {
    const prefs = loadAddonPrefs();
    addonsList.innerHTML = "";

    for (const a of ADDONS) {
      const wrap = document.createElement("div");
      wrap.className = "addon";

      const left = document.createElement("div");
      left.className = "addonLeft";
      left.innerHTML = `
        <div class="addonName">${a.name}</div>
        <div class="addonDesc">${a.desc}</div>
        <div class="key">${a.key}</div>
      `;

      const right = document.createElement("div");
      right.className = "addonRight";

      // UI selon type
      if (a.type === "bool") {
        const checked = prefs[a.key] === true;
        right.innerHTML = `
          <div class="addonPrice">${a.priceLabel}</div>
          <label class="toggle">
            <input type="checkbox" data-addon="${a.key}" ${checked ? "checked" : ""} />
            <span>Pré-sélection</span>
          </label>
        `;
      } else {
        // qty (simple: 0..20)
        const qty = Number.isFinite(Number(prefs[a.key])) ? Number(prefs[a.key]) : (a.defaultQty || 0);
        right.innerHTML = `
          <div class="addonPrice">${a.priceLabel}</div>
          <div class="toggle">
            <span>Qté</span>
            <select data-addon="${a.key}" style="height:34px;border-radius:10px;border:1px solid rgba(148,163,184,.25);background:rgba(255,255,255,.03);color:#e5e7eb;padding:0 10px;font-weight:800">
              ${Array.from({ length: 21 }).map((_, i) => `<option value="${i}" ${i === qty ? "selected" : ""}>${i}</option>`).join("")}
            </select>
          </div>
        `;
      }

      wrap.appendChild(left);
      wrap.appendChild(right);
      addonsList.appendChild(wrap);
    }

    // listeners
    addonsList.querySelectorAll("[data-addon]").forEach((el) => {
      el.addEventListener("change", () => {
        const prefs2 = loadAddonPrefs();
        const key = el.getAttribute("data-addon");

        if (el.tagName === "INPUT") {
          prefs2[key] = !!el.checked;
        } else {
          prefs2[key] = Number(el.value || 0);
        }

        saveAddonPrefs(prefs2);
        renderSummary();
      });
    });
  }

  function getSelectedPlan() {
    const selected = plansWrap.querySelector(".plan.selected");
    const plan = selected?.getAttribute("data-plan") || "pro";
    const price = selected?.getAttribute("data-price") || "79";
    return { plan, price };
  }

  function setSelectedPlan(plan) {
    plansWrap.querySelectorAll(".plan").forEach((p) => {
      p.classList.toggle("selected", p.getAttribute("data-plan") === plan);
    });
    localStorage.setItem(PLAN_PREF_KEY, plan);
    renderSummary();
  }

  function renderSummary() {
    const { plan, price } = getSelectedPlan();
    sumPlan.textContent = String(plan).toUpperCase();
    sumPlanPrice.textContent = `${price}€ / mois`;

    const prefs = loadAddonPrefs();

    // Construit une liste lisible
    const chosen = [];

    for (const a of ADDONS) {
      if (a.type === "bool") {
        if (prefs[a.key] === true) chosen.push(`${a.name} (${a.key})`);
      } else {
        const qty = Number(prefs[a.key] || 0);
        if (qty > 0) chosen.push(`${a.name} x${qty} (${a.key})`);
      }
    }

    sumAddons.innerHTML = chosen.length
      ? chosen.map((x) => `• ${x}`).join("<br>")
      : "—";
  }

  async function postJSON(url, body, token) {
    const headers = { "Content-Type": "application/json", "Accept": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur API (${r.status})`);
    return j;
  }

  async function openPortal() {
    const token = getToken();
    if (!token) {
      setMsg("Connecte-toi d’abord pour ouvrir le Portal Stripe.", "warn");
      return;
    }
    setMsg("Ouverture du Customer Portal…", "ok");
    try {
      const out = await postJSON("/api/stripe/portal", {}, token);
      if (!out?.url) throw new Error("URL portal manquante");
      window.location.href = out.url;
    } catch (e) {
      setMsg(e.message || "Erreur portal", "error");
    }
  }

  async function checkoutPlan() {
    const { plan } = getSelectedPlan();
    const token = getToken();

    // Si pas connecté -> on renvoie vers page signup/index avec plan pré-sélectionné
    if (!token) {
      localStorage.setItem(PLAN_PREF_KEY, plan);
      // Ton app.js lit déjà ?plan=...
      window.location.href = `/index.html?plan=${encodeURIComponent(plan)}`;
      return;
    }

    setMsg("Redirection vers Stripe Checkout…", "ok");
    btnCheckout.disabled = true;

    try {
      const out = await postJSON("/api/stripe/checkout", { plan }, token);
      if (!out?.url) throw new Error("URL checkout manquante");
      window.location.href = out.url;
    } catch (e) {
      setMsg(e.message || "Erreur checkout", "error");
      btnCheckout.disabled = false;
    }
  }

  function applyPlanFromQueryOrStorage() {
    const qp = new URLSearchParams(location.search);
    const p = (qp.get("plan") || localStorage.getItem(PLAN_PREF_KEY) || "pro").toLowerCase();
    if (["standard", "pro", "ultra"].includes(p)) setSelectedPlan(p);
  }

  function wirePlans() {
    plansWrap.querySelectorAll(".plan").forEach((el) => {
      el.addEventListener("click", () => {
        const p = el.getAttribute("data-plan");
        setSelectedPlan(p);
      });
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    setAuthUI();
    wirePlans();
    applyPlanFromQueryOrStorage();
    renderAddons();
    renderSummary();

    btnPortal.addEventListener("click", openPortal);
    btnCheckout.addEventListener("click", checkoutPlan);

    // Update auth pill if token changes (rare)
    window.addEventListener("storage", setAuthUI);
  });
})();
