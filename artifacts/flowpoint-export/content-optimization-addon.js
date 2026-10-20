(function () {
  'use strict';

  const buttonId = 'audit-panel-content-optimization';
  const resultId = 'audit-panel-content-optimization-result';

  function escapeText(value) {
    return String(value == null ? '' : value);
  }

  function currentAudit(button) {
    const audits = window.STATE && Array.isArray(window.STATE.audits) ? window.STATE.audits : [];
    let node = button;
    while (node) {
      const text = node.textContent || '';
      const audit = audits.find(item => item && item.url && text.includes(item.url));
      if (audit) return audit;
      node = node.parentElement;
    }
    return null;
  }

  function showMetric(parent, label, value) {
    const span = document.createElement('span');
    span.textContent = label + ': ';
    const strong = document.createElement('strong');
    strong.textContent = escapeText(value);
    span.appendChild(strong);
    parent.appendChild(span);
  }

  function mount() {
    const rerun = document.getElementById('audit-panel-rerun');
    const addonEnabled = !!window.STATE?.me?.addons?.advancedSeoLab;
    if (!rerun || !addonEnabled || document.getElementById(buttonId)) return;

    const actionGroup = rerun.parentElement;
    if (!actionGroup) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding:10px;background:var(--fp-inner-card);border:1px solid var(--fp-border);border-radius:8px';

    const button = document.createElement('button');
    button.id = buttonId;
    button.className = 'fp-btn fp-btn-ghost fp-btn-sm';
    button.style.width = '100%';
    button.textContent = 'Optimisation de contenu SEO';

    const result = document.createElement('div');
    result.id = resultId;
    result.setAttribute('aria-live', 'polite');
    result.style.marginTop = '8px';
    wrapper.append(button, result);
    actionGroup.insertBefore(wrapper, rerun);

    button.addEventListener('click', async () => {
      const audit = currentAudit(button);
      if (!audit || !audit.url) {
        result.textContent = 'Impossible de retrouver l’URL de cet audit.';
        return;
      }
      if (!window.confirm('Cette analyse utilise le quota DataForSEO. Continuer ?')) return;

      button.disabled = true;
      button.textContent = 'Analyse en cours…';
      result.textContent = '';
      try {
        const data = await window.apiAction('POST', '/api/seo/content-optimization', { url: audit.url });
        if (!data || data.error) throw new Error(data?.error || 'Analyse indisponible');

        const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];
        const score = Number(data.score);
        const wordCount = Number(data.wordCount);
        const headings = Number(data.headings);
        if (!Number.isFinite(score) || (!score && !wordCount && !headings && !recommendations.length)) {
          result.textContent = 'Aucune donnée disponible pour cette page.';
          return;
        }

        const metrics = document.createElement('div');
        metrics.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;font-size:11px;color:var(--fp-text-soft)';
        showMetric(metrics, 'Score contenu', score + '/100');
        showMetric(metrics, 'Mots', wordCount);
        showMetric(metrics, 'Titres', headings);
        result.appendChild(metrics);

        if (recommendations.length) {
          const list = document.createElement('ul');
          list.style.cssText = 'margin:0;padding-left:18px;font-size:11px;line-height:1.6;color:var(--fp-text-muted)';
          recommendations.forEach(item => {
            const li = document.createElement('li');
            li.textContent = escapeText(item);
            list.appendChild(li);
          });
          result.appendChild(list);
        }
      } catch (error) {
        result.textContent = 'Analyse indisponible. Vérifiez la configuration du service et réessayez.';
      } finally {
        button.disabled = false;
        button.textContent = 'Optimisation de contenu SEO';
      }
    });
  }

  mount();
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
})();
