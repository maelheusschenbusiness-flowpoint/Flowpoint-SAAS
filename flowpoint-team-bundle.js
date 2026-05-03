// FlowPoint Team Bundle JS
// Central loader for legacy team scripts (v1, v2, v3...)

(function(){
  const scripts = [
    '/team-calendar-pro.js',
    '/team-final-actions.js',
    '/notes d\'équipe-membres-polish.js',
    '/team-workspace-polish.js',
    '/team-workspace-pro.js',
    '/team-workspace-rebuild.js',
    '/team-workspace-rebuild.part1.js',
    '/team-workspace-rebuild.part2.js',
    '/team-workspace-rebuild.part3.js',
    '/team-workspace-rebuild.part4.js',
    '/team-workspace-rebuild.part5.js',
    '/team-workspace-rebuild.part6.js',
    '/team-workspace-rebuild.part7.js',
    '/espace-de-travail-equipe.js'
  ];

  function loadNext(i){
    if(i >= scripts.length) return;
    const s = document.createElement('script');
    s.src = scripts[i];
    s.defer = true;
    s.onload = () => loadNext(i+1);
    s.onerror = () => loadNext(i+1);
    document.body.appendChild(s);
  }

  if(location.hash.includes('team')){
    loadNext(0);
  }
})();
