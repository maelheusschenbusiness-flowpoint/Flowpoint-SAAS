(function () {
  'use strict';

  var isAnnual = false;

  var prices = {
    standard: { monthly: 29,  annual: 278  },
    pro:      { monthly: 79,  annual: 758  },
    enterprise:{ monthly: 249, annual: 2390 },
  };

  var labels = { standard: 'Standard', pro: 'Pro', enterprise: 'Enterprise' };

  function formatPrice(plan) {
    var p = isAnnual ? prices[plan].annual : prices[plan].monthly;
    var period = isAnnual ? '/an' : '/mois';
    return p + '€<span>' + period + '</span>';
  }

  function updatePrices() {
    Object.keys(prices).forEach(function (plan) {
      var el = document.getElementById('fp-price-' + plan);
      if (el) el.innerHTML = formatPrice(plan);
    });
    document.getElementById('fp-label-monthly').classList.toggle('active', !isAnnual);
    document.getElementById('fp-label-annual').classList.toggle('active', isAnnual);
    document.getElementById('fp-billing-toggle').classList.toggle('on', isAnnual);
  }

  document.getElementById('fp-billing-toggle').addEventListener('click', function () {
    isAnnual = !isAnnual;
    updatePrices();
  });

  document.getElementById('fp-plans-container').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-plan]');
    if (!btn) return;

    var plan = btn.dataset.plan;

    if (plan === 'enterprise') {
      window.location.href = 'mailto:hello@flowpoint.pro?subject=FlowPoint%20Enterprise';
      return;
    }

    var billing  = isAnnual ? 'annual' : 'monthly';

    /* Persist plan selection then route to checkout summary page */
    try { localStorage.setItem('fp_cart', JSON.stringify({ plan: plan, addons: {}, billing: billing })); } catch(e) {}

    btn.disabled = true;
    btn.innerHTML = '<span class="fp-spinner"></span>Chargement…';

    /* Route to checkout.html with plan pre-selected via URL param.
     * checkout.html reads fp_cart from localStorage (primary) or ?plan= (fallback)
     * and lets the user review before hitting Stripe. */
    window.location.href = '/checkout.html?plan=' + encodeURIComponent(plan) + '&billing=' + encodeURIComponent(billing);
  });

  document.querySelectorAll('.fp-faq-q').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var answer = btn.nextElementSibling;
      var icon   = btn.querySelector('span');
      var open   = answer.style.display === 'block';
      answer.style.display = open ? 'none' : 'block';
      if (icon) icon.textContent = open ? '+' : '−';
    });
  });

  updatePrices();
})();
