// drawer + minimal interactivity
(function(){
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const navItems = Array.from(document.querySelectorAll('.nav-item'));
  const userEmailEl = document.getElementById('user-email');

  menuToggle && menuToggle.addEventListener('click', () => {
    // toggle sidebar on small screens
    if (window.innerWidth < 900) {
      sidebar.style.display = sidebar.style.display === 'block' ? 'none' : 'block';
    }
  });

  navItems.forEach(btn => {
    btn.addEventListener('click', (e) => {
      navItems.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      // optionally show/hide sections (example only)
      const target = btn.dataset.target;
      document.querySelectorAll('.card').forEach(c=>c.style.display='block');
      // simple behavior: scroll to element if exists
      const el = document.getElementById(target);
      if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
    })
  });

  // fetch /api/me if backend available, otherwise fallback
  async function loadMe(){
    try {
      const r = await fetch('/api/me', { credentials:'same-origin' });
      if(!r.ok) throw new Error('no user');
      const data = await r.json();
      userEmailEl.textContent = data.email || '—';
      document.getElementById('acct-plan').textContent = (data.plan || '—').toUpperCase();
      document.getElementById('acct-org').textContent = data.org?.name || '—';
      document.getElementById('acct-role').textContent = data.role || '—';
      // small kpi
      document.getElementById('kpi-monitors').textContent = data.usage?.monitors?.used ?? '0';
      // TODO: fetch monitors list and render
    } catch(e) {
      userEmailEl.textContent = 'not-signed-in';
    }
  }
  loadMe();
})();
