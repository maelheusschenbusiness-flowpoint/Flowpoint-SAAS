/**
 * Analyse de la sortie de `stripe listen --forward-to ...` (Mode L) : preuve que chaque evenement a ete
 * transmis a l'application locale et qu'elle a repondu 2xx.
 * Format attendu (a confirmer avec la version de la CLI Stripe utilisee) :
 *   2026-11-08 12:00:01   --> setup_intent.succeeded [evt_1Abc...]
 *   2026-11-08 12:00:01  <--  [200] POST http://localhost:8080/api/billing/webhook [evt_1Abc...]
 */
export interface LigneLivraison { evenement: string; type: string | null; statut: number | null; url: string | null }

export function analyserJournalListen(texte: string): { livraisons: LigneLivraison[]; echecs: LigneLivraison[]; sansReponse: LigneLivraison[] } {
  const types = new Map<string, string>();
  const reponses = new Map<string, Array<{ statut: number; url: string }>>();
  for (const ligne of texte.split(/\r?\n/)) {
    const a = /-->\s+([a-z0-9_.]+)\s+\[(evt_[A-Za-z0-9]+)\]/.exec(ligne);
    if (a) { types.set(a[2]!, a[1]!); continue; }
    const r = /<--\s+\[(\d{3})\]\s+POST\s+(\S+)\s+\[(evt_[A-Za-z0-9]+)\]/.exec(ligne);
    if (r) {
      const l = reponses.get(r[3]!) ?? [];
      l.push({ statut: Number(r[1]), url: r[2]! });
      reponses.set(r[3]!, l);
    }
  }
  const livraisons: LigneLivraison[] = [];
  const echecs: LigneLivraison[] = [];
  const sansReponse: LigneLivraison[] = [];
  for (const [evt, type] of types) {
    const rs = reponses.get(evt) ?? [];
    if (rs.length === 0) { sansReponse.push({ evenement: evt, type, statut: null, url: null }); continue; }
    for (const r of rs) {
      const l = { evenement: evt, type, statut: r.statut, url: r.url };
      livraisons.push(l);
    }
    // Le dernier essai fait foi (Stripe rejoue un 5xx) ; un 4xx n'est pas rejoue : echec definitif.
    const dernier = rs[rs.length - 1]!;
    if (dernier.statut < 200 || dernier.statut >= 300) echecs.push({ evenement: evt, type, statut: dernier.statut, url: dernier.url });
  }
  return { livraisons, echecs, sansReponse };
}
