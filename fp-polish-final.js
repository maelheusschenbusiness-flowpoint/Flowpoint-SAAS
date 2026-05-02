(()=>{
  const $=(s,r=document)=>r.querySelector(s);

  function fixMobileMenu(){
    const btn=$('#fpMenuBtn');
    const sidebar=$('#sidebar');
    const overlay=$('#fpOverlay');
    if(!btn||!sidebar||!overlay) return;
    btn.onclick=()=>{
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
    };
    overlay.onclick=()=>{
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    };
  }

  function smoothScroll(){
    document.querySelectorAll('a[href^="#"]').forEach(a=>{
      a.addEventListener('click',()=>{
        setTimeout(()=>window.scrollTo({top:0,behavior:'smooth'}),50);
      });
    });
  }

  function polishFeedback(){
    document.addEventListener('click',e=>{
      const btn=e.target.closest('button');
      if(!btn)return;
      btn.style.transform='scale(0.97)';
      setTimeout(()=>btn.style.transform='',120);
    });
  }

  document.addEventListener('DOMContentLoaded',()=>{
    fixMobileMenu();
    smoothScroll();
    polishFeedback();
  });
})();