// dashboard.js

// ── DATA ──────────────────────────────────────────────────────────────────────

const ACTIONS = [
  { icon: 'orange', text: 'Ajouter témoignages – 158.3 mots 300-150 zone...', price: '$1.28', done: false },
  { icon: 'green',  text: 'Ajouter témoignages – 158.3 mots 350-150 an...',   price: '$1.35', done: false },
  { icon: 'green',  text: 'Renseigner témoignages – 304.3 mots 350-130...',   price: '$1.14', done: false },
  { icon: 'green',  text: 'Ajouter topnav/s – 191.314.02 350.97/114 350',     price: '$1.21', done: false },
];

const INCIDENTS = [
  { name: 'financiaro.com',   barWidth: 85, status: 'Paid', amount: '4,789.00',  link: 'View Log', time: '18 Jan 25 ago' },
  { name: 'leclercauto.com',  barWidth: 60, status: 'Paid', amount: '5,510,938', link: 'View Log', time: '' },
  { name: 'leclercauto.com',  barWidth: 40, status: 'Paid', amount: 'Pour de fona', link: '',      time: '' },
];

const MONITORS = [
  { url: 'leclercauto.com', status: 'up',   interval: 'Local',    lastChecked: '1:30:19 ago', responseTime: '92 url' },
  { url: 'leclercauto.com', status: 'down', interval: '23 Avns',  lastChecked: '1:30:19 ago', responseTime: '22 Continuous' },
  { url: 'leclercauto.com', status: 'up',   interval: 'Broad',    lastChecked: '1:30:19 ago', responseTime: '52 Continuous' },
  { url: 'leclercauto.com', status: 'down', interval: '21 Parts', lastChecked: '1:32:19 ago', responseTime: '52 Continuous' },
];

const PLANS = [
  {
    name: 'Standard', price: '29', period: '/mo/site', featured: false,
    features: ['Reoccur to com','SEO Dyxfit déseuver-mano','Gooo Rp6.0-24','For vert 08 bho fenix','UFO Manified Monitors'],
    btnClass: 'plan-btn-outline', btnLabel: 'Manage Subscription',
  },
  {
    name: 'Pro', price: '79', period: '/mo', featured: true, selector: true,
    features: ['TGO Dyxfit.12','G Google Maps','For xcnt 6 Montitage','UFO Manified Monitors'],
    btnClass: 'plan-btn-primary', btnLabel: 'Upgrade Subscription',
  },
  {
    name: 'Ultra', price: '149', period: '/status', featured: false,
    features: ['Reocurser 0 rigs','SEO Dyxfit 9 ur poner mano','Gooto Bop.0.24','The vers 10 Mo Fenix','UFO Manified Monitors'],
    btnClass: 'plan-btn-dark', btnLabel: 'Update Payment Method',
  },
];

// ── RENDER FUNCTIONS ──────────────────────────────────────────────────────────

function renderActions() {
  const el = document.getElementById('actionsList');
  if (!el) return;
  el.innerHTML = ACTIONS.map((a, i) => `
    <div class="action-item">
      <span class="action-icon ${a.icon}"></span>
      <span class="action-text" title="${a.text}">${a.text}</span>
      <span class="action-price">${a.price}</span>
      <button class="action-btn-mark" onclick="markDone(${i}, this)">Mark as done</button>
    </div>
  `).join('');
}

window.markDone = function(i, btn) {
  ACTIONS[i].done = !ACTIONS[i].done;
  const item = btn.closest('.action-item');
  const text = item.querySelector('.action-text');
  if (ACTIONS[i].done) {
    item.style.opacity = '0.5';
    text.style.textDecoration = 'line-through';
    btn.textContent = 'Undo';
  } else {
    item.style.opacity = '1';
    text.style.textDecoration = 'none';
    btn.textContent = 'Mark as done';
  }
};

function renderIncidents() {
  const el = document.getElementById('incidentsList');
  if (!el) return;
  el.innerHTML = INCIDENTS.map(inc => `
    <div class="incident-item">
      <span class="incident-name">${inc.name}</span>
      <div class="incident-bar"><div class="incident-bar-fill" style="width:${inc.barWidth}%"></div></div>
      ${inc.time ? `<span style="font-size:11px;color:var(--gray-400)">${inc.time}</span>` : ''}
      <span class="incident-status">${inc.status}</span>
      <span class="incident-cost">${inc.amount}</span>
      ${inc.link ? `<a href="#" class="incident-link">${inc.link}</a>` : ''}
    </div>
  `).join('');
}

function renderMonitors() {
  const el = document.getElementById('monitorsTableBody');
  if (!el) return;
  el.innerHTML = MONITORS.map(m => `
    <tr>
      <td><div class="monitor-url"><input type="checkbox" checked><span>${m.url}</span></div></td>
      <td><span class="status-dot status-${m.status}">${m.status === 'up' ? 'Up' : 'Down'}</span></td>
      <td>${m.interval}</td>
      <td>${m.lastChecked}</td>
      <td>${m.responseTime}</td>
    </tr>
  `).join('');
}

function renderBilling() {
  const el = document.getElementById('billingTabContent');
  if (!el) return;
  el.innerHTML = `
    <div class="plans-grid">
      ${PLANS.map(p => `
        <div class="plan-card ${p.featured ? 'featured' : ''}">
          <div class="plan-name">${p.name}</div>
          <div class="plan-price">
            <sup>€</sup>${p.price}
            ${p.selector
              ? `<div class="plan-period-selector">
                  /mo
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>`
              : `<span class="period">${p.period}</span>`
            }
          </div>
          <div class="plan-features">
            ${p.features.map(f => `<div class="plan-feature">${f}</div>`).join('')}
          </div>
          <button class="plan-btn ${p.btnClass}">${p.btnLabel}</button>
        </div>
      `).join('')}
    </div>
  `;
}

// ── CHART ─────────────────────────────────────────────────────────────────────

function initChart() {
  const canvas = document.getElementById('seoChart');
  if (!canvas) return;
  const labels = Array.from({ length: 31 }, (_, i) => {
    if (i % 5 !== 0) return '';
    const d = new Date();
    d.setDate(d.getDate() - (30 - i));
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  });
  const rand = (base, variance, trend) =>
    Array.from({ length: 31 }, (_, i) =>
      Math.round(base + trend * i + (Math.random() - 0.5) * variance)
    );
  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Performances', data: rand(65, 12, 0.4), borderColor: '#2563EB', backgroundColor: 'rgba(37,99,235,0.08)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4 },
        { label: 'Active',       data: rand(55,  8, 0.2), borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.05)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4 },
        { label: 'Incidents',    data: rand(20, 15,-0.1), borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.05)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          backgroundColor: 'white', borderColor: '#E5E7EB', borderWidth: 1,
          titleColor: '#111827', bodyColor: '#6B7280',
          bodyFont: { family: 'Inter', size: 12 },
          titleFont: { family: 'Inter', size: 12, weight: '600' },
          padding: 10, boxPadding: 4,
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#9CA3AF', font: { size: 11 } } },
        y: { grid: { color: '#F3F4F6' }, border: { display: false }, ticks: { color: '#9CA3AF', font: { size: 11 } } },
      },
      interaction: { mode: 'index', intersect: false },
    },
  });
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────

function initNav() {
  document.querySelectorAll('.sidebar-nav a[data-page]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.sidebar-nav a').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      link.classList.add('active');
      const page = document.getElementById('page-' + link.dataset.page);
      if (page) page.classList.add('active');
    });
  });
}

// ── BILLING TABS ──────────────────────────────────────────────────────────────

function initBillingTabs() {
  document.querySelectorAll('.billing-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.billing-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
}

// ── DATE PICKER ───────────────────────────────────────────────────────────────

function initDatePicker() {
  const ranges = ['Last 7 days', 'Last 30 days', 'Last 90 days', 'Last 12 months'];
  let idx = 1;
  const btn = document.getElementById('datePicker');
  const label = document.getElementById('dateLabel');
  if (btn && label) {
    btn.addEventListener('click', () => {
      idx = (idx + 1) % ranges.length;
      label.textContent = ranges[idx];
    });
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderActions();
  renderIncidents();
  renderMonitors();
  renderBilling();
  initChart();
  initNav();
  initBillingTabs();
  initDatePicker();
});
```

---

**Structure des fichiers dans ton dossier :**
```
mon-projet/
├── dashboard.html   ← coller le bloc 3
├── dashboard.css    ← coller le bloc 2
├── dashboard.js     ← coller le bloc 4
└── style.css        ← coller le bloc 1
