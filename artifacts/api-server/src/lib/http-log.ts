/**
 * Ce que le journal HTTP (pino-http) retient d'une requete : l'identifiant, la
 * methode et le CHEMIN, jamais la query string. C'est ce qui garde hors des
 * journaux le `fp_lid` de `GET /go`, un jeton de pre-inscription ou toute
 * valeur collee par erreur dans une URL. Ni IP, ni user-agent, ni en-tetes.
 */
export function serialiserRequeteHttp(req: { id?: string; method?: string; url?: string }): {
  id?: string; method?: string; url?: string;
} {
  return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
}
