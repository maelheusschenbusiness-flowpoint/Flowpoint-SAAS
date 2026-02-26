/* dashboard.js — navigation + mobile drawer + mini chart (sans libs) */

(function(){
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const openSidebarBtn = document.getElementById("openSidebar");
  const closeSidebarBtn = document.getElementById("closeSidebar");

  const navItems = Array.from(document.querySelectorAll(".nav__item"));
  const pages = Array.from(document.querySelectorAll(".page"));

  function isMobile(){
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function openSidebar(){
    sidebar.classList.add("is-open");
    overlay.hidden = false;
  }

  function closeSidebar(){
    sidebar.classList.remove("is-open");
    overlay.hidden = true;
  }

  if(openSidebarBtn) openSidebarBtn.addEventListener("click", openSidebar);
  if(closeSidebarBtn) closeSidebarBtn.addEventListener("click", closeSidebar);
  if(overlay) overlay.addEventListener("click", closeSidebar);

  // Route switch
  function setRoute(route){
    navItems.forEach(btn => btn.classList.toggle("is-active", btn.dataset.route === route));
    pages.forEach(p => p.classList.toggle("is-active", p.dataset.page === route));

    // scroll top main on route change (nice)
    window.scrollTo({ top: 0, behavior: "smooth" });

    if(isMobile()) closeSidebar();
  }

  navItems.forEach(btn => {
    btn.addEventListener("click", () => setRoute(btn.dataset.route));
  });

  // Default route
  setRoute("overview");

  // “Fake” dropdown for range (simple)
  const rangeBtn = document.getElementById("rangeBtn");
  const rangeLabel = document.getElementById("rangeLabel");
  const ranges = ["Last 30 days", "Last 7 days", "Today"];

  if(rangeBtn && rangeLabel){
    rangeBtn.addEventListener("click", () => {
      const current = rangeLabel.textContent.trim();
      const idx = ranges.indexOf(current);
      const next = ranges[(idx + 1) % ranges.length];
      rangeLabel.textContent = next;
    });
  }

  // Buttons: prevent “nothing happens” feeling (tu brancheras tes vraies routes ensuite)
  const toast = (msg) => {
    console.log(msg);
    const s = document.getElementById("statusText");
    if(s) s.textContent = msg;
    setTimeout(() => {
      if(s) s.textContent = "Dashboard à jour — OK";
    }, 1200);
  };

  const bind = (id, msg) => {
    const el = document.getElementById(id);
    if(el) el.addEventListener("click", () => toast(msg));
  };

  bind("refreshBtn", "Refresh…");
  bind("exportAuditsBtn", "Export Audits CSV…");
  bind("exportMonitorsBtn", "Export Monitors CSV…");
  bind("runAuditBtn", "Run audit…");
  bind("addMonitorBtn", "Add monitor…");
  bind("seePlansBtn", "See plans…");
  bind("billingPortalBtn", "Billing portal…");
  bind("logoutBtn", "Logout…");
  bind("viewAllIncidentsBtn", "View incidents…");

  // Simple chart (canvas) — vibe comme ton exemple
  function drawChart(){
    const canvas = document.getElementById("seoChart");
    if(!canvas) return;
    const ctx = canvas.getContext("2d");

    // Responsive canvas
    const parent = canvas.parentElement;
    const w = parent.clientWidth - 6;
    canvas.width = Math.max(320, w);
    canvas.height = 140;

    const data = [18, 22, 28, 25, 20, 35, 30, 24, 28, 22, 30];
    const pad = 16;
    const W = canvas.width, H = canvas.height;
    const min = Math.min(...data), max = Math.max(...data);
    const xStep = (W - pad*2) / (data.length - 1);

    const y = (v) => {
      const t = (v - min) / (max - min || 1);
      return (H - pad) - t * (H - pad*2);
    };

    ctx.clearRect(0,0,W,H);

    // grid lines
    ctx.strokeStyle = "rgba(148,163,184,.55)";
    ctx.lineWidth = 1;
    for(let i=0;i<3;i++){
      const yy = pad + i*(H-pad*2)/2;
      ctx.beginPath();
      ctx.moveTo(pad, yy);
      ctx.lineTo(W-pad, yy);
      ctx.stroke();
    }

    // area fill
    ctx.beginPath();
    ctx.moveTo(pad, y(data[0]));
    data.forEach((v,i)=>{
      ctx.lineTo(pad + i*xStep, y(v));
    });
    ctx.lineTo(pad + (data.length-1)*xStep, H-pad);
    ctx.lineTo(pad, H-pad);
    ctx.closePath();
    ctx.fillStyle = "rgba(37,99,235,.10)";
    ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(pad, y(data[0]));
    data.forEach((v,i)=>{
      ctx.lineTo(pad + i*xStep, y(v));
    });
    ctx.strokeStyle = "rgba(37,99,235,.95)";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  window.addEventListener("resize", drawChart);
  drawChart();
})();
