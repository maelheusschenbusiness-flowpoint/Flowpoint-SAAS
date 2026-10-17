/**
 * bs_monitor_ownership — a quelle organisation appartient un moniteur BetterStack.
 *
 * POURQUOI CETTE TABLE EXISTE
 *
 * L'integration BetterStack n'avait aucun modele de locataire. Mesure du
 * 17/10/2026 sur le code de Test-Replit :
 *
 *   - `updateMonitor(bsId, orgId, attrs)` recevait `orgId` et ne s'en servait
 *     QUE pour invalider un cache. L'appel partait en `PATCH /monitors/${bsId}`
 *     sans aucun controle d'appartenance. Idem pour delete, pause et resume.
 *     Une organisation pouvait donc agir sur le moniteur d'une autre en
 *     fournissant son identifiant.
 *   - `listMonitors(orgId)` appelait `/monitors?per_page=250` SANS filtre :
 *     tous les moniteurs du compte BetterStack partaient vers n'importe quelle
 *     organisation authentifiee.
 *
 * Le compte BetterStack est partage par FlowPoint. L'isolation ne peut donc
 * venir que de chez nous : cette table EST l'autorisation.
 *
 * CE QU'ELLE N'EST PAS
 *
 * Elle ne derive jamais d'une demande client. Un moniteur SANS proprietaire
 * n'appartient a personne et reste inaccessible : c'est la regle qui empeche
 * la premiere organisation qui demande de s'approprier le parc. L'ancien
 * `syncMonitorsToDB` faisait exactement l'inverse — il attribuait tout le parc
 * a l'organisation qui listait.
 */
import type { PoolClient } from "pg";

type Queryable = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };

export const BS_OWNERSHIP_TABLE = "bs_monitor_ownership";

/** GUC posee par withOrgDb() dans chaque transaction authentifiee. */
const GUC = `current_setting('app.current_org_id', true)`;
const ORG = `COALESCE(org_id::text, 'default')`;

export async function ensureBsOwnershipSchema(db: Queryable | PoolClient): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS bs_monitor_ownership (
      bs_id       TEXT        PRIMARY KEY,                    -- identifiant BetterStack ; un moniteur a UN proprietaire
      org_id      TEXT        NOT NULL,
      claimed_via TEXT        NOT NULL,                       -- 'created' | 'backfill_url' — comment l'appartenance a ete etablie
      claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS bs_own_org_idx ON bs_monitor_ownership(org_id)`);

  // La table porte org_id : elle entre dans l'invariant verifie par migrate.mjs,
  // donc RLS active, forcee, et les quatre policies posees ICI — pas par une
  // passe ulterieure qui pourrait passer avant la creation.
  await db.query(`ALTER TABLE bs_monitor_ownership ENABLE ROW LEVEL SECURITY`);
  await db.query(`ALTER TABLE bs_monitor_ownership FORCE ROW LEVEL SECURITY`);
  for (const op of ["select", "insert", "update", "delete"] as const) {
    await db.query(`DROP POLICY IF EXISTS "tenant_${op}" ON bs_monitor_ownership`);
  }
  await db.query(`CREATE POLICY "tenant_select" ON bs_monitor_ownership FOR SELECT USING     (${ORG} = ${GUC})`);
  await db.query(`CREATE POLICY "tenant_insert" ON bs_monitor_ownership FOR INSERT WITH CHECK (${ORG} = ${GUC})`);
  await db.query(`CREATE POLICY "tenant_update" ON bs_monitor_ownership FOR UPDATE USING     (${ORG} = ${GUC})`);
  await db.query(`CREATE POLICY "tenant_delete" ON bs_monitor_ownership FOR DELETE USING     (${ORG} = ${GUC})`);
}

/* ═════════ Attribution des moniteurs preexistants ═════════
 *
 * Le parc BetterStack existe avant cette table. On ne peut pas l'attribuer au
 * jugé : attribuer a tort donnerait a une organisation la main sur le moniteur
 * d'une autre, ce qui est exactement le defaut qu'on corrige.
 *
 * L'appartenance n'est donc etablie QUE lorsqu'elle se demontre : le moniteur
 * BetterStack surveille la meme URL qu'un moniteur natif, et cette URL
 * n'appartient qu'a UNE organisation. Une URL partagee par plusieurs
 * organisations ne prouve rien — on laisse sans proprietaire, donc
 * inaccessible.
 *
 * Par defaut la fonction n'ecrit RIEN : elle rend ce qu'elle ferait. C'est une
 * attribution de donnees existantes, elle se regarde avant de s'appliquer.
 */
export interface PropositionAttribution {
  bsId: string;
  url: string;
  orgId: string | null;
  raison: "url unique" | "url partagee par plusieurs organisations" | "aucune correspondance";
}

export async function proposerAttributions(
  db: Queryable | PoolClient,
  monitorsBetterStack: Array<{ id: string; url: string }>,
  options: { appliquer?: boolean } = {}
): Promise<PropositionAttribution[]> {
  const propositions: PropositionAttribution[] = [];

  for (const m of monitorsBetterStack) {
    const url = (m.url ?? "").trim();
    if (!url) {
      propositions.push({ bsId: String(m.id), url, orgId: null, raison: "aucune correspondance" });
      continue;
    }
    // Normalisation minimale : le protocole et la barre finale ne changent pas
    // l'identite du site surveille.
    const r = await db.query(
      `SELECT DISTINCT org_id FROM monitors
        WHERE regexp_replace(lower(url), '^https?://|/+$', '', 'g')
            = regexp_replace(lower($1), '^https?://|/+$', '', 'g')`,
      [url]
    );
    if (r.rows.length === 1) {
      const orgId = String(r.rows[0]!["org_id"]);
      propositions.push({ bsId: String(m.id), url, orgId, raison: "url unique" });
      if (options.appliquer) {
        await db.query(
          `INSERT INTO bs_monitor_ownership (bs_id, org_id, claimed_via)
           VALUES ($1, $2, 'backfill_url') ON CONFLICT (bs_id) DO NOTHING`,
          [String(m.id), orgId]
        );
      }
    } else if (r.rows.length > 1) {
      propositions.push({ bsId: String(m.id), url, orgId: null, raison: "url partagee par plusieurs organisations" });
    } else {
      propositions.push({ bsId: String(m.id), url, orgId: null, raison: "aucune correspondance" });
    }
  }
  return propositions;
}

/**
 * Le registre d'appartenance est-il present et interrogeable dans CET
 * environnement ?
 *
 * Le code d'isolation depend de cette table. Il est fail-closed — sans elle,
 * toute operation client est refusee — mais il faut pouvoir constater laquelle
 * des deux situations est en cours avant de s'appuyer sur la fonctionnalite.
 * Cette sonde ne lit aucune donnee : elle verifie seulement que la table repond.
 */
export async function registreAppartenancePresent(db: Queryable | PoolClient): Promise<boolean> {
  try {
    await db.query(`SELECT 1 FROM ${BS_OWNERSHIP_TABLE} WHERE false`);
    return true;
  } catch {
    return false;
  }
}
