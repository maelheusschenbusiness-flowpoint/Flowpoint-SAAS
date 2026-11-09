/* Stub de Stripe.js pour la certification navigateur (servi par route Playwright
 * a la place de https://js.stripe.com/v3/). Aucun appel Stripe. Le « Payment
 * Element » est un champ carte local ; confirmSetup/confirmPayment appellent le
 * faux Stripe du harnais (POST /__fake/stripe/confirm-setup, meme origine).
 *
 * Scenarios : window.__FP_STRIPE_STUB = { loaderror: bool, neverReady: bool }.  */
(function () {
  'use strict';
  var opts = window.__FP_STRIPE_STUB || {};
  window.__fpStripeCalls = [];
  window.Stripe = function (pk) {
    window.__fpStripeCalls.push({ fn: 'Stripe', pk: pk });
    if (!/^pk_test_/.test(pk || '')) throw new Error('Invalid API Key provided: ' + String(pk).slice(0, 8));
    return {
      elements: function (cfg) {
        window.__fpStripeCalls.push({ fn: 'elements', hasSecret: !!(cfg && cfg.clientSecret) });
        var secret = cfg && cfg.clientSecret;
        return {
          __secret: secret,
          create: function (type) {
            var handlers = {};
            var host = null;
            return {
              mount: function (sel) {
                host = document.querySelector(sel);
                if (!host) return;
                host.innerHTML = '<label style="display:block;font-size:12px">Numéro de carte (stub)' +
                  '<input id="fake-card-number" data-testid="fake-card-number" inputmode="numeric" autocomplete="off" value="4242 4242 4242 4242" ' +
                  'style="width:100%;padding:12px 14px;font-size:16px;margin-top:6px"/></label>';
                if (opts.loaderror) { setTimeout(function () { (handlers.loaderror || []).forEach(function (h) { h({ error: { message: 'stub loaderror' } }); }); }, 10); }
                else if (!opts.neverReady) { setTimeout(function () { (handlers.ready || []).forEach(function (h) { h(); }); }, 10); }
              },
              on: function (ev, h) { (handlers[ev] = handlers[ev] || []).push(h); },
              destroy: function () { if (host) host.innerHTML = ''; }
            };
          }
        };
      },
      confirmSetup: function (args) { return confirm('setup', args); },
      confirmPayment: function (args) { return confirm('payment', args); }
    };
    function confirm(kind, args) {
      var card = (document.getElementById('fake-card-number') || {}).value || '';
      window.__fpStripeCalls.push({ fn: 'confirm_' + kind, card: card.replace(/\d(?=\d{4})/g, '*') });
      return fetch('/__fake/stripe/confirm-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSecret: args.elements.__secret, card: card }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { return d.error ? { error: d.error } : (kind === 'setup' ? { setupIntent: d.setupIntent } : { paymentIntent: d.setupIntent }); });
    }
  };
})();
