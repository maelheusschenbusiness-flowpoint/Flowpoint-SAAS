(function () {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const t = value => typeof window.fpT === "function" ? window.fpT(value) : value;
  const statusLabels = {
    verified_resolved: ["✅", "Résolu selon le nouvel audit"],
    improved: ["🟠", "Amélioration mesurée"],
    still_present: ["🔴", "Toujours présent"],
    baseline_issue_not_found: ["ℹ️", "Aucun problème dans l’audit de référence"],
    not_comparable: ["⚪", "Audits non comparables"],
  };
  const auditLabel = audit => `${new Date(audit.created_at).toLocaleString()} · ${audit.url} · ${audit.issues} ${t("problèmes")}`;
  window.FP_ADDON_RENDERERS = window.FP_ADDON_RENDERERS || {};
  window.FP_ADDON_RENDERERS.technicalSeoFixVerification = async function renderTechnicalSEOFixVerification(root) {
    if (!root) return;
    const load = async () => {
      root.innerHTML = `<section class="fp-card" aria-labelledby="tsfv-title">
        <h2 id="tsfv-title" class="fp-card-title">${t("Vérification SEO technique")}</h2>
        <p>${t("Comparez le nombre total de problèmes entre deux audits terminés de la même URL.")}</p>
        <p class="fp-muted">${t("Les audits enregistrent un total agrégé, pas le détail par règle. La comparaison ne confirme donc pas une correction spécifique.")}</p>
        <div data-tsfv-state role="status" aria-live="polite">${t("Chargement des audits…")}</div>
      </section>`;
      const state = root.querySelector("[data-tsfv-state]");
      try {
        const data = await window.apiAction("GET", "/api/technical-seo-fix-verification");
        const audits = Array.isArray(data.audits) ? data.audits : [];
        const latest = audits[0];
        const baseline = latest && audits.find(audit =>
          audit.url === latest.url && new Date(audit.created_at) < new Date(latest.created_at),
        );
        const options = selectedId => audits.map(audit =>
          `<option value="${esc(audit.id)}" ${audit.id === selectedId ? "selected" : ""}>${esc(auditLabel(audit))}</option>`,
        ).join("");
        const history = (data.verifications || []).map(item => {
          const status = statusLabels[item.status] || ["⚪", item.status];
          return `<li>${esc(item.url)} — ${status[0]} ${t(status[1])}
            (${esc(item.before_issue_count)} → ${esc(item.after_issue_count)} ${t("problèmes")})</li>`;
        }).join("");
        state.innerHTML = `${audits.length < 2 ? `<p>${t("Il faut au moins deux audits terminés pour comparer une URL.")}</p>` : `
          <form data-tsfv-form>
            <label>${t("Audit de référence")}
              <select class="fp-input" name="beforeAuditId" required>${options(baseline?.id)}</select>
            </label>
            <label>${t("Audit après la correction")}
              <select class="fp-input" name="afterAuditId" required>${options(latest?.id)}</select>
            </label>
            <button class="fp-btn fp-btn-primary" type="submit">${t("Comparer les audits")}</button>
            <div data-tsfv-message role="status" aria-live="polite"></div>
          </form>`}
          ${history ? `<h3>${t("Comparaisons enregistrées")}</h3><ul>${history}</ul>` : ""}`;
        state.querySelector("[data-tsfv-form]")?.addEventListener("submit", async event => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget).entries());
          const message = state.querySelector("[data-tsfv-message]");
          try {
            const response = await window.apiAction("POST", "/api/technical-seo-fix-verification/verify", values);
            await load();
            const status = statusLabels[response.result?.status] || ["⚪", response.result?.status || ""];
            const output = root.querySelector("[data-tsfv-message]");
            if (output) {
              output.textContent = `${status[0]} ${t(status[1])} — ${response.result?.beforeIssueCount} → ${response.result?.afterIssueCount} ${t("problèmes")}`;
            }
          } catch (error) {
            message.setAttribute("role", "alert");
            message.textContent = String(error?.message || t("Impossible de comparer ces audits."));
          }
        });
      } catch (error) {
        state.setAttribute("role", "alert");
        state.innerHTML = `<p>${esc(String(error?.message || t("Impossible de charger les audits.")))}</p>
          <button class="fp-btn fp-btn-ghost" type="button" data-tsfv-retry>${t("Réessayer")}</button>`;
        state.querySelector("[data-tsfv-retry]")?.addEventListener("click", load);
      }
    };
    await load();
  };
})();
