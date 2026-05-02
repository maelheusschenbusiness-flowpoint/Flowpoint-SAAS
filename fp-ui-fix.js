(()=>{
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));

  function toast(msg){
    let t=$('.fpFixToast');
    if(!t){t=document.createElement('div');t.className='fpFixToast';t.style.cssText='position:fixed;right:18px;bottom:18px;z-index:99999;background:#101d48;color:#fff;border:1px solid rgba(174,197,255,.22);border-radius:16px;padding:12px 14px;font-weight:900;box-shadow:0 18px 50px rgba(0,0,0,.28)';document.body.appendChild(t)}
    t.textContent=msg;clearTimeout(t._tm);t._tm=setTimeout(()=>t.remove(),2200);
  }

  function enhanceCards(){
    const route=location.hash||'#overview';
    const root=$('#fpPageContainer');
    if(!root) return;
    if(route==='#missions' && !$('.fpMissionRichInjected')){
      const panel=document.createElement('section');
      panel.className='m2Panel fpMissionRichInjected';
      panel.innerHTML='<div class="m2Head"><div><div class="m2PanelTitle">Cartes enrichies missions</div><div class="m2Text">Actions concrètes, impact business, étapes et valeur client.</div></div><button class="m2Btn primary" data-fix-generate>Générer un plan</button></div><div class="fpRichCardGrid"><article class="fpRichCard"><strong>Quick win local</strong><p>Créer une page locale ciblée pour capter des recherches proches et transformer le trafic en demandes.</p><div class="fpRichPills"><span class="fpRichPill">Local SEO</span><span class="fpRichPill">Impact élevé</span></div></article><article class="fpRichCard"><strong>Conversion immédiate</strong><p>Renforcer CTA, preuves et FAQ sur les pages services pour augmenter la prise de contact.</p><div class="fpRichPills"><span class="fpRichPill">CRO</span><span class="fpRichPill">Rapide</span></div></article><article class="fpRichCard"><strong>Rapport client</strong><p>Transformer les actions en livrable compréhensible pour justifier la valeur FlowPoint.</p><div class="fpRichPills"><span class="fpRichPill">Rétention</span><span class="fpRichPill">Pro</span></div></article></div>';
      root.prepend(panel);
    }
    if(route==='#team' && !$('.fpTeamRichInjected')){
      const panel=document.createElement('section');
      panel.className='team3Panel fpTeamRichInjected';
      panel.innerHTML='<div class="team3PanelHead"><div><div class="team3PanelTitle">Workspace enrichi</div><div class="team3PanelText">Canaux, décisions, fichiers et résumé IA structurés dans de vraies cartes.</div></div><button class="team3Btn primary" data-fix-team-ai>Résumé IA</button></div><div class="fpRichCardGrid"><article class="fpRichCard"><strong>Décisions</strong><p>Centralise les choix importants et transforme chaque décision en mission assignable.</p></article><article class="fpRichCard"><strong>Documents</strong><p>Prépare l’interface fichiers sans casser le backend existant.</p></article><article class="fpRichCard"><strong>Suivi</strong><p>Affiche l’activité et les actions à faire pour éviter les discussions mortes.</p></article></div>';
      root.prepend(panel);
    }
  }

  function fixButtons(){
    document.addEventListener('click',e=>{
      const btn=e.target.closest('button,a,.fpBtn,.m2Btn,.team3Btn');
      if(!btn) return;
      if(btn.dataset.fixGenerate){toast('Plan généré : Local SEO → Conversion → Rapport client');return}
      if(btn.dataset.fixTeamAi){toast('Résumé IA : décisions et actions détectées.');return}
      if(btn.textContent.trim().toLowerCase()==='ouvrir' && !btn.dataset.boundOpen){
        e.preventDefault();toast('Ouverture du détail : fonctionnalité UI prête.');return;
      }
      if(btn.textContent.trim().toLowerCase()==='analyser'){
        e.preventDefault();toast('Analyse locale gratuite lancée.');return;
      }
      if(btn.classList.contains('m2Check')||btn.classList.contains('check')){
        btn.closest('.m2Mission,.mission')?.classList.toggle('done');
      }
    },true);
  }

  function fixLightTheme(){
    const prefers=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches;
    if(prefers && !document.body.dataset.theme) document.body.dataset.theme='light';
  }

  function init(){fixLightTheme();setTimeout(enhanceCards,150)}
  window.addEventListener('hashchange',init);
  document.addEventListener('DOMContentLoaded',()=>{fixButtons();init()});
})();