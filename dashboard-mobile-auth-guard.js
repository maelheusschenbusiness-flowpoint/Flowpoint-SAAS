(()=>{
const TOKEN_KEY='token';
const REFRESH_TOKEN_KEY='refreshToken';
const LOGOUT_FLAG_KEY='fp_manual_logout';
const DASHBOARD_URL='/dashboard.html#overview';
const MOBILE_QUERY='(max-width: 980px)';
const REDIRECT_BLOCK_WINDOW_MS=90000;
const RETRY_DELAYS=[350,900,1800];
const KEEPALIVE_MS=60000;
const nativeFetch=window.fetch.bind(window);
const nativeReplace=window.location.replace.bind(window.location);
const nativeAssign=window.location.assign?window.location.assign.bind(window.location):null;
const state={lastResumeAt:Date.now(),refreshInFlight:false,recentAuthFailureAt:0};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const isMobile=()=>window.matchMedia(MOBILE_QUERY).matches||/iPhone|iPad|iPod|Android/i.test(navigator.userAgent||'');
const hasTokens=()=>!!(localStorage.getItem(TOKEN_KEY)||localStorage.getItem(REFRESH_TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||sessionStorage.getItem(REFRESH_TOKEN_KEY));
const getRefreshToken=()=>localStorage.getItem(REFRESH_TOKEN_KEY)||sessionStorage.getItem(REFRESH_TOKEN_KEY)||'';
const getAccessToken=()=>localStorage.getItem(TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||'';
const setToken=(k,v)=>{if(!v)return;localStorage.setItem(k,v);try{sessionStorage.setItem(k,v);}catch{}};
const clearLogoutFlag=()=>{try{localStorage.removeItem(LOGOUT_FLAG_KEY);sessionStorage.removeItem(LOGOUT_FLAG_KEY);}catch{}};
const setLogoutFlag=()=>{try{localStorage.setItem(LOGOUT_FLAG_KEY,'1');sessionStorage.setItem(LOGOUT_FLAG_KEY,'1');}catch{}};
const hasLogoutFlag=()=>{try{return localStorage.getItem(LOGOUT_FLAG_KEY)==='1'||sessionStorage.getItem(LOGOUT_FLAG_KEY)==='1';}catch{return false;}};
const shouldProtect=()=>isMobile()&&!hasLogoutFlag()&&hasTokens()&&(navigator.onLine===false||(Date.now()-state.lastResumeAt)<REDIRECT_BLOCK_WINDOW_MS||(Date.now()-state.recentAuthFailureAt)<REDIRECT_BLOCK_WINDOW_MS);
const isAuthUrl=(input)=>{const url=typeof input==='string'?input:String(input?.url||'');return /\/api\/me/.test(url)||/\/api\/auth\/refresh/.test(url)};
async function tryRefresh(){
  const refreshToken=getRefreshToken();
  if(!refreshToken||state.refreshInFlight)return false;
  state.refreshInFlight=true;
  try{
    const r=await nativeFetch('/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({refreshToken})});
    const j=await r.json().catch(()=>({}));
    if(r.ok&&(j.token||j.accessToken)){
      setToken(TOKEN_KEY,j.token||j.accessToken);
      if(j.refreshToken)setToken(REFRESH_TOKEN_KEY,j.refreshToken);
      clearLogoutFlag();
      state.recentAuthFailureAt=0;
      return true;
    }
  }catch(e){
    console.warn('refresh fail',e);
  }finally{
    state.refreshInFlight=false;
  }
  return false;
}
async function guardedFetch(input,init){
  if(!isAuthUrl(input))return nativeFetch(input,init);
  let res;
  for(let i=0;i<=RETRY_DELAYS.length;i++){
    try{
      res=await nativeFetch(input,init);
      if(res.status!==401)return res;
      state.recentAuthFailureAt=Date.now();
      if(!isMobile()||!hasTokens()||hasLogoutFlag())return res;
      const ok=await tryRefresh();
      if(ok){
        const access=getAccessToken();
        const headers=new Headers((init&&init.headers)||{});
        if(access)headers.set('Authorization',`Bearer ${access}`);
        return nativeFetch(input,{...(init||{}),headers});
      }
    }catch(e){
      state.recentAuthFailureAt=Date.now();
      if(i===RETRY_DELAYS.length)throw e;
    }
    if(i<RETRY_DELAYS.length)await sleep(RETRY_DELAYS[i]);
  }
  return res;
}
window.fetch=guardedFetch;
window.location.replace=(url)=>{
  const target=String(url||'');
  if(/\/login\.html/.test(target)&&shouldProtect()){
    console.warn('blocked login redirect');
    tryRefresh().then((ok)=>{ if(ok) nativeReplace(DASHBOARD_URL); });
    return;
  }
  return nativeReplace(url);
};
if(nativeAssign){
  window.location.assign=(url)=>{
    const target=String(url||'');
    if(/\/login\.html/.test(target)&&shouldProtect()){
      console.warn('blocked assign');
      tryRefresh().then((ok)=>{ if(ok) nativeReplace(DASHBOARD_URL); });
      return;
    }
    return nativeAssign(url);
  };
}
function wakeSession(){
  state.lastResumeAt=Date.now();
  if(isMobile()&&hasTokens()&&!hasLogoutFlag())tryRefresh();
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') wakeSession(); });
window.addEventListener('focus',wakeSession);
window.addEventListener('online',wakeSession);
window.addEventListener('pageshow',wakeSession);
document.addEventListener('click',(e)=>{ const btn=e.target.closest('#fpLogoutBtn,[data-logout],.fpLogoutBtn'); if(btn) setLogoutFlag(); });
setInterval(()=>{ if(document.visibilityState==='visible'&&isMobile()&&hasTokens()&&!hasLogoutFlag()) tryRefresh(); },KEEPALIVE_MS);
if(isMobile()&&hasTokens()&&!hasLogoutFlag()) tryRefresh();
})();