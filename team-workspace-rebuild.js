(()=>{
  const PAGE_SELECTOR='fpPageContainer';
  const isTeamRoute=()=> (location.hash||'#overview').toLowerCase()==='#team';
  const root=()=>document.getElementById(PAGE_SELECTOR);
  let mounted=false;
  let ticking=false;

  function getPlan(){
    const el=document.getElementById('fpAccPlan');
    return (el?.textContent||'Standard').trim();
  }

  function renderTeamShell(){
    const host=root();
    if(!host) return;
    host.innerHTML=`
      <section class="fpTeamV2" data-team-v2="true">
        <div class="fpTeamV2Hero">
          <div>
            <div class="fpTeamV2SectionKicker">Équipe</div>
            <div class="fpTeamV2HeroTitle">Workspace équipe</div>
            <div class="fpTeamV2HeroText">
              Hub équipe stable pour chat, calendrier, notes, membres et activité. Cette version remet la page Équipe en état sans planter le dashboard.
            </div>
            <div class="fpTeamV2HeroMeta">
              <div class="fpTeamV2MetaPill"><span class="fpTeamV2Dot"></span>Workspace actif</div>
              <div class="fpTeamV2MetaPill">Plan : ${getPlan()}</div>
              <div class="fpTeamV2MetaPill">FlowPoint Team</div>
            </div>
          </div>

          <div class="fpTeamV2HeroRight">
            <div class="fpTeamV2ActionGrid">
              <button class="fpTeamV2Btn fpTeamV2BtnPrimary" type="button">Nouveau canal</button>
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" type="button">Lancer une visio</button>
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" type="button">Nouvelle note</button>
              <button class="fpTeamV2Btn fpTeamV2BtnGhost" type="button">Nouvel événement</button>
            </div>
            <div class="fpTeamV2InsightGrid">
              <div class="fpTeamV2Insight">
                <strong>Stabilité</strong>
                <span>Le module Équipe charge maintenant sans casser la navigation du dashboard.</span>
              </div>
              <div class="fpTeamV2Insight">
                <strong>Suite</strong>
                <span>On peut réinjecter les fonctions avancées page par page sur cette base saine.</span>
              </div>
            </div>
          </div>
        </div>

        <div class="fpTeamV2Kpis">
          <div class="fpTeamV2Kpi"><span>Canaux</span><strong>4</strong><small>Base équipe stable</small></div>
          <div class="fpTeamV2Kpi"><span>Calendrier</span><strong>OK</strong><small>Structure prête</small></div>
          <div class="fpTeamV2Kpi"><span>Notes</span><strong>OK</strong><small>Bloc prêt à enrichir</small></div>
          <div class="fpTeamV2Kpi"><span>Membres</span><strong>OK</strong><small>Base sans crash</small></div>
        </div>

        <div class="fpTeamV2Tabs">
          <button class="fpTeamV2Tab active" type="button">Canaux & chat</button>
          <button class="fpTeamV2Tab" type="button">Calendrier</button>
          <button class="fpTeamV2Tab" type="button">Notes</button>
          <button class="fpTeamV2Tab" type="button">Membres</button>
          <button class="fpTeamV2Tab" type="button">Activité</button>
        </div>

        <div class="fpTeamV2GridChat">
          <div class="fpTeamV2Panel">
            <div class="fpTeamV2SectionKicker">Canaux</div>
            <div class="fpTeamV2SectionText">Version stable remise en place pour éviter le plantage sur l’onglet Équipe.</div>
            <div class="fpTeamV2ChannelList">
              <button class="fpTeamV2ChannelBtn active" type="button"><div class="fpTeamV2ChannelLeft"><span class="fpTeamV2Hash">#</span><div><div class="fpTeamV2ChannelName">general</div><div class="fpTeamV2ChannelMeta">Annonces et coordination</div></div></div></button>
              <button class="fpTeamV2ChannelBtn" type="button"><div class="fpTeamV2ChannelLeft"><span class="fpTeamV2Hash">#</span><div><div class="fpTeamV2ChannelName">seo</div><div class="fpTeamV2ChannelMeta">Quick wins et contenu</div></div></div></button>
              <button class="fpTeamV2ChannelBtn" type="button"><div class="fpTeamV2ChannelLeft"><span class="fpTeamV2Hash">#</span><div><div class="fpTeamV2ChannelName">dev</div><div class="fpTeamV2ChannelMeta">Tech et stabilité</div></div></div></button>
            </div>
          </div>

          <div class="fpTeamV2Panel">
            <div class="fpTeamV2Header">
              <div>
                <div class="fpTeamV2SectionKicker">Canal actif</div>
                <div class="fpTeamV2SectionTitle">#general</div>
                <div class="fpTeamV2SectionText">La page est de nouveau stable. On peut maintenant la ré-enrichir proprement.</div>
              </div>
              <div class="fpTeamV2HeaderCenter"><div class="fpTeamV2Status online">En ligne</div></div>
              <div class="fpTeamV2HeaderActions"><button class="fpTeamV2Btn fpTeamV2BtnGhost fpTeamV2BtnWide" type="button">Lancer une visio</button></div>
            </div>

            <div class="fpTeamV2MessagesWrap">
              <div>
                <div class="fpTeamV2Messages">
                  <article class="fpTeamV2Message">
                    <div class="fpTeamV2Avatar">F</div>
                    <div>
                      <div class="fpTeamV2MessageTop"><strong>FlowPoint</strong><span class="fpTeamV2MessageMeta">system</span></div>
                      <div class="fpTeamV2MessageText">Le module Équipe a été remis en état. Plus de crash sur l’ouverture.</div>
                    </div>
                  </article>
                </div>

                <div class="fpTeamV2Composer">
                  <div class="fpTeamV2SectionKicker">Nouveau message</div>
                  <div class="fpTeamV2ComposerGrid">
                    <div class="fpTeamV2ComposerMain">
                      <textarea class="fpTeamV2Textarea" placeholder="Écris un message..." disabled></textarea>
                    </div>
                    <div class="fpTeamV2ComposerAside">
                      <button class="fpTeamV2Btn fpTeamV2BtnPrimary" type="button">Envoyer</button>
                      <button class="fpTeamV2Btn fpTeamV2BtnGhost" type="button">Joindre un document</button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="fpTeamV2Stack">
                <div class="fpTeamV2SidebarCard"><strong>Statut</strong><span>Version stable active.</span></div>
                <div class="fpTeamV2SidebarCard"><strong>Objectif</strong><span>Réinjecter ensuite chat, calendrier, notes et membres proprement.</span></div>
              </div>
            </div>
          </div>

          <div class="fpTeamV2Panel">
            <div class="fpTeamV2SectionKicker">Info</div>
            <div class="fpTeamV2SectionText">Si tu vois cette page, le crash Équipe est corrigé.</div>
          </div>
        </div>
      </section>`;
  }

  function mount(){
    if(!isTeamRoute()) return;
    renderTeamShell();
    mounted=true;
  }

  function scheduleMount(){
    if(ticking) return;
    ticking=true;
    requestAnimationFrame(()=>{
      ticking=false;
      mount();
    });
  }

  const observer=new MutationObserver(()=>{
    if(isTeamRoute()) scheduleMount();
  });

  document.addEventListener('DOMContentLoaded',()=>{
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(scheduleMount,80);
    setTimeout(scheduleMount,220);
    setTimeout(scheduleMount,500);
  });

  window.addEventListener('hashchange',()=>{
    if(isTeamRoute()){
      mounted=false;
      setTimeout(scheduleMount,80);
      setTimeout(scheduleMount,220);
    }
  });
})();