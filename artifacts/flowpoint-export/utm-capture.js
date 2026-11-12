/* utm-capture.js — campagne d'acquisition (UTM) jusqu'a l'abonnement.
 *
 * Reprise de la partie « campagne » du tracker de la branche Flowpoint, SANS son
 * identifiant de visiteur : l'identite reste celle des trackers de cette branche
 * (`fp_vid`), pour ne pas compter deux fois un meme visiteur.
 *
 * REGLES.
 *  - Aucun effet sans le cookie `fp_analytics_consent=accepted`.
 *  - Trois libelles seulement (utm_source, utm_medium, utm_campaign), en minuscules,
 *    motif ^[a-z0-9._-]{1,64}$ : une valeur hors motif est ignoree, jamais tronquee.
 *  - Premiere touche : une campagne deja rangee l'emporte sur l'URL.
 *  - Ajoutes aux seuls corps JSON des requetes de suivi ; le serveur les valide a
 *    nouveau et ne les enregistre qu'avec le consentement.
 */
(function () {
  'use strict';
  var CONSENT_COOKIE = 'fp_analytics_consent';
  var CAMPAIGN_KEY = 'fp_funnel_campaign';
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'];
  var UTM_RE = /^[a-z0-9._-]{1,64}$/;
  var TRACKED = { '/api/auth/pre-register': 1, '/api/public/checkout-session': 1, '/api/public/payment-intent': 1, '/api/public/funnel-event': 1 };

  function hasConsent() {
    try {
      return document.cookie.split(';').some(function (c) { return c.trim() === CONSENT_COOKIE + '=accepted'; });
    } catch (_) { return false; }
  }
  function clean(raw) {
    if (typeof raw !== 'string') return null;
    var v = raw.trim().toLowerCase();
    return UTM_RE.test(v) ? v : null;
  }
  function campaign() {
    if (!hasConsent()) return {};
    var out = {}, stored = null, k, v;
    try { stored = JSON.parse(localStorage.getItem(CAMPAIGN_KEY) || 'null'); } catch (_) {}
    if (stored && typeof stored === 'object') {
      for (var i = 0; i < UTM_KEYS.length; i++) { k = UTM_KEYS[i]; v = clean(stored[k]); if (v) out[k] = v; }
    }
    if (Object.keys(out).length) return out;
    try {
      var params = new URLSearchParams(window.location.search);
      for (var j = 0; j < UTM_KEYS.length; j++) { k = UTM_KEYS[j]; v = clean(params.get(k)); if (v) out[k] = v; }
      if (Object.keys(out).length) localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(out));
    } catch (_) {}
    return out;
  }

  var originalFetch = window.fetch && window.fetch.bind(window);
  if (!originalFetch) return;
  window.fetch = function (input, init) {
    try {
      if (hasConsent() && typeof input === 'string' && init && typeof init.body === 'string') {
        var path = new URL(input, window.location.href).pathname;
        if (TRACKED[path]) {
          var body = JSON.parse(init.body);
          var utm = campaign();
          if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(utm).length) {
            var merged = {};
            for (var key in body) if (Object.prototype.hasOwnProperty.call(body, key)) merged[key] = body[key];
            for (var u in utm) if (merged[u] === undefined) merged[u] = utm[u];
            init = Object.assign({}, init, { body: JSON.stringify(merged) });
          }
        }
      }
    } catch (_) { /* une mesure ratee ne doit jamais bloquer la requete */ }
    return originalFetch(input, init);
  };
  campaign(); // premiere touche : range des l'arrivee, si consentement
})();
