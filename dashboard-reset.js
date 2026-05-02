(()=>{
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const STORE='fp_reset_v1';

  function toast(t){let el=$('.toast');if(!el){el=document.createElement('div');el.className='toast';document.body.appendChild(el)}el.textContent=t;clearTimeout(el._t);el._t=setTimeout(()=>el.remove(),2200)}

  function nav(){
    $$('.nav a').forEach(a=>{
      a.onclick=()=>{
        $$('.nav a').forEach(x=>x.classList.remove('active'));
        a.classList.add('active');
        location.hash=a.getAttribute('href');
        render();
      }
    });
  }

  function overview(){
    return `
    <section class="hero">
      <div>
        <div class="kicker">FLOWPOINT</div>
        <div class="title">Overview</div>
        <div class="text">Centre de contrôle complet avec actions, performance et croissance.</div>
      </div>
    </section>

    <section class="grid three">
      <div class="card stat"><strong>84%</strong><span>Santé globale</span></div>
      <div class="card stat"><strong>6</strong><span>Missions actives</span></div>
      <div class="card stat"><strong>2</strong><span>Risques</span></div>
    </section>
    `;
  }

  function missions(){
    const list=Array.from({length:12}).map((_,i)=>`
      <div class="mission">
        <button class="check">✓</button>
        <div>
          <div class="mtitle">Optimiser page ${i+1}</div>
          <div class="pills"><span class="pill">SEO</span><span class="pill">Impact élevé</span></div>
        </div>
        <button class="btn">Ouvrir</button>
      </div>`).join('');

    return `
    <section class="panel">
      <div class="head"><div class="h2">Missions</div><button class="btn primary">Générer</button></div>
      <div class="missionList">${list}</div>
    </section>`;
  }

  function team(){
    const msgs=Array.from({length:6}).map((_,i)=>`
      <div class="msg">
        <div class="avatar">U</div>
        <div><strong>Message ${i+1}</strong><span>Discussion équipe structurée.</span></div>
      </div>`).join('');

    return `
    <section class="panel">
      <div class="head"><div class="h2">Team</div></div>
      <div class="chat">${msgs}</div>
    </section>`;
  }

  function render(){
    const root=$('.page');
    if(!root) return;
    const r=location.hash||'#overview';
    if(r==='#missions') root.innerHTML=missions();
    else if(r==='#team') root.innerHTML=team();
    else root.innerHTML=overview();
  }

  function init(){
    nav();
    render();
    document.addEventListener('click',e=>{
      if(e.target.classList.contains('check')){
        e.target.closest('.mission').classList.toggle('done');
      }
      if(e.target.textContent==='Générer'){toast('Missions générées');}
      if(e.target.textContent==='Ouvrir'){toast('Détail mission');}
    });
  }

  document.addEventListener('DOMContentLoaded',init);
})();