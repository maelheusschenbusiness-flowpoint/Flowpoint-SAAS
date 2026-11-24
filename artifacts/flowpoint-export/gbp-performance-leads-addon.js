(function () {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const t = value => typeof window.fpT === "function" ? window.fpT(value) : value;
  const METRICS = [
    ["CALL_CLICKS", "Appels depuis la fiche"],
    ["WEBSITE_CLICKS", "Clics vers le site"],
    ["BUSINESS_DIRECTION_REQUESTS", "Demandes d’itinéraire"],
    ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "Impressions Maps — ordinateur"],
    ["BUSINESS_IMPRESSIONS_MOBILE_MAPS", "Impressions Maps — mobile"],
  ];
  const GOAL_KEYS = ["CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS"];
  const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—";
  const loadMessage = status => status === 402 ? "Cet add-on n’est pas actif pour votre organisation."
    : status === 403 ? "Vous n’avez pas accès à ces données."
    : status === 502 ? "Les performances Google Business Profile sont temporairement indisponibles. Réessayez."
    : "Impossible de charger les performances Google Business Profile.";

  window.FP_ADDON_RENDERERS = window.FP_ADDON_RENDERERS || {};
  window.FP_ADDON_RENDERERS.gbpPerformanceLeads = async function renderGbpPerformance(root, force = false) {
    if (!root) return;
    root.innerHTML = `<section class="fp-card" aria-labelledby="gpl-title">
      <h2 id="gpl-title" class="fp-card-title">GBP Performance &amp; Leads</h2>
      <p>${t("Actions et performances mesurées par Google Business Profile. Les clics ne sont pas assimilés à des conversions.")}</p>
      <div data-gpl-state role="status" aria-live="polite">${t("Chargement des performances GBP…")}</div>
    </section>`;
    if (!root.dataset.gplBound) {
      root.dataset.gplBound = "true";
      root.addEventListener("submit", async event => {
        const form = event.target.closest("[data-gpl-settings]");
        if (!form) return;
        event.preventDefault();
        const values = new FormData(form);
        const goals = {};
        for (const key of GOAL_KEYS) {
          const value = String(values.get(key) ?? "").trim();
          if (value !== "") goals[key] = Number(value);
        }
        const message = root.querySelector("[data-gpl-message]");
        try {
          const result = await window.apiAction("PUT", "/api/gbp-performance/settings", {
            locationId: String(values.get("locationId") || "") || null,
            periodDays: Number(values.get("periodDays")),
            alertDropPercent: Number(values.get("alertDropPercent")),
            goals,
          });
          if (result && result.ok === false) throw new Error(result.error || t("Impossible d’enregistrer ces paramètres."));
          await window.FP_ADDON_RENDERERS.gbpPerformanceLeads(root, true);
          const saved = root.querySelector("[data-gpl-message]");
          if (saved) { saved.setAttribute("role", "status"); saved.textContent = t("Objectifs GBP enregistrés."); }
          window.showToast?.("success", t("Objectifs GBP enregistrés."));
        } catch (error) {
          if (message) { message.setAttribute("role", "alert"); message.textContent = String(error?.message || t("Impossible d’enregistrer ces paramètres.")); }
        }
      });
      root.addEventListener("click", event => {
        if (event.target.closest("[data-gpl-refresh]")) window.FP_ADDON_RENDERERS.gbpPerformanceLeads(root, true);
      });
    }
    const state = root.querySelector("[data-gpl-state]");
    try {
      const data = await window.apiAction("GET", "/api/gbp-performance", undefined, force ? { force: true } : {});
      const settings = data.settings || { locationId: null, periodDays: 30, goals: {}, alertDropPercent: 20 };
      const goals = settings.goals || {};
      const options = (data.locations || []).map(location =>
        `<option value="${esc(location.id)}" ${location.id === settings.locationId ? "selected" : ""}>${esc(location.name)}</option>`).join("");
      const notice = data.connectionRequired ? data.message
        : (!data.configured ? t("Synchronisez vos fiches Google Business Profile pour commencer.") : "");
      const kpis = data.configured ? METRICS.map(([key, label]) => {
        const current = data.current?.[key];
        const previous = data.previous?.[key];
        const change = Number.isFinite(current) && Number.isFinite(previous)
          ? `${current > previous ? "+" : ""}${number(current - previous)} ${t("vs période précédente")}`
          : t("Pas de comparaison disponible");
        const drop = data.drops?.[key];
        const goal = goals[key];
        return `<article class="fp-card" role="listitem">
          <strong>${number(current)}</strong>
          <div>${t(label)}</div>
          <small>${drop ? `${t("Baisse observée de")} ${esc(drop)}%` : esc(change)}</small>
          ${goal != null ? `<small>${t("Objectif :")} ${number(goal)} / ${esc(settings.periodDays)} ${t("jours")}</small>` : ""}
        </article>`;
      }).join("") : "";
      state.innerHTML = `<div><button type="button" class="fp-btn fp-btn-secondary fp-btn-sm" data-gpl-refresh>${t("Actualiser")}</button></div>
        ${notice ? `<p role="status">${esc(notice)}</p>` : ""}
        ${data.configured ? `<div class="fp-grid fp-grid-2" role="list" aria-label="${esc(t("Performances GBP mesurées"))}">${kpis}</div>` : ""}
        <form data-gpl-settings class="fp-grid fp-grid-2" aria-label="${esc(t("Objectifs GBP"))}">
          <label>${t("Fiche")}
            <select name="locationId" class="fp-input" ${options ? "" : "disabled"}>${options || `<option value="">${t("Aucune fiche synchronisée")}</option>`}</select>
          </label>
          <label>${t("Période")}
            <select name="periodDays" class="fp-input">${[7, 30, 90].map(days => `<option value="${days}" ${Number(settings.periodDays) === days ? "selected" : ""}>${days} ${t("jours")}</option>`).join("")}</select>
          </label>
          <label>${t("Seuil de baisse pour alerte (%)")}
            <input name="alertDropPercent" type="number" min="5" max="80" step="1" class="fp-input" value="${Number(settings.alertDropPercent) || 20}">
          </label>
          ${METRICS.slice(0, 3).map(([key, label]) => `<label>${t("Objectif —")} ${t(label)}
            <input name="${key}" type="number" min="0" step="1" class="fp-input" value="${esc(goals[key] ?? "")}" placeholder="${esc(t("Aucun objectif"))}">
          </label>`).join("")}
          <button type="submit" class="fp-btn fp-btn-primary fp-btn-sm">${t("Enregistrer les objectifs")}</button>
        </form>
        <div data-gpl-message role="status" aria-live="polite"></div>
        ${data.period ? `<small>${t("Période mesurée :")} ${esc(settings.periodDays)} ${t("jours")}, ${t("jusqu’au")} ${esc(new Date(data.period.end).toLocaleDateString())}.</small>` : ""}`;
    } catch (error) {
      state.setAttribute("role", "alert");
      state.innerHTML = `<p>${esc(t(loadMessage(Number(error?.status) || 0)))}</p>
        <button class="fp-btn fp-btn-ghost" type="button" data-gpl-refresh>${t("Réessayer")}</button>`;
    }
  };
})();
