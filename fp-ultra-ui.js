(()=>{
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));

  function toast(title, text=''){
    let t=$('.fpToastUltra');
    if(!t){t=document.createElement('div');t.className='fpToastUltra';document.body.appendChild(t)}
    t.innerHTML='<strong>'+title+'</strong>'+(text?'<span>'+text+'</span>':'');
    clearTimeout(t._tm);t._tm=setTimeout(()=>t.remove(),2600);
  }

  function commandBar(){
    if($('.fpCommandBar'))return;
    const bar=document.createElement('div');
    bar.className='fpCommandBar';
    bar.innerHTML='<button data-go="#overview">Overview</button><button data-go="#missions" class="primary">Missions</button><button data-go="#team">Équipe</button><button data-ultra-ai>Assistant IA</button>';
    document.body.appendChild(bar);
  }

  function enhanceEmptyStates(){
    $$('.m2Panel,.team3Panel,.fpCard').forEach(panel=>{
      if(panel.dataset.ultraEmpty)return;
      const txt=panel.textContent.trim();
      if(txt.length<35){
        panel.dataset.ultraEmpty='1';
        const e=document.createElement('div');
        e.className='fpEmptyPro';
        e.innerHTML='<strong>Prêt à enrichir</strong>Cette zone est préparée pour recevoir des données, actions et cartes premium.';
        panel.appendChild(e);
      }
    });
  }

  function enhanceButtons(){
    document.addEventListener('click',e=>{
      const go=e.target.closest('[data-go]');
      if(go){location.hash=go.dataset.go;toast('Navigation',go.dataset.go.replace('#',''));return}
      if(e.target.closest('[data-ultra-ai]')){toast('Assistant IA','Analyse locale prête : priorités, risques, quick wins.');return}
      const btn=e.target.closest('.fpBtn,.m2Btn,.team3Btn,button');
      if(!btn)return;
      const label=btn.textContent.trim().toLowerCase();
      if(label.includes('générer')){toast('Plan généré','Missions priorisées selon impact business.');return}
      if(label.includes('analyser')){toast('Analyse lancée','Mode local gratuit, prêt pour OpenAI si clé disponible.');return}
      if(label.includes('ouvrir')){toast('Détail mission','Vue détail prête à connecter au backend.');return}
    },true);
  }

  function routeEnhance(){setTimeout(()=>{commandBar();enhanceEmptyStates()},180)}
  document.addEventListener('DOMContentLoaded',()=>{enhanceButtons();routeEnhance()});
  window.addEventListener('hashchange',routeEnhance);
})();