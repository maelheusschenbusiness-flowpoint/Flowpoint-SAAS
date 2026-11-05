(function () {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const t = value => typeof window.fpT === "function" ? window.fpT(value) : value;
  const statusLabels = {
    goal_met: ["✅", "Objectif atteint"],
    needs_attention: ["🟠", "Objectif à améliorer"],
    no_data: ["⚪", "Aucune donnée GSC correspondante"],
  };
  window.FP_ADDON_RENDERERS = window.FP_ADDON_RENDERERS || {};
  window.FP_ADDON_RENDERERS.organicCampaignTracker = async function renderOrganicCampaignTracker(root) {
    if (!root) return;
    const load = async () => {
      root.innerHTML = `<section class="fp-card" aria-labelledby="oct-title">
        <h2 id="oct-title" class="fp-card-title">${t("Suivi des campagnes organiques")}</h2>
        <p>${t("Fixez des objectifs par requête et comparez-les aux données Search Console mesurées sur 28 jours.")}</p>
        <div data-oct-state role="status" aria-live="polite">${t("Chargement des campagnes…")}</div>
      </section>`;
      const state = root.querySelector("[data-oct-state]");
      try {
        const data = await window.apiAction("GET", "/api/organic-campaign-tracker");
        const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
        const rows = campaigns.map(campaign => {
          const status = statusLabels[campaign.status] || ["⚪", campaign.status || ""];
          const clicks = campaign.clicks === null ? "—" : esc(campaign.clicks);
          const position = campaign.averagePosition === null ? "—" : Number(campaign.averagePosition).toFixed(1);
          const actuals = campaign.status === "no_data"
            ? t("Aucune mesure GSC pour cette requête sur la période.")
            : `${clicks} ${t("clics")} · ${position} ${t("position moyenne")}`;
          return `<article class="fp-card" data-campaign="${esc(campaign.id)}">
            <div class="fp-flex fp-justify-between fp-align-center">
              <h3>${esc(campaign.keyword)}</h3>
              <button type="button" class="fp-btn fp-btn-ghost fp-btn-sm" data-oct-delete="${esc(campaign.id)}">${t("Supprimer")}</button>
            </div>
            <p>${status[0]} ${t(status[1])}</p>
            <p>${t("Objectif")}: ${t("position")} ≤ ${esc(campaign.targetPosition)} · ≥ ${esc(campaign.minimumClicks)} ${t("clics")}</p>
            <p>${actuals}</p>
            ${campaign.observedAt ? `<small>${t("Dernière mesure")}: ${esc(campaign.observedAt)}</small>` : ""}
          </article>`;
        }).join("");
        state.innerHTML = `<form data-oct-form>
          <div class="fp-grid fp-grid-2">
            <label>${t("Mot-clé")}
              <input class="fp-input" name="keyword" required maxlength="160" />
            </label>
            <label>${t("Position cible")}
              <input class="fp-input" name="targetPosition" type="number" min="0.1" step="0.1" required />
            </label>
            <label>${t("Clics minimum (28 jours)")}
              <input class="fp-input" name="minimumClicks" type="number" min="0" step="1" value="0" required />
            </label>
          </div>
          <button class="fp-btn fp-btn-primary" type="submit">${t("Enregistrer l’objectif")}</button>
          <div data-oct-message role="status" aria-live="polite"></div>
        </form>
        <h3>${t("Campagnes suivies")} (${campaigns.length})</h3>
        ${rows ? `<div class="fp-grid fp-grid-2">${rows}</div>` : `<p>${t("Aucun objectif enregistré.")}</p>`}`;
        state.querySelector("[data-oct-form]")?.addEventListener("submit", async event => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = Object.fromEntries(new FormData(form).entries());
          const message = state.querySelector("[data-oct-message]");
          try {
            await window.apiAction("POST", "/api/organic-campaign-tracker", {
              ...values, targetPosition: Number(values.targetPosition), minimumClicks: Number(values.minimumClicks),
            });
            await load();
            const savedMessage = root.querySelector("[data-oct-message]");
            if (savedMessage) savedMessage.textContent = t("Objectif enregistré.");
          } catch (error) {
            message.setAttribute("role", "alert");
            message.textContent = String(error?.message || t("Impossible d’enregistrer cet objectif."));
          }
        });
        state.querySelectorAll("[data-oct-delete]").forEach(button => {
          button.addEventListener("click", async () => {
            try {
              await window.apiAction("DELETE", `/api/organic-campaign-tracker/${encodeURIComponent(button.dataset.octDelete)}`);
              await load();
            } catch (error) {
              const message = root.querySelector("[data-oct-message]");
              if (message) {
                message.setAttribute("role", "alert");
                message.textContent = String(error?.message || t("Impossible de supprimer cet objectif."));
              }
            }
          });
        });
      } catch (error) {
        state.setAttribute("role", "alert");
        state.innerHTML = `<p>${esc(String(error?.message || t("Impossible de charger les campagnes.")))}</p>
          <button class="fp-btn fp-btn-ghost" type="button" data-oct-retry>${t("Réessayer")}</button>`;
        state.querySelector("[data-oct-retry]")?.addEventListener("click", load);
      }
    };
    await load();
  };
})();
