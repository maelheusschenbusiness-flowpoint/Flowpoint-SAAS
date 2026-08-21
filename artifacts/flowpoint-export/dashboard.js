               <div style="width:8px;height:8px;border-radius:50%;background:var(--fp-success)"></div>
                <div style="flex:1">
                  <div style="font-size:12px;font-weight:600">${escHtml(s.email || s.user_id || '—')}</div>
                  <div style="font-size:10px;color:var(--fp-text-faint)">${s.provider || ''} · ${s.ip_address || ''} · ${s.last_active_at ? 'Actif ' + new Date(s.last_active_at).toLocaleString(getLocale(),{hour:'2-digit',minute:'2-digit'}) : ''}</div>
                </div>
                <button class="fp-btn fp-btn-ghost fp-btn-sm" style="font-size:10px;color:var(--fp-danger)" onclick="window.FP_SSO_API && apiFetch('/api/sso/sessions/${s.id}/invalidate',{method:'POST',body:JSON.stringify({})}).then(()=>{showToast('success', fpT('Session révoquée'));window.FP_SSO_API.load();render(STATE.currentSection)})">Révoquer</button>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `}

    <!-- SSO PROVIDER MODAL -->
    <div id="fp-sso-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:1000;align-items:center;justify-content:center">
      <div class="fp-card" style="width:460px;max-width:92vw;padding:24px">
        <div id="fp-sso-modal-title" style="font-size:16px;font-weight:700;margin-bottom:16px">🔐 Configurer SSO</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input id="sso-name" class="fp-input" placeholder="Nom (ex: Google Workspace ACME)"/>
          <input id="sso-domain" class="fp-input" placeholder="Domaine (ex: acme.com)"/>
          <input id="sso-client-id" class="fp-input" placeholder="Client ID / Entity ID"/>
          <input id="sso-client-secret" class="fp-input" type="password" placeholder="Client Secret / Certificate"/>
          <input id="sso-metadata-url" class="fp-input" placeholder="Metadata URL (SAML) ou Authorization URL"/>
          <div style="font-size:10px;color:var(--fp-text-faint);padding:8px;background:rgba(37,99,235,0.06);border-radius:8px;border:1px solid rgba(37,99,235,0.15)">
            ℹ️ En production, le flux SSO redirige vers votre Identity Provider pour authentification sécurisée.
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="fp-btn fp-btn-ghost" onclick="document.getElementById('fp-sso-modal').style.display='none'">Annuler</button>
          <button class="fp-btn fp-btn-primary" onclick="window._submitSSOProvider()">Configurer</button>
        </div>
      </div>
    </div>
    <script>
    window._ssoTab = window._ssoTab || 'providers';
    window._currentSSOType = null;
    window._showSSOProviderModal = function(type, name) {
      window._currentSSOType = type || 'google_workspace';
      document.getElementById('fp-sso-modal-title').textContent = '🔐 Configurer ' + (name || 'SSO');
      document.getElementById('fp-sso-modal').style.display = 'flex';
    };
    window._submitSSOProvider = async function() {
      const name = document.getElementById('sso-name').value.trim();
      const domain = document.getElementById('sso-domain').value.trim();
      const clientId = document.getElementById('sso-client-id').value.trim();
      const secret = document.getElementById('sso-client-secret').value.trim();
      const metadataUrl = document.getElementById('sso-metadata-url').value.trim();
      if (!name) { showToast('error', fpT('Nom requis')); return; }
      showToast('info', fpT('Configuration SSO en cours…'));
      try {
        const r = await window.FP_SSO_API.createProvider({ providerType: window._currentSSOType, name, domain, clientId, clientSecret: secret, metadataUrl });
        if (r?.ok) {
          document.getElementById('fp-sso-modal').style.display = 'none';
          showToast('success', fpT('Provider SSO configuré !'));
          await window.FP_SSO_API.load();
          render(STATE.currentSection);
        } else showToast('error', r?.error || 'Erreur');
      } catch(e) { showToast('error', String(e)); }
    };
    </script>
  `;
}


// ═══════════════════════════════════════════════════════════════════════════════
// FP COMPETITORS API — Real competitor tracking client
// ═══════════════════════════════════════════════════════════════════════════════
window.FP_COMPETITORS_API = {
  async load() {
    try {
      const data = await apiFetch('/api/competitors').catch(() => null);
      if (!Array.isArray(data)) return null;
      // Normalize: expose domainRating also as score for backward compat
      const normalized = data.map(c => ({
        ...c,
        score: c.score ?? c.domainRating ?? 0,
      }));
      window.FP_DATA = window.FP_DATA || {};
      window.FP_DATA.competitors = normalized;
      return normalized;
    } catch(e) { console.warn('[FP_COMPETITORS_API] load error:', e); return null; }
  },
  async refresh(id) {
    try {
      // Calls the real server-side refresh endpoint that re-fetches DataForSEO data.
      const r = await apiFetch('/api/competitors/' + id + '/refresh', { method: 'POST' }).catch(() => null);
      if (!r) return null;
      return { ...r, score: r.score ?? r.domainRating ?? 0, dataStatus: r.dataStatus || 'available' };
    } catch(e) { console.warn('[FP_COMPETITORS_API] refresh error:', e); return null; }
  },
  async create(payload) {
    try {
      const r = await apiFetch('/api/competitors', { method: 'POST', body: JSON.stringify(payload) });
      if (r && r.id) {
        const c = { ...r, score: r.score ?? r.domainRating ?? 0 };
        STATE.competitors = [...(STATE.competitors || []), c];
        render();
      }
      return r;
    } catch(e) { console.warn('[FP_COMPETITORS_API] create error:', e); return null; }
  },
  async update(id, patch) {
    try {
      return await apiFetch('/api/competitors/' + id, { method: 'PATCH', body: JSON.stringify(patch) });
    } catch(e) { console.warn('[FP_COMPETITORS_API] update error:', e); return null; }
  },
  async delete(id) {
    try {
      await apiFetch('/api/competitors/' + id, { method: 'DELETE' });
      STATE.competitors = (STATE.competitors || []).filter(c => c.id !== id);
      render();
    } catch(e) { console.warn('[FP_COMPETITORS_API] delete error:', e); }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// FP CONNECTORS API — Real integration connector client
// ═══════════════════════════════════════════════════════════════════════════════
window.FP_CONNECTORS_API = {
  async load() {
    try {
      const data = await apiFetch('/api/connectors').catch(() => null);
      if (!Array.isArray(data)) return null;
      window.FP_DATA = window.FP_DATA || {};
      window.FP_DATA.connectors = data;
      return data;
    } catch(e) { console.warn('[FP_CONNECTORS_API] load error:', e); return null; }
  },
  async connect(provider, payload) {
    try {
      return await apiFetch('/api/connectors/' + provider + '/connect', { method: 'POST', body: JSON.stringify(payload || {}) });
    } catch(e) { console.warn('[FP_CONNECTORS_API] connect error:', e); return null; }
  },
  async disconnect(provider) {
    try {
      const r = await apiFetch('/api/connectors/' + provider + '/disconnect', { method: 'POST', body: '{}' });
      const conns = await this.load();
      if (conns) { STATE.connectors = conns; render(); }
      return r;
    } catch(e) { console.warn('[FP_CONNECTORS_API] disconnect error:', e); return null; }
  },
  async sync(provider) {
    try {
      return await apiFetch('/api/connectors/' + provider + '/sync', { method: 'POST', body: '{}' });
    } catch(e) { console.warn('[FP_CONNECTORS_API] sync error:', e); return null; }
  },
  isConnected(provider) {
    const conn = (STATE.connectors || []).find(c => c.provider === provider);
    return !!(conn && (conn.connected || conn.status === 'connected' || conn.status === 'active'));
  },
};

// ══════════════════════════════════════════════════════════════════════
// DATA EXPLORER API MODULE — real data from /api/data-explorer/*
// No synthetic values. No Math.random(). No PREVIEW_MODE.
// ══════════════════════════════════════════════════════════════════════
window._fpDEState = { loading: false, loaded: false, source: 'audits', days: 30, limit: 50, offset: 0, sort: null, sortDir: 'desc', filter: '', data: null, sources: null, error: null };

window._fpDataExplorerAPI = {
  async loadSources() {
    try {
      const s = await apiFetch('/api/data-explorer/sources').catch(() => null);
      if (Array.isArray(s)) { window._fpDEState.sources = s; render(); }
    } catch(e) { console.warn('[DE] sources error', e); }
  },
  async query(opts) {
    const st = window._fpDEState;
    const source = (opts && opts.source) || st.source || 'audits';
    const days   = (opts && opts.days)   || st.days   || 30;
    const limit  = (opts && opts.limit)  || st.limit  || 50;
    const offset = (opts && opts.offset != null ? opts.offset : st.offset) || 0;
    const sort   = (opts && opts.sort)   || st.sort   || '';
    const sortDir = (opts && opts.sortDir)|| st.sortDir|| 'desc';
    const filter  = (opts && opts.filter != null ? opts.filter : st.filter) || '';
    window._fpDEState = { ...window._fpDEState, loading: true, source, days, limit, offset, sort, sortDir, filter, error: null };
    render();
    try {
      const params = new URLSearchParams({ source, days: String(days), limit: String(limit), offset: String(offset) });
      if (sort) params.set('sort', sort);
      params.set('sortDir', sortDir);
      if (filter) params.set('filter', filter);
      const data = await apiFetch('/api/data-explorer/query?' + params.toString());
      window._fpDEState = { ...window._fpDEState, loading: false, loaded: true, data, error: null };
    } catch(e) {
      window._fpDEState = { ...window._fpDEState, loading: false, loaded: true, error: e.message || String(e) };
    }
    render();
  },
  async loadAll(source) {
    if (!window._fpDEState.sources) await this.loadSources();
    await this.query({ source: source || window._fpDEState.source });
  },
  setSource(source) { this.query({ source, offset: 0 }); },
  setDays(days) { this.query({ days: parseInt(days, 10), offset: 0 }); },
  setFilter(filter) { this.query({ filter, offset: 0 }); },
  setSort(col) {
    const st = window._fpDEState;
    const dir = (st.sort === col && st.sortDir === 'desc') ? 'asc' : 'desc';
    this.query({ sort: col, sortDir: dir });
  },
  nextPage() {
    const st = window._fpDEState;
    const newOffset = (st.offset || 0) + (st.limit || 50);
    if (st.data && newOffset < (st.data.total || 0)) this.query({ offset: newOffset });
  },
  prevPage() {
    const st = window._fpDEState;
    const newOffset = Math.max(0, (st.offset || 0) - (st.limit || 50));
    this.query({ offset: newOffset });
  },
  exportData(format) {
    const st = window._fpDEState;
    const params = new URLSearchParams({ source: st.source || 'audits', days: String(st.days || 30), format: format || 'csv' });
    if (st.filter) params.set('filter', st.filter);
    const token = _fpCurrentSessionToken();
    const a = document.createElement('a');
    a.href = '/api/data-explorer/export?' + params.toString();
    a.download = 'data-explorer-' + st.source + '.' + (format || 'csv');
    if (token) a.href += '&__token=' + encodeURIComponent(token);
    a.click();
    showToast('info', 'Export ' + (format || 'csv').toUpperCase() + ' en cours…');
  },
  refresh() { this.query(); },
};

// ══════════════════════════════════════════════════════════════════════
// REPORTS API MODULE — fetch from /api/reports routes
// No synthetic values. No Math.random(). No PREVIEW_MODE.
// ══════════════════════════════════════════════════════════════════════
window._fpReportsState = { loading: false, loaded: false, reports: null, error: null };

const FP_REPORT_TEMPLATES = {
  seo:        { label: 'Rapport SEO', icon: '📊', color: '#2563EB' },
  executive:  { label: 'Rapport Exécutif', icon: '📋', color: '#8b5cf6' },
  monitoring: { label: 'Monitoring SLA', icon: '⚡', color: '#22c55e' },
  conversion: { label: 'Rapport Conversion', icon: '🎯', color: '#f59e0b' },
  local:      { label: 'Local SEO', icon: '📍', color: '#0ea5e9' },
  ai:         { label: 'Rapport IA Lab', icon: '🤖', color: '#ec4899' },
};

window._fpReportsAPI = {
  async load(opts) {
    window._fpReportsState = { ...window._fpReportsState, loading: true, error: null };
    render(); // debounced — shows skeleton while fetching
    try {
      // force:true clears _apiFetchCache + _apiFetchInFlight for /api/reports,
      // guaranteeing a real network GET after any mutation (not stale cached data).
      const data = await apiFetch('/api/reports', { force: !!(opts && opts.force) });
      window._fpReportsState = { loading: false, loaded: true, reports: Array.isArray(data) ? data : [], error: null };
      // renderReports(), the activity feed and Mode Client use the canonical
      // dashboard state. Keep it in sync after every real list refresh so
      // creating from a template is indistinguishable from "Nouveau".
      STATE.reports = window._fpReportsState.reports;
      if (window._fpCMState && window._fpCMState.loaded) {
        window._fpCMState.reports = STATE.reports.filter(function(report) { return !!report.shared; });
      }
    } catch(e) {
      window._fpReportsState = { ...window._fpReportsState, loading: false, loaded: true, error: e.message || String(e) };
    }
    // Cancel any pending debounced render and fire immediately so the
    // freshly-loaded list is visible without waiting for the 30ms timer.
    if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }
    _doRender();
  },
  async create(payload) {
    try {
      const r = await apiFetch('/api/reports', { method: 'POST', body: JSON.stringify(payload || {}) });
      if (!r || !r.id) throw new Error('Le serveur n’a pas renvoyé de rapport créé.');
      await this.load({ force: true }); // bypass cache — real GET after mutation
      if (!(window._fpReportsState.reports || []).some(function(report) { return report.id === r.id; })) {
        throw new Error('Le rapport créé est introuvable après actualisation.');
      }
      // The server records the persistent activity event asynchronously. Add
      // the same event to the in-memory feed now so template creation updates
      // Recent reports, Client Mode *and* Activity in one interaction rather
      // than waiting for the next activity polling cycle.
      pushActivityEvent({
        id: 'local-report-' + r.id,
        type: 'report',
        label: 'Rapport généré : ' + String(r.name || payload?.name || 'Rapport'),
        targetId: r.id,
        targetType: 'report',
        metadata: { name: r.name || payload?.name || 'Rapport', templateKey: payload?.templateKey || null },
        createdAt: new Date().toISOString(),
      });
      showToast('success', fpT('Rapport créé !'));
      return r;
    } catch(e) { showToast('error', fpT('Erreur création rapport')); return null; }
  },
  createTemplate(templateKey) {
    const template = FP_REPORT_TEMPLATES[templateKey];
    if (!template) {
      showToast('error', fpT('Template de rapport indisponible'));
      return Promise.resolve(null);
    }
    return this.create({
      name: template.label + ' — ' + new Date().toLocaleDateString(getLocale()),
      format: 'PDF',
      templateKey: templateKey,
    });
  },
  async delete(id, name) {
    window.fpDarkConfirm('Supprimer le rapport "' + (name || id) + '" ?', async () => {
      try {
        await apiFetch('/api/reports/' + id, { method: 'DELETE' });
        await this.load({ force: true }); // bypass cache — real GET after mutation
        if ((window._fpReportsState.reports || []).some(function(report) { return report.id === id; })) {
          throw new Error('Le rapport supprimé est encore présent après actualisation.');
        }
        showToast('success', fpT('Rapport supprimé'));
      } catch(e) { showToast('error', fpT('Erreur suppression')); }
    }, 'Supprimer le rapport');
  },
  async share(id) {
    try {
      const r = await apiFetch('/api/reports/' + id + '/share', { method: 'POST', body: '{}' });
      if (!r || !r.token || !r.path) throw new Error('Le serveur n’a pas renvoyé de lien de partage.');
      const url = new URL(r.path, window.location.origin).toString();
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (_) {
        window.prompt(fpT('Copiez ce lien de partage'), url);
      }
      await this.load({ force: true }); // bypass cache — KPI partagés mis à jour immédiatement
      showToast(copied ? 'success' : 'info', copied ? fpT('Lien de partage copié') : fpT('Lien de partage généré'));
      return { ...r, url: url };
    } catch(e) { showToast('error', fpT('Erreur partage')); return null; }
  },
  downloadPdf(id, name) {
    const token = _fpCurrentSessionToken();
    fetch('/api/reports/' + id + '/download', _fpSessionFetchOptions())
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function(blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (name || 'rapport') + '.pdf';
        a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
        showToast('info', fpT('Téléchargement PDF…'));
      })
      .catch(function() { showToast('error', fpT('Téléchargement impossible')); });
  },
  refresh() { return this.load(); },
};

// ══════════════════════════════════════════════════════════════════════
// CLIENT MODE API MODULE — fetch from /api/client-mode/*
// No synthetic values. No Math.random(). No PREVIEW_MODE.
// ══════════════════════════════════════════════════════════════════════
window._fpCMState = { loading: false, loaded: false, status: null, kpis: null, reports: null, audits: null, error: null };

window._fpClientModeAPI = {
  async loadAll() {
    window._fpCMState = { ...window._fpCMState, loading: true, error: null };
    render();
    try {
      const [status, kpis, reports, audits] = await Promise.all([
        apiFetch('/api/client-mode/status').catch(() => null),
        apiFetch('/api/client-mode/kpis').catch(() => null),
        apiFetch('/api/client-mode/reports').catch(() => []),
        apiFetch('/api/client-mode/audits').catch(() => []),
      ]);
      window._fpCMState = { loading: false, loaded: true, status, kpis, reports: Array.isArray(reports) ? reports : [], audits: Array.isArray(audits) ? audits : [], error: null };
    } catch(e) {
      window._fpCMState = { ...window._fpCMState, loading: false, loaded: true, error: e.message || String(e) };
    }
    render();
  },
  refresh() { return this.loadAll(); },
};

// ══════════════════════════════════════════════════════════════════════
// renderGA4DataExplorer — Data Explorer real data
// ══════════════════════════════════════════════════════════════════════
function renderGA4DataExplorer() {
  const st = window._fpDEState || {};
  if (!st.loaded && !st.loading) setTimeout(() => window._fpDataExplorerAPI.loadAll(), 60);

  const sources = st.sources || [];
  const data = st.data;
  const sub = STATE.subRoute;

  const sourceLabel = (src) => {
    const found = sources.find(s => s.source === src);
    return found ? found.label : src;
  };

  const sourcesByCategory = sources.reduce((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});

  const header = `
    <div class="fp-section-header" style="margin-bottom:16px">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:var(--fp-text)">🔍 Data Explorer</h1>
        <p style="font-size:12px;color:var(--fp-text-muted);margin-top:2px">Explorez vos données GA4, Search Console et FlowPoint en temps réel</p>
      </div>
    </div>`;

  if (st.loading && !data) {
    return header + `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${Array.from({length:3},()=>'<div class="fp-skel-block" style="height:64px;border-radius:10px"></div>').join('')}
        <div class="fp-skel-block" style="height:240px;border-radius:10px"></div>
      </div>`;
  }

  if (st.error && !data) {
    return header + `
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:36px;margin-bottom:12px">⚠️</div>
        <div style="font-size:14px;font-weight:600;color:var(--fp-text);margin-bottom:6px">Erreur de chargement</div>
        <div style="font-size:12px;color:var(--fp-text-muted);margin-bottom:16px">${escHtml(String(st.error))}</div>
        <button class="fp-btn fp-btn-primary fp-btn-sm" onclick="window._fpDataExplorerAPI.refresh()">🔄 Réessayer</button>
      </div>`;
  }

  const controlsRow = `
    <div class="fp-card fp-mb-20" style="padding:12px 16px">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <div style="flex:1;min-width:200px">
          <label style="font-size:10px;font-weight:600;color:var(--fp-text-faint);display:block;margin-bottom:4px">SOURCE DE DONNÉES</label>
          <select class="fp-select" style="width:100%;font-size:12px" onchange="window._fpDataExplorerAPI.setSource(this.value)">
            ${Object.entries(sourcesByCategory).map(([cat, srcs]) => `
              <optgroup label="${escHtml(cat)}">
                ${srcs.map(s => `<option value="${escHtml(s.source)}" ${s.source === (st.source||'audits') ? 'selected' : ''}>${escHtml(s.label)}</option>`).join('')}
              </optgroup>
            `).join('')}
            ${sources.length === 0 ? `<option value="audits" selected>Audits SEO</option><option value="monitors">Monitors uptime</option><option value="missions">Missions</option>` : ''}
          </select>
        </div>
        <div>
          <label style="font-size:10px;font-weight:600;color:var(--fp-text-faint);display:block;margin-bottom:4px">PÉRIODE</label>
          <select class="fp-select" style="font-size:12px" onchange="window._fpDataExplorerAPI.setDays(this.value)">
            <option value="7"  ${(st.days||30)===7  ?'selected':''}>7 jours</option>
            <option value="30" ${(st.days||30)===30 ?'selected':''}>30 jours</option>
            <option value="90" ${(st.days||30)===90 ?'selected':''}>90 jours</option>
            <option value="180"${(st.days||30)===180?'selected':''}>6 mois</option>
            <option value="365"${(st.days||30)===365?'selected':''}>12 mois</option>
          </select>
        </div>
        <div style="flex:1;min-width:160px">
          <label style="font-size:10px;font-weight:600;color:var(--fp-text-faint);display:block;margin-bottom:4px">FILTRE</label>
          <input class="fp-input" style="width:100%;font-size:12px" placeholder="Filtrer les résultats…" value="${escHtml(st.filter||'')}" oninput="clearTimeout(window._fpDEFilterTimer);window._fpDEFilterTimer=setTimeout(()=>window._fpDataExplorerAPI.setFilter(this.value),500)"/>
        </div>
        <div style="display:flex;gap:6px;align-items:flex-end">
          <button class="fp-btn fp-btn-primary fp-btn-sm" onclick="window._fpDataExplorerAPI.refresh()" ${st.loading?'disabled':''}>
            ${st.loading?'<span style="opacity:0.7">⏳ Chargement…</span>':'🔄 Actualiser'}
          </button>
        </div>
      </div>
    </div>`;

  const exportRow = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:12px;color:var(--fp-text-muted)">
        ${data ? `<strong>${data.total}</strong> résultat${data.total>1?'s':''} — <span style="color:var(--fp-text-faint)">${escHtml(sourceLabel(st.source||'audits'))}</span>` : ''}
      </div>
      <div style="display:flex;gap:6px">
        <button class="fp-btn fp-btn-ghost fp-btn-sm" onclick="window._fpDataExplorerAPI.exportData('csv')">⬇ CSV</button>
        <button class="fp-btn fp-btn-ghost fp-btn-sm" onclick="window._fpDataExplorerAPI.exportData('json')">⬇ JSON</button>
      </div>
    </div>`;

  if (!data || !data.rows) {
    return header + controlsRow + `
      <div style="text-align:center;padding:60px 20px;background:var(--fp-card);border-radius:var(--fp-radius-lg);border:1px solid var(--fp-border)">
        <div style="font-size:36px;margin-bottom:12px">🔍</div>
        <div style="font-size:14px;font-weight:600;color:var(--fp-text);margin-bottom:6px">Sélectionnez une source de données</div>
        <div style="font-size:12px;color:var(--fp-text-muted)">Choisissez une source ci-dessus pour explorer vos données</div>
      </div>`;
  }

  if (data.rows.length === 0) {
    return header + controlsRow + exportRow + `
      <div style="text-align:center;padding:60px 20px;background:var(--fp-card);border-radius:var(--fp-radius-lg);border:1px solid var(--fp-border)">
        <div style="font-size:36px;margin-bottom:12px">📭</div>
        <div style="font-size:14px;font-weight:600;color:var(--fp-text);margin-bottom:6px">Aucune donnée disponible</div>
        <div style="font-size:12px;color:var(--fp-text-muted)">
          ${st.filter ? 'Aucun résultat pour ce filtre.' : 'Aucune donnée pour cette source sur la période sélectionnée.'}
        </div>
        ${st.filter ? `<button class="fp-btn fp-btn-ghost fp-btn-sm" style="margin-top:12px" onclick="window._fpDataExplorerAPI.setFilter('')">Réinitialiser le filtre</button>` : ''}
      </div>`;
  }

  const cols = data.columns || [];
  const rows = data.rows || [];
  const total = data.total || rows.length;
  const limit = st.limit || 50;
  const offset = st.offset || 0;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  const tableHtml = `
    <div class="fp-card fp-mb-20">
      ${exportRow}
      <div style="overflow-x:auto">
        <table class="fp-data-table">
          <thead>
            <tr>
              ${cols.map(col => {
                const isActive = st.sort === col.key;
                const icon = isActive ? (st.sortDir === 'asc' ? '↑' : '↓') : '↕';
                return `<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="window._fpDataExplorerAPI.setSort('${escHtml(col.key)}')">
                  ${escHtml(col.label)} <span style="opacity:${isActive?1:0.4};font-size:10px">${icon}</span>
                </th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                ${cols.map(col => {
                  const v = row[col.key];
                  const isNum = col.type === 'number';
                  const disp = v == null ? '<span style="color:var(--fp-text-faint)">—</span>' : escHtml(String(typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString(getLocale()) : v.toLocaleString(getLocale(), {maximumFractionDigits:2})) : v));
                  return `<td style="text-align:${isNum?'right':'left'};font-variant-numeric:tabular-nums">${disp}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${totalPages > 1 ? `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid var(--fp-border)">
          <button class="fp-btn fp-btn-ghost fp-btn-sm" ${page<=1?'disabled':''} onclick="window._fpDataExplorerAPI.prevPage()">← Précédent</button>
          <span style="font-size:12px;color:var(--fp-text-muted)">Page ${page} / ${totalPages} — ${total} résultats</span>
          <button class="fp-btn fp-btn-ghost fp-btn-sm" ${page>=totalPages?'disabled':''} onclick="window._fpDataExplorerAPI.nextPage()">Suivant →</button>
        </div>
      ` : `<div style="margin-top:10px;font-size:11px;color:var(--fp-text-faint);text-align:right">${total} résultat${total>1?'s':''}</div>`}
    </div>`;

  return header + controlsRow + tableHtml;
}

// ══════════════════════════════════════════════════════════════════════
// renderGA4Reports — Reports real data from /api/reports
// ══════════════════════════════════════════════════════════════════════
function renderGA4Reports() {
  if (STATE.loading) {
    return renderPageSkeleton({ stats: 0, rows: 4, rowH: 72, cards: 0 });
  }

  const st = window._fpReportsState || {};
  if (!st.loaded && !st.loading) setTimeout(() => window._fpReportsAPI.load(), 60);

  const sub = STATE.subRoute;
  const plan = STATE.me?.plan || 'Standard';
  const isPro = plan === 'Pro' || plan === 'Agency' || plan === 'Ultra';

  const header = `
    <div class="fp-section-header" style="margin-bottom:16px">
      <div><h1 style="font-size:22px;font-weight:800;color:var(--fp-text)">📄 Rapports</h1>
      <p style="font-size:12px;color:var(--fp-text-muted);margin-top:2px">Générez, gérez et partagez vos rapports SEO</p></div>
      <div style="display:flex;gap:8px">
        <button class="fp-btn fp-btn-ghost fp-btn-sm" onclick="window._fpReportsAPI.refresh()" ${st.loading?'disabled':''}>🔄 Actualiser</button>
        <button class="fp-btn fp-btn-primary fp-btn-sm" onclick="window._fpReportsAPI.create({name:'Rapport SEO — '+new Date().toLocaleDateString(getLocale()),format:'PDF'})">+ Nouveau rapport</button>
      </div>
    </div>`;

  if (st.loading && !st.reports) {
    return header + `<div style="display:flex;flex-direction:column;gap:10px">
      ${Array.from({length:4},()=>'<div class="fp-skel-block" style="height:72px;border-radius:10px"></div>').join('')}
    </div>`;
  }

  if (st.error && !st.reports) {
    return header + `
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:36px;margin-bottom:12px">⚠️</div>
        <div style="font-size:14px;font-weight:600;color:var(--fp-text);margin-bottom:6px">Erreur de chargement</div>
        <div style="font-size:12px;color:var(--fp-text-muted);margin-bottom:16px">${escHtml(String(st.error||'Erreur inconnue'))}</div>
        <button class="fp-btn fp-btn-primary fp-btn-sm" onclick="window._fpReportsAPI.refresh()">🔄 Réessayer</button>
      </div>`;
  }

  const reports = st.reports || STATE.reports || [];

  if (reports.length === 0) {
    return header + `
      <div style="text-align:center;padding:80px 20px;background:var(--fp-card);border-radius:var(--fp-radius-lg);border:1px solid var(--fp-border)">
        <div style="font-size:48px;margin-bottom:14px">📄</div>
        <div style="font-size:16px;font-weight:700;color:var(--fp-text);margin-bottom:8px">Aucun rapport généré</div>
        <div style="font-size:13px;color:var(--fp-text-muted);margin-bottom:20px">Créez votre premier rapport pour partager vos résultats SEO avec vos clients ou votre équipe.</div>
        <button class="fp-btn fp-btn-primary" onclick="window._fpReportsAPI.create({name:'Rapport SEO — '+new Date().toLocaleDateString(getLocale()),format:'PDF'})">Créer le premier rapport</button>
      </div>`;
  }

  const shared = reports.filter(r => r.shared || r.isShared).length;
  const recent = reports[0];

  const statsRow = `
    <div class="fp-stat-row fp-mb-20">
      ${statCard('Rapports totaux', String(reports.length), 'générés', 'neutral')}
      ${statCard('Partagés', String(shared), 'avec vos clients', shared > 0 ? 'up' : 'neutral')}
      ${statCard('Dernier rapport', recent ? new Date(recent.date || recent.createdAt || Date.now()).toLocaleDateString(getLocale()) : '—', recent ? escHtml(String(recent.name || '').slice(0, 30)) : 'Aucun rapport', 'neutral')}
      ${statCard('Types PDF', String(reports.filter(r => (r.type||r.format||'PDF').toUpperCase()==='PDF').length), 'téléchargeables', 'neutral')}
    </div>`;

  const historyHtml = `
    <div class="fp-card fp-mb-20">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="fp-card-title" style="margin-bottom:0">
          ${svgIcon('file-text').replace('stroke="currentColor"','stroke="#2563EB"')}
          Historique des rapports
        </div>
        ${st.loading ? '<span style="font-size:11px;color:var(--fp-text-faint)">Mise à jour…</span>' : ''}
      </div>
      <style>
        @media(max-width:640px){
          .fp-reports-table th:nth-child(4),.fp-reports-table td:nth-child(4),
          .fp-reports-table th:nth-child(5),.fp-reports-table td:nth-child(5){display:none}
          .fp-reports-table td:first-child{max-width:120px}
        }
      </style>
      <div style="overflow-x:auto">
        <table class="fp-data-table fp-reports-table">
          <thead><tr>
            <th>Nom du rapport</th>
            <th style="text-align:center">Type</th>
            <th style="text-align:center">Date</th>
            <th style="text-align:center">Partagé</th>
            <th style="text-align:center">Pages</th>
            <th style="text-align:center">Actions</th>
          </tr></thead>
          <tbody>
            ${reports.map(r => {
              const rId = r.id || r._id || '';
              const rName = String(r.name || r.title || 'Rapport');
              const rType = String(r.type || r.format || 'PDF').toUpperCase();
              const rDate = r.date ? new Date(r.date).toLocaleDateString(getLocale()) : r.createdAt ? new Date(r.createdAt).toLocaleDateString(getLocale()) : '—';
              const rShared = !!(r.shared || r.isShared);
              const rPages = r.pages != null ? Number(r.pages) : null;
              return `<tr>
                <td style="font-weight:600;font-size:11px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(rName)}">${escHtml(rName)}</td>
                <td style="text-align:center">${badge(rType, rType==='PDF'?'#2563EB':'#475569')}</td>
                <td style="text-align:center;color:var(--fp-text-faint);font-size:11px">${rDate}</td>
                <td style="text-align:center">${badge(rShared?'Partagé':'Privé', rShared?'#22c55e':'#475569')}</td>
                <td style="text-align:center;color:var(--fp-text-muted);font-size:11px">${rPages != null ? rPages : '—'}</td>
                <td style="text-align:center">
                  <div style="display:inline-flex;gap:4px">
                    ${rId ? `<button class="fp-btn fp-btn-ghost fp-btn-sm" style="font-size:10px" onclick="window._fpReportsAPI.downloadPdf('${escHtml(rId)}','${escHtml(rName.replace(/'/g,"'"))}')">⬇ PDF</button>` : ''}
                    ${rId && !rShared ? `<button class="fp-btn fp-btn-ghost fp-btn-sm" style="font-size:10px" onclick="window._fpReportsAPI.share('${escHtml(rId)}')">🔗 Partager</button>` : ''}
                    ${rId ? `<button class="fp-btn fp-btn-ghost fp-btn-sm" style="font-size:10px;color:#ef4444" onclick="window._fpReportsAPI.delete('${escHtml(rId)}','${escHtml(rName.replace(/'/g,"'"))}')">Suppr.</button>` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const quickCreateHtml = `
    <div class="fp-card">
      <div class="fp-card-title" style="margin-bottom:14px">⚡ Génération rapide</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
        ${[
          FP_REPORT_TEMPLATES.seo,
          FP_REPORT_TEMPLATES.executive,
          FP_REPORT_TEMPLATES.monitoring,
          FP_REPORT_TEMPLATES.conversion,
          FP_REPORT_TEMPLATES.local,
          FP_REPORT_TEMPLATES.ai,
        ].map(t => `
          <div style="padding:14px;border-radius:10px;border:1px solid ${t.color}25;background:${t.color}07;display:flex;align-items:center;gap:10px;cursor:pointer" data-template-key="${Object.keys(FP_REPORT_TEMPLATES).find(key => FP_REPORT_TEMPLATES[key] === t)}" onclick="window._fpReportsAPI.createTemplate(this.dataset.templateKey)">
            <span style="font-size:22px;flex-shrink:0">${t.icon}</span>
            <div>
              <div style="font-size:12px;font-weight:600;color:var(--fp-text)">${escHtml(t.label)}</div>
              <div style="font-size:10px;color:var(--fp-text-faint)">Générer maintenant</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;

  return header + statsRow + historyHtml + quickCreateHtml;
}

// ══════════════════════════════════════════════════════════════════════
// renderGA4ClientMode — Client Mode real data from /api/client-mode/*
// ══════════════════════════════════════════════════════════════════════
function renderGA4ClientMode() {
  const cmSt = window._fpCMState || {};
  if (!cmSt.loaded && !cmSt.loading) setTimeout(() => window._fpClientModeAPI.loadAll(), 60);

  const sub = STATE.subRoute;
  const plan = STATE.me?.plan || 'Standard';
  const isPro = plan === 'Pro' || plan === 'Agency' || plan === 'Ultra';

  const header = `
    <div class="fp-section-header" style="margin-bottom:16px">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:var(--fp-text)">👔 Mode Client</h1>
        <p style="font-size:12px;color:var(--fp-text-muted);margin-top:2px">Espace de consultation en lecture seule pour vos clients</p>
      </div>
      <button class="fp-btn fp-btn-ghost fp-btn-sm" onclick="window._fpClientModeAPI.refresh()">🔄 Actualiser</button>
    </div>`;

  if (cmSt.loading && !cmSt.kpis) {
    return header + `<div style="display:flex;flex-direction:column;gap:12px">
      <div class="fp-skel-block" style="height:56px;border-radius:10px"></div>
      <div class="fp-skel-block" style="height:120px;border-radius:10px"></div>
      <div class="fp-skel-block" style="height:200px;border-radius:10px"></div>
    </div>`;
  }

  if (cmSt.error && !cmSt.kpis) {
    return header + `
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:36px;margin-bottom:12px">⚠️</div>
        <div style="font-size:14px;font-weight:600;color:var(--fp-text);margin-bottom:6px">Erreur de chargement</div>
        <div style="font-size:12px;color:var(--fp-text-muted);margin-bottom:16px">${escHtml(String(cmSt.error||''))}</div>
        <button class="fp-btn fp-btn-primary fp-btn-sm" onclick="window._fpClientModeAPI.refresh()">🔄 Réessayer</button>
      </div>`;
  }

  const kpis = cmSt.kpis || {};
  const reports = cmSt.reports || [];
  const audits = cmSt.audits || [];
  const status = cmSt.status || {};
  const perms = status.permissions || {};

  const permsBanner = `
    <div style="padding:12px 16px;background:rgba(37,99,235,0.06);border:1px solid rgba(37,99,235,0.2);border-radius:var(--fp-radius-lg);margin-bottom:20px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <span style="font-size:13px;font-weight:700;color:var(--fp-text)">🔒 Mode Client actif</span>
      <span style="font-size:11px;color:var(--fp-text-muted)">Consultation uniquement — sans accès aux paramètres, à la facturation ni aux clés API</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-left:auto">
        ${badge('Lecture seule','#22c55e')}
        ${badge('Multi-tenant isolé','#2563EB')}
        ${badge('Sans accès billing','#ef4444')}
      </div>
    </div>`;

  const kpisRow = `
    <div class="fp-stat-row fp-mb-20">
      ${statCard('Score SEO moyen', kpis.avg_seo_score != null ? kpis.avg_seo_score + '/100' : '—', kpis.audit_count > 0 ? kpis.audit_count + ' site(s) audité(s)' : 'Aucun audit', kpis.avg_seo_score >= 70 ? 'up' : kpis.avg_seo_score > 0 ? 'neutral' : 'neutral')}
      ${statCard('Disponibilité', kpis.avg_uptime != null ? kpis.avg_uptime + '%' : '—', kpis.monitor_count > 0 ? kpis.monitor_count + ' monitor(s)' : 'Aucun monitor', kpis.avg_uptime >= 99 ? 'up' : 'neutral')}
      ${statCard('Missions', kpis.missions_total > 0 ? kpis.missions_done + '/' + kpis.missions_total : '—', kpis.missions_total > 0 ? 'complétées' : 'Aucune mission', 'neutral')}
      ${statCard('Rapports partagés', String(kpis.reports_shared || reports.length), 'accessibles', 'neutral')}
    </div>`;

  const monitorsHtml = kpis.monitor_count > 0 ? `
    <div class="fp-card fp-mb-20">
      <div class="fp-card-title" style="margin-bottom:12px">🔔 Disponibilité des services</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px;padding:14px;border-radius:10px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);text-align:center">
          <div style="font-size:22px;font-weight:800;color:#22c55e">${kpis.monitors_up || 0}</div>
          <div style="font-size:11px;color:var(--fp-text-muted)">En ligne</div>
        </div>
        <div style="flex:1;min-width:120px;padding:14px;border-radius:10px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);text-align:center">
          <div style="font-size:22px;font-weight:800;color:${kpis.monitors_down>0?'#ef4444':'var(--fp-text-faint)'}">${kpis.monitors_down || 0}</div>
          <div style="font-size:11px;color:var(--fp-text-muted)">Hors ligne</div>
        </div>
        <div style="flex:1;min-width:120px;padding:14px;border-radius:10px;background:rgba(37,99,235,0.07);border:1px solid rgba(37,99,235,0.2);text-align:center">
          <div style="font-size:22px;font-weight:800;color:#2563EB">${kpis.avg_uptime != null ? kpis.avg_uptime + '%' : '—'}</div>
          <div style="font-size:11px;color:var(--fp-text-muted)">Uptime moyen</div>
        </div>
      </div>
    </div>` : '';

  const auditsHtml = audits.length > 0 ? `
    <div class="fp-card fp-mb-20">
      <div class="fp-card-title" style="margin-bottom:14px">📊 Audits SEO</div>
      <div style="overflow-x:auto">
        <table class="fp-data-table">
          <thead><tr>
            <th>Site</th>
            <th style="text-align:center">Score</th>
            <th style="text-align:center">Statut</th>
            <th style="text-align:center">Date</th>
          </tr></thead>
          <tbody>
            ${audits.map(a => {
              const sc = Number(a.score) || 0;
              const color = sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444';
              return `<tr>
                <td style="font-size:11px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(String(a.url||''))}"><strong>${escHtml(String(a.url||'—').replace('https://',''))}</strong></td>
                <td style="text-align:center;font-weight:800;color:${color}">${sc > 0 ? sc + '/100' : '—'}</td>
                <td style="text-align:center">${badge(String(a.status||'done'), '#475569')}</td>
                <td style="text-align:center;color:var(--fp-text-faint);font-size:11px">${escHtml(fmtDate(a.date || a.createdAt))}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : `
    <div class="fp-card fp-mb-20" style="text-align:center;padding:32px">
      <div style="font-size:24px;margin-bottom:8px">📊</div>
      <div style="font-size:13px;color:var(--fp-text-muted)">Aucun audit disponible pour ce client.</div>
    </div>`;

  const reportsHtml = `
    <div class="fp-card">
      <div class="fp-card-title" style="margin-bottom:14px">📄 Rapports partagés</div>
      ${reports.length === 0
        ? `<div style="text-align:center;padding:32px;color:var(--fp-text-muted);font-size:13px">Aucun rapport partagé disponible.</div>`
        : `<div style="overflow-x:auto">
          <table class="fp-data-table">
            <thead><tr>
              <th>Rapport</th>
              <th style="text-align:center">Type</th>
              <th style="text-align:center">Date</th>
              <th style="text-align:center">Télécharger</th>
            </tr></thead>
            <tbody>
              ${reports.map(r => `<tr>
                <td style="font-weight:600;font-size:11px">${escHtml(String(r.name||'—'))}</td>
                <td style="text-align:center">${badge(String(r.type||'PDF').toUpperCase(), '#2563EB')}</td>
                <td style="text-align:center;color:var(--fp-text-faint);font-size:11px">${escHtml(String(r.date||'—'))}</td>
                <td style="text-align:center">
                  ${r.id ? `<button class="fp-btn fp-btn-ghost fp-btn-sm" style="font-size:10px" onclick="window._fpReportsAPI.downloadPdf('${escHtml(String(r.id))}','${escHtml(String(r.name||'rapport').replace(/'/g,"'"))}')">⬇ PDF</button>` : '<span style="color:var(--fp-text-faint);font-size:11px">—</span>'}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;

  // ── Sub-route routing for Mode Client tabs ────────────────────────
  if (sub === 'reporting') {
    return header + permsBanner + reportsHtml;
  }
  if (sub === 'dashboards') {
    // A client-facing dashboard is a *briefing*, not a duplicate of the
    // Command Center. It answers what can be shared today and what needs an
    // explanation, using only persisted audit/report data.
    const latestAudit = audits[0] || null;
    const latestReport = reports[0] || null;
    const score = latestAudit && latestAudit.score != null ? Number(latestAudit.score) : null;
    const scoreTone = score == null ? '#94a3b8' : score >= 70 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
    // /api/client-mode/reports is server-filtered to shared reports. Its
    // compact client contract intentionally omits the redundant `shared`
    // boolean, so the list length is the authoritative delivered count.
    const shareReady = reports.length;
    const clientBrief = `
      <div class="fp-card fp-mb-20" style="border-color:rgba(37,99,235,.28);background:linear-gradient(135deg,rgba(37,99,235,.10),rgba(15,23,42,0))">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
          <div>
            <div class="fp-card-title" style="margin-bottom:5px">📌 Synthèse client</div>
            <div style="font-size:12px;color:var(--fp-text-muted)">Une vue prête à présenter, limitée aux résultats et livrables partagés.</div>
          </div>
          ${latestReport ? badge(shareReady ? 'Rapport partageable' : 'Rapport à partager', shareReady ? '#22c55e' : '#f59e0b') : badge('Aucun rapport', '#94a3b8')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:12px;margin-top:16px">
          <div style="padding:13px;border-radius:10px;background:var(--fp-inner-card);border:1px solid var(--fp-border)">
            <div style="font-size:10px;color:var(--fp-text-faint);text-transform:uppercase;letter-spacing:.04em">Dernier score SEO</div>
            <div style="font-size:24px;font-weight:800;color:${scoreTone};margin:5px 0">${score == null ? '—' : score + '/100'}</div>
            <div style="font-size:11px;color:var(--fp-text-muted)">${latestAudit ? escHtml(String(latestAudit.url || latestAudit.name || 'Audit récent')) : 'Aucun audit disponible'}</div>
          </div>
          <div style="padding:13px;border-radius:10px;background:var(--fp-inner-card);border:1px solid var(--fp-border)">
            <div style="font-size:10px;color:var(--fp-text-faint);text-transform:uppercase;letter-spacing:.04em">Rapports partagés</div>
            <div style="font-size:24px;font-weight:800;color:var(--fp-text);margin:5px 0">${shareReady}</div>
            <div style="font-size:11px;color:var(--fp-text-muted)">${latestReport ? escHtml(String(latestReport.name || 'Dernier rapport')) : 'Créez un rapport à partager'}</div>
          </div>
          <div style="padding:13px;border-radius:10px;background:var(--fp-inner-card);border:1px solid var(--fp-border)">
            <div style="font-size:10px;color:var(--fp-text-faint);text-transform:uppercase;letter-spacing:.04em">Prochaine étape</div>
            <div style="font-size:14px;font-weight:700;color:var(--fp-text);margin:7px 0">${latestReport ? (shareReady ? 'Présenter les résultats' : 'Partager le rapport') : 'Générer un rapport'}</div>
            <button class="fp-btn fp-btn-ghost fp-btn-sm" style="font-size:10px" onclick="navigateSub('${latestReport ? 'reporting' : 'reporting'}')">${latestReport ? 'Voir les livrables' : 'Ouvrir les rapports'} →</button>
          </div>
        </div>
      </div>`;
    const auditPreview = latestAudit
      ? `<div class="fp-card"><div class="fp-card-title" style="margin-bottom:12px">🔎 Dernier audit à présenter</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div><div style="font-size:13px;font-weight:700;color:var(--fp-text)">${escHtml(String(latestAudit.url || latestAudit.name || 'Audit SEO'))}</div><div style="font-size:11px;color:var(--fp-text-muted);margin-top:3px">Résultat le plus récent disponible pour le client</div></div>
            <div style="font-size:22px;font-weight:800;color:${scoreTone}">${score == null ? '—' : score + '/100'}</div>
          </div></div>`
      : _emptyState('🔎', 'Aucun audit à présenter', 'Lancez un audit SEO pour alimenter le dashboard client.');
    return header + permsBanner + clientBrief + auditPreview;
  }
  if (sub === 'communication') {
    const _commHtml = `
      <div class="fp-card fp-mb-20">
        <div class="fp-card-title" style="margin-bottom:14px">💬 Communication client</div>
        <div style="text-align:center;padding:24px 16px;color:var(--fp-text-muted)">
          <div style="font-size:32px;margin-bottom:12px">📬</div>
          <div style="font-size:13px;font-weight:600;color:var(--fp-text);margin-bottom:6px">Espace de communication</div>
          <div style="font-size:12px;margin-bottom:16px">Partagez des mises à jour et rapports directement avec vos clients.</div>
          <button class="fp-btn fp-btn-primary fp-btn-sm" onclick="navigateSub('reporting')">Voir les rapports partagés →</button>
        </div>
      </div>`;
    return header + permsBanner + _commHtml + reportsHtml;
  }
  if (sub === 'onboarding') {
    const _onbHtml = `
      <div class="fp-card fp-mb-20">
        <div class="fp-card-title" style="margin-bottom:14px">🚀 Onboarding client</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${[{done:true,label:'Compte créé'},{done:!!(kpis.audit_count>0),label:'Premier audit lancé'},{done:!!(kpis.monitor_count>0),label:'Monitoring configuré'},{done:!!(reports.length>0),label:'Premier rapport partagé'},{done:false,label:'Accès client configuré'}].map(s=>`
          <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:${s.done?'rgba(34,197,94,0.06)':'var(--fp-inner-card)'};border:1px solid ${s.done?'rgba(34,197,94,0.25)':'var(--fp-border)'}">
            <div style="width:20px;height:20px;border-radius:50%;background:${s.done?'#22c55e':'rgba(148,163,184,0.2)'};display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0">${s.done?'✓':'○'}</div>
            <div style="font-size:13px;font-weight:600;color:${s.done?'var(--fp-text)':'var(--fp-text-muted)'}">${escHtml(s.label)}</div>
            ${s.done?badge('Complété','#22c55e'):badge('En attente','#94a3b8')}
          </div>`).join('')}
        </div>
      </div>`;
    return header + permsBanner + kpisRow + _onbHtml;
  }
  if (sub === 'projects') {
    const _msList = (STATE.missions||[]).filter(m=>m.status!=='dismissed').slice(0,8);
    const _prjHtml = `
      <div class="fp-card">
        <div class="fp-flex-between fp-mb-16">
          <div class="fp-card-title" style="margin-bottom:0">📋 Projets & missions</div>
          <button class="fp-btn fp-btn-ghost fp-btn-sm" onclick="navigate('missions')">Voir tout →</button>
        </div>
        ${_msList.length===0?`<div style="text-align:center;padding:24px;color:var(--fp-text-faint);font-size:12px">Aucune mission active</div>`:_msList.map(m=>{
          const _c={'done':'#22c55e','inprogress':'#f59e0b','todo':'#94a3b8','blocked':'#ef4444','open':'#6366f1','in_progress':'#f59e0b'}[m.status]||'#94a3b8';
          const _l={'done':'Terminé','inprogress':'En cours','todo':'À faire','blocked':'Bloqué','open':'À faire','in_progress':'En cours','completed':'Terminée'}[m.status]||'À faire';
          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:var(--fp-inner-card);border:1px solid var(--fp-border);margin-bottom:8px">
            <div style="width:8px;height:8px;border-radius:50%;background:${_c};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:600;color:var(--fp-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(m.title||m.name||'Mission')}</div>
              <div style="font-size:10px;color:var(--fp-text-faint)">${escHtml(m.category||m.type||'Mission')}</div>
            </div>
            ${badge(_l,_c)}
          </div>`;
        }).join('')}
      </div>`;
    return header + permsBanner + _prjHtml;
  }
  if (sub === 'analytics') {
    // Client-facing analytics — GA4/GSC data only, no invented numbers
    const ga4 = STATE.ga4Status || {};
    const gsc = STATE.gsc || {};
    const ga4Connected = window.fpIsConnected ? window.fpIsConnected('ga4') : !!ga4.connected;
    const gscConnected = window.fpIsConnected ? window.fpIsConnected('gsc') : !!gsc.connected;
    const _emptyState = (icon, title, desc) => `
      <div style="text-align:center;padding:40px 20px;background:var(--fp-inner-card);border-radius:var(--fp-radius-lg);border:1px dashed var(--fp-border)">
        <div style="font-size:32px;margin-bottom:10px">${icon}</div>
        <div style="font-size:13px;font-weight:700;color:var(--fp-text);margin-bottom:6px">${title}</div>
        <div style="font-size:12px;color:var(--fp-text-muted);max-width:320px;margin:0 auto 14px">${desc}</div>
        <button class="fp-btn fp-btn-primary fp-btn-sm" onclick="navigate('settings')">Connecter →</button>
      </div>`;
    const ga4Block = ga4Connected ? `
      <div class="fp-card fp-mb-20">
        <div class="fp-card-title" style="margin-bottom:14px">📊 Google Analytics 4</div>
        <div class="fp-stat-row">
          ${statCard('Sessions', ga4.sessions != null ? String(Math.round(ga4.sessions)) : '—', '30 derniers jours', 'neutral')}
          ${statCard('Conversions', ga4.conversions != null ? String(Math.round(ga4.conversions)) : '—', 'Objectifs atteints', ga4.conversions > 0 ? 'up' : 'neutral')}
          ${statCard('Taux de rebond', ga4.bounceRate != null ? Math.round(ga4.bounceRate) + '%' : '—', 'Moyenne 30j', ga4.bounceRate < 50 ? 'up' : 'neutral')}
          ${statCard('Durée moy.', ga4.avgSessionDuration != null ? Math.round(ga4.avgSessionDuration) + 's' : '—', 'Par session', 'neutral')}
        </div>
      </div>` : _emptyState('📊', 'Google Analytics non connecté', 'Connectez Google Analytics 4 pour visualiser les sessions, conversions et comportement utilisateur.');
    const gscBlock = gscConnected ? `
      <div class="fp-card fp-mb-20">
        <div class="fp-card-title" style="margin-bottom:14px">🔍 Google Search Console</div>
        <div class="fp-stat-row">
          ${statCard('Impressions', gsc.impressions != null ? String(Math.round(gsc.impressions)) : '—', '30 derniers jours', 'neutral')}
          ${statCard('Clics', gsc.clicks != null ? String(Math.round(gsc.clicks)) : '—', 'Recherche organique', gsc.clicks > 0 ? 'up' : 'neutral')}
          ${statCard('CTR moyen', gsc.ctr != null ? (gsc.ctr * 100).toFixed(1) + '%' : '—', 'Taux de clic', 'neutral')}
          ${statCard('Position moy.', gsc.avgPosition != null ? gsc.avgPosition.toFixed(1) : '—', 'Rank Google', gsc.avgPosition < 10 ? 'up' : 'neutral')}
        </div>
      </div>` : _emptyState('🔍', 'Google Search Console non connectée', 'Connectez Google Search Console pour voir les impressions, clics et positions organiques.');
    return header + permsBanner + '<div style="display:flex;flex-direction:column;gap:16px">' + ga4Block + gscBlock + '</div>';
  }

  if (sub === 'agency') {
    // Agency Lab — audits table + shared reports + white-label status; no duplicated KPI/availability blocks
    const wlBranding = (STATE.settings && STATE.settings.wlBranding && typeof STATE.settings.wlBranding === 'object')
      ? STATE.settings.wlBranding : (typeof localStorage !== 'undefined' ? (function(){try{return JSON.parse(localStorage.getItem('fp:wl-branding')||'{}');}catch(_){return {};}})() : {});
    const wlEnabled = !!(wlBranding.logoUrl || wlBranding.agencyName || wlBranding.primaryColor);
    const wlBlock = `
      <div class="fp-card fp-mb-20" style="margin-top:20px">
        <div class="fp-card-title" style="margin-bottom:14px">🎨 White-Label & Branding</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          ${wlEnabled
            ? `<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:200px">
                ${wlBranding.logoUrl ? `<img src="${escHtml(wlBranding.logoUrl)}" style="height:36px;max-width:80px;border-radius:6px;object-fit:contain" onerror="this.style.display='none'">` : `<div style="width:36px;height:36px;border-radius:8px;background:${wlBranding.primaryColor||'#2563EB'};display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:14px">${(wlBranding.agencyName||'A').charAt(0).toUpperCase()}</div>`}
                <div>
                  <div style="font-size:13px;font-weight:700;color:var(--fp-text)">${escHtml(wlBranding.agencyName || 'Votre agence')}</div>
                  <div style="font-size:11px;color:var(--fp-text-muted)">${wlBranding.primaryColor || '#2563EB'} · White-label actif</div>
                </div>
              </div>
              <div style="display:flex;gap:6px">${badge('White-label actif','#22c55e')}<button class="fp-btn fp-btn-ghost fp-btn-sm" onclick="navigate('settings');setTimeout(()=>navigateSub('workspace'),50)">Modifier →</button></div>`
            : `<div style="flex:1;color:var(--fp-text-muted);font-size:12px">Aucun branding configuré. Personnalisez logo, couleurs et nom d'agence dans les Paramètres → Workspace.</div>
               <button class="fp-btn fp-btn-primary fp-btn-sm" onclick="navigate('settings');setTimeout(()=>navigateSub('workspace'),50)">Configurer →</button>`}
        </div>
      </div>`;
    return header + permsBanner + auditsHtml + reportsHtml + wlBlock;
  }

  // Default: Command Center — all sections
  return header + permsBanner + kpisRow + monitorsHtml + auditsHtml + reportsHtml;
}

})(); // end IIFE
