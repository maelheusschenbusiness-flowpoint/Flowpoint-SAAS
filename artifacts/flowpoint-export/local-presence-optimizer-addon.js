(function () {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const t = value => typeof window.fpT === "function" ? window.fpT(value) : value;

  window.FP_ADDON_RENDERERS = window.FP_ADDON_RENDERERS || {};
  window.FP_ADDON_RENDERERS.localPresenceOptimizer = async function renderLocalPresenceOptimizer(root, force = false) {
    if (!root) return;
    root.innerHTML = `<section class="fp-card" aria-labelledby="lpo-title">
      <h2 id="lpo-title" class="fp-card-title">Local Presence Optimizer</h2>
      <p>${t("Priorités calculées à partir des champs présents dans votre fiche GBP synchronisée.")}</p>
      <div data-lpo-state role="status" aria-live="polite">${t("Analyse des fiches GBP…")}</div>
    </section>`;
    if (!root.dataset.lpoBound) {
      root.dataset.lpoBound = "true";
      root.addEventListener("submit", async event => {
        const form = event.target.closest("[data-lpo-settings]");
        if (!form) return;
        event.preventDefault();
        const values = new FormData(form);
        const message = root.querySelector("[data-lpo-message]");
        try {
          const result = await window.apiAction("PUT", "/api/local-presence/settings", {
            locationId: String(values.get("locationId") || ""),
            trackedFields: values.getAll("trackedFields").map(String),
          });
          if (result && result.ok === false) throw new Error(result.error || t("Enregistrement impossible."));
          await window.FP_ADDON_RENDERERS.localPresenceOptimizer(root, true);
          const saved = root.querySelector("[data-lpo-message]");
          if (saved) { saved.setAttribute("role", "status"); saved.textContent = t("Critères de présence enregistrés."); }
          window.showToast?.("success", t("Critères de présence enregistrés."));
        } catch (error) {
          if (message) { message.setAttribute("role", "alert"); message.textContent = String(error?.message || t("Enregistrement impossible.")); }
        }
      });
      root.addEventListener("click", event => {
        if (event.target.closest("[data-lpo-refresh]")) window.FP_ADDON_RENDERERS.localPresenceOptimizer(root, true);
      });
    }
    const state = root.querySelector("[data-lpo-state]");
    try {
      const data = await window.apiAction("GET", "/api/local-presence", undefined, force ? { force: true } : {});
      const settings = data.settings || {};
      const selected = new Set(settings.trackedFields || []);
      const fields = data.analysis?.fields || [];
      const opportunities = data.analysis?.opportunities || [];
      const completed = Number(data.analysis?.completedFields ?? 0);
      const total = Number(data.analysis?.totalFields ?? 0);
      const options = (data.locations || []).map(location =>
        `<option value="${esc(location.id)}" ${location.id === (settings.locationId || data.profile?.id) ? "selected" : ""}>${esc(location.name)}</option>`).join("");
      const syncedAt = data.profile?.lastSyncAt ? esc(new Date(data.profile.lastSyncAt).toLocaleString()) : t("Aucune synchronisation");
      state.innerHTML = `<div><button type="button" class="fp-btn fp-btn-secondary fp-btn-sm" data-lpo-refresh>${t("Actualiser")}</button></div>
        ${!data.connected ? `<p role="status">${t("Aucune fiche GBP synchronisée. Connectez Google Business Profile puis synchronisez vos fiches.")}</p>` : `
        <p><strong>${Number(data.analysis?.score ?? 0)}%</strong> — ${completed} / ${total} ${t("critères renseignés")}</p>
        <form data-lpo-settings aria-label="${esc(t("Critères de présence"))}">
          <label>${t("Établissement")}
            <select name="locationId" class="fp-input">${options}</select>
          </label>
          <div class="fp-grid fp-grid-2">
            ${fields.map(field => `<label><input type="checkbox" name="trackedFields" value="${esc(field.key)}" ${selected.has(field.key) ? "checked" : ""}> ${esc(field.label)} <span>${t(field.complete ? "Complet" : "À compléter")}</span></label>`).join("")}
          </div>
          <button type="submit" class="fp-btn fp-btn-primary fp-btn-sm">${t("Enregistrer mes critères")}</button>
        </form>
        <div data-lpo-message role="status" aria-live="polite"></div>
        <h3>${t("Prochaines actions")}</h3>
        ${opportunities.length ? `<ul>${opportunities.map(item => `<li>${esc(item.title)} — <small>${esc(item.evidence)}</small></li>`).join("")}</ul>` : `<p>${t("Tous les critères suivis sont présents dans les dernières données synchronisées.")}</p>`}`}
        <small>${t("Dernière synchronisation :")} ${syncedAt}</small>`;
    } catch (error) {
      state.setAttribute("role", "alert");
      state.innerHTML = `<p>${esc(String(error?.message || t("Impossible de charger l’analyse des fiches GBP.")))}</p>
        <button class="fp-btn fp-btn-ghost" type="button" data-lpo-refresh>${t("Réessayer")}</button>`;
    }
  };
})();
