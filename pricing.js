(() => {
  const TOKEN_KEYS = ["token", "fp_token"];
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

  function setAuth(ok) {
    authText.textContent = ok ? "Statut : Connecté" : "Statut : Non connecté";
    authDot.style.background = ok ? "#22c55e" : "#f59e0b";
  }

  async function api(path, opts = {}) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!headers["Content-Type"] && opts.body) headers["Content-Type"] = "application/json";

    return fetch(path, { ...opts, headers, cache: "no-store" });
  }

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
    renderSummaryAddons();
  });

  // Add-ons (tu voulais tous ceux-là)
  const ADDONS = [
    { key:"monitorsPack50", name:"Monitors Pack +50", desc:"+50 monitors actifs.", priceLabel:"19€ / mois", kind:"qty", max:10 },
    { key:"extraSeat", name:"Extra Seat", desc:"Ajoute des seats à ton org.", priceLabel:"7€ / mois", kind:"qty", max:10 },

    { key:"retention90d", name:"Retention +90 days", desc:"Rétention étendue à 90 jours.", priceLabel:"9€ / mois", kind:"flag" },
    { key:"retention365d", name:"Retention +365 days", desc:"Rétention étendue à 365 jours.", priceLabel:"19€ / mois", kind:"flag" },

    { key:"auditsPack200", name:"Audits Pack +200", desc:"+200 audits / mois.", priceLabel:"9€ / mois", kind:"flag" },
    { key:"auditsPack1000", name:"Audits Pack +1000", desc:"+1000 audits / mois.", priceLabel:"29€ / mois", kind:"flag" },

    { key:"pdfPack200", name:"PDF Pack +200", desc:"+200 PDFs / mois.", priceLabel:"9€ / mois", kind:"flag" },
    { key:"exportsPack1000", name:"Exports Pack +1000", desc:"+1000 exports / mois.", priceLabel:"19€ / mois", kind:"flag" },

    { key:"prioritySupport", name:"Priority Support", desc:"Support prioritaire (SLA).", priceLabel:"29€ / mois", kind:"flag" },
    { key:"customDomain", name:"Custom Domain", desc:"Domaine personnalisé.", priceLabel:"9€ / mois", kind:"flag" },
  ];

  function loadAddonPref() {
    const raw = localStorage.getItem(ADDON_PREF_KEY);
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  }

  function saveAddonPref(pref) {
    localStorage.setItem(ADDON_PREF_KEY, JSON.stringify(pref || {}));
  }

  function renderAddons() {
    const pref = loadAddonPref();
    addonsList.innerHTML = "";

    for (const a of ADDONS) {
      const card = document.createElement("div");
      card.className = "addon";

      const top = document.createElement("div");
      top.className = "addonTop";
      top.innerHTML = `
        <div style="min-width:0">
          <div class="addonName">${a.name}</div>
          <div class="addonDesc">${a.desc}</div>
          <div class="chip">${a.key}</div>
        </div>
        <div class="addonPrice">${a.priceLabel}</div>
      `;

      const ctrl = document.createElement("div");
      ctrl.className = "addonCtrl";

      if (a.kind === "qty") {
        const sel = document.createElement("select");
        const cur = Number(pref[a.key] || 0);
        const max = Math.max(1, Math.min(10, a.max || 10));

        for (let i = 0; i <= max; i++) {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent = `Qté ${i}`;
          sel.appendChild(opt);
        }
        sel.value = String(Math.max(0, Math.min(max, cur)));

        sel.addEventListener("change", () => {
          const p = loadAddonPref();
          p[a.key] = Number(sel.value || 0);
          saveAddonPref(p);
          renderSummaryAddons();
        });

        const label = document.createElement("div");
        label.style.color = "var(--muted)";
        label.style.fontWeight = "850";
        label.style.fontSize = "13px";
        label.textContent = "Quantité";

        ctrl.appendChild(label);
        ctrl.appendChild(sel);
      } else {
        const label = document.createElement("div");
        label.style.color = "var(--muted)";
        label.style.fontWeight = "850";
        label.style.fontSize = "13px";
        label.textContent = "Activer";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!pref[a.key];

        chk.addEventListener("change", () => {
          const p = loadAddonPref();
          p[a.key] = !!chk.checked;
          saveAddonPref(p);
          renderSummaryAddons();
        });

        ctrl.appendChild(label);
        ctrl.appendChild(chk);
      }

      card.appendChild(top);
      card.appendChild(ctrl);
      addonsList.appendChild(card);
    }
  }

  function renderSummaryAddons() {
    const pref = loadAddonPref();
    const lines = [];

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
      sumAddons.innerHTML = `<li class="small">—</li>`;
      return;
    }
    for (const t of lines) {
      const li = document.createElement("li");
      li.textContent = t;
      sumAddons.appendChild(li);
    }
  }

  btnBackDash?.addEventListener("click", () => {
    window.location.href = "/dashboard.html";
  });

  btnPortal?.addEventListener("click", async () => {
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

  function init() {
    setAuth(!!getToken());

    const urlPlan = new URLSearchParams(location.search).get("plan");
    const stored = localStorage.getItem(PLAN_PREF_KEY);
    setActivePlan(normalizePlan(urlPlan || stored || "pro"));

    renderAddons();
    renderSummaryAddons();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
