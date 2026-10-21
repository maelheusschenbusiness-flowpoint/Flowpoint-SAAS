/**
 * Browser-side factory embedded in the behavioral analytics snippet.
 * A tab keeps one session id across page navigations so A/B assignment and
 * unique-session conversion counts do not change on every page load.
 */
export const BEHAVIORAL_SESSION_ID_FACTORY = `function(w){
  var key='fp:behavioral:session-id:v1';
  var create=function(){return 'fp_'+Math.random().toString(36).slice(2,10)};
  try{
    var existing=w.sessionStorage.getItem(key);
    if(existing&&/^fp_[a-z0-9]+$/.test(existing))return existing;
    var id=create();
    w.sessionStorage.setItem(key,id);
    return id;
  }catch(e){return create()}
}`;
