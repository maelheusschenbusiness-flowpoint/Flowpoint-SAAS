(()=>{
  const root=document.getElementById('fpPageContainer');
  if(!root) return;

  function generateMissions(){
    const base=[
      'Optimiser les pages services principales',
      'Créer des pages locales ciblées',
      'Renforcer les appels à l\'action',
      'Améliorer la vitesse mobile',
      'Ajouter des preuves sociales',
      'Créer un rapport client clair'
    ];
    return Array.from({length:20}).map((_,i)=>({
      title:base[i%base.length]+` (${i+1})`,
      cat:['SEO','Local','CRO','Tech'][i%4],
      impact:['Élevé','Très élevé','Moyen'][i%3]
    }));
  }

  function renderMissions(){
    const missions=generateMissions();
    root.innerHTML=`
      <div class="m2Hero">
        <div class="m2Kicker">MISSIONS V2</div>
        <div class="m2Title">Moteur intelligent</div>
        <div class="m2Text">Missions générées automatiquement avec logique business et SEO.</div>
      </div>

      <div class="m2Grid">
        <div>
          <div class="m2Panel">
            <div class="m2Head">
              <div>
                <div class="m2PanelTitle">Missions actives</div>
              </div>
              <div class="m2Actions">
                <button class="m2Btn primary">Générer</button>
              </div>
            </div>

            ${missions.map(m=>`
              <div class="m2Mission">
                <button class="m2Check">✓</button>
                <div>
                  <div class="m2MissionTitle">${m.title}</div>
                  <div class="m2Meta">
                    <span class="m2Pill">${m.cat}</span>
                    <span class="m2Pill">${m.impact}</span>
                  </div>
                </div>
                <button class="m2Btn">Ouvrir</button>
              </div>
            `).join('')}

          </div>
        </div>

        <div>
          <div class="m2Panel">
            <div class="m2PanelTitle">Assistant IA</div>
            <div class="m2Card">
              <strong>Plan recommandé</strong>
              <span>Prioriser Local SEO et conversion pour générer rapidement du business.</span>
            </div>
            <textarea class="m2Input" placeholder="Demande un plan stratégique..."></textarea>
            <button class="m2Btn primary" style="margin-top:10px">Analyser</button>
          </div>
        </div>
      </div>

      <div class="m2Panel">
        <div class="m2PanelTitle">Bibliothèque</div>
        <div class="m2Lib">
          ${Array.from({length:24}).map((_,i)=>`
            <div class="m2Card">
              <strong>Pack ${i+1}</strong>
              <span>Contenu enrichi personnalisable selon le site et les objectifs.</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  window.addEventListener('hashchange',()=>{
    if(location.hash==='#missions') renderMissions();
  });

  if(location.hash==='#missions') renderMissions();
})();