(()=>{
  const KEY='fp_team_workspace_v5';
  const root=()=>document.getElementById('fpPageContainer');
  const route=()=>String(location.hash||'').toLowerCase();
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{};}catch{return {};}};
  const save=(s)=>{try{localStorage.setItem(KEY,JSON.stringify(s));}catch{}};
  const planText=()=>String(document.getElementById('fpAccPlan')?.textContent||'Standard').trim()||'Standard';
  const trialText=()=>String(document.getElementById('fpAccTrial')?.textContent||'').trim();
  const rank=()=>{const p=planText().toLowerCase(); if(p.includes('ultra')) return 3; if(p.includes('pro')) return 2; return 1;};
  const isTrial=()=>/essai|trial|actif/i.test(trialText());
  const canInvite=()=> rank()>=2 || isTrial();
  const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  function st(){const s=load(); ['activity','messages','events','members','invites','channels','notes','docs'].forEach(k=>{if(!Array.isArray(s[k]))s[k]=[]}); if(!s.selectedDate)s.selectedDate=todayIso(); if(!s.currentChannel)s.currentChannel='general'; return s;}
  const chName=s=>(s.channels||[]).find(c=>c.id===s.currentChannel)?.name||s.currentChannel||'general';
  const msgs=s=>(s.messages||[]).filter(m=>m.channel===(s.currentChannel||'general'));
  const actionLib={
    0:['Préparer les priorités de la semaine','Relancer les messages sans réponse','Identifier une décision à clarifier','Archiver les docs inutiles','Créer une note de passation'],
    1:['Analyser les quick wins SEO','Transformer un message en action','Vérifier les documents manquants','Préparer un point client','Nettoyer les canaux inactifs'],
    2:['Contrôler les décisions importantes','Vérifier les documents liés au canal','Mettre à jour la note active','Assigner un owner','Créer une checklist d’exécution'],
    3:['Suivre les deadlines calendrier','Repérer les blocages membres','Créer un résumé de canal','Planifier la prochaine revue','Classer les messages prioritaires'],
    4:['Préparer le reporting équipe','Vérifier les livrables ouverts','Relancer les owners','Sécuriser les documents critiques','Synthétiser les actions restantes'],
    5:['Revue légère des notes','Contrôle des canaux actifs','Préparer lundi matin','Vérifier les membres disponibles','Archiver les actions terminées'],
    6:['Préparer la semaine','Détecter les risques planning','Lister les décisions bloquées','Mettre à jour les priorités','Planifier un point équipe']
  };
  function dayActions(s,day){
    const live=(s.activity||[]).filter(a=>{const d=new Date(a.date||Date.now());return d.getDay()===day;}).map(a=>`${a.title||'Action'} — ${a.text||'suivi workspace'}`);
    return [...live,...(actionLib[day]||[])].slice(0,8);
  }
  function planBlocks(){
    const r=rank();
    const blocks=[
      ['Inbox intelligente','Priorise messages non lus, décisions et documents à traiter.','Standard','3 signaux'],
      ['Focus du jour','Canal actif, dernier message et prochaines actions visibles.','Standard','Live'],
      ['Qualité workspace','Détecte échanges trop longs, notes oubliées et docs manquants.','Standard','Score 72%']
    ];
    if(r>=2){blocks.push(['AI résumé équipe','Convertit conversations en décisions, checklists et relances.','Pro','Auto'],['Charge par membre','Repère surcharge, inactivité et blocages par profil.','Pro','3 profils'],['Priorités automatiques','Classe messages, notes et événements selon urgence.','Pro','Smart']);}
    if(r>=3){blocks.push(['Executive radar','Risques projet, retards probables et performance équipe.','Ultra','Radar'],['Client delivery mode','Suit deadlines client, livrables et documents critiques.','Ultra','Client'],['Prévision surcharge 7j','Anticipe les pics de charge avant blocage.','Ultra','Prévision']);}
    return `<section class="fpTeamPowerPanel fpTeamDecorated"><div class="fpTeamPowerHead"><div><span>Modules selon ton plan</span><strong>Command Center équipe</strong><p>Blocs actifs pour transformer l’espace Équipe en vrai cockpit opérationnel.</p></div><em>${esc(planText())}</em></div><div class="fpTeamPowerGrid">${blocks.map(b=>`<article class="fpTeamPowerCard"><div class="fpTeamPowerTop"><span class="fpTeamPowerBadge">${b[2]}</span><small>${b[3]}</small></div><strong>${b[0]}</strong><p>${b[1]}</p></article>`).join('')}</div>${r<2&&!isTrial()?'<div class="fpTeamUpgradeBox"><strong>Améliorer le plan</strong><span>Invitations avancées, résumé IA et charge par membre se débloquent en Pro.</span><button class="fpTeamUpgradeBtn" data-upgrade-plan>Voir les plans</button></div>':''}</section>`;
  }
  function stabilizeScroll(){
    document.querySelectorAll('.fpTeamV2ChannelItem,.fpTeamV2Tab,[data-team-tab]').forEach(el=>{
      if(el.dataset.scrollStable)return; el.dataset.scrollStable='1';
      el.addEventListener('click',()=>{const y=window.scrollY; setTimeout(()=>window.scrollTo({top:y,behavior:'instant'}),0); setTimeout(()=>window.scrollTo({top:y,behavior:'instant'}),80);},true);
    });
  }
  function improveText(){
    const bad=['Zone de saisie mieux positionnée et plus lisible.','Fil scrollable, saisie claire, docs liés et actions de contexte visibles sans allonger la page.','Version finale propre de l’espace équipe : chat, calendrier, notes, membres et activité, avec une base stable et plus premium.'];
    document.querySelectorAll('.fpTeamV2 p,.fpTeamV2 span,.fpTeamV2 div').forEach(el=>{
      if(el.children.length) return;
      const t=el.textContent.trim();
      if(bad.includes(t)) el.textContent='Espace de travail clair pour décider, documenter et suivre les actions sans perdre le contexte.';
    });
  }
  function improveModals(){
    document.querySelectorAll('.fpTeamV2Modal,.fpTeamV2Drawer,.fpTeamV2FormPanel,[class*="Modal"],[class*="Drawer"],[class*="FormPanel"]').forEach(el=>el.classList.add('fpTeamCompactModal'));
  }
  function addHeatmapDetails(){
    document.querySelectorAll('.fpTeamV2HeatCell:not([data-final-heat])').forEach((el,i)=>{
      el.dataset.finalHeat='1';
      el.addEventListener('click',()=>{
        const old=document.querySelector('.fpTeamHeatDetailsLive'); if(old)old.remove();
        const actions=dayActions(st(),i);
        const box=document.createElement('div');
        box.className='fpTeamHeatDetailsLive fpTeamDecorated';
        box.innerHTML=`<div class="fpTeamHeatHead"><div><strong>Actions du jour</strong><span>${['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'][i]}</span></div><em>${actions.length} actions</em></div><div class="fpTeamActionGrid">${actions.map((a,n)=>`<article><b>${String(n+1).padStart(2,'0')}</b><span>${esc(a)}</span></article>`).join('')}</div>`;
        (el.closest('.fpTeamV2Panel,.fpTeamV2SidebarCard,.fpTeamPowerPanel')||el.parentElement).appendChild(box);
      });
    });
  }
  function topButtons(){
    const s=st();
    const unread=(s.activity||[]).filter(a=>Number(a.date||0)>Number(s.lastNotificationsSeenAt||0)).length;
    const b=document.getElementById('fpTeamMessagesTop');
    if(b){b.dataset.count=String(unread); b.onclick=()=>{location.hash='#team'; setTimeout(()=>{const ss=st(); ss.tab='activity'; ss.lastNotificationsSeenAt=Date.now(); save(ss); window.dispatchEvent(new Event('hashchange'));},40);};}
    document.querySelectorAll('[data-open="invite"]').forEach(btn=>{
      if(!canInvite()){btn.textContent='Améliorer le plan';btn.onclick=e=>{e.preventDefault();location.hash='#billing';};}
    });
    document.querySelectorAll('[data-upgrade-plan]').forEach(btn=>btn.onclick=()=>{location.hash='#billing';});
  }
  function addCalendarPolish(){
    const r=root(); if(!r||r.querySelector('.fpTeamCalendarDeep'))return;
    const target=r.querySelector('.fpTeamV2SelectedCard'); if(!target)return;
    target.classList.add('fpTeamCalendarSelectedPro');
    target.insertAdjacentHTML('beforeend',`<div class="fpTeamCalendarDeep"><div class="fpTeamMetric"><strong>Réunions</strong><span>2 prévues</span></div><div class="fpTeamMetric"><strong>Suivis</strong><span>1 action</span></div><div class="fpTeamMetric"><strong>Risque</strong><span>Faible</span></div><div class="fpTeamMetric"><strong>Conseil</strong><span>Ajoute un owner si l’événement devient client.</span></div></div>`);
  }
  function addNotesPolish(){
    const r=root(); if(!r||r.querySelector('.fpTeamNotesDeep'))return;
    const list=r.querySelector('.fpTeamV2NoteList,.fpTeamV2NotesList,.fpTeamV2NotesLayout .fpTeamV2Panel:first-child');
    if(list) list.classList.add('fpTeamNoteLibraryPro');
    const active=r.querySelector('.fpTeamV2NotesLayout .fpTeamV2Panel:last-child')||r.querySelector('.fpTeamV2NotesLayout');
    active?.insertAdjacentHTML('beforeend',`<section class="fpTeamNotesDeep fpTeamDecorated"><div class="fpTeamDeepHead"><span>Note OS</span><strong>Transformer la note en exécution</strong></div><div class="fpTeamActionGrid"><article><b>01</b><span>Décision claire à garder visible.</span></article><article><b>02</b><span>Owner ou canal responsable.</span></article><article><b>03</b><span>Prochaine étape datée.</span></article><article><b>04</b><span>Pièce jointe ou preuve liée.</span></article></div></section>`);
  }
  function addMembersPolish(){
    const r=root(); if(!r||r.querySelector('.fpTeamMembersDeep'))return;
    const target=r.querySelector('.fpTeamV2MembersLayout')||r.querySelector('.fpTeamV2Panel'); if(!target)return;
    target.insertAdjacentHTML('beforeend',`<section class="fpTeamMembersDeep fpTeamDecorated"><div class="fpTeamDeepHead"><span>Management</span><strong>Contrôle opérationnel des membres</strong></div><div class="fpTeamMemberOps"><article><strong>Permissions</strong><span>Owner, Manager, Editor, Viewer avec accès par canal.</span></article><article><strong>Charge</strong><span>Suivi charge, disponibilité et dernière activité.</span></article><article><strong>Invitations</strong><span>${canInvite()?'Tu peux inviter pendant ton essai / plan actuel.':'Améliore le plan pour inviter plus de membres.'}</span></article><article><strong>Qualité</strong><span>Détecte les profils inactifs ou sans rôle clair.</span></article></div></section>`);
  }
  function addPilotagePolish(){
    const r=root(); if(!r||r.querySelector('.fpTeamPilotageDeep'))return;
    const tab=(st().tab||'chat');
    if(tab!=='activity'&&tab!=='pilotage')return;
    const target=r.querySelector('.fpTeamV2ActivityLayout,.fpTeamV2Panel:last-child,.fpTeamV2')||r;
    target.insertAdjacentHTML('beforeend',`<section class="fpTeamPilotageDeep fpTeamDecorated"><div class="fpTeamDeepHead"><span>Pilotage</span><strong>Centre de décision équipe</strong></div><div class="fpTeamPilotGrid"><article><b>Score équipe</b><strong>78%</strong><span>Bonne base, manque encore d’owners sur certaines actions.</span></article><article><b>Blocage actuel</b><strong>Notes</strong><span>Plusieurs décisions doivent être transformées en tâches.</span></article><article><b>Priorité</b><strong>Planning</strong><span>Verrouiller les deadlines de la semaine.</span></article><article><b>Action rapide</b><button class="fpTeamMiniBlue">Créer un brief</button></article></div></section>`);
  }
  function enrich(){
    const r=root(); if(!r||!route().includes('team'))return;
    if(!r.querySelector('.fpTeamPowerPanel')){const tabs=r.querySelector('.fpTeamV2Tabs'); tabs?.insertAdjacentHTML('afterend',planBlocks());}
    const tab=st().tab||'chat';
    addHeatmapDetails();
    if(tab==='calendar') addCalendarPolish();
    if(tab==='notes') addNotesPolish();
    if(tab==='members') addMembersPolish();
    addPilotagePolish();
    improveText(); improveModals(); topButtons(); stabilizeScroll();
  }
  function run(){setTimeout(enrich,90);}
  window.addEventListener('hashchange',run); document.addEventListener('DOMContentLoaded',run); document.addEventListener('click',()=>setTimeout(enrich,130),true); setInterval(enrich,1200);
})();
