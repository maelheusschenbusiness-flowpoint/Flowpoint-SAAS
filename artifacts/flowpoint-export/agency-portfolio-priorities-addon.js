(function () {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const t = value => typeof window.fpT === "function" ? window.fpT(value) : value;
  const priorities = {
    urgent: ["🔴", "Urgent"],
    focus: ["🟠", "À traiter"],
    stable: ["🟢", "Stable"],
  };
  window.FP_ADDON_RENDERERS = window.FP_ADDON_RENDERERS || {};
  window.FP_ADDON_RENDERERS.agencyPortfolioPriorities = async function renderAgencyPortfolioPriorities(root) {
    if (!root) return;
    const load = async () => {
      root.innerHTML = `<section class="fp-card" aria-labelledby="app-title">
        <h2 id="app-title" class="fp-card-title">${t("Priorités du portefeuille d’agences")}</h2>
        <p>${t("Classez vos sites à partir des audits SEO et des clics GSC réellement mesurés.")}</p>
        <div data-app-state role="status" aria-live="polite">${t("Chargement des priorités…")}</div>
      </section>`;
      const state = root.querySelector("[data-app-state]");
      try {
        const data = await window.apiAction("GET", "/api/agency-portfolio-priorities");
        const settings = data.settings?.priorityWeights || {};
        const rows = Array.isArray(data.priorities) ? data.priorities : [];
        state.innerHTML = rows.length ? `<form data-app-settings aria-label="${esc(t("Pondérations de priorité"))}">
          <div class="fp-grid fp-grid-2" role="list">${rows.map(site => {
            const badge = priorities[site.priority] || priorities.stable;
            return `<article class="fp-card" role="listitem">
              <h3>${esc(site.domain)}</h3>
              <p>${badge[0]} ${t(badge[1])} · ${esc(site.currentScore)}/100 ${site.scoreChange === null ? "" : `(${site.scoreChange > 0 ? "+" : ""}${esc(site.scoreChange)})`}</p>
              <p>${esc(site.criticalIssues)} ${t("problèmes critiques")} · ${site.monthlyOrganicClicks === null ? "—" : esc(site.monthlyOrganicClicks)} ${t("clics GSC / 30 jours")}</p>
              <ul>${(site.reasons || []).map(reason => `<li>${esc(reason)}</li>`).join("") || `<li>${t("Aucun signal de baisse détecté.")}</li>`}</ul>
              <label>${t("Pondération (1 à 5)")}
                <select class="fp-input" name="${esc(site.domain)}" aria-label="${esc(t("Pondération pour"))} ${esc(site.domain)}">
                  ${[1,2,3,4,5].map(n => `<option value="${n}" ${Number(settings[site.domain] ?? site.priorityWeight) === n ? "selected" : ""}>${n}</option>`).join("")}
                </select>
              </label>
            </article>`;
          }).join("")}</div>
          <button class="fp-btn fp-btn-primary" type="submit">${t("Enregistrer les priorités")}</button>
          <div data-app-message role="status" aria-live="polite"></div>
        </form>` : `<p>${t("Aucun audit SEO terminé n’est disponible pour les sites de votre organisation.")}</p>`;
        state.querySelector("[data-app-settings]")?.addEventListener("submit", async event => {
          event.preventDefault();
          const form = event.currentTarget;
          const priorityWeights = Object.fromEntries(
            [...new FormData(form).entries()].map(([domain, weight]) => [domain, Number(weight)]),
          );
          const message = form.querySelector("[data-app-message]");
          try {
            await window.apiAction("PUT", "/api/agency-portfolio-priorities/settings", { priorityWeights });
            await load();
            const savedMessage = root.querySelector("[data-app-message]");
            if (savedMessage) {
              savedMessage.setAttribute("role", "status");
              savedMessage.textContent = t("Paramètres enregistrés.");
            }
          } catch (error) {
            message.setAttribute("role", "alert");
            message.textContent = String(error?.message || t("Impossible d’enregistrer les priorités."));
          }
        });
      } catch (error) {
        state.setAttribute("role", "alert");
        state.innerHTML = `<p>${esc(String(error?.message || t("Impossible de charger le portefeuille.")))}</p>
          <button class="fp-btn fp-btn-ghost" type="button" data-app-retry>${t("Réessayer")}</button>`;
        state.querySelector("[data-app-retry]")?.addEventListener("click", load);
      }
    };
    await load();
  };
})();
