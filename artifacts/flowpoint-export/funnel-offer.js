/*
 * FlowPoint signup funnel — shared trial-first offer.
 *
 * One rendering for every plan card of the funnel (signin.html plan screen,
 * checkout.html plan picker): « N days free » first, the monthly price second.
 * Prices come from /api/plans/catalog and the trial length / eligibility from
 * the server quote; nothing here is hard-coded. Without a confirmed trial the
 * card shows the plain monthly price.
 */
(function () {
  'use strict';

  function eur(minor) {
    var v = (Number(minor) || 0) / 100;
    return '€' + (v % 1 === 0 ? String(v) : v.toFixed(2));
  }
  function trialDaysOf(q) { return q && q.trialEligible && q.trialDays > 0 ? q.trialDays : 0; }

  /* Bloc « essai d'abord » : gros « N days free », prix mensuel en second. */
  function offerHtml(priceMinor, trialDays) {
    if (trialDays > 0) {
      return '<div class="fp-trial-offer">' +
        '<div class="fp-trial-free">' + trialDays + ' days free</div>' +
        '<div class="fp-trial-after">' + eur(priceMinor) + '/month after trial</div>' +
      '</div>';
    }
    return '<div class="fp-plan-pick-price">' + eur(priceMinor) + '</div>' +
      '<div class="fp-plan-pick-unit">/month</div>';
  }

  /*
   * Fills every [data-fp-offer="<planId>"] element with the server offer.
   * Returns { trialDays, prices } or null when the server data is unavailable
   * (the static fallback stays in place).
   */
  async function fillPlanOffers(root, preRegisterToken) {
    try {
      var cr = await fetch('/api/plans/catalog', { credentials: 'include' });
      if (!cr.ok) return null;
      var catalog = await cr.json();
      var plans = (catalog && catalog.plans) || [];
      if (!plans.length) return null;
      var days = 0;
      try {
        var qr = await fetch('/api/billing/quote', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: plans[0].id, addons: {}, preRegisterToken: preRegisterToken || undefined })
        });
        var qd = await qr.json();
        if (qr.ok && qd && qd.quote) days = trialDaysOf(qd.quote);
      } catch (e) { days = 0; }
      var prices = {};
      plans.forEach(function (p) {
        prices[p.id] = p.priceMinor;
        var slot = (root || document).querySelector('[data-fp-offer="' + String(p.id).replace(/"/g, '') + '"]');
        if (slot) slot.innerHTML = offerHtml(p.priceMinor, days);
      });
      return { trialDays: days, prices: prices };
    } catch (e) { return null; }
  }

  window.FPOffer = { eur: eur, trialDaysOf: trialDaysOf, offerHtml: offerHtml, fillPlanOffers: fillPlanOffers };
})();
