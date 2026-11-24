(function () {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const t = value => typeof window.fpT === "function" ? window.fpT(value) : value;
  const split = value => String(value || "").split(",").map(term => term.trim()).filter(Boolean);

  window.FP_ADDON_RENDERERS = window.FP_ADDON_RENDERERS || {};
  window.FP_ADDON_RENDERERS.localLandingOpportunities = async function renderLocalLandingOpportunities(root, force = false) {
    if (!root) return;
    root.innerHTML = `<section class="fp-card" aria-labelledby="llo-title">
      <h2 id="llo-title" class="fp-card-title">${t("Opportunités de pages locales")}</h2>
      <p>${t("Requêtes réellement observées dans Google Search Console. Les recommandations ne prédisent pas de gains et ne supposent pas qu’une page est absente.")}</p>
      <div data-llo-state role="status" aria-live="polite">${t("Chargement des requêtes Google Search Console…")}</div>
    </section>`;
    if (!root.dataset.lloBound) {
      root.dataset.lloBound = "true";
      root.addEventListener("submit", async event => {
        const form = event.target.closest("[data-llo-settings]");
        if (!form) return;
        event.preventDefault();
        const values = new FormData(form);
        const message = root.querySelector("[data-llo-message]");
        try {
          await window.apiAction("PUT", "/api/local-landing-opportunities/settings", {
            services: split(values.get("services")),
            locations: split(values.get("locations")),
            minimumImpressions: Number(values.get("minimumImpressions")),
            maximumPosition: Number(values.get("maximumPosition")),
          });
          await window.FP_ADDON_RENDERERS.localLandingOpportunities(root, true);
          const saved = root.querySelector("[data-llo-message]");
          if (saved) { saved.setAttribute("role", "status"); saved.textContent = t("Critères locaux enregistrés."); }
          window.showToast?.("success", t("Critères locaux enregistrés."));
        } catch (error) {
          if (message) { message.setAttribute("role", "alert"); message.textContent = String(error?.message || t("Enregistrement impossible.")); }
        }
      });
      root.addEventListener("click", event => {
        if (event.target.closest("[data-llo-retry]")) window.FP_ADDON_RENDERERS.localLandingOpportunities(root, true);
      });
    }
    const state = root.querySelector("[data-llo-state]");
    try {
      const data = await window.apiAction("GET", "/api/local-landing-opportunities", undefined, force ? { force: true } : {});
      const settings = data.settings || {};
      const items = Array.isArray(data.opportunities) ? data.opportunities : [];
      state.innerHTML = `<form data-llo-settings class="fp-grid fp-grid-2" aria-label="${esc(t("Critères locaux"))}">
        <label>${t("Services ciblés")}
          <input class="fp-input" name="services" value="${esc((settings.services || []).join(", "))}" placeholder="${esc(t("Services ciblés"))}" required>
        </label>
        <label>${t("Villes ou zones")}
          <input class="fp-input" name="locations" value="${esc((settings.locations || []).join(", "))}" placeholder="${esc(t("Villes ou zones"))}" required>
        </label>
        <label>${t("Impressions minimum")}
          <input class="fp-input" name="minimumImpressions" type="number" min="1" max="100000" step="1" value="${esc(settings.minimumImpressions ?? 10)}" required>
        </label>
        <label>${t("Position maximum")}
          <input class="fp-input" name="maximumPosition" type="number" min="4" max="100" step="1" value="${esc(settings.maximumPosition ?? 30)}" required>
        </label>
        <button class="fp-btn fp-btn-primary" type="submit">${t("Enregistrer les critères")}</button>
      </form>
      <div data-llo-message role="status" aria-live="polite"></div>
      <div role="list" aria-label="${esc(t("Opportunités de pages locales"))}">
      ${items.length ? items.map(item => `<article class="fp-card fp-mb-10" role="listitem">
        <strong>${esc(item.keyword)}</strong>
        <div>${esc(item.impressions)} ${t("impressions")} · ${esc(item.clicks)} ${t("clics")} · ${t("Position moyenne")} ${esc(item.averagePosition)}</div>
        <div>${esc(t(item.recommendation))}</div>
        <small>${esc(t(item.evidence))}</small>
      </article>`).join("") : `<p>${t("Aucune requête ne correspond aux critères enregistrés sur les 28 derniers jours. Vérifiez la connexion Search Console ou ajustez les services, zones et seuils.")}</p>`}
      </div>`;
    } catch (error) {
      state.setAttribute("role", "alert");
      state.innerHTML = `<p>${esc(String(error?.message || t("Impossible de charger les requêtes Search Console.")))}</p>
        <button class="fp-btn fp-btn-ghost" type="button" data-llo-retry>${t("Réessayer")}</button>`;
    }
  };
})();
