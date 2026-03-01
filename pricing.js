// pricing.js — FlowPoint Pricing (Plans + Add-ons keys)
// - Checkout plan via POST /api/stripe/checkout (backend accepte uniquement "plan")
// - Portal via POST /api/stripe/portal
// - On sauvegarde la sélection add-ons en localStorage (préférence UI)

(() => {
  // Tokens possibles (tu as eu token vs fp_token selon pages)
  const TOKEN_KEYS = ["token", "fp_token"]; // dashboard.js = token ; app.js = fp_token
  const ADDON_PREF_KEY = "fp_addon_pref";
  const PLAN_PREF_KEY = "fp_plan_pref";

  const $ = (q) => document.querySelector(q);

  const authText = $("#authText");
  const authDot = $("#authDot");

  const plansWrap = $("#plans");
  const sumPlan = $("#sumPlan");
  const sumPlanPrice = $("#sumPlanPrice");
  const sumAddons = $("#sumAddons");

  const btnCheckout = $("#btnCheckout");
  const btnPortal = $("#btnPortal");
  const btnBackDash = $("#btnBackDash");

  const addonsList = $("#addonsList");

  function getToken() {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
    return "";
  }

  function setAuthPill(ok) {
    authText.textContent = ok ? "Statut : Connecté" : "Statut : Non connecté";
    authDot.style.background = ok ? "#22c55e" : "#f59e0b";
  }

  async function api(path, opts = {}) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };

    if (token) headers.Authorization = `Bearer ${token}`;
    if (!headers["Content-Type"] && opts.body) headers["Content-Type"] = "application/json";

    const r = await fetch(path, {
      ...opts,
      headers,
      cache: "no-store",
    });

    if (r.status === 401 || r.status === 403) {
      // Token pas bon => on considère non connecté
      return { ok: false, status: r.status, json: async () => ({}) };
    }

    return r;
  }

  // ===== Plans UI =====
  const PLAN_META = {
    standard: { label: "STANDARD", price: "29€ / mois" },
    pro: { label: "PRO", price: "79€ / mois" },
    ultra: { label: "ULTRA", price: "149€ / mois" },
  };

  function normalizePlan(p) {
    const v = String(p || "").toLowerCase();
    return ["standard", "pro", "ultra"].includes(v) ? v : "pro";
  }

  function setActivePlan(plan) {
    const p = normalizePlan(plan);

    plansWrap.querySelectorAll(".plan").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-plan") === p);
    });

    localStorage.setItem(PLAN_PREF_KEY, p);

    sumPlan.textContent = PLAN_META[p].label;
    sumPlanPrice.textContent = PLAN_META[p].price;
  }

  plansWrap.addEventListener("click", (e) => {
    const card = e.target.closest(".plan");
    if (!card) return;
    setActivePlan(card.getAttribute("data-plan"));
    renderSummaryAddons(); // garde résumé cohérent
  });

  // ===== Add-ons (keys violettes) =====
  // IMPORTANT : tu m’as demandé de remplacer 2-9 par ces items.
  // WhiteLabel est gratuit et inclus (pas un add-on payant ici).
  // MonitorsPack+50 est le #1 (clé monitorsPack50).
  const ADDONS = [
    {
      key: "monitorsPack50",
      name: "Monitors Pack +50",
      desc: "Ajoute +50 monitors actifs au quota du plan.",
      priceLabel: "19€ / mois",
      kind: "qty", // quantité
      max: 50,
    },
    {
      key: "extraSeat",
      name: "Extra Seat",
      desc: "Ajoute des seats (membres) à ton organisation.",
      priceLabel: "7€ / mois",
      kind: "qty",
      max: 500,
    },
    {
      key: "retention90d",
      name: "Retention +90 days",
      desc: "Rétention des données étendue à 90 jours.",
      priceLabel: "9€ / mois",
      kind: "flag",
    },
    {
      key: "retention365d",
      name: "Retention +365 days",
      desc: "Rétention des données étendue à 365 jours.",
      priceLabel: "19€ / mois",
      kind: "flag",
    },
    {
      key: "auditsPack200",
      name: "Audits Pack +200",
      desc: "Ajoute +200 audits / mois.",
      priceLabel: "9€ / mois",
      kind: "flag",
    },
    {
      key: "auditsPack1000",
      name: "Audits Pack +1000",
      desc: "Ajoute +1000 audits / mois.",
      priceLabel: "29€ / mois",
      kind: "flag",
    },
    {
      key: "pdfPack200",
      name: "PDF Pack +200",
      desc: "Ajoute +200 PDFs / mois.",
      priceLabel: "9€ / mois",
      kind: "flag",
    },
    {
      key: "exportsPack1000",
      name: "Exports Pack +1000",
      desc: "Ajoute +1000 exports / mois.",
      priceLabel: "19€ / mois",
      kind: "flag",
    },
    {
      key: "prioritySupport",
      name: "Priority Support",
      desc: "Support prioritaire (SLA).",
      priceLabel: "29€ / mois",
      kind: "flag",
    },
    // Tu as aussi “Custom Domain” dans Stripe, on le garde en dernier si tu veux l’afficher :
    {
      key: "customDomain",
      name: "Custom Domain",
      desc: "Domaine personnalisé (ex: app.tondomaine.com).",
      priceLabel: "9€ / mois",
      kind: "flag",
    },
  ];

  function loadAddonPref() {
    const raw = localStorage.getItem(ADDON_PREF_KEY);
    if (!raw) return {};
    try {
      const j = JSON.parse(raw);
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }

  function saveAddonPref(pref) {
    localStorage.setItem(ADDON_PREF_KEY, JSON.stringify(pref || {}));
  }

  function renderAddons() {
    const pref = loadAddonPref();

    addonsList.innerHTML = "";

    for (const a of ADDONS) {
      const row = document.createElement("div");
      row.className = "addon";

      const left = document.createElement("div");
      left.className = "addonLeft";
      left.innerHTML = `
        <div class="addonName">${a.name}</div>
        <div class="small addonDesc">${a.desc}</div>
        <div class="keyChip">${a.key}</div>
      `;

      const right = document.createElement("div");
      right.className = "addonRight";

      const price = document.createElement("div");
      price.style.fontWeight = "950";
      price.textContent = a.priceLabel;

      right.appendChild(price);

      if (a.kind === "qty") {
        const sel = document.createElement("select");
        sel.className = "qty";
        const cur = Number(pref[a.key] || 0);

        // options 0..10 + “custom” si tu veux, mais on reste simple
        const max = Math.min(a.max || 50, 50);
        for (let i = 0; i <= 10; i++) {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent = `Qté ${i}`;
          sel.appendChild(opt);
        }
        sel.value = String(Math.min(10, Math.max(0, cur)));

        sel.addEventListener("change", () => {
          const p = loadAddonPref();
          p[a.key] = Number(sel.value || 0);
          saveAddonPref(p);
          renderSummaryAddons();
        });

        right.appendChild(sel);
      } else {
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!pref[a.key];

        chk.addEventListener("change", () => {
          const p = loadAddonPref();
          p[a.key] = !!chk.checked;
          saveAddonPref(p);
          renderSummaryAddons();
        });

        right.appendChild(chk);
      }

      row.appendChild(left);
      row.appendChild(right);
      addonsList.appendChild(row);
    }
  }

  function renderSummaryAddons() {
    const pref = loadAddonPref();

    const lines = [];

    // White label inclus gratuit (toujours)
    // (tu as demandé “white label gratuit”)
    // => pas besoin de le lister en add-on payant, il est déjà affiché dans le résumé.

    for (const a of ADDONS) {
      const v = pref[a.key];
      if (a.kind === "qty") {
        const n = Number(v || 0);
        if (n > 0) lines.push(`${a.name} × ${n}`);
      } else {
        if (v) lines.push(a.name);
      }
    }

    sumAddons.innerHTML = "";
    if (!lines.length) {
      sumAddons.innerHTML = `<li class="small2">—</li>`;
      return;
    }
    for (const t of lines) {
      const li = document.createElement("li");
      li.textContent = t;
      sumAddons.appendChild(li);
    }
  }

  // ===== Actions =====
  btnBackDash?.addEventListener("click", () => {
    window.location.href = "/dashboard.html";
  });

  btnPortal?.addEventListener("click", async () => {
    // Si pas connecté => redirige login
    const token = getToken();
    if (!token) return (window.location.href = "/login.html");

    const r = await api("/api/stripe/portal", { method: "POST", body: "{}" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return alert(data?.error || "Impossible d'ouvrir le portal");
    window.location.href = data.url;
  });

  btnCheckout?.addEventListener("click", async () => {
    const plan = normalizePlan(localStorage.getItem(PLAN_PREF_KEY) || "pro");
    const token = getToken();

    // Si pas connecté, renvoie vers index avec plan préselectionné
    if (!token) {
      return (window.location.href = `/index.html?plan=${encodeURIComponent(plan)}`);
    }

    btnCheckout.disabled = true;
    btnCheckout.textContent = "Redirection…";

    try {
      const r = await api("/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "Erreur checkout");
      if (!data?.url) throw new Error("URL Stripe manquante");
      window.location.href = data.url;
    } catch (e) {
      alert(e?.message || "Erreur");
      btnCheckout.disabled = false;
      btnCheckout.textContent = "Continuer (Checkout Plan)";
    }
  });

  // ===== Init =====
  function init() {
    const token = getToken();
    setAuthPill(!!token);

    const urlPlan = new URLSearchParams(location.search).get("plan");
    const stored = localStorage.getItem(PLAN_PREF_KEY);
    setActivePlan(normalizePlan(urlPlan || stored || "pro"));

    renderAddons();
    renderSummaryAddons();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
