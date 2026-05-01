// FlowPoint Team V10 UI fixes — interactions (no more bottom broken forms, integrated messages, pro modals)
(function(){
  if (window.__FP_TEAM_V10__) return;
  window.__FP_TEAM_V10__ = true;

  const $ = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

  // --------- Helpers ---------
  function toast(msg){
    const t = document.createElement('div');
    t.className = 'fpTeamV10Toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(()=> t.remove(), 2600);
  }

  function openModal({title, sub, fields=[]}){
    const back = document.createElement('div');
    back.className = 'fpTeamV10Backdrop';

    const modal = document.createElement('div');
    modal.className = 'fpTeamV10Modal';

    modal.innerHTML = `
      <div class="fpTeamV10ModalHead">
        <div>
          <div class="fpTeamV10Kicker">FlowPoint</div>
          <h2 class="fpTeamV10Title">${title}</h2>
          ${sub ? `<div class="fpTeamV10Sub">${sub}</div>` : ``}
        </div>
        <button class="fpTeamV10Close">✕</button>
      </div>
      <div class="fpTeamV10Body">
        <div class="fpTeamV10Grid"></div>
        <div class="fpTeamV10Panel">
          <div class="fpTeamV10PanelTitle">Checklist</div>
          <div class="fpTeamV10Checklist">
            <label><input type="checkbox"> Décision claire</label>
            <label><input type="checkbox"> Responsable assigné</label>
            <label><input type="checkbox"> Prochaine étape définie</label>
          </div>
        </div>
        <div class="fpTeamV10Actions">
          <button class="fpTeamV10Btn">Annuler</button>
          <button class="fpTeamV10Btn fpTeamV10BtnPrimary">Valider</button>
        </div>
      </div>
    `;

    const grid = modal.querySelector('.fpTeamV10Grid');
    fields.forEach(f=>{
      const div = document.createElement('div');
      div.className = 'fpTeamV10Field';
      div.innerHTML = `<label>${f.label}</label>${f.type==='textarea' ? `<textarea class="fpTeamV10Textarea" placeholder="${f.placeholder||''}"></textarea>` : `<input class="fpTeamV10Input" placeholder="${f.placeholder||''}" />`}`;
      grid.appendChild(div);
    });

    back.appendChild(modal);
    document.body.appendChild(back);

    const close = ()=> back.remove();
    modal.querySelector('.fpTeamV10Close').onclick = close;
    modal.querySelector('.fpTeamV10Btn').onclick = close;
    modal.querySelector('.fpTeamV10BtnPrimary').onclick = ()=>{
      toast('Action enregistrée');
      close();
    };
  }

  // --------- Messages integrated panel ---------
  function toggleMessagesDock(){
    let dock = $('.fpTeamMessageDock');
    if (dock){ dock.remove(); return; }

    dock = document.createElement('div');
    dock.className = 'fpTeamMessageDock';
    dock.innerHTML = `
      <div class="fpTeamMessageDockHead">
        <div class="fpTeamMessageDockTitle">Recherche messages</div>
        <button class="fpTeamMessageDockClose">✕</button>
      </div>
      <div class="fpTeamMessageSearch">
        <span>👤</span>
        <span>#</span>
        <span>🔗</span>
        <span>@</span>
        <input placeholder="Rechercher…" />
        <button>OK</button>
      </div>
      <div class="fpTeamFilterHelp">
        <div class="fpTeamFilterHelpItem">
          <div class="fpTeamFilterHelpIcon">👤</div>
          <div class="fpTeamFilterHelpText">D’un utilisateur spécifique<small>de: utilisateur</small></div>
        </div>
        <div class="fpTeamFilterHelpItem">
          <div class="fpTeamFilterHelpIcon">#</div>
          <div class="fpTeamFilterHelpText">Envoyé dans un salon<small>dans: salon</small></div>
        </div>
        <div class="fpTeamFilterHelpItem">
          <div class="fpTeamFilterHelpIcon">🔗</div>
          <div class="fpTeamFilterHelpText">Contient un lien ou fichier<small>lien, intégration</small></div>
        </div>
        <div class="fpTeamFilterHelpItem">
          <div class="fpTeamFilterHelpIcon">@</div>
          <div class="fpTeamFilterHelpText">Mentionne un utilisateur<small>mentions: utilisateur</small></div>
        </div>
      </div>
    `;

    document.body.appendChild(dock);
    dock.querySelector('.fpTeamMessageDockClose').onclick = ()=> dock.remove();
  }

  // --------- Fix buttons (no more bottom forms) ---------
  document.addEventListener('click', function(e){
    const btn = e.target.closest('button');
    if (!btn) return;

    const text = (btn.innerText||'').toLowerCase();

    if (btn.id === 'fpTeamMessagesTop'){
      e.preventDefault();
      toggleMessagesDock();
      return;
    }

    // intercept create / add buttons
    if (
      text.includes('nouvelle note') ||
      text.includes('créer note') ||
      text.includes('nouvel événement') ||
      text.includes('créer événement') ||
      text.includes('ajouter') ||
      text.includes('créer')
    ){
      e.preventDefault();
      e.stopPropagation();

      openModal({
        title: 'Créer élément',
        sub: 'Structure propre avec décision, responsable et prochaine étape.',
        fields:[
          {label:'Titre', placeholder:'Titre clair'},
          {label:'Contenu', type:'textarea', placeholder:'Détails…'}
        ]
      });
    }
  }, true);

  // --------- Improve existing layout after render ---------
  function enhance(){
    // unread indicator (demo if messages exist)
    const msgBtn = $('#fpTeamMessagesTop');
    if (msgBtn) msgBtn.classList.add('fpHasUnread');

    // fix member card
    $$('.fpMemberCard, .fpTeamMemberCard').forEach(el=>{
      el.classList.add('fpMemberProCard');
    });

    // fix note blocks
    $$('.fpNoteRow, .fpNoteItem').forEach(el=>{
      el.classList.add('fpNoteListPro');
    });

    // fix ugly text sections
    $$('.fpCardText, .fpSmall').forEach(el=>{
      if (el.innerText.length > 40) el.classList.add('fpTeamProTextBlock');
    });
  }

  const obs = new MutationObserver(()=> enhance());
  obs.observe(document.body, {childList:true, subtree:true});

  enhance();
})();
