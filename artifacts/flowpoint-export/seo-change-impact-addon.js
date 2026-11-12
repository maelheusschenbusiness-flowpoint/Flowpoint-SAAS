(function () {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const t = value => typeof window.fpT === "function" ? window.fpT(value) : value;
  const signed = value => `${Number(value) > 0 ? "+" : ""}${Number(value)}`;
  const dateLabel = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : esc(date.toLocaleDateString());
  };

  window.FP_ADDON_RENDERERS = window.FP_ADDON_RENDERERS || {};
  window.FP_ADDON_RENDERERS.seoChangeImpact = async function renderSEOChangeImpact(root) {
    if (!root) return;
    root.innerHTML = `<section class="fp-card" aria-labelledby="sci-title">
      <h2 id="sci-title" class="fp-card-title">${t("Impact des changements SEO")}</h2>
      <p>${t("Comparez les scores et métriques mesurés entre les deux derniers audits terminés.")}</p>
      <div data-sci-state role="status" aria-live="polite">${t("Chargement des audits…")}</div>
    </section>`;
    const state = root.querySelector("[data-sci-state]");
    if (!state) return;

    const load = async () => {
      state.setAttribute("role", "status");
      state.textContent = t("Chargement des audits…");
      try {
        const data = await window.apiAction("GET", "/api/seo-change-impact");
        const settings = data.settings || {};
        const comparisons = Array.isArray(data.comparisons) ? data.comparisons : [];
        state.innerHTML = `<form data-sci-settings class="fp-grid fp-grid-2" aria-label="${esc(t("Paramètres de comparaison"))}">
          <label>${t("Période observée (jours)")}
            <input class="fp-input" name="lookbackDays" type="number" min="7" max="365" step="1" required value="${esc(settings.lookbackDays ?? 30)}">
          </label>
          <label>${t("Seuil minimal de variation du score")}
            <input class="fp-input" name="minimumScoreChange" type="number" min="0" max="100" step="1" required value="${esc(settings.minimumScoreChange ?? 0)}">
          </label>
          <button class="fp-btn fp-btn-primary" type="submit">${t("Enregistrer")}</button>
        </form>
        <p>${t("Comparaisons fondées uniquement sur les audits terminés de votre organisation.")}</p>
        <div data-sci-results role="list" aria-label="${esc(t("Comparaisons SEO mesurées"))}">
          ${comparisons.length ? comparisons.map(item => `<article class="fp-card fp-mb-10" role="listitem">
            <h3>${esc(item.siteUrl)}</h3>
            <p>${dateLabel(item.beforeCapturedAt)} → ${dateLabel(item.afterCapturedAt)}</p>
            <dl class="fp-grid fp-grid-2">
              <div><dt>${t("Score SEO")}</dt><dd>${esc(item.beforeScore)} → ${esc(item.afterScore)} (${esc(signed(item.scoreDelta))})</dd></div>
              <div><dt>${t("Problèmes critiques mesurés")}</dt><dd>${esc(item.beforeCriticalIssues)} → ${esc(item.afterCriticalIssues)} (${esc(signed(item.criticalIssueDelta))})</dd></div>
              <div><dt>${t("Score de vitesse")}</dt><dd>${esc(item.beforeSpeed)} → ${esc(item.afterSpeed)} (${esc(signed(item.speedDelta))})</dd></div>
            </dl>
          </article>`).join("") : `<p>${t("Deux audits terminés sont nécessaires pour afficher un impact mesuré.")}</p>`}
        </div>
        <div data-sci-message role="status" aria-live="polite"></div>`;

        const form = state.querySelector("[data-sci-settings]");
        const message = state.querySelector("[data-sci-message]");
        form?.addEventListener("submit", async event => {
          event.preventDefault();
          const values = new FormData(form);
          const settingsUpdate = {
            lookbackDays: Number(values.get("lookbackDays")),
            minimumScoreChange: Number(values.get("minimumScoreChange")),
          };
          try {
            await window.apiAction("PUT", "/api/seo-change-impact/settings", settingsUpdate);
            await load();
            const savedMessage = state.querySelector("[data-sci-message]");
            if (savedMessage) {
              savedMessage.setAttribute("role", "status");
              savedMessage.textContent = t("Paramètres enregistrés.");
            }
          } catch (error) {
            if (message) {
              message.setAttribute("role", "alert");
              message.textContent = String(error?.message || t("Impossible d’enregistrer les paramètres."));
            }
          }
        });
      } catch (error) {
        state.setAttribute("role", "alert");
        state.innerHTML = `<p>${esc(String(error?.message || t("Impossible de charger les audits SEO.")))}</p>
          <button class="fp-btn fp-btn-ghost" type="button" data-sci-retry>${t("Réessayer")}</button>`;
        state.querySelector("[data-sci-retry]")?.addEventListener("click", load);
      }
    };
    await load();
  };
})();
