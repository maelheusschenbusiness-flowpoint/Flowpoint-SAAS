/**
 * FlowPoint — serialisation de l'activation d'une inscription (A-06).
 *
 * Deux chemins activent un nouveau compte apres paiement : `finalize-checkout`
 * (navigateur) et le webhook Stripe (`activateNewSignup`). Ils s'executent
 * souvent presque en meme temps. Avant ce module, chacun lisait
 * `pending_signups` sans verrou et le premier generait un `randomUUID()` pour
 * l'organisation sans chercher celle que l'autre venait de creer : deux
 * organisations pour un meme `owner_email`.
 *
 * Contrat (a appeler DANS la transaction d'activation, juste apres BEGIN) :
 *  1. `lockSignupEmail` prend un verrou advisory transactionnel sur l'e-mail
 *     normalise : les deux chemins passent l'un apres l'autre, jamais en meme
 *     temps, et le verrou est libere par COMMIT/ROLLBACK ;
 *  2. `lockPendingSignup` relit la ligne `pending_signups` FOR UPDATE ;
 *  3. `resolveOwnerOrgId` reutilise l'organisation existante du proprietaire
 *     (sinon l'identifiant propose), vue apres le verrou donc committee par le
 *     chemin precedent.
 */

export interface SqlClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export function normalizeSignupEmail(email: string): string {
  return email.toLowerCase().trim();
}

export async function lockSignupEmail(client: SqlClientLike, email: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [normalizeSignupEmail(email)]);
}

/** `consumed` vaut true quand l'autre chemin a deja active ce jeton ; `found` false si la ligne n'existe plus. */
export async function lockPendingSignup(
  client: SqlClientLike,
  token: string,
): Promise<{ found: boolean; consumed: boolean }> {
  const r = await client.query(
    `SELECT consumed_at FROM pending_signups WHERE token = $1 FOR UPDATE`,
    [token],
  );
  const row = r.rows[0];
  if (!row) return { found: false, consumed: false };
  return { found: true, consumed: row["consumed_at"] != null };
}

/**
 * Identifiant d'organisation a utiliser pour ce proprietaire : l'organisation
 * non supprimee la plus ancienne portant cet `owner_email`, sinon `candidateId`.
 */
export async function resolveOwnerOrgId(
  client: SqlClientLike,
  email: string,
  candidateId: string,
): Promise<{ orgId: string; reused: boolean }> {
  const r = await client.query(
    `SELECT id::text AS id FROM organizations
      WHERE lower(owner_email) = $1 AND status IS DISTINCT FROM 'deleted'
      ORDER BY created_at ASC NULLS LAST, id ASC
      LIMIT 1`,
    [normalizeSignupEmail(email)],
  );
  const id = r.rows[0]?.["id"];
  if (typeof id === "string" && id) return { orgId: id, reused: id !== candidateId };
  return { orgId: candidateId, reused: false };
}
