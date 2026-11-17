/* Vérifie, dans un navigateur réel en fr-FR sans préférence, que les 11 pages publiques s'affichent en anglais
   (aucun texte français visible) et que la logique de tarifs reste indépendante de la langue.
   Usage : node scripts/verifier-langue-pages-publiques.cjs http://127.0.0.1:4400   (serveur de test local uniquement) */
const BASE = process.argv[2]; if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE || '')) { console.error('cible refusée : serveur local uniquement'); process.exit(2); }
const { chromium } = require('playwright');
const PAGES = ['signin','login','login-verify','pricing','checkout','checkout-payment','checkout-return','success','cancel','accept-invitation','report-view'];
(async()=>{
  const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox']});
  for (const profile of [{name:'bureau',viewport:{width:1440,height:900}},{name:'mobile',viewport:{width:390,height:844},isMobile:true,hasTouch:true}]) {
    const ctx = await browser.newContext({locale:'fr-FR', ...profile});
    for (const pg of PAGES) {
      const page = await ctx.newPage(); const errs=[];
      page.on('pageerror', e=>errs.push(String(e.message).slice(0,120)));
      await page.goto(BASE+'/'+pg+'.html',{waitUntil:'domcontentloaded'}).catch(()=>{}); await page.waitForTimeout(1500);
      if (pg==='pricing') await page.evaluate(()=>{ try{toggleCmpRows()}catch(e){} try{toggleAddons()}catch(e){} });
      await page.waitForTimeout(500);
      const r = await page.evaluate(()=>{
        const FR=/\b(votre|vos|vous|nous|pour|avec|mois|essai|gratuit|créer|compte|tarifs?|connexion|déjà|prénom|entreprise|paiement|annulé|disponible|Bientôt|rejoindre|expirée?|Réduire|Augmenter|Historique|Crédits|jours?|Voir|Ajoutez|Gérez|supplémentaires?)\b|[éèêàçùôîû]/i;
        const out=[]; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
        for(let n=w.nextNode();n;n=w.nextNode()){const p=n.parentElement; if(!p||/^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName))continue; const t=n.nodeValue.trim(); if(t&&FR.test(t)&&p.getClientRects().length) out.push(t.slice(0,70));}
        document.querySelectorAll('[title],[aria-label],[placeholder]').forEach(e=>{ if(!e.getClientRects().length) return; for(const a of ['title','aria-label','placeholder']){const v=e.getAttribute(a); if(v&&FR.test(v)) out.push(a+': '+v.slice(0,60));}});
        return {lang:document.documentElement.lang, fr:[...new Set(out)].slice(0,6), n:out.length, title:document.title.slice(0,50)};});
      console.log(`${profile.name.padEnd(6)} ${pg.padEnd(18)} lang=${r.lang} français_visible=${r.n} erreurs_js=${errs.length}${errs.length?' '+JSON.stringify(errs.slice(0,2)):''}${r.n?' '+JSON.stringify(r.fr):''}`);
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
})();
