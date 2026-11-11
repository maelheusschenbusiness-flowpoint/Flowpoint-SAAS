/**
 * Langue choisie a l'inscription — stockage durable et resolution destinataire.
 *
 * Regle : choix de l'utilisateur > organisation > anglais. Jamais le
 * navigateur, le pays ni l'e-mail : seule la langue explicitement envoyee par
 * la page publique (fp-locale.js, cle localStorage 'fp:language') est retenue.
 *
 * Flux : POST /auth/pre-register (ou le cookie court du depart Google) stocke
 * `pending_signups.language` ; l'activation (webhook Stripe / finalize-checkout)
 * appelle `applySignupLanguage` dans SA transaction pour la recopier dans
 * `user_prefs.settings.language` (sans ecraser un choix existant) et dans
 * `organizations.language` (seulement si vide).
 *
 * Les e-mails transactionnels futurs lisent `getRecipientLanguage({ orgId })`.
 */
import { resolveDashboardLanguage } from "../lib/default-language.js";

/** Miroir exact de LOCALE_BY_LANGUAGE (artifacts/flowpoint-export/fp-locale.js). */
export const SUPPORTED_SIGNUP_LANGUAGES: readonly string[] = [
  "pt-br", "fr", "en", "es", "de", "it", "pt", "nl", "pl", "sv", "ro", "cs",
];
const SUPPORTED = new Set(SUPPORTED_SIGNUP_LANGUAGES);

/** Cookie court (httpOnly, /api/auth) qui porte la langue du depart Google au callback. */
export const SIGNUP_LANGUAGE_COOKIE = "fp_signup_lang";

/** Meme normalisation que fpResolveLanguage cote client ; tout le reste -> 'en'. */
export function normalizeSignupLanguage(raw: unknown): string {
  if (typeof raw !== "string") return "en";
  const v = raw.trim().replace(/_/g, "-").toLowerCase();
  if (!v || v.length > 16) return "en";
  if (SUPPORTED.has(v)) return v;
  const base = v.split("-")[0] ?? "";
  return SUPPORTED.has(base) ? base : "en";
}

/** Variante qui distingue « absent / invalide » (null) d'un choix valide. */
export function parseSignupLanguage(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = normalizeSignupLanguage(raw);
  if (n !== "en") return n;
  const v = raw.trim().toLowerCase();
  return v === "en" || v.startsWith("en-") || v.startsWith("en_") ? "en" : null;
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * A appeler dans la transaction d'activation, apres l'upsert de l'organisation.
 * N'echoue jamais l'activation : protege par un SAVEPOINT.
 */
export async function applySignupLanguage(
  client: Queryable,
  opts: { orgId: string; language: unknown },
): Promise<void> {
  if (opts.language === null || opts.language === undefined || opts.language === "") return;
  const language = normalizeSignupLanguage(opts.language);
  await client.query("SAVEPOINT fp_signup_language");
  try {
    // Contexte de tenant pour les policies RLS de user_prefs (inoffensif sous BYPASSRLS).
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [opts.orgId]);
    await client.query(
      `INSERT INTO user_prefs (org_id, settings, updated_at)
       VALUES ($1, jsonb_build_object('language', $2::text), NOW())
       ON CONFLICT (org_id) DO UPDATE
         SET settings = CASE
               WHEN COALESCE(user_prefs.settings->>'language', '') = ''
                 THEN COALESCE(user_prefs.settings, '{}'::jsonb) || jsonb_build_object('language', $2::text)
               ELSE user_prefs.settings
             END,
             updated_at = NOW()`,
      [opts.orgId, language],
    );
    await client.query(
      `UPDATE organizations SET language = $2
       WHERE id::text = $1 AND COALESCE(language, '') = ''`,
      [opts.orgId, language],
    );
    await client.query("RELEASE SAVEPOINT fp_signup_language");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT fp_signup_language").catch(() => {});
  }
}

/**
 * Langue d'un destinataire d'e-mail : user_prefs.settings.language (choix
 * explicite) > organizations.language > 'en'. Le defaut historique francais
 * de l'organisation est ignore, comme pour le tableau de bord.
 * `userId` est accepte pour l'avenir : les preferences sont aujourd'hui
 * stockees par organisation (user_prefs.org_id).
 */
export async function getRecipientLanguage(
  opts: { orgId?: string | null; userId?: string | null },
  db?: Queryable,
): Promise<string> {
  try {
    const q: Queryable = db ?? (await import("@workspace/db")).pool;
    let orgId = opts.orgId ?? null;
    if (!orgId && opts.userId) {
      const m = await q.query(
        `SELECT organization_id::text AS id FROM organization_members
         WHERE user_id::text = $1 AND status = 'active' ORDER BY organization_id LIMIT 1`,
        [opts.userId],
      );
      orgId = m.rows[0]?.id ?? null;
    }
    if (!orgId) return "en";
    const r = await q.query(
      `SELECT (SELECT settings->>'language' FROM user_prefs WHERE org_id = $1) AS pref,
              (SELECT language FROM organizations WHERE id::text = $1) AS org`,
      [orgId],
    );
    const row = r.rows[0] ?? {};
    return normalizeSignupLanguage(resolveDashboardLanguage(row.pref, row.org));
  } catch {
    return "en";
  }
}

export async function getUserLanguage(userId: string, db?: Queryable): Promise<string> {
  return getRecipientLanguage({ userId }, db);
}
