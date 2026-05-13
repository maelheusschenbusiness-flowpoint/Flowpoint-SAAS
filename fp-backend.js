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

  function apiFetch(path, opts) {
    return fetch(path, Object.assign({ credentials: 'include' }, opts || {}))
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
        return res.json();
      });
  }

  function apiAction(method, path, body) {
    return fetch(path, {
      method: method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
      return res.json();
    });
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
        await fetch('/api/missions/' + id, { method: 'DELETE', credentials: 'include' });
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
        await fetch('/api/notifications/' + id + '/read', { method: 'PATCH', credentials: 'include' });
      } catch (e) { console.warn('[FP] notif markRead error:', e.message); }
    },

    markAllRead: async function () {
      try {
        await fetch('/api/notifications/read-all', { method: 'PATCH', credentials: 'include' });
      } catch (e) { console.warn('[FP] notif markAllRead error:', e.message); }
    },

    delete: async function (id) {
      try {
        await fetch('/api/notifications/' + id, { method: 'DELETE', credentials: 'include' });
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
        await fetch('/api/keywords/' + id, { method: 'DELETE', credentials: 'include' });
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
        await fetch('/api/competitors/' + id, { method: 'DELETE', credentials: 'include' });
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

  console.log('[FP] Backend integration layer v4 chargé — APIs: missions, chat, notifs, keywords, competitors, connectors, monitors, billing');
})();
