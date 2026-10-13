/**
 * checkout_post_tokens — schema et isolation, poses au meme endroit.
 *
 * La table porte un jeton a usage unique (token_hash = SHA256 de la session
 * Stripe) qui ouvre la premiere session d'un compte apres paiement. Elle porte
 * aussi `org_id`, donc elle entre dans l'invariant d'isolation verifie par
 * migrate.mjs : toute table portant org_id doit avoir RLS active ET une policy
 * qui isole sur org_id.
 *
 * Elle ne l'avait pas a l'initialisation. Elle etait creee uniquement au
 * demarrage du serveur, dans une etape detachee et tolerante aux erreurs, avec
 * ENABLE + FORCE ROW LEVEL SECURITY et AUCUNE policy. Deux consequences, selon
 * l'ordre dans lequel les etapes de demarrage se terminent :
 *
 *  - la table n'existe pas quand migrate.mjs passe, donc l'audit d'isolation ne
 *    la voit pas ; elle apparait ensuite sans policy ;
 *  - la passe RLS du demarrage peut se terminer AVANT la creation de la table,
 *    et la table reste alors sans policy jusqu'au demarrage suivant.
 *
 * FORCE sans policy est fail-closed — aucune fuite — mais l'invariant est faux
 * pendant cette fenetre, et ce qui tient par l'ordre d'execution de deux
 * etapes asynchrones ne tient pas.
 *
 * Le schema est donc pose ici, appele par les DEUX chemins : init-data-tables
 * (etape 5 de migrate.mjs, donc avant le durcissement RLS et l'audit) et le
 * demarrage du serveur. Les policies sont posees dans la meme fonction que la
 * table : il n'existe plus d'instant ou l'une existe sans les autres.
 *
 * Les policies sont celles que la passe RLS applique a toute table portant
 * org_id — meme nom, meme predicat — pour qu'un rejeu de cette passe soit un
 * no-op. Elles n'ouvrent rien : une connexion cliente sans `app.current_org_id`
 * ne voit aucune ligne, et le pool backend (superuser) n'est pas soumis a RLS.
 */

/** Le strict minimum attendu d'un client ou d'un pool pg. */
type Queryable = { query: (sql: string) => Promise<unknown> };

export const CHECKOUT_POST_TOKENS_TABLE = "checkout_post_tokens";

/** GUC posee par withOrgDb() dans chaque transaction authentifiee. */
const GUC = `current_setting('app.current_org_id', true)`;
const ORG = `COALESCE(org_id::text, 'default')`;

export async function ensureCheckoutPostTokensSchema(db: Queryable): Promise<void> {
  // Schema ancien (stripe_session_id en cle primaire, pas de token_hash) :
  // la table est refaite. Les policies sont reposees juste apres, puisqu'un
  // DROP TABLE emporte les siennes.
  await db.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'checkout_post_tokens'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'checkout_post_tokens'
          AND column_name = 'token_hash'
      ) THEN
        DROP TABLE checkout_post_tokens;
      END IF;
    END $$
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS checkout_post_tokens (
      token_hash         TEXT        PRIMARY KEY,           -- SHA256(stripe_session_id)
      stripe_session_id  TEXT        UNIQUE NOT NULL,       -- conserve pour l'idempotence des evenements Stripe
      stripe_event_id    TEXT,
      org_id             TEXT        NOT NULL,
      email              TEXT        NOT NULL,
      pre_register_token TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at         TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes'
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS cpt_org_idx     ON checkout_post_tokens(org_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS cpt_expires_idx ON checkout_post_tokens(expires_at)`);

  // RLS active et forcee : le jeton ne doit jamais etre lisible via PostgREST.
  await db.query(`ALTER TABLE checkout_post_tokens ENABLE ROW LEVEL SECURITY`);
  await db.query(`ALTER TABLE checkout_post_tokens FORCE ROW LEVEL SECURITY`);

  // Isolation par organisation, posee avec la table et non par une passe ulterieure.
  for (const op of ["select", "insert", "update", "delete"] as const) {
    await db.query(`DROP POLICY IF EXISTS "tenant_${op}" ON checkout_post_tokens`);
  }
  await db.query(`CREATE POLICY "tenant_select" ON checkout_post_tokens FOR SELECT USING     (${ORG} = ${GUC})`);
  await db.query(`CREATE POLICY "tenant_insert" ON checkout_post_tokens FOR INSERT WITH CHECK (${ORG} = ${GUC})`);
  await db.query(`CREATE POLICY "tenant_update" ON checkout_post_tokens FOR UPDATE USING     (${ORG} = ${GUC})`);
  await db.query(`CREATE POLICY "tenant_delete" ON checkout_post_tokens FOR DELETE USING     (${ORG} = ${GUC})`);
}
