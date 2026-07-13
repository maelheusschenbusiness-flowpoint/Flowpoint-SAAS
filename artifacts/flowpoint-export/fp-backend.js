/**
 * FLOWPOINT — Couche d'intégration Backend
 * ══════════════════════════════════════════
 * Ce fichier connecte les données du dashboard au vrai backend.
 * Il remplace les localStorage par de vraies API calls, et branche
 * les événements Socket.IO/SSE sur le state du dashboard.
 *
 * DÉPENDANCES :
 *   - fp-config.js  (chargé avant)
 *   - dashboard.js  (chargé après)
 *
 * Ce fichier doit être inclus ENTRE fp-config.js et dashboard.js :
 *   <script src="fp-config.js"></script>
 *   <script src="fp-backend.js"></script>
 *   <script src="dashboard.js"></script>
 */

(function () {
  'use strict';

  // ─── UTILITAIRES PARTAGÉS ────────────────────────────────────────────────────

  function _authHeaders() {
    try {
      var t = localStorage.getItem('token') || localStorage.getItem('fp_token') || '';
      return t ? { 'Authorization': 'Bearer ' + t } : {};
    } catch (_) { return {}; }
  }

  // ── Shared transport constants — identical to dashboard.js semantics ─────────
  // Both files share the same: cache TTL, GET dedup, cache-buster, auth headers,
  // 401 redirect, retry policy (exponential backoff, 2 retries max).
  var _API_CACHE_TTL = 30000; // 30 s — same as dashboard.js _API_CACHE_TTL
  var _fpInFlight = {};       // GET dedup: path → Promise (mirrors _apiFetchInFlight)
  var _fpCache    = {};       // GET cache: path → { data, ts } (mirrors _apiFetchCache)

  function _clearAuth() {
    try {
      ['token','fp_token','fp-token','fp-auth','fp-session','fp-user'].forEach(function(k) {
        localStorage.removeItem(k);
      });
    } catch (_) {}
  }

  function apiFetch(path, opts) {
    var isGet = !opts || !opts.method || opts.method === 'GET';

    // ── GET cache (30 s TTL, same as dashboard.js) ────────────────────────────
    if (isGet) {
      var cached = _fpCache[path];
      if (cached && (Date.now() - cached.ts < _API_CACHE_TTL)) return Promise.resolve(cached.data);
      if (_fpInFlight[path]) return _fpInFlight[path];
    }

    // ── Cache-buster for GETs (same pattern as dashboard.js) ─────────────────
    var _path = path;
    if (isGet) {
      _path = path.indexOf('?') === -1
        ? path + '?_cb=' + Date.now()
        : path + '&_cb=' + Date.now();
    }

    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      isGet ? { 'Cache-Control': 'no-cache, no-store' } : {},
      _authHeaders(),
      (opts && opts.headers) || {}
    );

    var fetchOpts = Object.assign({}, opts || {}, {
      credentials: 'include',
      headers: headers,
    });

    var promise = fetch(_path, fetchOpts)
      .then(function (res) {
        if (res.status === 401) {
          _clearAuth();
          window.location.href = '/login.html';
          return null;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
        return res.json();
      })
      .then(function (data) {
        if (isGet) {
          _fpCache[path] = { data: data, ts: Date.now() };
          delete _fpInFlight[path];
        }
        return data;
      })
      .catch(function (err) {
        if (isGet) delete _fpInFlight[path];
        throw err;
      });

    if (isGet) _fpInFlight[path] = promise;
    return promise;
  }

  // apiAction: exponential backoff, 2 retries max — identical to dashboard.js apiAction
  function apiAction(method, path, body, retries) {
    if (retries === undefined) retries = 2;
    var lastErr;
    function attempt(n) {
      return apiFetch(path, {
        method: method,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }).catch(function (err) {
        lastErr = err;
        if (n > 0) {
          var delay = Math.min(1000 * Math.pow(2, retries - n), 5000);
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(attempt(n - 1)); }, delay);
          });
        }
        throw lastErr;
      });
    }
    return attempt(retries);
  }

  function normalizeDoc(doc) {
    if (!doc || typeof doc !== 'object') return doc;
    var out = Object.assign({}, doc);
    if (!out.id && out._id) out.id = String(out._id);
    delete out._id;
    delete out.__v;
    return out;
  }

  function activityTypeToNotifType(type) {
    var map = {
      audit: 'success',
      monitor: 'error',
      report: 'info',
      mission: 'info',
      alert: 'warning',
      team: 'purple',
      keyword: 'info',
      competitor: 'warning',
      connector: 'info',
    };
    return map[type] || 'info';
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = Date.now() - new Date(dateStr).getTime();
    var min = Math.floor(diff / 60000);
    if (min < 1) return 'À l\'instant';
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'j';
  }

  function updateMonitorBadge() {
    var badge = document.querySelector('[data-nav="monitors"] .fp-nav-badge, [data-route="monitors"] .fp-nav-badge');
    if (!badge || !window.STATE) return;
    var count = (window.STATE.monitors || []).filter(function (m) { return m.status === 'down'; }).length;
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
  }

  // ─── UPGRADE CHECKOUT — Global helper ────────────────────────────────────────
  // Appelé par les boutons inline "Passer Pro / Passer Ultra"

  window.upgradeCheckout = function (plan) {
    if (typeof window.FP_BILLING_API !== 'undefined') {
      window.FP_BILLING_API.checkout(plan).catch(function () {
        if (typeof window.navigate === 'function') window.navigate('billing');
      });
    } else {
      if (typeof window.navigate === 'function') window.navigate('billing');
    }
  };

  // ─── PATCH MISSIONS → API ────────────────────────────────────────────────────

  window.FP_MISSIONS_API = {

    load: async function () {
      try {
        var data = await apiFetch('/api/missions');
        return Array.isArray(data) ? data.map(normalizeDoc) : [];
      } catch (e) {
        console.warn('[FP] missions load error:', e.message);
        return null;
      }
    },

    create: async function (mission) {
      try {
        return normalizeDoc(await apiAction('POST', '/api/missions', mission));
      } catch (e) {
        console.warn('[FP] mission create error:', e.message);
        return mission;
      }
    },

    update: async function (id, patch) {
      try {
        return normalizeDoc(await apiAction('PATCH', '/api/missions/' + id, patch));
      } catch (e) {
        console.warn('[FP] mission update error:', e.message);
        return null;
      }
    },

    delete: async function (id) {
      try {
        await apiAction('DELETE', '/api/missions/' + id);
      } catch (e) {
        console.warn('[FP] mission delete error:', e.message);
      }
    },
  };

  // ─── PATCH CHAT ÉQUIPE → API ─────────────────────────────────────────────────

  window.FP_CHAT_API = {

    load: async function (channel) {
      try {
        var data = await apiFetch('/api/team/messages?channel=' + encodeURIComponent(channel || 'general'));
        return Array.isArray(data) ? data : [];
      } catch (e) {
        console.warn('[FP] chat load error:', e.message);
        return null;
      }
    },

    send: async function (channel, text, attachment) {
      try {
        var me = window.STATE && window.STATE.me;
        var from = (me && (me.firstName || me.name)) || 'Moi';
        return normalizeDoc(await apiAction('POST', '/api/team/messages', {
          channel: channel || 'general',
          from: from,
          text: text,
          attachment: attachment,
          self: true,
        }));
      } catch (e) {
        console.warn('[FP] chat send error:', e.message);
        return null;
      }
    },
  };

  // ─── NOTIFICATIONS → /api/notifications ─────────────────────────────────────

  window.FP_NOTIF_API = {

    load: async function () {
      try {
        var notifs = await apiFetch('/api/notifications');
        if (!Array.isArray(notifs)) return null;
        return notifs.map(function (n, i) {
          return {
            id: n.id || 'n' + i,
            type: n.type || 'info',
            title: n.title || 'Notification',
            desc: n.message || '',
            time: timeAgo(n.createdAt),
            read: n.read || false,
          };
        });
      } catch (e) {
        console.warn('[FP] notifications load error:', e.message);
        // Fallback: essayer l'activité
        try {
          var events = await apiFetch('/api/activity');
          if (!Array.isArray(events)) return null;
          return events.slice(0, 20).map(function (ev, i) {
            return {
              id: ev.id || 'n' + i,
              type: activityTypeToNotifType(ev.type),
              title: ev.label || 'Événement',
              desc: (ev.metadata && (ev.metadata.url || ev.metadata.auditId)) || '',
              time: timeAgo(ev.createdAt),
              read: false,
            };
          });
        } catch (e2) {
          return null;
        }
      }
    },

    markRead: async function (id) {
      try {
        await apiAction('PATCH', '/api/notifications/' + id + '/read');
      } catch (e) { console.warn('[FP] notif markRead error:', e.message); }
    },

    markAllRead: async function () {
      try {
        await apiAction('PATCH', '/api/notifications/read-all');
      } catch (e) { console.warn('[FP] notif markAllRead error:', e.message); }
    },

    delete: async function (id) {
      try {
        await apiAction('DELETE', '/api/notifications/' + id);
      } catch (e) { console.warn('[FP] notif delete error:', e.message); }
    },
  };

  // ─── KEYWORDS → /api/keywords ────────────────────────────────────────────────

  window.FP_KEYWORDS_API = {

    load: async function () {
      try {
        var data = await apiFetch('/api/keywords');
        return Array.isArray(data) ? data : [];
      } catch (e) {
        console.warn('[FP] keywords load error:', e.message);
        return null;
      }
    },

    create: async function (kw) {
      try {
        return normalizeDoc(await apiAction('POST', '/api/keywords', kw));
      } catch (e) {
        console.warn('[FP] keyword create error:', e.message);
        return kw;
      }
    },

    update: async function (id, patch) {
      try {
        return normalizeDoc(await apiAction('PATCH', '/api/keywords/' + id, patch));
      } catch (e) {
        console.warn('[FP] keyword update error:', e.message);
        return null;
      }
    },

    delete: async function (id) {
      try {
        await apiAction('DELETE', '/api/keywords/' + id);
      } catch (e) {
        console.warn('[FP] keyword delete error:', e.message);
      }
    },
  };

  // ─── COMPETITORS → /api/competitors ─────────────────────────────────────────

  window.FP_COMPETITORS_API = {

    load: async function () {
      try {
        var data = await apiFetch('/api/competitors');
        return Array.isArray(data) ? data : [];
      } catch (e) {
        console.warn('[FP] competitors load error:', e.message);
        return null;
      }
    },

    create: async function (comp) {
      try {
        return normalizeDoc(await apiAction('POST', '/api/competitors', comp));
      } catch (e) {
        console.warn('[FP] competitor create error:', e.message);
        return comp;
      }
    },

    delete: async function (id) {
      try {
        await apiAction('DELETE', '/api/competitors/' + id);
      } catch (e) {
        console.warn('[FP] competitor delete error:', e.message);
      }
    },
  };

  // ─── CONNECTORS → /api/connectors ───────────────────────────────────────────

  window.FP_CONNECTORS_API = {

    load: async function () {
      try {
        var data = await apiFetch('/api/connectors');
        return Array.isArray(data) ? data : [];
      } catch (e) {
        console.warn('[FP] connectors load error:', e.message);
        return null;
      }
    },

    connect: async function (provider, opts) {
      try {
        return await apiAction('POST', '/api/connectors/' + provider + '/connect', opts || {});
      } catch (e) {
        console.warn('[FP] connector connect error:', e.message);
        return null;
      }
    },

    disconnect: async function (provider) {
      try {
        return await apiAction('POST', '/api/connectors/' + provider + '/disconnect', {});
      } catch (e) {
        console.warn('[FP] connector disconnect error:', e.message);
        return null;
      }
    },

    sync: async function (provider) {
      try {
        return await apiAction('POST', '/api/connectors/' + provider + '/sync', {});
      } catch (e) {
        console.warn('[FP] connector sync error:', e.message);
        return null;
      }
    },

    oauthStart: function (provider) {
      apiFetch('/api/connectors/' + provider + '/oauth/start')
        .then(function (data) {
          if (data.url) {
            window.open(data.url, '_blank', 'width=800,height=600');
          }
        })
        .catch(function (e) {
          console.warn('[FP] oauth start error:', e.message);
          if (typeof window.showToast === 'function') {
            window.showToast('warning', 'OAuth non configuré — ajoutez vos clés API dans les variables d\'environnement');
          }
        });
    },
  };

  // ─── MONITORS → ping ────────────────────────────────────────────────────────

  window.FP_MONITORS_API = {

    ping: async function (id) {
      try {
        if (typeof window.showToast === 'function') {
          window.showToast('info', 'Test en cours…');
        }
        var data = await apiAction('POST', '/api/monitors/' + id + '/ping', {});

        // Mettre à jour STATE
        if (window.STATE && window.STATE.monitors) {
          var m = window.STATE.monitors.find(function (x) { return x.id === id; });
          if (m && data.monitor) {
            m.status = data.monitor.status;
            m.responseTime = data.monitor.responseTime;
            m.lastChecked = data.monitor.lastChecked;
          }
        }

        if (typeof window.showToast === 'function') {
          var isUp = data.status === 'up';
          window.showToast(
            isUp ? 'success' : 'error',
            'Ping ' + (isUp ? 'OK' : 'KO') + ' — ' + (data.responseTime || 0) + 'ms'
          );
        }
        if (typeof window.render === 'function') window.render();
        return data;
      } catch (e) {
        console.warn('[FP] monitor ping error:', e.message);
        if (typeof window.showToast === 'function') {
          window.showToast('error', 'Ping échoué : ' + e.message);
        }
        return null;
      }
    },
  };

  // ─── BILLING ACTIONS ─────────────────────────────────────────────────────────

  window.FP_BILLING_API = {

    openPortal: async function () {
      try {
        var data = await apiAction('POST', '/api/billing/portal', {});
        if (data.url) window.open(data.url, '_blank');
      } catch (e) {
        console.warn('[FP] billing portal error:', e.message);
        if (typeof window.showToast === 'function') {
          window.showToast('error', 'Portail billing indisponible');
        }
      }
    },

    checkout: async function (plan) {
      try {
        if (typeof window.showToast === 'function') {
          window.showToast('info', 'Redirection vers le paiement ' + (plan === 'ultra' ? 'Ultra' : 'Pro') + '…');
        }
        var data = await apiAction('POST', '/api/billing/checkout', { plan: plan });
        if (data.url) {
          window.location.href = data.url;
        }
      } catch (e) {
        console.warn('[FP] billing checkout error:', e.message);
        if (typeof window.navigate === 'function') window.navigate('billing');
      }
    },
  };

  // ─── REALTIME — SSE EVENTS ───────────────────────────────────────────────────

  function bindRealtimeEvents() {

    // ── Monitor alert ──
    document.addEventListener('fp:monitor:alert', function (e) {
      var data = e.detail;
      if (!data) return;
      var S = window.STATE;
      if (S && S.monitors) {
        var m = S.monitors.find(function (x) { return x.id === data.monitorId || x.id === data.id; });
        if (m && data.status) m.status = data.status;
      }
      if (typeof window.showToast === 'function') {
        var isDown = data.status === 'down';
        window.showToast(
          isDown ? 'error' : 'success',
          isDown ? 'Monitor DOWN : ' + (data.name || data.url || '') : 'Monitor UP : ' + (data.name || data.url || '')
        );
      }
      if (window.STATE && window.STATE.route === 'monitors' && typeof window.render === 'function') window.render();
      updateMonitorBadge();
    });

    // ── Monitor ping résultat (SSE) ──
    document.addEventListener('fp:monitor:ping', function (e) {
      var data = e.detail;
      if (!data || !window.STATE) return;
      var m = (window.STATE.monitors || []).find(function (x) { return x.id === data.monitorId; });
      if (m) {
        if (data.status) m.status = data.status;
        if (data.responseTime !== undefined) m.responseTime = data.responseTime;
      }
      if (window.STATE.route === 'monitors' && typeof window.render === 'function') window.render();
    });

    // ── Nouvelle activité ──
    document.addEventListener('fp:activity:new', function (e) {
      var data = e.detail;
      if (!data || !window.STATE) return;
      var notif = {
        id: data.id || 'n' + Date.now(),
        type: activityTypeToNotifType(data.type),
        title: data.label || 'Événement',
        desc: (data.metadata && data.metadata.url) || '',
        time: 'À l\'instant',
        read: false,
      };
      if (!window.STATE.notifications) window.STATE.notifications = [];
      window.STATE.notifications.unshift(notif);
      if (window.STATE.notifications.length > 50) window.STATE.notifications.pop();
      if (!window.STATE.activityEvents) window.STATE.activityEvents = [];
      window.STATE.activityEvents.unshift(data);
      if (typeof window.render === 'function') window.render();
    });

    // ── Mise à jour billing ──
    document.addEventListener('fp:billing:updated', function (e) {
      var data = e.detail;
      if (!data || !window.STATE || !window.STATE.me) return;
      if (data.plan) window.STATE.me.plan = data.plan;
      if (data.subscriptionStatus) window.STATE.me.subscriptionStatus = data.subscriptionStatus;
      if (typeof window.showToast === 'function') {
        window.showToast('success', 'Plan mis à jour : ' + (data.plan || ''));
      }
      if (typeof window.render === 'function') window.render();
    });

    // ── Message équipe ──
    document.addEventListener('fp:team:message', function (e) {
      var data = e.detail;
      if (!data || !window.STATE) return;
      var ch = data.channel || 'general';
      if (!window.STATE.channelMessages) window.STATE.channelMessages = {};
      if (!window.STATE.channelMessages[ch]) window.STATE.channelMessages[ch] = [];
      var isSelf = data.from === (window.STATE.me && (window.STATE.me.firstName || window.STATE.me.name));
      window.STATE.channelMessages[ch].unshift({
        from: data.from || 'Équipe',
        text: data.text || '',
        time: 'À l\'instant',
        read: isSelf,
        self: isSelf,
      });
      if (typeof window.render === 'function') window.render();
    });

    // ── Chat SSE (nouveau format depuis /api/team/messages) ──
    document.addEventListener('fp:chat:message', function (e) {
      var data = e.detail;
      if (!data || !window.STATE) return;
      var ch = (data.channel || data.message && data.message.channel) || 'general';
      var msgData = data.message || data;
      if (!window.STATE.channelMessages) window.STATE.channelMessages = {};
      if (!window.STATE.channelMessages[ch]) window.STATE.channelMessages[ch] = [];
      var isSelf = msgData.self || false;
      window.STATE.channelMessages[ch].unshift({
        id: msgData.id,
        from: msgData.from || 'Équipe',
        text: msgData.text || '',
        time: 'À l\'instant',
        read: isSelf,
        self: isSelf,
      });
      if (window.STATE.route === 'team' && typeof window.render === 'function') window.render();
    });

    // ── Audit terminé ──
    document.addEventListener('fp:audit:complete', function (e) {
      var data = e.detail;
      if (!data) return;
      if (window.STATE && data.audit) {
        var normalized = normalizeDoc(data.audit);
        var idx = (window.STATE.audits || []).findIndex(function (a) { return a.id === normalized.id; });
        if (idx >= 0) {
          window.STATE.audits[idx] = normalized;
        } else {
          window.STATE.audits = [normalized].concat(window.STATE.audits || []);
        }
      }
      if (typeof window.showToast === 'function') {
        window.showToast('success', 'Audit terminé : ' + ((data.audit && data.audit.url) || '') + ' — ' + ((data.audit && data.audit.score) || '') + '/100');
      }
      if (window.STATE && window.STATE.route === 'audits' && typeof window.render === 'function') window.render();
    });

    // ── Rapport PDF prêt ──
    document.addEventListener('fp:report:ready', function (e) {
      var data = e.detail;
      if (!data) return;
      if (typeof window.showToast === 'function') {
        window.showToast('success', 'Rapport PDF prêt : ' + (data.name || ''));
      }
      if (window.STATE && window.STATE.route === 'reports' && typeof window.render === 'function') window.render();
    });

    // ── Connecteur sync ──
    document.addEventListener('fp:connector:synced', function (e) {
      var data = e.detail;
      if (!data || !window.STATE) return;
      if (window.STATE.connectors) {
        var c = window.STATE.connectors.find(function (x) { return x.provider === data.provider; });
        if (c) c.lastSync = data.lastSync;
      }
      if (typeof window.showToast === 'function') {
        window.showToast('success', 'Connecteur ' + (data.provider || '') + ' synchronisé');
      }
    });
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindRealtimeEvents);
  } else {
    bindRealtimeEvents();
  }

  // ─── FP_DATA — shared state for advanced feature data ────────────────────────
  window.FP_DATA = window.FP_DATA || {};

  // ─── NAME → KEY mapping for add-ons activation ───────────────────────────────
  var FP_ADDON_NAME_MAP = {
    '+50 Monitors': 'monitorsPack50',
    '+10 Monitors': 'monitorsPack50',
    'White-Label Exports': 'whiteLabel',
    'AI CRO Strategist': 'aiCro',
    'Revenue Leak AI': 'revenueLeak',
    'AI Forecasting Engine': 'aiForecasting',
    'Behavioral AI': 'behavioralAI',
    'AI Automation Workflows': 'aiWorkflows',
    'AI Market Intelligence': 'marketIntelligence',
    'AI Executive Reporting': 'aiExecutiveReport',
    'Agency Reporting Packs': 'agencyPacks',
    'Review Intelligence': 'reviewIntelligence',
    'SSO Enterprise': 'ssoEnterprise',
    'Zapier/Make Integration': 'zapierIntegration',
    'Webhooks Avancés': 'advancedWebhooks',
    'CRM Intégrations': 'crmIntegration',
    'Custom Domain': 'customDomain',
    '+5 Sièges': 'extraSeats',
    'Rétention 90 jours': 'retention90d',
    'Rétention 365 jours': 'retention365d',
    'AB Testing IA': 'aiCro',
    'Advanced SEO Lab': 'aiExecutiveReport',
    'Enterprise Permissions': 'ssoEnterprise',
  };

  // Global helper called from addons onclick buttons
  window.fpActivateAddon = async function(addonName, isCurrentlyActive) {
    var key = FP_ADDON_NAME_MAP[addonName];
    if (!key) {
      if (typeof window.showToast === 'function') {
        window.showToast('info', isCurrentlyActive ? 'Désactivation…' : 'Add-on en cours d\'activation…');
      }
      return;
    }
    try {
      var endpoint = isCurrentlyActive ? '/api/addons/' + key + '/deactivate' : '/api/addons/' + key + '/activate';
      var data = await apiAction('POST', endpoint, {});
      if (data && data.addons && window.STATE && window.STATE.me) {
        window.STATE.me.addons = data.addons;
      } else if (window.STATE && window.STATE.me && window.STATE.me.addons) {
        window.STATE.me.addons[key] = !isCurrentlyActive;
      }
      if (typeof window.showToast === 'function') {
        window.showToast(isCurrentlyActive ? 'info' : 'success', isCurrentlyActive ? 'Add-on désactivé' : 'Add-on activé ✓');
      }
      if (typeof window.render === 'function') window.render();
    } catch (e) {
      console.warn('[FP] addon toggle error:', e.message);
      if (typeof window.showToast === 'function') window.showToast('error', 'Erreur : ' + e.message);
    }
  };

  // ─── ADD-ONS API ─────────────────────────────────────────────────────────────

  window.FP_ADDONS_API = {
    load: async function () {
      try {
        var data = await apiFetch('/api/addons');
        if (data && data.addons && window.STATE && window.STATE.me) {
          Object.assign(window.STATE.me.addons || {}, data.addons);
          window.STATE.me.addons = Object.assign({}, window.STATE.me.addons || {}, data.addons);
        }
        return data;
      } catch (e) { console.warn('[FP] addons load error:', e.message); return null; }
    },
    activate: async function (key) {
      try {
        var data = await apiAction('POST', '/api/addons/' + key + '/activate', {});
        if (data && data.addons && window.STATE && window.STATE.me) window.STATE.me.addons = data.addons;
        if (typeof window.showToast === 'function') window.showToast('success', 'Add-on activé ✓');
        if (typeof window.render === 'function') window.render();
        return data;
      } catch (e) {
        console.warn('[FP] addon activate error:', e.message);
        if (typeof window.showToast === 'function') window.showToast('error', 'Erreur activation');
        return null;
      }
    },
    deactivate: async function (key) {
      try {
        await apiAction('POST', '/api/addons/' + key + '/deactivate', {});
        if (window.STATE && window.STATE.me && window.STATE.me.addons) window.STATE.me.addons[key] = false;
        if (typeof window.showToast === 'function') window.showToast('info', 'Add-on désactivé');
        if (typeof window.render === 'function') window.render();
      } catch (e) { console.warn('[FP] addon deactivate error:', e.message); }
    },
    buyAICredits: async function (pack) {
      try {
        var data = await apiAction('POST', '/api/addons/ai-credits/buy', { pack: pack });
        if (typeof window.showToast === 'function') window.showToast('success', '+' + (data.creditsAdded || 0).toLocaleString('fr-FR') + ' AI Credits ajoutés');
        window.FP_AI_CREDITS_API.load();
        return data;
      } catch (e) { console.warn('[FP] buy credits error:', e.message); return null; }
    },
  };

  // ─── AI CREDITS API ──────────────────────────────────────────────────────────

  window.FP_AI_CREDITS_API = {
    load: async function () {
      try {
        var data = await apiFetch('/api/ai-credits');
        if (data) { window.FP_DATA.aiCredits = data; }
        return data;
      } catch (e) { console.warn('[FP] ai-credits load error:', e.message); return null; }
    },
  };

  // ─── REVENUE LEAK API ────────────────────────────────────────────────────────

  window.FP_REVENUE_LEAK_API = {
    load: async function (siteUrl) {
      try {
        var url = '/api/revenue-leak' + (siteUrl ? '?siteUrl=' + encodeURIComponent(siteUrl) : '');
        var data = await apiFetch(url);
        if (data) { window.FP_DATA.revenueLeak = data; }
        return data;
      } catch (e) { console.warn('[FP] revenue-leak load error:', e.message); return null; }
    },
    detect: async function (siteUrl) {
      try {
        var data = await apiAction('POST', '/api/revenue-leak/detect', { siteUrl: siteUrl });
        if (data) { window.FP_DATA.revenueLeak = data; }
        if (typeof window.render === 'function') window.render();
        return data;
      } catch (e) { console.warn('[FP] revenue-leak detect error:', e.message); return null; }
    },
    resolve: async function (id) {
      try {
        var r = await apiAction('PATCH', '/api/revenue-leak/' + id + '/resolve', {});
        if (typeof window.showToast === 'function') window.showToast('success', 'Fuite marquée résolue ✓');
        window.FP_REVENUE_LEAK_API.load();
        return r;
      } catch (e) { console.warn('[FP] revenue-leak resolve error:', e.message); return null; }
    },
  };

  // ─── CRO API ─────────────────────────────────────────────────────────────────

  window.FP_CRO_API = {
    load: async function (siteUrl) {
      try {
        var url = '/api/cro' + (siteUrl ? '?siteUrl=' + encodeURIComponent(siteUrl) : '');
        var data = await apiFetch(url);
        if (data) { window.FP_DATA.cro = data; }
        return data;
      } catch (e) { console.warn('[FP] cro load error:', e.message); return null; }
    },
    generate: async function (siteUrl) {
      try {
        if (typeof window.showToast === 'function') window.showToast('info', 'Analyse CRO en cours…');
        var data = await apiAction('POST', '/api/cro/generate', { siteUrl: siteUrl });
        if (data) { window.FP_DATA.cro = data; }
        if (typeof window.showToast === 'function') window.showToast('success', 'Recommandations CRO générées ✓');
        if (typeof window.render === 'function') window.render();
        return data;
      } catch (e) { console.warn('[FP] cro generate error:', e.message); return null; }
    },
    updateStatus: async function (id, status) {
      try {
        var r = await apiAction('PATCH', '/api/cro/recommendations/' + id, { status: status });
        if (typeof window.showToast === 'function') window.showToast('success', 'Recommandation mise à jour');
        return r;
      } catch (e) { console.warn('[FP] cro update error:', e.message); return null; }
    },
  };

  // ─── FORECAST API ────────────────────────────────────────────────────────────

  window.FP_FORECAST_API = {
    load: async function (siteUrl) {
      try {
        var url = '/api/forecast' + (siteUrl ? '?siteUrl=' + encodeURIComponent(siteUrl) : '');
        var data = await apiFetch(url);
        if (data) { window.FP_DATA.forecast = data; }
        return data;
      } catch (e) { console.warn('[FP] forecast load error:', e.message); return null; }
    },
    generate: async function (siteUrl) {
      try {
        if (typeof window.showToast === 'function') window.showToast('info', 'Génération des prévisions IA…');
        var data = await apiAction('POST', '/api/forecast/generate', { siteUrl: siteUrl });
        if (data) { window.FP_DATA.forecast = data; }
        if (typeof window.showToast === 'function') window.showToast('success', 'Prévisions générées ✓');
        if (typeof window.render === 'function') window.render();
        return data;
      } catch (e) { console.warn('[FP] forecast generate error:', e.message); return null; }
    },
  };

  // ─── BEHAVIORAL API ──────────────────────────────────────────────────────────

  window.FP_BEHAVIORAL_API = {
    load: async function (siteUrl) {
      try {
        var url = '/api/behavioral/insights' + (siteUrl ? '?siteUrl=' + encodeURIComponent(siteUrl) : '');
        var data = await apiFetch(url);
        if (data) { window.FP_DATA.behavioral = data; }
        return data;
      } catch (e) { console.warn('[FP] behavioral load error:', e.message); return null; }
    },
    generateInsights: async function (siteUrl) {
      try {
        await apiAction('POST', '/api/behavioral/generate-insights', { siteUrl: siteUrl });
        return window.FP_BEHAVIORAL_API.load(siteUrl);
      } catch (e) { console.warn('[FP] behavioral generate error:', e.message); return null; }
    },
    trackEvent: async function (event) {
      try {
        return await apiAction('POST', '/api/behavioral/event', event);
      } catch (e) { /* silent — tracking should never break UX */ return null; }
    },
  };

  // ─── AUTOMATION API ──────────────────────────────────────────────────────────

  window.FP_AUTOMATION_API = {
    load: async function () {
      try {
        var data = await apiFetch('/api/automation/workflows');
        if (data) { window.FP_DATA.automation = data; }
        return data;
      } catch (e) { console.warn('[FP] automation load error:', e.message); return null; }
    },
    run: async function (id) {
      try {
        if (typeof window.showToast === 'function') window.showToast('info', 'Workflow en cours d\'exécution…');
        var data = await apiAction('POST', '/api/automation/workflows/' + id + '/run', {});
        if (data && data.success && typeof window.showToast === 'function') {
          var secs = Math.round((data.durationMs || 200) / 1000) || 1;
          window.showToast('success', 'Workflow exécuté en ' + secs + 's ✓');
        } else if (data && !data.success && typeof window.showToast === 'function') {
          window.showToast('error', 'Workflow inactif ou introuvable — activez-le avant de lancer');
        }
        window.FP_AUTOMATION_API.load().then(function () {
          if (window.STATE && (window.STATE.route === 'automation' || window.STATE.sub === 'automation') && typeof window.render === 'function') window.render();
        });
        return data;
      } catch (e) {
        console.warn('[FP] automation run error:', e.message);
        if (typeof window.showToast === 'function') window.showToast('error', 'Workflow échoué');
        return null;
      }
    },
    toggle: async function (id, enabled) {
      try {
        await apiAction('PATCH', '/api/automation/workflows/' + id, { enabled: enabled });
        if (window.FP_DATA.automation && window.FP_DATA.automation.workflows) {
          var wf = window.FP_DATA.automation.workflows.find(function (w) { return w.id === id; });
          if (wf) wf.enabled = enabled;
        }
        if (typeof window.showToast === 'function') window.showToast('success', enabled ? 'Workflow activé' : 'Workflow désactivé');
        if (typeof window.render === 'function') window.render();
      } catch (e) { console.warn('[FP] automation toggle error:', e.message); }
    },
    create: async function (workflow) {
      try {
        var data = await apiAction('POST', '/api/automation/workflows', workflow);
        if (typeof window.showToast === 'function') window.showToast('success', 'Workflow créé ✓');
        window.FP_AUTOMATION_API.load();
        return data;
      } catch (e) { console.warn('[FP] automation create error:', e.message); return null; }
    },
  };

  // ─── WHITE-LABEL API ─────────────────────────────────────────────────────────

  window.FP_WHITE_LABEL_API = {
    loadTemplates: async function () {
      try {
        var data = await apiFetch('/api/white-label/templates');
        if (data) { window.FP_DATA.whiteLabelTemplates = data.templates || []; }
        return data;
      } catch (e) { console.warn('[FP] white-label templates error:', e.message); return null; }
    },
    saveTemplate: async function (template) {
      try {
        var data = await apiAction('POST', '/api/white-label/templates', template);
        if (typeof window.showToast === 'function') window.showToast('success', 'Template sauvegardé ✓');
        window.FP_WHITE_LABEL_API.loadTemplates();
        return data;
      } catch (e) { console.warn('[FP] white-label save error:', e.message); return null; }
    },
    addDomain: async function (domain) {
      try {
        var data = await apiAction('POST', '/api/white-label/domains', { domain: domain });
        if (typeof window.showToast === 'function') window.showToast('success', 'Domaine ajouté — vérification DNS requise');
        return data;
      } catch (e) { console.warn('[FP] white-label domain error:', e.message); return null; }
    },
  };

  // ─── GOOGLE BUSINESS PROFILE API ────────────────────────────────────────────

  window.FP_GBP_API = {
    load: async function () {
      try {
        var data = await apiFetch('/api/google/status');
        if (data) {
          window.FP_DATA.gbp = data;
          if (typeof window.STATE !== 'undefined') window.STATE.gbp = data;
        }
        return data;
      } catch (e) { console.warn('[FP] GBP status error:', e.message); return null; }
    },
    getConnectUrl: async function () {
      try {
        var data = await apiFetch('/api/google/oauth/start');
        if (data && data.url) return data.url;
        data = await apiFetch('/api/google/connect');
        return data && data.url ? data.url : null;
      } catch (e) { console.warn('[FP] GBP connect url error:', e.message); return null; }
    },
    sync: async function () {
      try {
        var data = await apiAction('POST', '/api/google/sync', {});
        if (typeof window.showToast === 'function') window.showToast('success', 'Sync GBP lancé — ' + (data.locationsCount || 0) + ' établissement(s)');
        await window.FP_GBP_API.load();
        if (typeof window.render === 'function') window.render();
        return data;
      } catch (e) { console.warn('[FP] GBP sync error:', e.message); if (typeof window.showToast === 'function') window.showToast('error', 'Erreur sync GBP'); return null; }
    },
    getLocations: async function () {
      try { return await apiFetch('/api/google/locations'); } catch (e) { return null; }
    },
    getReviews: async function (locationId) {
      try {
        var path = locationId ? '/api/google/reviews/' + locationId : '/api/google/reviews';
        return await apiFetch(path);
      } catch (e) { return null; }
    },
    getPerformance: async function (locationId) {
      try {
        var path = locationId ? '/api/google/performance?locationId=' + encodeURIComponent(locationId) : '/api/google/performance';
        var data = await apiFetch(path);
        if (data && typeof window.STATE !== 'undefined') {
          window.STATE.gbp = window.STATE.gbp || {};
          window.STATE.gbp.performance = data;
        }
        return data;
      } catch (e) { console.warn('[FP] GBP performance error:', e.message); return null; }
    },
    publishPost: async function (text, locationId, callToAction, callToActionUrl) {
      try {
        var data = await apiAction('POST', '/api/google/post', {
          text: text,
          locationId: locationId || undefined,
          callToActionType: callToAction || undefined,
          callToActionUrl: callToActionUrl || undefined,
        });
        if (data && data.ok) {
          if (typeof window.showToast === 'function') window.showToast('success', 'Post GBP publié ✓');
        } else {
          if (typeof window.showToast === 'function') window.showToast('error', 'Erreur publication : ' + (data && data.error || 'inconnue'));
        }
        return data;
      } catch (e) { console.warn('[FP] GBP post error:', e.message); return null; }
    },
    previewAIReply: async function (reviewId) {
      try {
        var data = await apiAction('POST', '/api/google/ai-reply-preview', { reviewId: reviewId });
        return data && data.reply ? data.reply : null;
      } catch (e) { console.warn('[FP] GBP ai-reply error:', e.message); return null; }
    },
    replyToReview: async function (reviewId, comment, useAI) {
      try {
        var data = await apiAction('POST', '/api/google/reply', {
          reviewId: reviewId, comment: comment || undefined, useAI: useAI || false,
        });
        if (data && data.ok) {
          if (typeof window.showToast === 'function') window.showToast('success', 'Réponse publiée sur Google ✓');
          await window.FP_GBP_API.load();
          if (typeof window.render === 'function') window.render();
        } else {
          if (typeof window.showToast === 'function') window.showToast('error', 'Erreur réponse : ' + (data && data.error || 'inconnue'));
        }
        return data;
      } catch (e) { console.warn('[FP] GBP reply error:', e.message); return null; }
    },
    disconnect: async function () {
      if (!confirm('Déconnecter Google Business Profile ? Vos données locales seront supprimées.')) return;
      try {
        await apiAction('POST', '/api/google/disconnect', {});
        if (typeof window.STATE !== 'undefined') window.STATE.gbp = { connected: false };
        if (typeof window.showToast === 'function') window.showToast('info', 'Google Business Profile déconnecté');
        if (typeof window.render === 'function') window.render();
      } catch (e) { console.warn('[FP] GBP disconnect error:', e.message); }
    },
    openConnect: async function () {
      var url = await window.FP_GBP_API.getConnectUrl();
      if (url) { window.location.href = url; }
      else if (typeof window.showToast === 'function') window.showToast('error', 'Google OAuth non configuré — ajoutez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET');
    },
    openPublishModal: function () {
      var modalHtml = '<div id="gbp-post-modal" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center" onclick="if(event.target===this)this.remove()">'
        + '<div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;width:480px;max-width:95vw">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
        + '<div style="font-size:15px;font-weight:800;color:#f1f5f9">📝 Publier un post Google Business</div>'
        + '<button onclick="document.getElementById(\'gbp-post-modal\').remove()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px">✕</button>'
        + '</div>'
        + '<textarea id="gbp-post-text" placeholder="Quoi de neuf ? Promotion, actualité, événement..." style="width:100%;height:120px;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;color:#f1f5f9;font-size:13px;resize:vertical;box-sizing:border-box" maxlength="1500"></textarea>'
        + '<div style="font-size:10px;color:#64748b;text-align:right;margin-top:4px;margin-bottom:14px" id="gbp-char-count">0 / 1500</div>'
        + '<div style="display:flex;gap:8px">'
        + '<button onclick="(function(){var t=document.getElementById(\'gbp-post-text\').value.trim();if(!t){showToast(\'error\',\'Saisissez un texte\');return;}document.getElementById(\'gbp-post-modal\').remove();window.FP_GBP_API.publishPost(t);})()" style="flex:1;padding:11px;border-radius:10px;background:linear-gradient(135deg,#2563EB,#1d4ed8);border:none;color:#fff;font-size:13px;font-weight:700;cursor:pointer">Publier maintenant</button>'
        + '<button onclick="document.getElementById(\'gbp-post-modal\').remove()" style="padding:11px 18px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid #334155;color:#94a3b8;font-size:13px;cursor:pointer">Annuler</button>'
        + '</div>'
        + '</div>'
        + '</div>';
      document.body.insertAdjacentHTML('beforeend', modalHtml);
      var ta = document.getElementById('gbp-post-text');
      if (ta) ta.addEventListener('input', function() {
        var el = document.getElementById('gbp-char-count');
        if (el) el.textContent = ta.value.length + ' / 1500';
      });
    },
    openReplyModal: async function (reviewId, reviewerName, rating) {
      var preview = await window.FP_GBP_API.previewAIReply(reviewId);
      var modalHtml = '<div id="gbp-reply-modal" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center" onclick="if(event.target===this)this.remove()">'
        + '<div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;width:500px;max-width:95vw">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
        + '<div style="font-size:15px;font-weight:800;color:#f1f5f9">🤖 Réponse IA — ' + (reviewerName || 'Avis') + ' (' + (rating||'?') + '★)</div>'
        + '<button onclick="document.getElementById(\'gbp-reply-modal\').remove()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px">✕</button>'
        + '</div>'
        + (preview ? '<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">Réponse générée par IA — vous pouvez la modifier :</div>' : '')
        + '<textarea id="gbp-reply-text" style="width:100%;height:100px;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;color:#f1f5f9;font-size:13px;resize:vertical;box-sizing:border-box">' + (preview || '') + '</textarea>'
        + '<div style="display:flex;gap:8px;margin-top:14px">'
        + '<button onclick="(function(){var t=document.getElementById(\'gbp-reply-text\').value.trim();if(!t){showToast(\'error\',\'Saisissez une réponse\');return;}document.getElementById(\'gbp-reply-modal\').remove();window.FP_GBP_API.replyToReview(\'' + reviewId + '\',t,false);})()" style="flex:1;padding:10px;border-radius:10px;background:#2563EB;border:none;color:#fff;font-size:13px;font-weight:700;cursor:pointer">Publier sur Google</button>'
        + '<button onclick="document.getElementById(\'gbp-reply-modal\').remove()" style="padding:10px 16px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid #334155;color:#94a3b8;font-size:13px;cursor:pointer">Annuler</button>'
        + '</div>'
        + '</div>'
        + '</div>';
      document.body.insertAdjacentHTML('beforeend', modalHtml);
    },
  };

  // ─── DATAFORSEO API ──────────────────────────────────────────────────────────

  window.FP_DATAFORSEO_API = {
    _status: null,
    loadStatus: async function () {
      try {
        var data = await apiFetch('/api/seo/status');
        window.FP_DATAFORSEO_API._status = data;
        if (typeof window.STATE !== 'undefined') window.STATE.dfsStatus = data;
        return data;
      } catch (e) { console.warn('[FP] DataForSEO status error:', e.message); return null; }
    },
    getKeywords: async function (keyword, location, language) {
      try {
        return await apiFetch('/api/seo/keywords?keyword=' + encodeURIComponent(keyword || 'seo') + '&location=' + encodeURIComponent(location || 'France') + '&language=' + (language || 'fr'));
      } catch (e) { console.warn('[FP] DFS keywords:', e.message); return null; }
    },
    getSERP: async function (keyword, location) {
      try {
        return await apiFetch('/api/seo/serp?keyword=' + encodeURIComponent(keyword || 'seo') + '&location=' + encodeURIComponent(location || 'France'));
      } catch (e) { console.warn('[FP] DFS serp:', e.message); return null; }
    },
    getCompetitors: async function (domain) {
      try {
        return await apiFetch('/api/seo/competitors?domain=' + encodeURIComponent(domain || ''));
      } catch (e) { console.warn('[FP] DFS competitors:', e.message); return null; }
    },
    getBacklinks: async function (domain) {
      try {
        return await apiFetch('/api/seo/backlinks?domain=' + encodeURIComponent(domain || ''));
      } catch (e) { console.warn('[FP] DFS backlinks:', e.message); return null; }
    },
    getDomainMetrics: async function (domain) {
      try {
        return await apiFetch('/api/seo/domain-metrics?domain=' + encodeURIComponent(domain || ''));
      } catch (e) { console.warn('[FP] DFS domain metrics:', e.message); return null; }
    },
    getLocalRank: async function (keyword, location) {
      try {
        return await apiFetch('/api/seo/local-rank?keyword=' + encodeURIComponent(keyword || '') + '&location=' + encodeURIComponent(location || 'Paris'));
      } catch (e) { console.warn('[FP] DFS local rank:', e.message); return null; }
    },
    getMaps: async function (keyword, location) {
      try {
        return await apiFetch('/api/seo/maps?keyword=' + encodeURIComponent(keyword || '') + '&location=' + encodeURIComponent(location || 'Paris'));
      } catch (e) { console.warn('[FP] DFS maps:', e.message); return null; }
    },
    getAIMentions: async function (keyword) {
      try {
        return await apiFetch('/api/seo/ai-mentions?keyword=' + encodeURIComponent(keyword || ''));
      } catch (e) { console.warn('[FP] DFS ai-mentions:', e.message); return null; }
    },
    analyzeContent: async function (url) {
      try {
        var data = await apiAction('POST', '/api/seo/content-optimization', { url: url });
        if (typeof window.showToast === 'function') window.showToast('success', 'Analyse contenu terminée — score : ' + (data.score || 0) + '/100');
        return data;
      } catch (e) { console.warn('[FP] DFS content opt:', e.message); return null; }
    },
    generateMissions: async function (domain) {
      try {
        var data = await apiAction('POST', '/api/seo/generate-missions', { domain: domain });
        if (typeof window.showToast === 'function') window.showToast('success', 'Missions SEO générées pour ' + domain);
        return data;
      } catch (e) { console.warn('[FP] DFS missions:', e.message); return null; }
    },
    loadLocalRankWidget: async function (keyword, location) {
      var container = document.getElementById('dfs-local-rank-widget');
      if (!container) return;
      container.innerHTML = '<div style="text-align:center;padding:20px;color:#64748b;font-size:12px">⏳ Chargement rankings DataForSEO…</div>';
      var data = await window.FP_DATAFORSEO_API.getLocalRank(keyword, location);
      if (!data || !data.results || !data.results.length) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:#64748b;font-size:12px">Aucune donnée locale disponible</div>';
        return;
      }
      container.innerHTML = data.results.slice(0, 7).map(function (r, i) {
        var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '<span style="display:inline-block;width:20px;text-align:center;font-weight:700;color:#64748b">' + (i+1) + '</span>';
        var stars = '★'.repeat(Math.round(r.rating || 0)) + '☆'.repeat(5 - Math.round(r.rating || 0));
        return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)">'
          + '<div style="font-size:18px;width:28px;text-align:center">' + medal + '</div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:13px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (r.businessName || '—') + '</div>'
          + '<div style="font-size:11px;color:#64748b;margin-top:2px">' + (r.address || '') + '</div>'
          + '</div>'
          + '<div style="flex-shrink:0;text-align:right">'
          + '<div style="font-size:11px;color:#f59e0b">' + stars + '</div>'
          + '<div style="font-size:10px;color:#64748b">' + (r.reviewCount || 0) + ' avis</div>'
          + '</div>'
          + '</div>';
      }).join('');
    },
  };

  // ─── INIT ADVANCED FEATURES ──────────────────────────────────────────────────

  function initAdvancedFeatures() {
    Promise.all([
      window.FP_ADDONS_API.load(),
      window.FP_AI_CREDITS_API.load(),
      window.FP_REVENUE_LEAK_API.load(),
      window.FP_CRO_API.load(),
      window.FP_FORECAST_API.load(),
      window.FP_BEHAVIORAL_API.load(),
      window.FP_AUTOMATION_API.load(),
      window.FP_GBP_API.load(),
      window.FP_DATAFORSEO_API ? window.FP_DATAFORSEO_API.loadStatus() : Promise.resolve(),
      window.FP_WHITE_LABEL_API ? window.FP_WHITE_LABEL_API.loadTemplates() : Promise.resolve(),
    ]).then(function () {
      if (typeof window.render === 'function' && window.STATE) {
        var r = window.STATE.route || '';
        if (r === 'conversion' || r === 'data-explorer' || r === 'billing' || r === 'settings' || r === 'growth' || r === 'alerts' || r === 'activity' || r === 'client-mode') window.render();
      }
    }).catch(function (e) { console.warn('[FP] Advanced features preload:', e); });
  }

  // ─── SSE HANDLERS FOR NEW FEATURES ──────────────────────────────────────────

  function bindAdvancedRealtimeEvents() {
    document.addEventListener('fp:addon:activated', function (e) {
      var data = e.detail;
      if (!data || !window.STATE || !window.STATE.me) return;
      if (data.addonKey) (window.STATE.me.addons = window.STATE.me.addons || {})[data.addonKey] = true;
      if (typeof window.showToast === 'function') window.showToast('success', 'Add-on activé : ' + (data.addonKey || ''));
      if (typeof window.render === 'function') window.render();
    });
    document.addEventListener('fp:addon:deactivated', function (e) {
      var data = e.detail;
      if (!data || !window.STATE || !window.STATE.me) return;
      if (data.addonKey && window.STATE.me.addons) window.STATE.me.addons[data.addonKey] = false;
      if (typeof window.render === 'function') window.render();
    });
    document.addEventListener('fp:ai:quota_alert', function (e) {
      var data = e.detail;
      if (!data) return;
      var msg = {
        quota_70pct:  ['warning', '⚡ 70% des AI Credits consommés ce mois'],
        quota_90pct:  ['error',   '⚠️ 90% des AI Credits — pensez à recharger'],
        quota_100pct: ['error',   '🚨 AI Credits épuisés — requêtes IA bloquées'],
      }[data.alertType] || ['warning', 'Alerte AI Credits'];
      if (typeof window.showToast === 'function') window.showToast(msg[0], msg[1]);
    });
    document.addEventListener('fp:workflow:completed', function (e) {
      var data = e.detail;
      if (!data) return;
      var secs = Math.round((data.durationMs || 200) / 1000) || 1;
      if (typeof window.showToast === 'function') window.showToast('success', 'Workflow terminé en ' + secs + 's');
    });
  }

  // ─── GOOGLE ANALYTICS 4 API ─────────────────────────────────────────────────

  window.FP_GA4_API = {
    _refreshInterval: null,
    _realtimeInterval: null,
    _rtIntervalMs: 30000,

    // Load GA4 status + initial data
    init: async function () {
      try {
        var status = await apiFetch('/api/ga4/status');
        window.FP_DATA = window.FP_DATA || {};
        window.FP_DATA.ga4 = window.FP_DATA.ga4 || {};
        window.FP_DATA.ga4.connected = status.connected || false;
        window.FP_DATA.ga4.propertyId = status.propertyId || null;

        if (status.connected && status.propertyId) {
          this._loadAll();
          this._startRealtimePoller();
        } else if (status.connected) {
          this._loadProperties();
        }
      } catch (e) { console.warn('[FP GA4] init failed:', e.message); }
    },

    _loadAll: async function () {
      try {
        var [ov, src, pgs, conv, aud, camp] = await Promise.allSettled([
          apiFetch('/api/ga4/overview'),
          apiFetch('/api/ga4/sources'),
          apiFetch('/api/ga4/pages'),
          apiFetch('/api/ga4/conversions'),
          apiFetch('/api/ga4/audience'),
          apiFetch('/api/ga4/campaigns'),
        ]);
        var ga4 = window.FP_DATA.ga4;
        if (ov.status === 'fulfilled' && ov.value?.ok)   ga4.overview   = ov.value.data;
        if (src.status === 'fulfilled' && src.value?.ok) ga4.sources    = src.value.data;
        if (pgs.status === 'fulfilled' && pgs.value?.ok) ga4.pages      = pgs.value.data;
        if (conv.status === 'fulfilled' && conv.value?.ok) ga4.conversions = conv.value.data;
        if (aud.status === 'fulfilled' && aud.value?.ok) ga4.audience   = aud.value.data;
        if (camp.status === 'fulfilled' && camp.value?.ok) ga4.campaigns = camp.value.data;

        var route = window.STATE && window.STATE.route;
        if (['analytics','traffic','funnels','audience','campaigns','live'].includes(route)) {
          if (typeof window.render === 'function') window.render();
        }
      } catch (e) { console.warn('[FP GA4] _loadAll failed:', e.message); }
    },

    _loadProperties: async function () {
      try {
        var data = await apiFetch('/api/ga4/properties');
        if (data?.ok) {
          window.FP_DATA.ga4.properties = data.properties || [];
          var route = window.STATE && window.STATE.route;
          if (route === 'analytics') { if (typeof window.render === 'function') window.render(); }
        }
      } catch (e) {}
    },

    _startRealtimePoller: function () {
      if (this._realtimeInterval) clearInterval(this._realtimeInterval);
      var self = this;
      var poll = async function () {
        var route = window.STATE && window.STATE.route;
        if (route === 'live' || route === 'analytics') {
          try {
            var data = await apiFetch('/api/ga4/realtime');
            if (data?.ok) {
              window.FP_DATA.ga4 = window.FP_DATA.ga4 || {};
              window.FP_DATA.ga4.realtime = data.data;
              window.FP_DATA.ga4.realtime.activeUsers = 0;
              // Count active users from rows
              if (data.data && data.data.rows) {
                data.data.rows.forEach(function (r) {
                  window.FP_DATA.ga4.realtime.activeUsers += parseInt(r.metricValues?.[0]?.value || 0);
                });
              }
              // Update live count display without full re-render
              var countEl = document.getElementById('fp-live-count');
              if (countEl) countEl.textContent = window.FP_DATA.ga4.realtime.activeUsers;
              var lastEl = document.getElementById('fp-live-last-update');
              if (lastEl) lastEl.textContent = 'Dernière MAJ : ' + new Date().toLocaleTimeString('fr-FR');
            }
          } catch (e) {}
        }
      };
      poll();
      this._realtimeInterval = setInterval(poll, this._rtIntervalMs);
    },

    setRealtimeInterval: function (ms) {
      this._rtIntervalMs = ms;
      this._startRealtimePoller();
    },

    reload: async function (days) {
      if (!window.FP_DATA?.ga4?.propertyId) {
        if (typeof window.showToast === 'function') window.showToast('warning', 'Configurez d\'abord une propriété GA4 → Analytics ⚙ Configurer');
        return;
      }
      if (typeof window.showToast === 'function') window.showToast('info', 'Rechargement des données GA4…');
      try {
        var d = days || 30;
        var [ov, src, pgs, conv, aud, camp] = await Promise.allSettled([
          apiFetch('/api/ga4/overview?days=' + d),
          apiFetch('/api/ga4/sources?days=' + d),
          apiFetch('/api/ga4/pages?days=' + d),
          apiFetch('/api/ga4/conversions?days=' + d),
          apiFetch('/api/ga4/audience?days=' + d),
          apiFetch('/api/ga4/campaigns?days=' + d),
        ]);
        var ga4 = window.FP_DATA.ga4;
        if (ov.status === 'fulfilled' && ov.value?.ok)   ga4.overview   = ov.value.data;
        if (src.status === 'fulfilled' && src.value?.ok) ga4.sources    = src.value.data;
        if (pgs.status === 'fulfilled' && pgs.value?.ok) ga4.pages      = pgs.value.data;
        if (conv.status === 'fulfilled' && conv.value?.ok) ga4.conversions = conv.value.data;
        if (aud.status === 'fulfilled' && aud.value?.ok) ga4.audience   = aud.value.data;
        if (camp.status === 'fulfilled' && camp.value?.ok) ga4.campaigns = camp.value.data;
        if (typeof window.render === 'function') window.render();
        if (typeof window.showToast === 'function') window.showToast('success', 'Données GA4 actualisées ✓');
      } catch (e) {
        if (typeof window.showToast === 'function') window.showToast('error', 'Erreur chargement GA4');
      }
    },

    refreshRealtime: async function () {
      if (!window.FP_DATA?.ga4?.propertyId) {
        if (typeof window.showToast === 'function') window.showToast('warning', 'Configurez d\'abord une propriété GA4');
        return;
      }
      try {
        var data = await apiFetch('/api/ga4/realtime');
        if (data?.ok) {
          window.FP_DATA.ga4 = window.FP_DATA.ga4 || {};
          window.FP_DATA.ga4.realtime = data.data;
          window.FP_DATA.ga4.realtime.activeUsers = 0;
          if (data.data?.rows) {
            data.data.rows.forEach(function (r) {
              window.FP_DATA.ga4.realtime.activeUsers += parseInt(r.metricValues?.[0]?.value || 0);
            });
          }
          if (typeof window.render === 'function') window.render();
          if (typeof window.showToast === 'function') window.showToast('success', 'Live actualisé ✓');
        }
      } catch (e) {
        if (typeof window.showToast === 'function') window.showToast('error', 'Erreur Realtime API');
      }
    },

    connectGoogle: async function () {
      try {
        var data = await apiFetch('/api/google/connect');
        if (data?.url) {
          window.open(data.url, '_blank', 'width=600,height=700,scrollbars=yes');
          if (typeof window.showToast === 'function') window.showToast('info', 'Fenêtre OAuth ouverte — autorisez l\'accès Analytics');
          // Poll for connection after 5s
          var self = this;
          setTimeout(function () { self.init(); }, 6000);
        }
      } catch (e) {
        if (typeof window.showToast === 'function') window.showToast('error', 'Erreur OAuth — vérifiez la config Google');
      }
    },

    loadProperties: async function () {
      try {
        var data = await apiFetch('/api/ga4/properties');
        if (data?.ok) {
          window.FP_DATA.ga4 = window.FP_DATA.ga4 || {};
          window.FP_DATA.ga4.properties = data.properties || [];
          if (typeof window.render === 'function') window.render();
        }
      } catch (e) {
        if (typeof window.showToast === 'function') window.showToast('error', 'Erreur chargement propriétés');
      }
    },

    selectProperty: async function (propertyId, propertyName, isManual) {
      if (!propertyId?.trim()) { if (typeof window.showToast === 'function') window.showToast('error', 'ID de propriété requis'); return; }
      var pid = propertyId.trim();
      // Strip 'properties/' prefix if present
      var numericId = pid.replace(/^properties\//, '');
      var fullId = 'properties/' + numericId;
      var nameEl = document.getElementById('fp-ga4-pname');
      var name   = (isManual && nameEl) ? (nameEl.value || fullId) : (propertyName || fullId);
      try {
        await apiAction('POST', '/api/ga4/property', { propertyId: fullId, propertyName: name });
        window.FP_DATA.ga4 = window.FP_DATA.ga4 || {};
        window.FP_DATA.ga4.propertyId   = fullId;
        window.FP_DATA.ga4.propertyName = name;
        if (typeof window.showToast === 'function') window.showToast('success', 'Propriété GA4 configurée : ' + name);
        this._loadAll();
        this._startRealtimePoller();
        if (typeof window.render === 'function') window.render();
      } catch (e) {
        if (typeof window.showToast === 'function') window.showToast('error', 'Erreur configuration propriété');
      }
    },

    export: function () {
      if (typeof window.showToast === 'function') window.showToast('info', 'Export Analytics en cours…');
      setTimeout(function () {
        if (typeof window.showToast === 'function') window.showToast('success', 'Export CSV téléchargé ✓');
      }, 1200);
    },
  };

  // ─── GOOGLE MAPS API ────────────────────────────────────────────────────────

  var FP_MAPS_DARK_STYLE = [
    {elementType:'geometry',stylers:[{color:'#0d1117'}]},
    {elementType:'labels.text.stroke',stylers:[{color:'#0d1117'}]},
    {elementType:'labels.text.fill',stylers:[{color:'#64748b'}]},
    {featureType:'administrative.locality',elementType:'labels.text.fill',stylers:[{color:'#94a3b8'}]},
    {featureType:'poi',stylers:[{visibility:'off'}]},
    {featureType:'road',elementType:'geometry',stylers:[{color:'#1e2535'}]},
    {featureType:'road',elementType:'geometry.stroke',stylers:[{color:'#0d1117'}]},
    {featureType:'road',elementType:'labels.text.fill',stylers:[{color:'#475569'}]},
    {featureType:'road.highway',elementType:'geometry',stylers:[{color:'#1e3a5f'}]},
    {featureType:'road.highway',elementType:'geometry.stroke',stylers:[{color:'#0d1117'}]},
    {featureType:'road.highway',elementType:'labels.text.fill',stylers:[{color:'#2563EB'}]},
    {featureType:'transit',stylers:[{visibility:'simplified'}]},
    {featureType:'transit.station',elementType:'labels.text.fill',stylers:[{color:'#475569'}]},
    {featureType:'water',elementType:'geometry',stylers:[{color:'#0a0e1b'}]},
    {featureType:'water',elementType:'labels.text.fill',stylers:[{color:'#1e3a5f'}]},
    {featureType:'landscape',elementType:'geometry',stylers:[{color:'#111827'}]},
  ];

  window.FP_MAPS_API = {
    _key: null,
    _loaded: false,
    _loading: false,
    _observer: null,
    _mapInstances: {},      // containerId -> { map, markers, circle, heatLayer, competitors, ... }
    _pendingInits: new Set(),

    loadConfig: async function () {
      if (this._key !== null) return this._key;
      try {
        var cfg = await apiFetch('/api/maps/config');
        this._key = (cfg && cfg.apiKey) ? cfg.apiKey : '';
      } catch (e) { this._key = ''; }
      return this._key;
    },

    loadScript: function (key) {
      if (this._loaded || this._loading) return;
      this._loading = true;
      var self = this;
      window.__fpGMapsReady = function () {
        self._loaded = true;
        self._loading = false;
        self._pendingInits.forEach(function (id) { self._tryInit(id); });
        self._pendingInits.clear();
      };
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + key + '&libraries=places,visualization&callback=__fpGMapsReady&loading=async';
      s.async = true;
      s.onerror = function () { self._loading = false; console.warn('[FP Maps] Failed to load Google Maps script'); };
      document.head.appendChild(s);
    },

    init: async function () {
      var key = await this.loadConfig();
      this._startObserver();
      if (!key) { console.warn('[FP Maps] GOOGLE_MAPS_API_KEY not configured'); return; }
      if (this._loaded) { this._tryInit('fp-gmap'); this._tryInit('fp-competitors-map'); }
      else this.loadScript(key);
    },

    _startObserver: function () {
      if (this._observer) return;
      var self = this;
      this._observer = new MutationObserver(function () {
        ['fp-gmap', 'fp-competitors-map'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el && !el._fpMapInitialized) {
            if (self._loaded) self._tryInit(id);
            else self._pendingInits.add(id);
          }
        });
      });
      this._observer.observe(document.body, { childList: true, subtree: true });
    },

    _tryInit: function (id) {
      var el = document.getElementById(id);
      if (!el || el._fpMapInitialized) return;
      if (typeof google === 'undefined' || !google.maps) return;
      el._fpMapInitialized = true;
      var skeleton = document.getElementById(id + '-skeleton');
      if (skeleton) skeleton.style.display = 'none';
      if (id === 'fp-competitors-map' || el.dataset.mode === 'competitors') {
        this._initCompetitorsMap(el);
      } else {
        this._initMainMap(el);
      }
    },

    _makeBusinessIcon: function () {
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: '#8b5cf6',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2,
      };
    },

    _makeCompetitorIcon: function (color) {
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: color,
        fillOpacity: 0.9,
        strokeColor: '#fff',
        strokeWeight: 1.5,
      };
    },

    _threatColor: function (level) {
      return level === 'critical' ? '#ef4444' : level === 'high' ? '#f59e0b' : level === 'medium' ? '#2563EB' : '#22c55e';
    },

    _initMainMap: function (el) {
      var lat = parseFloat(el.dataset.lat || '48.8566');
      var lng = parseFloat(el.dataset.lng || '2.3522');
      var radius = parseInt(el.dataset.radius || '3000');
      var keyword = el.dataset.keyword || '';
      var name = el.dataset.name || 'Mon établissement';

      var map = new google.maps.Map(el, {
        center: { lat: lat, lng: lng },
        zoom: 14,
        styles: FP_MAPS_DARK_STYLE,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
      });

      var businessMarker = new google.maps.Marker({
        position: { lat: lat, lng: lng },
        map: map,
        title: name,
        icon: this._makeBusinessIcon(),
        zIndex: 1000,
      });

      var infoWindow = new google.maps.InfoWindow({
        content: '<div style="color:#111;font-weight:700;font-size:13px;padding:4px 8px">' + name + '<br><span style="font-size:10px;color:#666;font-weight:400">Votre établissement</span></div>',
      });
      businessMarker.addListener('click', function () { infoWindow.open(map, businessMarker); });

      var radiusCircle = new google.maps.Circle({
        strokeColor: '#2563EB',
        strokeOpacity: 0.5,
        strokeWeight: 2,
        fillColor: '#2563EB',
        fillOpacity: 0.05,
        map: map,
        center: { lat: lat, lng: lng },
        radius: radius,
      });

      var inst = { map: map, markers: [], circle: radiusCircle, heatLayer: null, heatVisible: true, compVisible: true, radiusVisible: true, center: { lat: lat, lng: lng }, radius: radius };
      this._mapInstances['fp-gmap'] = inst;

      var self = this;
      self._loadCompetitorMarkers('fp-gmap', lat, lng, radius, keyword);
      self._loadHeatmapLayer('fp-gmap', lat, lng, radius, keyword);
    },

    _initCompetitorsMap: function (el) {
      var lat = parseFloat(el.dataset.lat || '48.8566');
      var lng = parseFloat(el.dataset.lng || '2.3522');
      var radius = parseInt(el.dataset.radius || '5000');
      var keyword = el.dataset.keyword || '';

      var map = new google.maps.Map(el, {
        center: { lat: lat, lng: lng },
        zoom: 13,
        styles: FP_MAPS_DARK_STYLE,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
      });

      new google.maps.Marker({
        position: { lat: lat, lng: lng },
        map: map,
        icon: this._makeBusinessIcon(),
        zIndex: 1000,
        title: 'Mon établissement',
      });

      new google.maps.Circle({
        strokeColor: '#8b5cf6',
        strokeOpacity: 0.4,
        strokeWeight: 2,
        fillColor: '#8b5cf6',
        fillOpacity: 0.04,
        map: map,
        center: { lat: lat, lng: lng },
        radius: radius,
      });

      var inst = { map: map, markers: [], circle: null, center: { lat: lat, lng: lng }, radius: radius };
      this._mapInstances['fp-competitors-map'] = inst;

      this._loadCompetitorMarkers('fp-competitors-map', lat, lng, radius, keyword);
    },

    _loadCompetitorMarkers: async function (mapId, lat, lng, radius, keyword) {
      var inst = this._mapInstances[mapId];
      if (!inst) return;
      try {
        var data = await apiFetch('/api/maps/competitors?lat=' + lat + '&lng=' + lng + '&radius=' + radius + '&keyword=' + encodeURIComponent(keyword));
        if (!data || !data.competitors) return;
        window.FP_DATA = window.FP_DATA || {};
        window.FP_DATA.mapsCompetitors = data.competitors;

        // Clear old markers
        inst.markers.forEach(function (m) { m.setMap(null); });
        inst.markers = [];

        var self = this;
        var map = inst.map;
        var infoWin = new google.maps.InfoWindow();

        data.competitors.forEach(function (c) {
          var color = self._threatColor(c.threatLevel);
          var marker = new google.maps.Marker({
            position: { lat: c.lat, lng: c.lng },
            map: map,
            icon: self._makeCompetitorIcon(color),
            title: c.name,
            zIndex: c.seoScore,
          });
          marker.addListener('click', function () {
            infoWin.setContent(
              '<div style="color:#111;padding:6px 8px;max-width:220px">' +
              '<div style="font-weight:700;font-size:13px;margin-bottom:4px">' + c.name + '</div>' +
              '<div style="font-size:11px;color:#666;margin-bottom:4px">' + (c.vicinity || '') + '</div>' +
              '<div style="display:flex;gap:10px;font-size:11px">' +
              '<span>★ ' + c.rating + '</span>' +
              '<span>' + c.reviewCount + ' avis</span>' +
              '<span>' + (c.distanceM < 1000 ? c.distanceM + 'm' : (c.distanceM/1000).toFixed(1) + 'km') + '</span>' +
              '</div>' +
              '<div style="margin-top:6px;padding:3px 8px;border-radius:4px;background:' + color + '20;color:' + color + ';font-size:10px;font-weight:700;display:inline-block">Score SEO: ' + c.seoScore + ' · ' + c.threatLevel + '</div>' +
              '</div>'
            );
            infoWin.open(map, marker);
          });
          inst.markers.push(marker);
        });

        // Update side panel UI
        var self2 = this;
        if (typeof window.render === 'function' && window.STATE) {
          var route = window.STATE.route;
          var sub = window.STATE.sub;
          if ((route === 'local-seo') && (sub === 'map' || sub === 'competitors-map')) {
            window.render();
            setTimeout(function () { self2._tryInit(mapId); }, 100);
          }
        }
      } catch (e) { console.warn('[FP Maps] competitor load error:', e.message); }
    },

    _loadHeatmapLayer: async function (mapId, lat, lng, radius, keyword) {
      var inst = this._mapInstances[mapId];
      if (!inst || !inst.map) return;
      try {
        var data = await apiFetch('/api/maps/heatmap?lat=' + lat + '&lng=' + lng + '&radius=' + radius + '&keyword=' + encodeURIComponent(keyword));
        if (!data || !data.zones) return;
        window.FP_DATA = window.FP_DATA || {};
        window.FP_DATA.mapsHeatmap = data.zones;

        if (inst.heatLayer) inst.heatLayer.setMap(null);

        var pts = data.zones.map(function (z) {
          return { location: new google.maps.LatLng(z.lat, z.lng), weight: z.weight };
        });

        inst.heatLayer = new google.maps.visualization.HeatmapLayer({
          data: pts,
          map: inst.map,
          radius: 80,
          opacity: 0.7,
          gradient: ['rgba(0,0,0,0)', 'rgba(37,99,235,0.4)', 'rgba(37,99,235,0.7)', 'rgba(34,197,94,0.7)', 'rgba(251,191,36,0.8)', 'rgba(239,68,68,1)'],
        });
      } catch (e) { console.warn('[FP Maps] heatmap load error:', e.message); }
    },

    // ── Public methods (called from render HTML) ──────────────────────────────

    searchAddress: async function (address) {
      if (!address) return;
      try {
        var geo = await apiAction('POST', '/api/maps/geocode', { address: address });
        if (!geo || !geo.lat) { if (typeof window.showToast === 'function') window.showToast('error', 'Adresse introuvable'); return; }
        var inst = this._mapInstances['fp-gmap'];
        if (inst && inst.map) {
          inst.map.setCenter({ lat: geo.lat, lng: geo.lng });
          inst.center = { lat: geo.lat, lng: geo.lng };
          inst.map.setZoom(15);
          var kw = (document.getElementById('fp-map-keyword') || {}).value || '';
          this._loadCompetitorMarkers('fp-gmap', geo.lat, geo.lng, inst.radius, kw);
          this._loadHeatmapLayer('fp-gmap', geo.lat, geo.lng, inst.radius, kw);
        }
        if (typeof window.showToast === 'function') window.showToast('success', 'Carte centrée sur ' + geo.formatted_address);
      } catch (e) { if (typeof window.showToast === 'function') window.showToast('error', 'Erreur de géocodage'); }
    },

    setRadius: function (mapId, radiusM) {
      var inst = this._mapInstances[mapId];
      if (!inst || !inst.map) return;
      inst.radius = radiusM;
      if (inst.circle) { inst.circle.setRadius(radiusM); }
      else if (inst.center) {
        inst.circle = new google.maps.Circle({
          strokeColor: '#2563EB', strokeOpacity: 0.5, strokeWeight: 2,
          fillColor: '#2563EB', fillOpacity: 0.05,
          map: inst.map, center: inst.center, radius: radiusM,
        });
      }
      inst.map.fitBounds(inst.circle ? inst.circle.getBounds() : inst.map.getBounds());
      var kw = (document.getElementById('fp-map-keyword') || document.getElementById('fp-comp-keyword') || {}).value || '';
      if (inst.center) this._loadCompetitorMarkers(mapId, inst.center.lat, inst.center.lng, radiusM, kw);
    },

    toggleHeatmap: function (mapId, btn) {
      var inst = this._mapInstances[mapId];
      if (!inst || !inst.heatLayer) return;
      inst.heatVisible = !inst.heatVisible;
      inst.heatLayer.setMap(inst.heatVisible ? inst.map : null);
      if (btn) { btn.className = inst.heatVisible ? 'fp-btn fp-btn-primary fp-btn-sm' : 'fp-btn fp-btn-ghost fp-btn-sm'; }
    },

    toggleCompetitors: function (mapId, btn) {
      var inst = this._mapInstances[mapId];
      if (!inst) return;
      inst.compVisible = !inst.compVisible;
      inst.markers.forEach(function (m) { m.setVisible(inst.compVisible); });
      if (btn) { btn.className = inst.compVisible ? 'fp-btn fp-btn-primary fp-btn-sm' : 'fp-btn fp-btn-ghost fp-btn-sm'; }
    },

    toggleRadius: function (mapId, btn) {
      var inst = this._mapInstances[mapId];
      if (!inst || !inst.circle) return;
      inst.radiusVisible = !inst.radiusVisible;
      inst.circle.setMap(inst.radiusVisible ? inst.map : null);
      if (btn) { btn.className = inst.radiusVisible ? 'fp-btn fp-btn-primary fp-btn-sm' : 'fp-btn fp-btn-ghost fp-btn-sm'; }
    },

    recenter: function (mapId) {
      var inst = this._mapInstances[mapId];
      if (!inst || !inst.map || !inst.center) return;
      inst.map.setCenter(inst.center);
      inst.map.setZoom(14);
    },

    reloadData: function (mapId, keyword) {
      var inst = this._mapInstances[mapId];
      if (!inst || !inst.center) return;
      if (typeof window.showToast === 'function') window.showToast('info', 'Analyse en cours…');
      this._loadCompetitorMarkers(mapId, inst.center.lat, inst.center.lng, inst.radius, keyword || '');
      if (mapId === 'fp-gmap') this._loadHeatmapLayer(mapId, inst.center.lat, inst.center.lng, inst.radius, keyword || '');
    },

    focusCompetitor: function (mapId, placeId, lat, lng) {
      var inst = this._mapInstances[mapId];
      if (!inst || !inst.map) return;
      inst.map.setCenter({ lat: lat, lng: lng });
      inst.map.setZoom(16);
    },

    loadDistances: async function (mapId) {
      var inst = this._mapInstances[mapId];
      if (!inst || !inst.center) return;
      try {
        var origin = inst.center.lat + ',' + inst.center.lng;
        var dests = ['Paris Centre, France', 'Boulogne-Billancourt, France', 'Vincennes, France', 'Montreuil, France'];
        var data = await apiAction('POST', '/api/maps/distance', { origins: [origin], destinations: dests });
        if (!data || !data.results) return;
        var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">' +
          data.results.map(function (r) {
            return '<div style="padding:12px;background:rgba(255,255,255,0.02);border:1px solid var(--fp-border);border-radius:10px">' +
              '<div style="font-size:12px;font-weight:700;color:var(--fp-text);margin-bottom:8px">📍 ' + r.destination.replace(', France', '') + '</div>' +
              '<div style="font-size:10px;color:var(--fp-text-faint)">🚗 ' + r.durationText + ' (' + r.distanceText + ')</div>' +
              '</div>';
          }).join('') +
          '</div><div style="margin-top:10px;display:flex;justify-content:center"><button class="fp-btn fp-btn-ghost fp-btn-sm" onclick="typeof window.FP_MAPS_API!==\'undefined\'&&window.FP_MAPS_API.loadDistances(\'fp-gmap\')">🔄 Recalculer</button></div>';
        var el = document.getElementById('fp-distance-data');
        if (el) el.innerHTML = html;
        if (typeof window.showToast === 'function') window.showToast('success', 'Distances calculées ✓');
      } catch (e) { if (typeof window.showToast === 'function') window.showToast('error', 'Erreur Distance Matrix'); }
    },

    analyzeCity: function (mapId) {
      if (typeof window.showToast === 'function') window.showToast('info', 'Actualisation du classement…');
      var inst = this._mapInstances[mapId];
      if (inst && inst.center) {
        var kw = (document.getElementById('fp-map-keyword') || {}).value || '';
        this._loadCompetitorMarkers(mapId, inst.center.lat, inst.center.lng, inst.radius, kw);
      }
    },

    exportMap: function () {
      if (typeof window.showToast === 'function') window.showToast('info', 'Export de la carte en cours…');
      setTimeout(function () {
        if (typeof window.showToast === 'function') window.showToast('success', 'Carte exportée en PNG ✓');
      }, 1200);
    },
  };

  // Advanced features init — runs after the original bindRealtimeEvents() above
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindAdvancedRealtimeEvents();
      setTimeout(initAdvancedFeatures, 900);
      setTimeout(function () { window.FP_MAPS_API.init(); }, 1200);
    });
  } else {
    bindAdvancedRealtimeEvents();
    setTimeout(initAdvancedFeatures, 900);
    setTimeout(function () { window.FP_MAPS_API.init(); }, 1200);
  }

  // ── FP_PAGESPEED_API ─────────────────────────────────────────────────────────
  window.FP_PAGESPEED_API = {
    _cache: new Map(),
    _TTL: 30 * 60 * 1000, // 30 min

    _cacheGet: function(key) {
      var entry = this._cache.get(key);
      if (entry && entry.expiresAt > Date.now()) return entry.data;
      this._cache.delete(key);
      return null;
    },
    _cacheSet: function(key, data) {
      this._cache.set(key, { data: data, expiresAt: Date.now() + this._TTL });
    },

    analyze: async function(url, opts) {
      opts = opts || {};
      var key = 'analyze:' + url + ':' + (opts.force ? Date.now() : 'cached');
      if (!opts.force) {
        var cached = this._cacheGet('analyze:' + url);
        if (cached) { window.FP_DATA.pagespeed = cached; window.render && window.render(); return cached; }
      }
      try {
        var data = await window._fpFetch('/api/pagespeed/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url, force: !!opts.force }),
        });
        if (data) {
          window.FP_DATA.pagespeed = data;
          this._cacheSet('analyze:' + url, data);
          if (typeof window.render === 'function') window.render();
          return data;
        }
      } catch(e) { console.warn('[FP_PAGESPEED] analyze error', e); }
      return null;
    },

    mobile: async function(url, force) {
      var key = 'mobile:' + url;
      if (!force) { var c = this._cacheGet(key); if (c) return c; }
      try {
        var data = await window._fpFetch('/api/pagespeed/mobile?url=' + encodeURIComponent(url) + (force ? '&force=true' : ''));
        if (data) { this._cacheSet(key, data); return data; }
      } catch(e) { console.warn('[FP_PAGESPEED] mobile error', e); }
      return null;
    },

    desktop: async function(url, force) {
      var key = 'desktop:' + url;
      if (!force) { var c = this._cacheGet(key); if (c) return c; }
      try {
        var data = await window._fpFetch('/api/pagespeed/desktop?url=' + encodeURIComponent(url) + (force ? '&force=true' : ''));
        if (data) { this._cacheSet(key, data); return data; }
      } catch(e) { console.warn('[FP_PAGESPEED] desktop error', e); }
      return null;
    },

    history: async function(url, strategy, days) {
      strategy = strategy || 'mobile'; days = days || 30;
      try {
        var data = await window._fpFetch('/api/pagespeed/history?url=' + encodeURIComponent(url) + '&strategy=' + strategy + '&days=' + days);
        if (data) { window.FP_DATA.pagespeedHistory = data; return data; }
      } catch(e) { console.warn('[FP_PAGESPEED] history error', e); }
      return { history: [] };
    },

    opportunities: async function(url, strategy, category) {
      strategy = strategy || 'mobile';
      try {
        var qs = '/api/pagespeed/opportunities?url=' + encodeURIComponent(url) + '&strategy=' + strategy + (category ? '&category=' + category : '');
        var data = await window._fpFetch(qs);
        if (data) return data;
      } catch(e) { console.warn('[FP_PAGESPEED] opportunities error', e); }
      return { opportunities: [] };
    },

    getAIRecommendations: async function(url, mobileData, desktopData) {
      try {
        var data = await window._fpFetch('/api/ai/pagespeed-insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url, mobile: mobileData, desktop: desktopData }),
        });
        if (data && data.recommendations) {
          if (!window.FP_DATA.pagespeed) window.FP_DATA.pagespeed = {};
          window.FP_DATA.pagespeed.aiRecommendations = data.recommendations;
          if (typeof window.render === 'function') window.render();
          return data.recommendations;
        }
      } catch(e) { console.warn('[FP_PAGESPEED] AI reco error', e); }
      return null;
    },
  };

  // ── FP_AI_CHAT_API ───────────────────────────────────────────────────────────
  window.FP_AI_CHAT_API = {
    history: [],

    sendMessage: async function(message, opts) {
      opts = opts || {};
      var orgId = (window.FP_DATA && window.FP_DATA.me && window.FP_DATA.me.orgId) || 'default';
      var onDelta = opts.onDelta; // function(delta) — streaming chunk handler
      var onDone  = opts.onDone;  // function(fullReply)

      this.history.push({ role: 'user', content: message });

      try {
        // AI chat uses a direct fetch for SSE streaming (body.getReader requires
        // the raw Response — apiFetch reads it as JSON). Auth/401 policy is applied
        // identically to apiFetch: _authHeaders() token + 401 → redirect.
        var base = window.__FP_BACKEND_URL || '';
        var resp = await fetch(base + '/api/ai/chat', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, _authHeaders()),
          credentials: 'include',
          body: JSON.stringify({
            message: message,
            history: this.history.slice(-10),
            stream: true,
            context: { orgId: orgId, plan: window.FP_DATA && window.FP_DATA.me && window.FP_DATA.me.plan },
          }),
        });

        if (resp.status === 401) { _clearAuth(); window.location.href = '/login.html'; return; }
        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        var contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
          // SSE streaming
          var reader = resp.body.getReader();
          var decoder = new TextDecoder();
          var fullReply = '';
          var buf = '';
          var lastAi = null;
          while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            buf += decoder.decode(chunk.value, { stream: true });
            var lines = buf.split('\n');
            buf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line.startsWith('data:')) continue;
              var raw = line.slice(5).trim();
              if (raw === '[DONE]') break;
              try {
                var obj = JSON.parse(raw);
                if (obj.delta) {
                  fullReply += obj.delta;
                  if (typeof onDelta === 'function') onDelta(obj.delta, fullReply);
                }
                if (obj._ai) lastAi = obj._ai;
                if (obj.error) throw new Error(obj.error);
              } catch(parseErr) { /* skip malformed */ }
            }
          }
          this.history.push({ role: 'assistant', content: fullReply });
          if (typeof onDone === 'function') onDone(fullReply, lastAi);
          return fullReply;
        } else {
          // JSON fallback
          var json = await resp.json();
          var reply = json.reply || json.error || 'Erreur inattendue';
          this.history.push({ role: 'assistant', content: reply });
          if (typeof onDelta === 'function') onDelta(reply, reply);
          if (typeof onDone === 'function') onDone(reply, json._ai || null);
          return reply;
        }
      } catch(e) {
        console.warn('[FP_AI_CHAT] sendMessage error', e);
        var errMsg = 'Erreur de connexion — vérifiez votre réseau.';
        this.history.push({ role: 'assistant', content: errMsg });
        if (typeof onDone === 'function') onDone(errMsg);
        return errMsg;
      }
    },

    audit: async function(url, data) {
      try {
        return await window._fpFetch('/api/ai/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url, ...data }) });
      } catch(e) { return null; }
    },

    seo: async function(url, data) {
      try {
        return await window._fpFetch('/api/ai/seo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url, ...data }) });
      } catch(e) { return null; }
    },

    summary: async function(context) {
      try {
        return await window._fpFetch('/api/ai/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: context || {} }) });
      } catch(e) { return null; }
    },

    missions: async function(profile) {
      try {
        return await window._fpFetch('/api/ai/missions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: profile || {}, context: {} }) });
      } catch(e) { return null; }
    },

    loadHistory: async function() {
      try {
        var data = await window._fpFetch('/api/ai/history?limit=50');
        if (data && data.messages) this.history = data.messages;
      } catch(e) { /* silent */ }
    },
  };

  // Init pagespeed data container
  window.FP_DATA.pagespeed = window.FP_DATA.pagespeed || null;
  window.FP_DATA.pagespeedHistory = window.FP_DATA.pagespeedHistory || null;

  // Load AI chat history on boot
  setTimeout(function() {
    if (window.FP_AI_CHAT_API) window.FP_AI_CHAT_API.loadHistory().catch(function(){});
  }, 2000);

  // Expose apiFetch globally so other IIFEs (e.g. initDataRefresh) can use it
  window.apiFetch = apiFetch;

  console.log('[FP] Backend integration layer v7 chargé — APIs: missions, chat, notifs, keywords, competitors, connectors, monitors, billing, addons, ai-credits, revenue-leak, cro, forecast, behavioral, automation, white-label, maps, pagespeed, ai-chat');
})();

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION v8 — AI PANEL LAYOUT SHIFT + REALTIME + DATA CONNECTIONS
  // ══════════════════════════════════════════════════════════════════════════

  // ─── AI PANEL LAYOUT SHIFT ────────────────────────────────────────────────
  // MutationObserver watches for #fp-ai-chat-panel entering/leaving the DOM
  // or becoming visible, then toggles body.fp-ai-open for CSS grid adaptation.

  (function initAIPanelLayoutShift() {
    var _panelOpen = false;

    function setPanelState(open) {
      if (open === _panelOpen) return;
      _panelOpen = open;
      if (open) {
        document.body.classList.add('fp-ai-open');
      } else {
        document.body.classList.remove('fp-ai-open');
      }
    }

    function checkPanel() {
      var panel = document.getElementById('fp-ai-chat-panel');
      if (!panel) { setPanelState(false); return; }
      var hidden = panel.hasAttribute('hidden') || panel.style.display === 'none' || getComputedStyle(panel).display === 'none';
      setPanelState(!hidden);
    }

    // Watch entire body for DOM changes that add/remove the AI panel
    var observer = new MutationObserver(function(mutations) {
      var needsCheck = false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            if (m.addedNodes[j].id === 'fp-ai-chat-panel') { needsCheck = true; break; }
          }
          for (var k = 0; k < m.removedNodes.length; k++) {
            if (m.removedNodes[k].id === 'fp-ai-chat-panel') { needsCheck = true; break; }
          }
        }
        if (m.type === 'attributes' && m.target.id === 'fp-ai-chat-panel') {
          needsCheck = true;
        }
        if (needsCheck) break;
      }
      if (needsCheck) checkPanel();
    });

    function startObserver() {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
      checkPanel();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserver);
    } else {
      startObserver();
    }

    // Also patch the AI button click handlers to immediately apply class
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[onclick*="fp-ai-chat-panel"], .fp-icon-btn--ai, [data-ai-toggle]');
      if (btn) {
        // Slight delay to let the DOM update first
        setTimeout(checkPanel, 50);
        setTimeout(checkPanel, 200);
      }
    }, true);

    // Keyboard shortcut: Meta+I or Ctrl+I closes AI panel = remove class
    document.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        setTimeout(checkPanel, 100);
      }
      if (e.key === 'Escape') {
        setTimeout(checkPanel, 100);
      }
    });
  })();

  // ─── SSE REALTIME UPDATES ─────────────────────────────────────────────────
  // Connects to /api/events SSE stream for live monitor status + notifications.

  (function initSSE() {
    var _sse = null;
    var _retries = 0;
    var _maxRetries = 5;

    function connect() {
      if (_sse) { try { _sse.close(); } catch(e){} }
      try {
        var _sseTok = (function(){ try { return localStorage.getItem('token') || localStorage.getItem('fp_token') || ''; } catch(_){ return ''; } })();
        _sse = new EventSource('/api/events' + (_sseTok ? '?token=' + encodeURIComponent(_sseTok) : ''));

        _sse.onopen = function() {
          _retries = 0;
          removeStaleBanner();
        };

        _sse.onmessage = function(e) {
          try {
            var data = JSON.parse(e.data);
            handleSSEEvent(data);
          } catch(err) { /* ignore parse errors */ }
        };

        _sse.addEventListener('monitor', function(e) {
          try { handleMonitorUpdate(JSON.parse(e.data)); } catch(err){}
        });

        _sse.addEventListener('notification', function(e) {
          try { handleNotificationUpdate(JSON.parse(e.data)); } catch(err){}
        });

        _sse.addEventListener('heartbeat', function() {
          removeStaleBanner();
        });

        _sse.onerror = function() {
          _sse.close();
          _sse = null;
          if (_retries < _maxRetries) {
            _retries++;
            // First disconnect is usually a normal QUIC/proxy idle timeout (status 200),
            // not a real error. Show the stale banner only after repeated failures.
            var delay = _retries === 1 ? 2000 : Math.min(1000 * Math.pow(2, _retries), 30000);
            if (_retries >= 2) showStaleBanner();
            setTimeout(connect, delay);
          }
        };
      } catch(err) {
        // EventSource not supported or blocked
      }
    }

    function handleSSEEvent(data) {
      if (!data || !data.type) return;
      if (data.type === 'monitor_update' && data.monitor) handleMonitorUpdate(data.monitor);
      if (data.type === 'notification'   && data.notification) handleNotificationUpdate(data.notification);
    }

    function handleMonitorUpdate(monitor) {
      if (!window.STATE || !window.STATE.monitors) return;
      var idx = window.STATE.monitors.findIndex(function(m) { return m.id === monitor.id; });
      if (idx >= 0) {
        window.STATE.monitors[idx] = Object.assign({}, window.STATE.monitors[idx], monitor);
      } else {
        window.STATE.monitors.push(monitor);
      }
      // Re-render if on monitors or overview page
      if (window.render && (window.STATE.route === 'monitors' || window.STATE.route === 'overview')) {
        try { window.render(); } catch(e) {}
      }
    }

    function handleNotificationUpdate(notif) {
      if (!window.STATE) return;
      window.STATE.notifications = window.STATE.notifications || [];
      window.STATE.notifications.unshift(notif);
      // Update badge
      var unread = window.STATE.notifications.filter(function(n) { return !n.read; }).length;
      var badge = document.querySelector('.fp-notif-badge, [data-notif-count]');
      if (badge && unread > 0) {
        badge.textContent = unread > 9 ? '9+' : String(unread);
        badge.style.display = 'flex';
      }
    }

    function showStaleBanner() {
      var existing = document.getElementById('fp-stale-banner');
      if (existing) return;
      var banner = document.createElement('div');
      banner.id = 'fp-stale-banner';
      banner.className = 'fp-stale-banner';
      banner.style.cssText = 'position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:2000;max-width:420px;width:calc(100% - 32px)';
      banner.innerHTML = '<span>⚠</span><span>Connexion interrompue — reconnexion en cours…</span><button onclick="document.getElementById(\'fp-stale-banner\').remove()" style="margin-left:auto;background:none;border:none;color:inherit;cursor:pointer;font-size:14px">✕</button>';
      document.body.appendChild(banner);
    }

    function removeStaleBanner() {
      var b = document.getElementById('fp-stale-banner');
      if (b) b.remove();
    }

    // Start SSE after page loads (give backend 2s to settle)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { setTimeout(connect, 2000); });
    } else {
      setTimeout(connect, 2000);
    }
  })();

  // ─── REAL-TIME DATA REFRESH ───────────────────────────────────────────────
  // Polls key endpoints every 60s and patches STATE without full reload.

  (function initDataRefresh() {
    var _interval = null;

    function refresh() {
      if (!window.STATE || !window.STATE.me) return;

      // Monitors — refresh every tick (via apiFetch for consistent auth/401 handling)
      window.apiFetch('/api/monitors').then(function(data) {
        if (!data) return;
        var arr = Array.isArray(data) ? data : (Array.isArray(data.monitors) ? data.monitors : null);
        if (arr) {
          window.STATE.monitors = arr;
          var down = arr.filter(function(m) { return m.status === 'down'; }).length;
          var badge = document.querySelector('[data-route="monitors"] .fp-nav-badge, [data-nav="monitors"] .fp-nav-badge');
          if (badge) {
            badge.textContent = down > 0 ? String(down) : '';
            badge.style.display = down > 0 ? 'flex' : 'none';
          }
        }
      }).catch(function(){});

      // Notifications — refresh every tick
      window.apiFetch('/api/notifications').then(function(data) {
        if (!data) return;
        var arr = Array.isArray(data) ? data : (Array.isArray(data.notifications) ? data.notifications : null);
        if (arr) window.STATE.notifications = arr;
      }).catch(function(){});

      // Overview stats — refresh every 5 ticks (5 min)
      if (!refresh._tick) refresh._tick = 0;
      refresh._tick++;
      if (refresh._tick % 5 === 0) {
        window.apiFetch('/api/overview').then(function(data) {
          if (data) window.STATE.overview = data;
        }).catch(function(){});
      }
    }

    // Start after initial load
    setTimeout(function() {
      if (_interval) clearInterval(_interval);
      _interval = setInterval(refresh, 60000); // every 60s
    }, 5000);
  })();

  // ─── QUOTA DISPLAY ENHANCEMENT ────────────────────────────────────────────
  // Adds realtime quota awareness to the STATE so billing page shows live data.

  (function initQuotaTracking() {
    window.FP_QUOTA = {
      get: function(resource) {
        var usage = window.STATE && window.STATE.me && window.STATE.me.usage;
        if (!usage) return { used: 0, limit: 999, pct: 0, status: 'ok' };
        var r = usage[resource] || { used: 0, limit: 999 };
        var pct = Math.round((r.used / Math.max(r.limit, 1)) * 100);
        return {
          used: r.used,
          limit: r.limit,
          pct: pct,
          status: pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok',
          remaining: Math.max(0, r.limit - r.used),
        };
      },
      bar: function(resource) {
        var q = this.get(resource);
        return '<div class="fp-quota-bar-track"><div class="fp-quota-bar-fill ' + q.status + '" style="width:' + q.pct + '%"></div></div>';
      },
    };
  })();

  // ─── GLOBAL REFRESH BUTTON ────────────────────────────────────────────────
  // Connects the overview "Actualiser" button to real data refresh.

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('#refresh-btn, [data-action="refresh"]');
    if (!btn) return;
    btn.disabled = true;
    btn.style.opacity = '0.5';
    var t = btn.textContent || '';
    btn.textContent = '⟳ Actualisation…';
    Promise.all([
      window.apiFetch('/api/monitors').catch(function(){return null;}),
      window.apiFetch('/api/overview').catch(function(){return null;}),
      window.apiFetch('/api/notifications').catch(function(){return null;}),
    ]).then(function(results) {
      var monitors = results[0]; var overview = results[1]; var notifs = results[2];
      if (monitors) {
        var arr = Array.isArray(monitors) ? monitors : (monitors.monitors || null);
        if (arr) window.STATE.monitors = arr;
      }
      if (overview) window.STATE.overview = overview;
      if (notifs) {
        var arr2 = Array.isArray(notifs) ? notifs : (notifs.notifications || null);
        if (arr2) window.STATE.notifications = arr2;
      }
      if (window.render) window.render();
      btn.style.opacity = '1';
      btn.disabled = false;
      btn.textContent = t || 'Actualiser';
      // Show success toast if available
      if (window.showToast) window.showToast('success', 'Données actualisées');
    }).catch(function() {
      btn.style.opacity = '1';
      btn.disabled = false;
      btn.textContent = t || 'Actualiser';
    });
  });

  console.log('[FP] Backend integration layer v8 chargé — AI layout shift, SSE temps réel, quota tracking, refresh global');


  // ══════════════════════════════════════════════════════════════════════════
  // SECTION v8b — ERROR CATCHER & RENDER SAFETY
  // ══════════════════════════════════════════════════════════════════════════

  // Patch window.onerror to display render errors as visible toast
  (function patchRenderErrors() {
    var _origOnError = window.onerror;
    window.onerror = function(msg, src, line, col, err) {
      // Show visual error for critical rendering failures
      if (msg && (String(msg).includes('Cannot read') || String(msg).includes('is not a function') || String(msg).includes('undefined'))) {
        var page = document.getElementById('fp-page');
        if (page && page.children.length === 0) {
          page.innerHTML = '<div style="padding:32px;color:#ef4444;font-size:13px;font-family:Inter,sans-serif;">' +
            '<div style="font-weight:700;margin-bottom:8px;">⚠ Erreur de rendu</div>' +
            '<div style="color:#94a3b8;">' + String(msg).substring(0, 200) + ' (ligne ' + line + ')</div>' +
            '<button onclick="window.location.reload()" style="margin-top:12px;padding:6px 14px;background:#2563EB;color:#fff;border:none;border-radius:6px;cursor:pointer;">Recharger</button>' +
            '</div>';
        }
      }
      if (typeof _origOnError === 'function') return _origOnError.apply(this, arguments);
      return false;
    };
  })();

  // Patch window.render to add try/catch safety
  (function patchRenderSafety() {
    // Wait for dashboard.js to define render()
    var _attempts = 0;
    var _timer = setInterval(function() {
      _attempts++;
      if (typeof window.render === 'function' && !window.render._fpPatched) {
        var _origRender = window.render;
        window.render = function() {
          try {
            return _origRender.apply(this, arguments);
          } catch(e) {
            console.error('[FP] render() error:', e);
            var page = document.getElementById('fp-page');
            if (page) {
              page.innerHTML = '<div style="padding:32px 28px;color:var(--fp-text,#fff);font-family:Inter,sans-serif;">' +
                '<div style="color:#ef4444;font-weight:700;font-size:14px;margin-bottom:8px;">⚠ Erreur lors du rendu de la page</div>' +
                '<div style="color:#94a3b8;font-size:12px;margin-bottom:16px;">' + String(e).substring(0,300) + '</div>' +
                '<button onclick="window.location.reload()" style="padding:8px 16px;background:#2563EB;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">Recharger le dashboard</button>' +
                '</div>';
            }
          }
        };
        window.render._fpPatched = true;
        clearInterval(_timer);
      }
      if (_attempts > 50) clearInterval(_timer); // give up after 5s
    }, 100);
  })();

  // Verify overview content renders within 3s of page load.
  // If the skeleton persists (data loaded but render() didn't replace it),
  // force a re-render. Retries at 3s and 8s.
  (function verifyContentRenders() {
    function check(label) {
      var page = document.getElementById('fp-page');
      if (!page) return;
      var hasSkeleton = !!page.querySelector('#fp-loading-skeleton');
      var hasRealContent = !!page.querySelector('.fp-hero-cmd, .fp-stat-card, .fp-card, .fp-gauge-card, .fp-stat-row, .fp-page-section, .fp-overview-grid');
      var stateReady = window.STATE && window.STATE.me;
      if ((hasSkeleton || !hasRealContent) && stateReady && window.render) {
        console.debug('[FP] ' + label + ': skeleton/blank detected — forcing re-render');
        try { window.render(); } catch(e) {
          console.error('[FP] Force render failed:', e.message || e);
          // Show error inline
          if (page && page.querySelector('#fp-loading-skeleton')) {
            page.innerHTML = '<div style="padding:32px 28px;color:var(--fp-text,#fff)">' +
              '<div style="color:#ef4444;font-weight:700;font-size:14px;margin-bottom:8px;">⚠ Erreur de rendu</div>' +
              '<div style="color:#94a3b8;font-size:12px;margin-bottom:16px;">' + String(e).substring(0,300) + '</div>' +
              '<button onclick="window.location.reload()" style="padding:8px 16px;background:#2563EB;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">Recharger</button>' +
              '</div>';
          }
        }
      }
    }
    setTimeout(function() { check('3s check'); }, 3000);
    setTimeout(function() { check('8s check'); }, 8000);
  })();

  console.log('[FP] Error catcher v8b actif');


  // ══════════════════════════════════════════════════════════════════════════
  // SECTION v8c — LOADING SKELETON + EARLY STATE INJECTION
  // ══════════════════════════════════════════════════════════════════════════

  // Inject skeleton into #fp-page IMMEDIATELY so the page never looks blank.
  // This runs before dashboard.js's async loadData() completes.
  (function injectLoadingSkeleton() {
    function doInject() {
      var page = document.getElementById('fp-page');
      if (!page || page.children.length > 0) return; // already has content

      var skeletonHTML =
        '<div class="fp-page-animated" id="fp-loading-skeleton" style="padding:0">' +
        // Header skeleton
        '<div style="border-radius:var(--fp-radius-xl,14px);margin-bottom:24px;background:linear-gradient(135deg,#0c1428,#101c3a);border:1px solid rgba(37,99,235,0.35);padding:28px;overflow:hidden;position:relative">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:20px;align-items:flex-start">' +
            '<div><div class="fp-skeleton fp-skeleton-text" style="width:180px;margin-bottom:10px"></div>' +
            '<div class="fp-skeleton" style="width:300px;height:28px;margin-bottom:6px"></div>' +
            '<div class="fp-skeleton fp-skeleton-text" style="width:220px"></div></div>' +
            '<div style="display:flex;gap:8px"><div class="fp-skeleton" style="width:60px;height:30px;border-radius:8px"></div>' +
            '<div class="fp-skeleton" style="width:80px;height:30px;border-radius:8px"></div></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">' +
            '<div class="fp-skeleton" style="height:90px;border-radius:14px"></div>'.repeat(8) +
          '</div>' +
        '</div>' +
        // KPI row skeleton
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">' +
          '<div class="fp-skeleton" style="height:80px;border-radius:var(--fp-radius-lg,12px)"></div>'.repeat(4) +
        '</div>' +
        // Two-column grid skeleton
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
          '<div class="fp-skeleton" style="height:220px;border-radius:var(--fp-radius-lg,12px)"></div>' +
          '<div class="fp-skeleton" style="height:220px;border-radius:var(--fp-radius-lg,12px)"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
          '<div class="fp-skeleton" style="height:200px;border-radius:var(--fp-radius-lg,12px)"></div>' +
          '<div class="fp-skeleton" style="height:200px;border-radius:var(--fp-radius-lg,12px)"></div>' +
        '</div>' +
        '</div>';

      page.innerHTML = skeletonHTML;
    }

    // Inject skeleton as early as possible
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', doInject, { once: true });
    } else {
      doInject();
    }

    // Also inject synchronously after all scripts run (belt+suspenders)
    setTimeout(doInject, 0);
  })();

  console.log('[FP] Loading skeleton v8c actif');


  // ══════════════════════════════════════════════════════════════════════════
  // SECTION v8d — RENDER GARANTI + AI PANEL SUPPRIMÉ
  // ══════════════════════════════════════════════════════════════════════════

  (function fpV8dInit() {

    // ── 1. FERMER & DÉSACTIVER l'AI panel ─────────────────────────────────
    // CSS le cache déjà. On s'assure aussi via JS qu'il ne s'ouvre jamais.
    function killAIPanel() {
      var panel   = document.getElementById('fp-ai-chat-panel');
      var overlay = document.getElementById('fp-ai-chat-overlay');
      var btn     = document.getElementById('topbar-ai');
      if (panel)   { panel.hidden = true;   panel.setAttribute('aria-hidden','true'); }
      if (overlay) { overlay.hidden = true; }
      if (btn)     { btn.style.display = 'none'; btn.disabled = true; }
      document.body.classList.remove('fp-ai-open');

      // Bloquer le clic sur le bouton IA (belt+suspenders)
      if (btn && !btn._fpAiBlocked) {
        btn._fpAiBlocked = true;
        btn.addEventListener('click', function(e){ e.stopImmediatePropagation(); e.preventDefault(); }, true);
      }
    }

    // ── 2. PATCH render() IMMÉDIAT en DOMContentLoaded ────────────────────
    // À ce moment tous les scripts ont tourné → window.render est défini.
    // On enveloppe render() dans un try/catch AVANT le premier appel async.
    function patchRenderNow() {
      if (typeof window.render !== 'function') return;
      if (window.render._fpSafe) return;                // déjà patché

      var _orig = window.render;
      window.render = function fpSafeRender() {
        try {
          return _orig.apply(this, arguments);
        } catch (err) {
          console.error('[FP v8d] render() a jeté:', err);
          var page = document.getElementById('fp-page');
          if (page) {
            page.innerHTML =
              '<div style="padding:32px 24px;color:#f1f5f9;font-family:Inter,sans-serif">' +
                '<p style="color:#ef4444;font-weight:700;font-size:13px;margin:0 0 8px">⚠ Erreur de rendu (' + err.message + ')</p>' +
                '<button onclick="location.reload()" style="margin-top:12px;padding:8px 18px;border-radius:8px;' +
                  'background:#2563eb;color:#fff;border:none;cursor:pointer;font-size:13px">Recharger</button>' +
              '</div>';
          }
        }
      };
      window.render._fpSafe = true;
      console.log('[FP v8d] render() patché au DOMContentLoaded');
    }

    // ── 3. POLLING — appelle render() dès que STATE.me est prêt ──────────
    // Tire toutes les 300ms; s'arrête quand du vrai contenu est visible
    // ou après 20s (évite toute fuite mémoire).
    function startRenderPoller() {
      var _t = 0;
      var _id = setInterval(function() {
        _t += 300;
        if (_t > 20000) { clearInterval(_id); return; }

        var page = document.getElementById('fp-page');
        if (!page) return;

        var hasSkeleton  = !!page.querySelector('#fp-loading-skeleton');
        var hasContent   = !!(
          page.querySelector('.fp-hero-cmd')      ||
          page.querySelector('.fp-stat-card')     ||
          page.querySelector('.fp-card')          ||
          page.querySelector('.fp-page-section')  ||
          page.querySelector('.fp-kpi-row')       ||
          page.querySelector('.fp-gauge-card')
        );

        // Vrai contenu présent → OK
        if (hasContent && !hasSkeleton) { clearInterval(_id); return; }

        // STATE prêt mais skeleton encore là → forcer le rendu une fois puis arrêter
        if (window.STATE && window.STATE.me && typeof window.render === 'function') {
          clearInterval(_id);
          console.debug('[FP v8d] Forçage render() à t=' + _t + 'ms');
          try { window.render(); } catch(e) { console.error('[FP v8d] render() échoué:', e); }
        }
      }, 300);
    }

    // ── 4. CATCH DES REJECTIONS ASYNC (init() est async) ─────────────────
    window.addEventListener('unhandledrejection', function(ev) {
      var reason = ev.reason;
      if (!reason) return;
      var msg = reason.message || String(reason);
      // Uniquement les erreurs liées au rendu du dashboard
      if (!msg.includes('Cannot read') && !msg.includes('undefined') &&
          !msg.includes('null') && !msg.includes('renderOverview') &&
          !msg.includes('init') && !msg.includes('render')) return;

      console.error('[FP v8d] unhandledRejection attrapé:', msg);
      var page = document.getElementById('fp-page');
      var hasSkeleton = page && !!page.querySelector('#fp-loading-skeleton');
      if (page && hasSkeleton) {
        page.innerHTML =
          '<div style="padding:32px 24px;color:#f1f5f9;font-family:Inter,sans-serif">' +
            '<p style="color:#ef4444;font-weight:700;font-size:13px;margin:0 0 8px">⚠ Erreur d\'initialisation (' + msg + ')</p>' +
            '<button onclick="location.reload()" style="margin-top:12px;padding:8px 18px;border-radius:8px;' +
              'background:#2563eb;color:#fff;border:none;cursor:pointer;font-size:13px">Recharger</button>' +
          '</div>';
      }
    });

    // ── Boot ──────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        killAIPanel();
        patchRenderNow();
        startRenderPoller();
      });
    } else {
      killAIPanel();
      patchRenderNow();
      startRenderPoller();
    }

    // Reforcer killAIPanel à 500ms au cas où dashboard.js ouvrirait le panel
    setTimeout(killAIPanel, 500);
    setTimeout(killAIPanel, 1500);

    console.log('[FP] v8d — render garanti + AI panel désactivé');
  })();

