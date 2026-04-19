(()=>{
  const KEY='fp_team_workspace_v4';
  const route=()=> (location.hash||'#overview').toLowerCase();
  const root=()=>document.getElementById('fpPageContainer');
  const esc=(v)=>String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const uid=(p='id')=>`${p}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  let mounted=false;
  let bindDone=false;
  let busy=false;

  const planText=()=> (document.getElementById('fpAccPlan')?.textContent||'Standard').trim();
  const planRank=()=>{const p=planText().toLowerCase(); if(p.includes('ultra')) return 3; if(p.includes('pro')) return 2; return 1;};
  const isPro=()=>planRank()>=2;
  const isUltra=()=>planRank()>=3;

  const nowIso=()=>{const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const shortDate=(v)=>{try{return new Date(v).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})}catch{return '—';}};
  const fullDateTime=(v)=>{try{return new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return 'Récemment';}};
  const monthLabel=(y,m)=>{const t=new Date(y,m,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'}); return t.charAt(0).toUpperCase()+t.slice(1);};
  const fullDate=(v)=>{const d=new Date(v); if(Number.isNaN(d.getTime())) return 'Jour sélectionné'; const t=d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); return t.charAt(0).toUpperCase()+t.slice(1);};
  const sizeLabel=(n)=>{const x=Number(n||0); if(!x) return 'Pièce jointe'; return x>1048576?`${(x/1048576).toFixed(1)} MB`:`${Math.max(1,Math.round(x/1024))} KB`;};

  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||null}catch{return null;}};
  const save=(s)=>localStorage.setItem(KEY,JSON.stringify(s));

  function seed(){
    const today=nowIso();
    const n=Date.now();
    return {
      tab:'chat',
      currentChannel:'general',
      selectedDate:today,
      selectedNoteId:'note_playbook',
      selectedMemberId:'member_mael',
      activityFilter:'all',
      viewYear:new Date().getFullYear(),
      viewMonth:new Date().getMonth(),
      draftFiles:[],
      channels:[
        {id:'general',name:'general',desc:'Annonces, coordination et décisions visibles.',private:false,topic:'Coordination'},
        {id:'seo',name:'seo',desc:'Quick wins, pages locales et contenu.',private:false,topic:'SEO'},
        {id:'dev',name:'dev',desc:'Bugs, stabilité et intégrations.',private:false,topic:'Tech'},
        {id:'planning',name:'planning',desc:'Planning et deadlines.',private:true,topic:'Planning'}
      ],
      messages:[
        {id:uid('m'),channel:'general',author:'FlowPoint',role:'system',text:'Le workspace équipe est maintenant stable et prêt à être enrichi.',date:n-7200000,files:[]},
        {id:uid('m'),channel:'general',author:'Maël',role:'owner',text:'Je veux une vraie page équipe premium, propre et sans crash.',date:n-4300000,files:[]},
        {id:uid('m'),channel:'seo',author:'SEO Manager',role:'manager',text:'Pages locales et titles à prioriser cette semaine.',date:n-2500000,files:[{name:'quick-wins.docx',type:'DOC',size:'420 KB'}]},
        {id:uid('m'),channel:'dev',author:'Tech Ops',role:'editor',text:'Le dashboard doit rester stable sur mobile, même après retour au premier plan.',date:n-1300000,files:[{name:'mobile-auth-check.pdf',type:'PDF',size:'960 KB'}]}
      ],
      notes:[
        {id:'note_playbook',title:'Playbook équipe',type:'Process',priority:'Haute',author:'Maël',date:n-86400000,pinned:true,tags:['Ops','Coordination','Décision'],checklist:['Clarifier','Documenter','Exécuter'],text:'Canal général = annonces. SEO = quick wins. Dev = technique. Planning = deadlines.\n\nToujours garder une trace des décisions, des docs clés et des prochaines actions.'},
        {id:uid('note'),title:'Sprint workspace',type:'Sprint',priority:'Moyenne',author:'Maël',date:n-43200000,pinned:false,tags:['Sprint','UX'],checklist:['Chat','Calendrier','Membres'],text:'Objectif : garder la stabilité, enrichir les blocs et améliorer l’expérience mobile.'}
      ],
      members:[
        {id:'member_mael',name:'Maël',title:'Direction produit',role:'Owner',status:'online',initials:'MH',bio:'Pilote la roadmap, les arbitrages et la vision produit.',focus:'Coordination produit',activity:'A lancé la refonte équipe',load:72,skills:['Vision','Pilotage','Décision']},
        {id:uid('member'),name:'SEO Manager',title:'Lead SEO',role:'Manager',status:'online',initials:'SM',bio:'Transforme les audits en quick wins actionnables.',focus:'Pages locales & contenus',activity:'Prépare les priorités locales',load:61,skills:['SEO','Contenu','Local']},
        {id:uid('member'),name:'Tech Ops',title:'Ops & stabilité',role:'Editor',status:'offline',initials:'TO',bio:'Suit les bugs, la stabilité et les intégrations.',focus:'Stabilité dashboard',activity:'A vérifié les correctifs',load:46,skills:['Tech','Infra','Monitoring']}
      ],
      events:[
        {id:uid('evt'),title:'Revue équipe',date:today,time:'09:00',type:'meeting',desc:'Point équipe sur priorités et déblocages.',assignee:'Maël'},
        {id:uid('evt'),title:'Quick wins SEO',date:today,time:'14:00',type:'seo',desc:'Liste des actions SEO à pousser.',assignee:'SEO Manager'},
        {id:uid('evt'),title:'Check stabilité',date:today,time:'17:00',type:'monitoring',desc:'Validation du rendu et des fixs.',assignee:'Tech Ops'}
      ],
      activity:[
        {id:uid('a'),type:'message',title:'Message posté dans #general',text:'Le workspace équipe a été remis en état.',date:n-3600000},
        {id:uid('a'),type:'doc',title:'Document ajouté',text:'quick-wins.docx disponible dans #seo.',date:n-2500000},
        {id:uid('a'),type:'member',title:'Membre actif',text:'SEO Manager est actuellement en ligne.',date:n-900000}
      ]
    };
  }

  function state(){
    const s=load()||seed();
    if(!s.selectedDate) s.selectedDate=nowIso();
    if(typeof s.viewYear!=='number'||typeof s.viewMonth!=='number'){ const d=new Date(); s.viewYear=d.getFullYear(); s.viewMonth=d.getMonth(); }
    if(!Array.isArray(s.draftFiles)) s.draftFiles=[];
    return s;
  }

  const activeChannel=(s)=>s.channels.find(c=>c.id===s.currentChannel)||s.channels[0];
  const channelMessages=(s)=>s.messages.filter(m=>m.channel===s.currentChannel).sort((a,b)=>a.date-b.date);
  const activeNote=(s)=>s.notes.find(n=>n.id===s.selectedNoteId)||s.notes[0]||null;
  const activeMember=(s)=>s.members.find(m=>m.id===s.selectedMemberId)||s.members[0]||null;
  const dayEvents=(s)=>s.events.filter(e=>e.date===s.selectedDate).sort((a,b)=>String(a.time).localeCompare(String(b.time)));

  function channelDocs(s){
    return channelMessages(s).flatMap(m=>m.files||[]).slice(-6).reverse();
  }

  function analytics(s){
    return {
      online:s.members.filter(m=>m.status==='online').length,
      channels:s.channels.length,
      messages:channelMessages(s).length,
      docs:channelDocs(s).length,
      monthEvents:s.events.filter(e=>{const d=new Date(e.date); return d.getFullYear()===s.viewYear && d.getMonth()===s.viewMonth;}).length,
      activeName:activeChannel(s).name
    };
  }

  function pushActivity(s,type,title,text){
    s.activity.unshift({id:uid('a'),type,title,text,date:Date.now()});
    s.activity=s.activity.slice(0,30);
  }

  function renderHero(s,a){
    return `<div class="fpTeamV2Hero"><div><div class="fpTeamV2SectionKicker">Équipe</div><div class="fpTeamV2HeroTitle">Workspace collaboration</div><div class="fpTeamV2HeroText">Version finale propre de l’espace équipe : chat, calendrier, notes, membres et activité, avec une base stable et plus premium.</div><div class="fpTeamV2HeroMeta"><div class="fpTeamV2MetaPill"><span class="fpTeamV2Dot"></span>${a.online} en ligne</div><div class="fpTeamV2MetaPill">Plan : ${esc(planText())}</div><div class="fpTeamV2MetaPill">Canal actif : #${esc(a.activeName)}</div></div></div><div class="fpTeamV2HeroRight"><div class="fpTeamV2ActionGrid"><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="channel">Nouveau canal</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="visio">Lancer une visio</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="note">Nouvelle note</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="event">Nouvel événement</button></div><div class="fpTeamV2InsightGrid"><div class="fpTeamV2Insight"><strong>Stabilité</strong><span>La page équipe reste chargée proprement même si le dashboard rerender.</span></div><div class="fpTeamV2Insight"><strong>Montée en gamme</strong><span>${isUltra()?'Ultra ouvre une lecture plus analytique et plus poussée.':isPro()?'Pro ouvre plus de structure et de confort.':'Base claire et lisible.'}</span></div></div></div></div>`;
  }

  function renderKpis(a){
    return `<div class="fpTeamV2Kpis"><div class="fpTeamV2Kpi"><span>Canaux</span><strong>${a.channels}</strong><small>Espaces de discussion séparés</small></div><div class="fpTeamV2Kpi"><span>Messages</span><strong>${a.messages}</strong><small>Historique du canal actif</small></div><div class="fpTeamV2Kpi"><span>Documents</span><strong>${a.docs}</strong><small>Pièces liées au canal</small></div><div class="fpTeamV2Kpi"><span>Événements</span><strong>${a.monthEvents}</strong><small>Éléments du mois affiché</small></div></div>`;
  }

  function renderTabs(s){
    const items=[['chat','Canaux & chat'],['calendar','Calendrier'],['notes','Notes'],['members','Membres'],['activity','Activité']];
    return `<div class="fpTeamV2Tabs">${items.map(([k,l])=>`<button class="fpTeamV2Tab ${s.tab===k?'active':''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
  }

  function renderChat(s){
    const ch=activeChannel(s); const msgs=channelMessages(s); const docs=channelDocs(s);
    return `<div class="fpTeamV2GridChat"><div class="fpTeamV2Panel"><div class="fpTeamV2SectionKicker">Canaux</div><div class="fpTeamV2SectionText">Canaux structurés pour éviter le bruit et mieux piloter l’équipe.</div><div class="fpTeamV2ChannelList">${s.channels.map(c=>`<button class="fpTeamV2ChannelBtn ${c.id===s.currentChannel?'active':''}" data-channel="${c.id}"><div class="fpTeamV2ChannelLeft"><span class="fpTeamV2Hash">#</span><div><div class="fpTeamV2ChannelName">${esc(c.name)}</div><div class="fpTeamV2ChannelMeta">${esc(c.desc)}</div></div></div>${c.private?'<span class="fpTeamV2Lock">Privé</span>':''}</button>`).join('')}</div><div class="fpTeamV2SidebarCard" style="margin-top:16px;"><strong>Conseils du canal</strong><span>Garde ce canal lisible, actionnable et utile au workspace.</span><div class="fpTeamV2MiniList"><div class="fpTeamV2MiniCard"><strong>Décision</strong><span>Écris les arbitrages de manière claire.</span></div><div class="fpTeamV2MiniCard"><strong>Structure</strong><span>Évite de mélanger SEO, tech et planning au même endroit.</span></div><div class="fpTeamV2MiniCard"><strong>Clarté</strong><span>Ajoute les docs utiles quand ils comptent vraiment.</span></div></div></div></div><div class="fpTeamV2Panel"><div class="fpTeamV2Header"><div><div class="fpTeamV2SectionKicker">Canal actif</div><div class="fpTeamV2SectionTitle">#${esc(ch.name)}</div><div class="fpTeamV2SectionText">${esc(ch.desc)} · ${esc(ch.topic)}</div></div><div class="fpTeamV2HeaderCenter"><div class="fpTeamV2Status online">${s.members.filter(m=>m.status==='online').length} en ligne</div></div><div class="fpTeamV2HeaderActions"><button class="fpTeamV2Btn fpTeamV2BtnGhost fpTeamV2BtnWide" data-open="visio">Lancer une visio</button></div></div><div class="fpTeamV2ChannelHero"><div class="fpTeamV2ChannelHeroText">Le chat sert à décider, exécuter et conserver les échanges importants. Les messages défilent sans agrandir la page.</div><div class="fpTeamV2TopActions"><span class="fpTeamV2Badge">${msgs.length} messages</span><span class="fpTeamV2Badge">${docs.length} documents</span></div></div><div class="fpTeamV2MessagesWrap"><div><div class="fpTeamV2Messages">${msgs.length?msgs.map(m=>`<article class="fpTeamV2Message"><div class="fpTeamV2Avatar">${esc((m.author||'U').slice(0,1).toUpperCase())}</div><div><div class="fpTeamV2MessageTop"><strong>${esc(m.author)}</strong><span class="fpTeamV2MessageMeta">${esc(m.role)}</span><span class="fpTeamV2MessageMeta">${esc(fullDateTime(m.date))}</span></div><div class="fpTeamV2MessageText">${esc(m.text)}</div>${m.files&&m.files.length?`<div class="fpTeamV2Attachments">${m.files.map(f=>`<div class="fpTeamV2Attachment"><div class="fpTeamV2Hash">${esc((f.type||'F').slice(0,1))}</div><div><strong>${esc(f.name)}</strong><span>${esc(f.type)} · ${esc(f.size)}</span></div></div>`).join('')}</div>`:''}</div></article>`).join(''):'<div class="fpTeamV2Empty">Aucun message dans ce canal.</div>'}</div><div class="fpTeamV2Composer"><div class="fpTeamV2SectionKicker">Nouveau message</div><div class="fpTeamV2SectionText">Zone de saisie mieux positionnée et plus lisible.</div><div class="fpTeamV2ComposerGrid"><div><textarea id="fpTeamV2MessageInput" class="fpTeamV2Textarea" placeholder="Écris un message utile, une décision, une consigne ou un suivi précis..."></textarea><div class="fpTeamV2PendingFiles">${(s.draftFiles||[]).map((f,i)=>`<div class="fpTeamV2FileChip">${esc(f.name)}<button data-remove-file="${i}">×</button></div>`).join('')}</div></div><div class="fpTeamV2Stack"><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-send="message">Envoyer</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="attach">Joindre un document</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-tab-jump="activity">Voir l’activité</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-tab-jump="calendar">Voir le calendrier</button><input type="file" id="fpTeamV2FileInput" hidden multiple /></div></div></div></div><div class="fpTeamV2Stack"><div class="fpTeamV2SidebarCard"><strong>Documents du canal</strong><span>Pièces récentes liées au salon actif.</span><div class="fpTeamV2DocList">${docs.length?docs.map(f=>`<div class="fpTeamV2DocItem"><strong>${esc(f.name)}</strong><span>${esc(f.type)} · ${esc(f.size)}</span></div>`).join(''):'<div class="fpTeamV2Empty">Aucun document récent.</div>'}</div></div><div class="fpTeamV2SidebarCard"><strong>Activité récente</strong><span>Résumé rapide du workspace.</span><div class="fpTeamV2ActivityCards">${s.activity.slice(0,4).map(a=>`<div class="fpTeamV2MiniCard"><strong>${esc(a.title)}</strong><span>${esc(a.text)} · ${esc(shortDate(a.date))}</span></div>`).join('')}</div></div></div></div></div><div class="fpTeamV2Panel"><div class="fpTeamV2SectionKicker">Vue manager</div><div class="fpTeamV2SectionText">Lecture rapide du canal et des priorités.</div><div class="fpTeamV2MiniList"><div class="fpTeamV2MiniCard"><strong>Focus actuel</strong><span>#${esc(ch.name)} concentre ${msgs.length} message(s).</span></div><div class="fpTeamV2MiniCard"><strong>Dernier message</strong><span>${msgs.length?esc(msgs[msgs.length-1].text.slice(0,90)):'Aucun message récent'}</span></div><div class="fpTeamV2MiniCard"><strong>Recommandation</strong><span>Garde les échanges actionnables et bien reliés aux documents.</span></div></div></div></div>`;
  }

  function buildCalendarCells(s){
    const first=new Date(s.viewYear,s.viewMonth,1); const start=(first.getDay()+6)%7; const days=new Date(s.viewYear,s.viewMonth+1,0).getDate(); const prevDays=new Date(s.viewYear,s.viewMonth,0).getDate(); const cells=[];
    for(let i=0;i<42;i++){ let y=s.viewYear,m=s.viewMonth,day,muted=false; if(i<start){ muted=true; m--; if(m<0){m=11;y--;} day=prevDays-start+i+1; } else if(i>=start+days){ muted=true; m++; if(m>11){m=0;y++;} day=i-(start+days)+1; } else { day=i-start+1; } const iso=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`; const ev=s.events.filter(e=>e.date===iso); cells.push({iso,day,muted,count:ev.length,events:ev.slice(0,2),isToday:iso===nowIso(),isSelected:iso===s.selectedDate}); }
    return cells;
  }

  function renderCalendar(s){
    const cells=buildCalendarCells(s); const events=dayEvents(s); const weekdays=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    return `<div class="fpTeamV2CalendarLayout"><div class="fpTeamV2Panel"><div class="fpTeamV2CalendarHeader"><div><div class="fpTeamV2SectionKicker">Calendrier workspace</div><div class="fpTeamV2SectionTitle">${esc(monthLabel(s.viewYear,s.viewMonth))}</div><div class="fpTeamV2SectionText">Vue calendrier plus propre avec panneau du jour visible immédiatement.</div></div><div class="fpTeamV2CalendarNav"><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-cal-nav="prev">Mois précédent</button><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="event">Nouvel événement</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-cal-nav="next">Mois suivant</button></div></div><div class="fpTeamV2CalendarSurface"><div class="fpTeamV2Weekdays">${weekdays.map(w=>`<div>${w}</div>`).join('')}</div><div class="fpTeamV2CalendarGrid">${cells.map(c=>`<button class="fpTeamV2DayCard ${c.muted?'isMuted':''} ${c.isToday?'isToday':''} ${c.isSelected?'isSelected':''}" data-select-date="${c.iso}"><div class="fpTeamV2DayTop"><strong>${c.day}</strong>${c.count?`<span class="fpTeamV2DayCount">${c.count}</span>`:''}</div><div class="fpTeamV2DayPills">${c.events.map(e=>`<div class="fpTeamV2DayPill ${esc(e.type||'task')}">${esc(e.title)}</div>`).join('')}</div></button>`).join('')}</div></div></div><div class="fpTeamV2Stack"><div class="fpTeamV2SelectedCard"><div class="fpTeamV2SectionKicker">Jour sélectionné</div><div class="fpTeamV2SelectedTitle">${esc(fullDate(s.selectedDate))}</div><div class="fpTeamV2SelectedActions"><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="event">Ajouter un événement</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="event-quick">Ajouter sur ce jour</button></div><div class="fpTeamV2Timeline">${events.length?events.map(e=>`<div class="fpTeamV2TimelineRow"><div class="fpTeamV2TimelineTime">${esc(e.time)}</div><div class="fpTeamV2TimelineBody"><div class="fpTeamV2TimelineEvent"><strong>${esc(e.title)}</strong><span>${esc(e.desc)} · ${esc(e.assignee)}</span></div></div></div>`).join(''):'<div class="fpTeamV2Empty">Aucun événement pour cette journée.</div>'}</div></div><div class="fpTeamV2SidebarCard"><strong>Analytics calendrier</strong><span>Lecture rapide du mois affiché.</span><div class="fpTeamV2InfoGrid" style="margin-top:12px;"><div class="fpTeamV2Stat"><span>Mois</span><strong>${s.events.filter(e=>{const d=new Date(e.date); return d.getFullYear()===s.viewYear && d.getMonth()===s.viewMonth;}).length}</strong></div><div class="fpTeamV2Stat"><span>Réunions</span><strong>${s.events.filter(e=>e.type==='meeting').length}</strong></div><div class="fpTeamV2Stat"><span>Suivis</span><strong>${s.events.filter(e=>e.type!=='meeting').length}</strong></div></div>${isPro()?'<div class="fpTeamV2MiniList" style="margin-top:12px;"><div class="fpTeamV2MiniCard"><strong>Pro</strong><span>Tu peux enrichir avec catégories, priorité et charge.</span></div></div>':''}</div></div></div>`;
  }

  function renderNotes(s){
    const n=activeNote(s);
    return `<div class="fpTeamV2NotesLayout"><div class="fpTeamV2Panel"><div class="fpTeamV2SectionKicker">Notes</div><div class="fpTeamV2SectionText">Décisions, checklists et mémoire d’exécution.</div><div class="fpTeamV2InfoGrid" style="margin-top:14px;"><div class="fpTeamV2Stat"><span>Total</span><strong>${s.notes.length}</strong></div><div class="fpTeamV2Stat"><span>Pinned</span><strong>${s.notes.filter(x=>x.pinned).length}</strong></div><div class="fpTeamV2Stat"><span>Type</span><strong>${n?esc(n.type):'—'}</strong></div></div><div class="fpTeamV2ActionRow" style="margin-top:14px;display:flex;gap:10px;"><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="note">Créer une note</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="note-template">Template</button></div><div class="fpTeamV2NotesList">${s.notes.map(x=>`<button class="fpTeamV2NoteItem" data-note="${x.id}"><strong>${esc(x.title)}</strong><span>${esc(x.text.slice(0,90))} · ${esc(shortDate(x.date))}</span></button>`).join('')}</div></div><div class="fpTeamV2Panel">${n?`<div class="fpTeamV2NoteHeader"><div><div class="fpTeamV2SectionKicker">Note active</div><div class="fpTeamV2SectionTitle">${esc(n.title)}</div><div class="fpTeamV2SectionText">${esc(n.type)} · Priorité ${esc(n.priority)} · ${esc(n.author)}</div></div><div class="fpTeamV2NoteActions"><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-note-pin="${n.id}">${n.pinned?'Désépingler':'Pin'}</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-note-edit="${n.id}">Modifier</button><button class="fpTeamV2Btn fpTeamV2BtnDanger" data-note-delete="${n.id}">Supprimer</button></div></div><div class="fpTeamV2InfoGrid" style="margin-bottom:14px;"><div class="fpTeamV2Stat"><span>Type</span><strong>${esc(n.type)}</strong></div><div class="fpTeamV2Stat"><span>Priorité</span><strong>${esc(n.priority)}</strong></div><div class="fpTeamV2Stat"><span>Tags</span><strong>${(n.tags||[]).length}</strong></div></div><div class="fpTeamV2NoteContent">${esc(n.text)}</div><div class="fpTeamV2MiniList" style="margin-top:14px;"><div class="fpTeamV2MiniCard"><strong>Checklist</strong><span>${(n.checklist||[]).map(esc).join(' · ')}</span></div><div class="fpTeamV2MiniCard"><strong>Valeur</strong><span>Une note doit toujours servir à garder une décision ou une exécution visible.</span></div><div class="fpTeamV2MiniCard"><strong>Montée en gamme</strong><span>${isUltra()?'Ultra ouvre une logique plus analytique et reliée aux autres blocs.':isPro()?'Pro donne plus de structure et de templates.':'Base claire et lisible.'}</span></div></div>`:'<div class="fpTeamV2Empty">Sélectionne une note.</div>'}</div><div class="fpTeamV2SidebarCard"><strong>Bibliothèque</strong><span>Utilise les notes comme système d’exécution, pas juste comme texte brut.</span><div class="fpTeamV2MiniList"><div class="fpTeamV2MiniCard"><strong>Décision</strong><span>Consigne les arbitrages importants.</span></div><div class="fpTeamV2MiniCard"><strong>Checklist</strong><span>Prépare des modèles récurrents.</span></div><div class="fpTeamV2MiniCard"><strong>Vision</strong><span>Garde une mémoire claire des points forts du workspace.</span></div></div></div></div>`;
  }

  function renderMembers(s){
    const m=activeMember(s);
    return `<div class="fpTeamV2MembersLayout"><div class="fpTeamV2Panel"><div class="fpTeamV2MembersTop"><div><div class="fpTeamV2SectionKicker">Membres</div><div class="fpTeamV2SectionTitle">Équipe & rôles</div><div class="fpTeamV2SectionText">Profils, dénominations, expertise et présence.</div></div><div class="fpTeamV2MemberActions"><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-open="member">Ajouter un membre</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-open="visio">Visio</button></div></div><div class="fpTeamV2MemberStats"><div class="fpTeamV2Stat"><span>Membres</span><strong>${s.members.length}</strong></div><div class="fpTeamV2Stat"><span>En ligne</span><strong>${s.members.filter(x=>x.status==='online').length}</strong></div><div class="fpTeamV2Stat"><span>Profils</span><strong>${isPro()?'Avancé':'Base'}</strong></div></div><div class="fpTeamV2MembersGrid" style="margin-top:16px;">${s.members.map(x=>`<div class="fpTeamV2MemberCard"><div class="fpTeamV2MemberTop"><div class="fpTeamV2Avatar">${esc(x.initials)}</div><div class="fpTeamV2MemberMain"><div class="fpTeamV2MemberRow"><div class="fpTeamV2MemberName">${esc(x.name)}</div><div class="fpTeamV2Status ${x.status}">${x.status==='online'?'En ligne':'Hors ligne'}</div></div><div class="fpTeamV2MemberTitle">${esc(x.title)}</div><div class="fpTeamV2MemberRole">${esc(x.role)}</div></div></div><div class="fpTeamV2MemberBio">${esc(x.bio)}</div><div class="fpTeamV2Tags">${(x.skills||[]).map(sk=>`<span class="fpTeamV2Tag">${esc(sk)}</span>`).join('')}</div><div class="fpTeamV2MemberFooter"><div class="fpTeamV2Subtle">${esc(x.activity)} · Charge ${x.load}%</div><div class="fpTeamV2InlineActions" style="display:flex;gap:10px;flex-wrap:wrap;"><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-member-status="${x.id}">${x.status==='online'?'Mettre hors ligne':'Mettre en ligne'}</button><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-member-select="${x.id}">Voir</button><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-member-edit="${x.id}">Modifier</button></div></div></div>`).join('')}</div></div><div class="fpTeamV2SidebarCard">${m?`<strong>${esc(m.name)} · ${esc(m.title)}</strong><span>${esc(m.role)}</span><div class="fpTeamV2MiniList"><div class="fpTeamV2MiniCard"><strong>Focus</strong><span>${esc(m.focus)}</span></div><div class="fpTeamV2MiniCard"><strong>Dernière activité</strong><span>${esc(m.activity)}</span></div><div class="fpTeamV2MiniCard"><strong>Charge</strong><span>${m.load}% · ${m.status==='online'?'Disponible':'Non disponible'}</span></div></div>`:'<div class="fpTeamV2Empty">Aucun membre</div>'}</div></div>`;
  }

  function renderActivity(s){
    const list=s.activityFilter==='all'?s.activity:s.activity.filter(a=>a.type===s.activityFilter);
    const heat=[1,2,3,4,2,1,3].map((lvl,i)=>`<div class="fpTeamV2HeatCell fpTeamV2HeatCellLevel${lvl}"><strong>${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][i]}</strong><span>${lvl*3} actions</span></div>`).join('');
    return `<div class="fpTeamV2ActivityLayout"><div class="fpTeamV2Panel"><div class="fpTeamV2SectionKicker">Activité</div><div class="fpTeamV2SectionTitle">Timeline du workspace</div><div class="fpTeamV2SectionText">Vue vivante des actions récentes avec un peu d’analytics.</div><div class="fpTeamV2Filters"><button class="fpTeamV2Filter ${s.activityFilter==='all'?'active':''}" data-activity-filter="all">Tout</button><button class="fpTeamV2Filter ${s.activityFilter==='message'?'active':''}" data-activity-filter="message">Messages</button><button class="fpTeamV2Filter ${s.activityFilter==='doc'?'active':''}" data-activity-filter="doc">Documents</button><button class="fpTeamV2Filter ${s.activityFilter==='member'?'active':''}" data-activity-filter="member">Membres</button></div><div class="fpTeamV2FeedList">${list.length?list.map(it=>`<div class="fpTeamV2FeedItem"><div class="fpTeamV2FeedIcon">${it.type==='doc'?'📄':it.type==='member'?'👤':'💬'}</div><div><strong>${esc(it.title)}</strong><span>${esc(it.text)}</span></div><div class="fpTeamV2FeedMeta">${esc(shortDate(it.date))}</div></div>`).join(''):'<div class="fpTeamV2Empty">Aucune activité sur ce filtre.</div>'}</div></div><div class="fpTeamV2Stack"><div class="fpTeamV2SidebarCard"><strong>Analytics rapides</strong><span>Lecture immédiate du niveau d’usage.</span><div class="fpTeamV2Kpis" style="margin-top:14px;"><div class="fpTeamV2Kpi"><span>Messages</span><strong>${s.activity.filter(x=>x.type==='message').length}</strong><small>Actions conversationnelles</small></div><div class="fpTeamV2Kpi"><span>Docs</span><strong>${s.activity.filter(x=>x.type==='doc').length}</strong><small>Ajouts de documents</small></div><div class="fpTeamV2Kpi"><span>Membres</span><strong>${s.activity.filter(x=>x.type==='member').length}</strong><small>Présence et profils</small></div><div class="fpTeamV2Kpi"><span>Canaux</span><strong>${s.channels.length}</strong><small>Espaces suivis</small></div></div></div><div class="fpTeamV2SidebarCard"><strong>Heatmap légère</strong><span>Petit bloc analytique visuel.</span><div class="fpTeamV2AnalyticsHeat">${heat}</div></div></div>`;
  }

  function body(s){ if(s.tab==='calendar') return renderCalendar(s); if(s.tab==='notes') return renderNotes(s); if(s.tab==='members') return renderMembers(s); if(s.tab==='activity') return renderActivity(s); return renderChat(s); }

  function render(){
    if(route()!=='#team' || busy) return;
    const host=root(); if(!host) return;
    busy=true;
    try{
      const s=state(); const a=analytics(s);
      host.innerHTML=`<section class="fpTeamV2" data-team-v2="true">${renderHero(s,a)}${renderKpis(a)}${renderTabs(s)}<div class="fpTeamV2Body">${body(s)}</div></section>`;
      const fileBtn=document.querySelector('[data-open="attach"]');
      const fileInput=document.getElementById('fpTeamV2FileInput');
      if(fileBtn && fileInput) fileBtn.onclick=()=>fileInput.click();
      mounted=true;
    }catch(err){
      console.error('team rebuild failed',err);
    }finally{ busy=false; }
  }

  function ensureModal(){
    let overlay=document.getElementById('fpTeamV2Modal');
    if(!overlay){
      overlay=document.createElement('div');
      overlay.id='fpTeamV2Modal';
      overlay.className='fpTeamV2ModalOverlay';
      overlay.innerHTML='<div class="fpTeamV2ModalWrap"><div class="fpTeamV2ModalCard"></div></div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click',(e)=>{ if(e.target===overlay) overlay.classList.remove('show'); });
    }
    return overlay;
  }

  function modalHead(title,text){
    return `<div class="fpTeamV2ModalHead"><div><div class="fpTeamV2SectionKicker">Workspace</div><div class="fpTeamV2ModalTitle">${esc(title)}</div><div class="fpTeamV2ModalText">${esc(text)}</div></div><button class="fpTeamV2ModalClose" type="button">×</button></div>`;
  }

  function openModal(kind,preset={}){
    const overlay=ensureModal();
    const card=overlay.querySelector('.fpTeamV2ModalCard');
    const s=state();
    if(kind==='visio'){ window.open(`https://meet.jit.si/${encodeURIComponent(`flowpoint-${activeChannel(s).name}`)}`,'_blank','noopener,noreferrer'); pushActivity(s,'message','Visio ouverte',`Une visio a été lancée depuis #${activeChannel(s).name}.`); save(s); render(); return; }
    if(kind==='channel') card.innerHTML=`${modalHead('Nouveau canal','Crée un canal propre avec une utilité claire.')}<div class="fpTeamV2ModalForm"><label class="fpTeamV2Field"><span class="fpTeamV2Label">Nom</span><input class="fpTeamV2Input" id="fpModalChannelName" placeholder="client-success"></label><label class="fpTeamV2Field"><span class="fpTeamV2Label">Description</span><textarea class="fpTeamV2Textarea" id="fpModalChannelDesc" placeholder="Canal dédié à..."></textarea></label><div class="fpTeamV2Check"><input type="checkbox" id="fpModalChannelPrivate"> <span>Canal privé</span></div><div class="fpTeamV2ModalActions"><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-close-modal>Annuler</button><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-save-channel>Créer</button></div></div>`;
    if(kind==='note' || kind==='note-template') card.innerHTML=`${modalHead('Nouvelle note','Ajoute une note mieux structurée pour le workspace.')}<div class="fpTeamV2ModalForm"><label class="fpTeamV2Field"><span class="fpTeamV2Label">Titre</span><input class="fpTeamV2Input" id="fpModalNoteTitle" value="${esc(preset.title|| (kind==='note-template'?'Note modèle workspace':''))}"></label><label class="fpTeamV2Field"><span class="fpTeamV2Label">Contenu</span><textarea class="fpTeamV2Textarea" id="fpModalNoteText">${esc(preset.text|| (kind==='note-template'?'Objectif\nDécision\nChecklist\nProchaine étape':''))}</textarea></label><input type="hidden" id="fpModalNoteEditId" value="${esc(preset.id||'')}"><div class="fpTeamV2ModalActions"><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-close-modal>Annuler</button><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-save-note>${preset.id?'Mettre à jour':'Créer'}</button></div></div>`;
    if(kind==='event' || kind==='event-quick') card.innerHTML=`${modalHead('Nouvel événement','Ajoute un événement propre dans le calendrier.')}<div class="fpTeamV2ModalForm"><label class="fpTeamV2Field"><span class="fpTeamV2Label">Titre</span><input class="fpTeamV2Input" id="fpModalEventTitle" value="${esc(preset.title||'Revue équipe')}"></label><label class="fpTeamV2Field"><span class="fpTeamV2Label">Date</span><input class="fpTeamV2Input" id="fpModalEventDate" type="date" value="${esc(preset.date||s.selectedDate)}"></label><label class="fpTeamV2Field"><span class="fpTeamV2Label">Heure</span><input class="fpTeamV2Input" id="fpModalEventTime" type="time" value="${esc(preset.time||'09:00')}"></label><label class="fpTeamV2Field"><span class="fpTeamV2Label">Type</span><select class="fpTeamV2Select" id="fpModalEventType"><option value="meeting">Réunion</option><option value="seo">SEO</option><option value="monitoring">Monitoring</option><option value="task">Tâche</option></select></label><label class="fpTeamV2Field"><span class="fpTeamV2Label">Description</span><textarea class="fpTeamV2Textarea" id="fpModalEventDesc" placeholder="Description..."></textarea></label><div class="fpTeamV2ModalActions"><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-close-modal>Annuler</button><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-save-event>Ajouter</button></div></div>`;
    if(kind==='member') card.innerHTML=`${modalHead('Membre','Ajoute ou modifie un profil membre.')}<div class="fpTeamV2ModalForm"><label class="fpTeamV2Field"><span class="fpTeamV2Label">Nom</span><input class="fpTeamV2Input" id="fpModalMemberName" value="${esc(preset.name||'')}"></label><label class="fpTeamV2Field"><span class="fpTeamV2Label">Rôle</span><input class="fpTeamV2Input" id="fpModalMemberRole" value="${esc(preset.role||'Collaborateur')}"></label><label class="fpTeamV2Field"><span class="fpTeamV2Label">Titre</span><input class="fpTeamV2Input" id="fpModalMemberTitle" value="${esc(preset.title||'')}"></label><label class="fpTeamV2Field"><span class="fpTeamV2Label">Bio</span><textarea class="fpTeamV2Textarea" id="fpModalMemberBio">${esc(preset.bio||'')}</textarea></label><input type="hidden" id="fpModalMemberEditId" value="${esc(preset.id||'')}"><div class="fpTeamV2ModalActions"><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-close-modal>Annuler</button><button class="fpTeamV2Btn fpTeamV2BtnPrimary" data-save-member>${preset.id?'Mettre à jour':'Ajouter'}</button></div></div>`;
    if(kind==='attach') card.innerHTML=`${modalHead('Joindre un document','Ajoute un document au prochain message.')}<div class="fpTeamV2ModalForm"><label class="fpTeamV2Field"><span class="fpTeamV2Label">Document</span><input class="fpTeamV2Input" id="fpModalAttachFile" type="file"></label><div class="fpTeamV2ModalActions"><button class="fpTeamV2Btn fpTeamV2BtnGhost" data-close-modal>Fermer</button></div></div>`;
    overlay.classList.add('show');
  }

  function closeModal(){ document.getElementById('fpTeamV2Modal')?.classList.remove('show'); }

  function bind(){
    if(bindDone) return;
    bindDone=true;

    document.addEventListener('click',(e)=>{
      if(route()!=='#team') return;
      const q=(sel)=>e.target.closest(sel);
      const s=state();
      if(q('[data-tab]')){ s.tab=q('[data-tab]').dataset.tab; save(s); render(); return; }
      if(q('[data-channel]')){ s.currentChannel=q('[data-channel]').dataset.channel; pushActivity(s,'message','Canal ouvert',`Le canal #${activeChannel(s).name} a été consulté.`); save(s); render(); return; }
      if(q('[data-tab-jump]')){ s.tab=q('[data-tab-jump]').dataset.tabJump; save(s); render(); return; }
      if(q('[data-note]')){ s.selectedNoteId=q('[data-note]').dataset.note; save(s); render(); return; }
      if(q('[data-member-select]')){ s.selectedMemberId=q('[data-member-select]').dataset.memberSelect; save(s); render(); return; }
      if(q('[data-member-status]')){ const m=s.members.find(x=>x.id===q('[data-member-status]').dataset.memberStatus); if(m){ m.status=m.status==='online'?'offline':'online'; pushActivity(s,'member','Statut modifié',`${m.name} est maintenant ${m.status==='online'?'en ligne':'hors ligne'}.`); save(s); render(); } return; }
      if(q('[data-activity-filter]')){ s.activityFilter=q('[data-activity-filter]').dataset.activityFilter; save(s); render(); return; }
      if(q('[data-select-date]')){ s.selectedDate=q('[data-select-date]').dataset.selectDate; const d=new Date(s.selectedDate); s.viewYear=d.getFullYear(); s.viewMonth=d.getMonth(); save(s); render(); return; }
      if(q('[data-cal-nav]')){ if(q('[data-cal-nav]').dataset.calNav==='prev'){ s.viewMonth--; if(s.viewMonth<0){ s.viewMonth=11; s.viewYear--; } } else { s.viewMonth++; if(s.viewMonth>11){ s.viewMonth=0; s.viewYear++; } } save(s); render(); return; }
      if(q('[data-remove-file]')){ s.draftFiles.splice(Number(q('[data-remove-file]').dataset.removeFile),1); save(s); render(); return; }
      if(q('[data-send="message"]')){ const input=document.getElementById('fpTeamV2MessageInput'); const text=input?.value?.trim(); if(!text) return; s.messages.push({id:uid('m'),channel:s.currentChannel,author:document.getElementById('fpAccOrg')?.textContent?.trim()||'Vous',role:'owner',text,date:Date.now(),files:s.draftFiles||[]}); s.draftFiles=[]; pushActivity(s,'message',`Message posté dans #${activeChannel(s).name}`,text.slice(0,90)); save(s); render(); return; }
      if(q('[data-note-pin]')){ const n=s.notes.find(x=>x.id===q('[data-note-pin]').dataset.notePin); if(n){ n.pinned=!n.pinned; save(s); render(); } return; }
      if(q('[data-note-delete]')){ s.notes=s.notes.filter(x=>x.id!==q('[data-note-delete]').dataset.noteDelete); s.selectedNoteId=s.notes[0]?.id||null; save(s); render(); return; }
      if(q('[data-note-edit]')){ const n=s.notes.find(x=>x.id===q('[data-note-edit]').dataset.noteEdit); if(n) openModal('note',{id:n.id,title:n.title,text:n.text}); return; }
      if(q('[data-member-edit]')){ const m=s.members.find(x=>x.id===q('[data-member-edit]').dataset.memberEdit); if(m) openModal('member',{id:m.id,name:m.name,role:m.role,title:m.title,bio:m.bio}); return; }
      if(q('[data-open]')){ const kind=q('[data-open]').dataset.open; if(kind==='note-template') openModal('note-template'); else if(kind==='event-quick') openModal('event',{date:s.selectedDate}); else openModal(kind); return; }
      if(q('[data-close-modal]') || q('.fpTeamV2ModalClose')){ closeModal(); return; }
      if(q('[data-save-channel]')){ const name=(document.getElementById('fpModalChannelName')?.value||'').trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-'); const desc=(document.getElementById('fpModalChannelDesc')?.value||'').trim(); const priv=!!document.getElementById('fpModalChannelPrivate')?.checked; if(!name) return; s.channels.unshift({id:uid('ch'),name,desc:desc||'Nouveau canal workspace',private:priv,topic:'Coordination'}); s.currentChannel=s.channels[0].id; pushActivity(s,'message',`Canal #${name} créé`,priv?'Canal privé ajouté.':'Canal public ajouté.'); save(s); closeModal(); render(); return; }
      if(q('[data-save-note]')){ const title=(document.getElementById('fpModalNoteTitle')?.value||'').trim(); const text=(document.getElementById('fpModalNoteText')?.value||'').trim(); const editId=(document.getElementById('fpModalNoteEditId')?.value||'').trim(); if(!title) return; if(editId){ const n=s.notes.find(x=>x.id===editId); if(n){ n.title=title; n.text=text; } } else { const n={id:uid('note'),title,text,type:'Standard',priority:'Moyenne',author:'Vous',date:Date.now(),tags:['Workspace'],checklist:['Clarifier','Documenter','Exécuter'],pinned:false}; s.notes.unshift(n); s.selectedNoteId=n.id; } save(s); closeModal(); render(); return; }
      if(q('[data-save-event]')){ const title=(document.getElementById('fpModalEventTitle')?.value||'').trim(); const date=(document.getElementById('fpModalEventDate')?.value||'').trim(); const time=(document.getElementById('fpModalEventTime')?.value||'09:00').trim(); const type=(document.getElementById('fpModalEventType')?.value||'task').trim(); const desc=(document.getElementById('fpModalEventDesc')?.value||'').trim(); if(!title || !date) return; s.events.unshift({id:uid('evt'),title,date,time,type,desc:desc||'Événement workspace',assignee:document.getElementById('fpAccOrg')?.textContent?.trim()||'Équipe'}); s.selectedDate=date; save(s); closeModal(); render(); return; }
      if(q('[data-save-member]')){ const editId=(document.getElementById('fpModalMemberEditId')?.value||'').trim(); const name=(document.getElementById('fpModalMemberName')?.value||'').trim(); const role=(document.getElementById('fpModalMemberRole')?.value||'Collaborateur').trim(); const title=(document.getElementById('fpModalMemberTitle')?.value||'Membre équipe').trim(); const bio=(document.getElementById('fpModalMemberBio')?.value||'').trim(); if(!name) return; if(editId){ const m=s.members.find(x=>x.id===editId); if(m){ m.name=name; m.role=role; m.title=title; m.bio=bio||m.bio; } } else { const initials=name.split(/\s+/).map(x=>x[0]?.toUpperCase()).slice(0,2).join('')||'NM'; const m={id:uid('member'),name,title,role,status:'online',initials,bio:bio||'Membre ajouté au workspace.',focus:'Coordination',activity:'Profil créé',load:35,skills:['Coordination']}; s.members.unshift(m); s.selectedMemberId=m.id; } save(s); closeModal(); render(); return; }
    });

    document.addEventListener('change',(e)=>{
      if(route()!=='#team') return;
      if(e.target.id==='fpTeamV2FileInput'){
        const s=state(); Array.from(e.target.files||[]).forEach(file=>s.draftFiles.push({name:file.name,type:(file.name.split('.').pop()||'DOC').toUpperCase(),size:sizeLabel(file.size)})); save(s); render();
      }
      if(e.target.id==='fpModalAttachFile'){
        const file=e.target.files?.[0]; if(!file) return; const s=state(); s.draftFiles.push({name:file.name,type:(file.name.split('.').pop()||'DOC').toUpperCase(),size:sizeLabel(file.size)}); save(s); closeModal(); render();
      }
    });

    const observer=new MutationObserver(()=>{ if(route()==='#team' && !busy) requestAnimationFrame(render); });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  document.addEventListener('DOMContentLoaded',()=>{ bind(); setTimeout(render,80); setTimeout(render,220); setTimeout(render,500); });
  window.addEventListener('hashchange',()=>{ if(route()==='#team'){ mounted=false; setTimeout(render,80); setTimeout(render,220); } });
})();