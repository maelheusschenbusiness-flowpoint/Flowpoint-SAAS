(function () {
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const t = value => typeof window.fpT === "function" ? window.fpT(value) : value;

  window.FP_ADDON_RENDERERS = window.FP_ADDON_RENDERERS || {};
  window.FP_ADDON_RENDERERS.conversionOpportunityEngine = async function renderConversionOpportunities(root) {
    if (!root) return;
    root.innerHTML = `<section class="fp-card">
      <h2 class="fp-card-title">${t("Opportunités de conversion")}</h2>
      <p>${t("Pages avec suffisamment de sessions mais un taux de conversion mesuré faible.")}</p>
      <div data-coe-state>${t("Chargement des données GA4…")}</div>
    </section>`;
    if (!root.dataset.coeBound) {
      root.dataset.coeBound = "true";
      root.addEventListener("submit", async event => {
        const form = event.target.closest("[data-coe-settings]");
        if (!form) return;
        event.preventDefault();
        const values = new FormData(form);
        try {
          await window.apiAction("PUT", "/api/conversion-opportunity-engine/settings", {
            minimumSessions: Number(values.get("minimumSessions")),
            maximumConversionRate: Number(values.get("maximumConversionRate")) / 100,
          });
          await window.FP_ADDON_RENDERERS.conversionOpportunityEngine(root);
          window.showToast?.("success", t("Paramètres enregistrés."));
        } catch (error) {
          window.showToast?.("error", String(error?.message || error));
        }
      });
    }
    const state = root.querySelector("[data-coe-state]");
    try {
      const data = await window.apiAction("GET", "/api/conversion-opportunity-engine");
      const settings = data.settings || {};
      const items = data.opportunities || [];
      state.innerHTML = `<form data-coe-settings class="fp-grid fp-grid-2">
        <label>${t("Sessions minimales")}<input class="fp-input" name="minimumSessions" type="number" min="1" value="${escapeHtml(settings.minimumSessions ?? 100)}"></label>
        <label>${t("Taux maximal (%)")}<input class="fp-input" name="maximumConversionRate" type="number" min="0" max="100" step="0.1" value="${escapeHtml(((settings.maximumConversionRate ?? 0.02) * 100).toFixed(1))}"></label>
        <button class="fp-btn fp-btn-primary" type="submit">${t("Enregistrer")}</button>
      </form><p>${t("Données GA4 mesurées sur les 28 derniers jours.")}</p>
      ${items.length ? items.map(item => `<article class="fp-card fp-mb-10">
        <strong>${escapeHtml(item.landingPage)}</strong>
        <div>${escapeHtml(item.sessions)} ${t("sessions")} · ${escapeHtml(item.conversions)} ${t("conversions")} · ${(item.conversionRate * 100).toFixed(1)}%</div>
      </article>`).join("") : `<p>${t("Aucune page mesurée ne correspond aux critères.")}</p>`}`;
    } catch (error) {
      state.textContent = String(error?.message || t("Impossible de charger les données GA4."));
    }
  };
})();
