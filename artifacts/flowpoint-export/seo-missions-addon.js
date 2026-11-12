(function () {
      'use strict';
      const t = key => typeof window.fpT === 'function' ? window.fpT(key) : key;
      window._generateLocalMissions = async function () {
        const state = window.STATE || {};
        const site = state.me?.domain || state.currentDomain || state.audits?.find(a => a && a.url)?.url || '';
        let domain = '';
        try { domain = new URL(/^https?:\/\//i.test(site) ? site : 'https://' + site).hostname.replace(/^www\./i, ''); } catch (_) {}
        if (!domain) { window.showToast?.('warning', t('Aucun domaine disponible pour générer les missions.')); return; }
        if (!window.confirm(t('Cette action utilise le quota DataForSEO. Continuer ?'))) return;
        window.showToast?.('info', t('Génération des missions SEO…'));
        try {
          const result = await window.apiAction('POST', '/api/seo/generate-missions', { domain });
          if (!result || result.ok !== true || !Array.isArray(result.missions)) throw new Error(result?.error || t('Génération indisponible'));
          const created = [];
          for (const item of result.missions.slice(0, 5)) {
            const keyword = String(item?.keyword || '').trim();
            if (!keyword) continue;
            const title = t('Créer du contenu optimisé pour') + ' ' + keyword;
            const existing = (state.missions || []).find(m => String(m.title || '').toLowerCase() === title.toLowerCase() && m.status !== 'done');
            if (existing) continue;
            const payload = { title, category: 'SEO', source: 'dataforseo', status: 'todo', priority: Number(item.difficulty) < 35 ? 'high' : 'medium', impact: 'SEO', steps: Array.isArray(item.actionPlan) ? item.actionPlan : [] };
            const saved = await window.apiAction('POST', '/api/missions', payload);
            if (saved?.id) { if (!state.missions) state.missions = []; state.missions.unshift({ ...payload, id: saved.id, createdAt: saved.createdAt || new Date().toISOString() }); created.push(saved); }
          }
          if (!created.length) { window.showToast?.('warning', t('Aucune nouvelle mission SEO à créer.')); return; }
          window.showToast?.('success', created.length + ' ' + t('missions SEO créées.'));
          window.navigate?.('missions');
        } catch (error) { window.showToast?.('error', error?.message || t('Génération indisponible')); }
      };
    })();
    