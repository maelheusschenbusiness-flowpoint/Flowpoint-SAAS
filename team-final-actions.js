(()=>{
  const KEY='fp_team_workspace_v5';
  const root=()=>document.getElementById('fpPageContainer');
  const route=()=>String(location.hash||'').toLowerCase();
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{};}catch{return {};}};
  const save=(s)=>{try{localStorage.setItem(KEY,JSON.stringify(s));}catch{}};
  const planText=()=>String(document.getElementById('fpAccPlan')?.textContent||'Standard').trim();
  const trialText=()=>String(document.getElementById('fpAccTrial')?.textContent||'').trim();
  const rank=()=>{const p=planText().toLowerCase(); if(p.includes('ultra')) return 3; if(p.includes('pro')) return 2; return 1;};
  const isTrial=()=>/essai|trial|actif/i.test(trialText());
  const canInvite=()=> rank()>=2 || isTrial();
  const fmt=(v)=>{try{return new Date(v).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});}catch{return '—';}};
  const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  function st(){const s=load(); if(!Array.isArray(s.activity))s.activity=[]; if(!Array.isArray(s.messages))s.messages=[]; if(!Array.isArray(s.events))s.events=[]; if(!Array.isArray(s.members))s.members=[]; if(!Array.isArray(s.invites))s.invites=[]; if(!s.selectedDate)s.selectedDate=todayIso(); return s;}
  function activeChannel(s){return (s.channels||[]).find(c=>c.id===s.currentChannel)||(s.channels||[])[0]||{id:'general',name:'general'};}
  function channelMessages(s){return (s.messages||[]).filter(m=>m.channel===(s.currentChannel||'general'));}
  function dayActions(s,day){
    const base=(s.activity||[]).filter(a=>{const d=new Date(a.date||Date.now());return d.getDay()===day;}).slice(0,5);
    const names=['Préparer les priorités','Relancer les messages non lus','Vérifier les documents','Mettre à jour les notes','Planifier les deadlines','Contrôler les membres','Synthétiser la semaine'];
    return base.length?base.map(a=>`${a.title} — ${a.text||''}`):[names[day]||'Action workspace','Contrôler les décisions importantes','Nettoyer les échanges inutiles'];
  }
  function planBlocks(){
    const r=rank();
    const blocks=[
      ['Inbox intelligente','Regroupe les messages non lus, décisions et documents à traiter.','Standard'],
      ['Focus du jour','Affiche le canal actif, le dernier message et les prochaines actions.','Standard'],
      ['Qualité workspace','Détecte les échanges trop longs, notes oubliées et documents manquants.','Standard']
    ];
    if(r>=2){blocks.push(['AI résumé équipe','Transforme les conversations en décisions, checklists et relances.','Pro'],['Charge par membre','Repère les personnes surchargées, inactives ou bloquées.','Pro'],['Priorités automatiques','Classe messages, notes et événements selon urgence.','Pro']);}
    if(r>=3){blocks.push(['Executive radar','Risque projet, retard probable, blocages et performance équipe.','Ultra'],['Client delivery mode','Suit livrables, deadlines client et documents critiques.','Ultra'],['Prévision surcharge 7j','Anticipe les pics de charge avant qu’ils bloquent l’équipe.','Ultra']);}
    return `<div class="fpTeamPowerPanel"><div class="fpTeamPowerHead"><div><span>Selon ton plan</span><strong>Modules puissants équipe</strong></div><em>${esc(planText())}</em></div><div class="fpTeamPowerGrid">${blocks.map(b=>`<article class="fpTeamPowerCard"><div class="fpTeamPowerBadge">${b[2]}</div><strong>${b[0]}</strong><p>${b[1]}</p></article>`).join('')}</div>${r<2&&!isTrial()?'<div class="fpTeamUpgradeBox"><strong>Améliorer le plan</strong><span>Les invitations avancées, l’AI résumé et la charge par membre se débloquent en Pro.</span><button class="fpTeamUpgradeBtn" data-upgrade-plan>Voir les plans</button></div>':''}</div>`;
  }
  function improveModals(){
    document.querySelectorAll('.fpTeamV2Modal,.fpTeamV2Drawer,.fpTeamV2FormPanel,[class*="Modal"],[class*="Drawer"]').forEach(el=>el.classList.add('fpTeamCompactModal'));
  }
  function addHeatmapDetails(){
    const s=st();
    document.querySelectorAll('.fpTeamV2HeatCell:not([data-final-heat])').forEach((el,i)=>{
      el.dataset.finalHeat='1';
      el.addEventListener('click',()=>{
        const old=document.querySelector('.fpTeamHeatDetailsLive'); if(old)old.remove();
        const actions=dayActions(st(),i);
        const box=document.createElement('div');
        box.className='fpTeamHeatDetailsLive';
        box.innerHTML=`<strong>Actions du jour</strong><span>${['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'][i]||'Jour sélectionné'}</span><ul>${actions.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`;
        el.closest('.fpTeamV2Panel,.fpTeamV2SidebarCard,.fpTeamPowerPanel')?.appendChild(box);
      });
    });
  }
  function improveTopButtons(){
    const s=st();
    const unread=(s.activity||[]).filter(a=>Number(a.date||0)>Number(s.lastNotificationsSeenAt||0)).length;
    const b=document.getElementById('fpTeamMessagesTop');
    if(b){b.dataset.count=String(unread); b.onclick=()=>{location.hash='#team'; setTimeout(()=>{const ss=st(); ss.tab='activity'; ss.lastNotificationsSeenAt=Date.now(); save(ss); window.dispatchEvent(new Event('hashchange'));},40);};}
    document.querySelectorAll('[data-open="invite"]').forEach(btn=>{
      if(!canInvite()){
        btn.textContent='Améliorer le plan';
        btn.disabled=false;
        btn.onclick=(e)=>{e.preventDefault(); location.hash='#billing';};
      }
    });
    document.querySelectorAll('[data-go-invite-page]').forEach(btn=>{btn.onclick=()=>{location.href='/invite-accept.html';};});
  }
  function enrichCurrentTab(){
    const r=root(); if(!r||!route().includes('team'))return;
    if(!r.querySelector('.fpTeamPowerPanel')){
      const tabs=r.querySelector('.fpTeamV2Tabs');
      if(tabs) tabs.insertAdjacentHTML('afterend',planBlocks());
    }
    const s=st();
    const tab=s.tab||'chat';
    if(tab==='members' && !r.querySelector('.fpTeamMembersPolish')){
      const target=r.querySelector('.fpTeamV2MembersLayout .fpTeamV2Panel')||r.querySelector('.fpTeamV2MembersLayout');
      target?.insertAdjacentHTML('beforeend',`<div class="fpTeamMembersPolish"><h3>Contrôle des accès</h3><div class="fpTeamAccessGrid"><div><strong>Invitations</strong><span>${canInvite()?'Disponibles pendant ton plan / essai.':'Passe en Pro pour inviter plusieurs membres.'}</span></div><div><strong>Rôles</strong><span>Owner, Manager, Editor, Viewer.</span></div><div><strong>Présence</strong><span>Online, hors ligne, dernière activité et charge.</span></div></div></div>`);
    }
    if(tab==='notes' && !r.querySelector('.fpTeamNotesPolish')){
      const target=r.querySelector('.fpTeamV2NotesLayout .fpTeamV2Panel:last-child')||r.querySelector('.fpTeamV2NotesLayout');
      target?.insertAdjacentHTML('beforeend',`<div class="fpTeamNotesPolish"><h3>Note OS</h3><div class="fpTeamAccessGrid"><div><strong>Décision</strong><span>Ce qui est acté.</span></div><div><strong>Owner</strong><span>Qui doit exécuter.</span></div><div><strong>Next step</strong><span>Prochaine action claire.</span></div></div></div>`);
    }
    if(tab==='calendar' && !r.querySelector('.fpTeamCalendarPolish')){
      const target=r.querySelector('.fpTeamV2SelectedCard');
      target?.insertAdjacentHTML('beforeend',`<div class="fpTeamCalendarPolish"><strong>Lecture planning</strong><span>Les événements du jour restent visibles ici, sans ouvrir une page trop large. Sur mobile, le calendrier garde un style Apple compact.</span></div>`);
    }
    if(tab==='activity' && !r.querySelector('.fpTeamActivityPolish')){
      const feed=r.querySelector('.fpTeamV2FeedList,.fpTeamV2ActivityCards');
      if(feed) feed.classList.add('fpTeamScrollableFeed');
    }
  }
  function run(){setTimeout(()=>{enrichCurrentTab(); addHeatmapDetails(); improveTopButtons(); improveModals();},80);}
  window.addEventListener('hashchange',run);
  document.addEventListener('click',e=>setTimeout(run,120),true);
  document.addEventListener('DOMContentLoaded',run);
  setInterval(run,900);
})();
