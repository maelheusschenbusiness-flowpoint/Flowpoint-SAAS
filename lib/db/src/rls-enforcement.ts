/**
 * rls-enforcement.ts — mesure et classement de l'isolation RLS reellement active.
 *
 * Contexte (C-08). `withOrgDb()` pose le GUC `app.current_org_id` puis tente
 * `SET LOCAL ROLE app_user`. Quand ce SET ROLE echoue (role absent, appartenance
 * non accordee — cas des bases gerees), l'ancien code basculait en « GUC-only RLS
 * mode » et affirmait que c'etait « correct et sur ». C'est faux des que le role
 * de CONNEXION ignore lui-meme RLS : superuser, BYPASSRLS (cas de `postgres` sur
 * Supabase), ou proprietaire de tables dont RLS n'est pas FORCEE. Les policies ne
 * sont alors jamais evaluees ; seul le `WHERE org_id = ...` ecrit a la main dans
 * chaque requete isole les organisations.
 *
 * Ce module ne change AUCUNE requete applicative : il mesure, classe et rend
 * l'etat observable. Il n'importe pas `pg` a l'execution (types seulement).
 */
import type { PoolClient } from "pg";

/** Faits mesures sur la base ; `null` = non mesure. */
export interface RlsEnforcementFacts {
  appUserRoleExists: boolean | null;
  /** `SET ROLE app_user` a reussi avec la connexion courante. */
  setRoleUsable: boolean | null;
  /** app_user lui-meme superuser ou BYPASSRLS (alors SET ROLE n'isole rien). */
  appUserBypassesRls: boolean | null;
  connectionRole: string | null;
  connectionIsSuperuser: boolean | null;
  connectionBypassesRls: boolean | null;
  /** Tables de `public` avec RLS activee, SANS FORCE, dont le role de connexion est proprietaire (donc exempte). */
  ownedUnforcedRlsTables: number | null;
}

export type RlsEnforcementMode =
  /** SET ROLE app_user fonctionne : les policies sont evaluees pour chaque requete d'orgDb. */
  | "enforced"
  /** SET ROLE impossible : l'isolation repose sur le role de connexion lui-meme. */
  | "guc-only"
  /** Sonde pas encore executee. */
  | "unprobed";

export interface RlsEnforcementClassification {
  mode: RlsEnforcementMode;
  /**
   * `true`  : les policies protegent reellement les requetes passant par orgDb.
   * `false` : AUCUNE isolation par la base (seuls les filtres org_id manuels protegent).
   * `null`  : inconnu.
   */
  isolationGuaranteed: boolean | null;
  reasons: string[];
}

export function classifyRlsEnforcement(f: RlsEnforcementFacts): RlsEnforcementClassification {
  const reasons: string[] = [];
  const unknown =
    f.setRoleUsable === null && f.connectionIsSuperuser === null && f.connectionBypassesRls === null;
  if (unknown) {
    return { mode: "unprobed", isolationGuaranteed: null, reasons: ["sonde RLS non executee"] };
  }

  if (f.setRoleUsable === true) {
    if (f.appUserBypassesRls) {
      reasons.push("le role app_user est superuser ou BYPASSRLS : SET ROLE n'active aucune policy");
      return { mode: "enforced", isolationGuaranteed: false, reasons };
    }
    return { mode: "enforced", isolationGuaranteed: true, reasons };
  }

  // GUC-only : tout depend du role de connexion.
  if (f.appUserRoleExists === false) reasons.push("role app_user absent : aucune bascule de role possible");
  else reasons.push("SET ROLE app_user impossible avec la connexion courante (appartenance non accordee)");
  if (f.connectionIsSuperuser) reasons.push(`le role de connexion est superuser : toutes les policies RLS sont ignorees`);
  if (f.connectionBypassesRls) reasons.push(`le role de connexion a BYPASSRLS : toutes les policies RLS sont ignorees`);
  if ((f.ownedUnforcedRlsTables ?? 0) > 0) {
    reasons.push(`le role de connexion possede ${f.ownedUnforcedRlsTables} table(s) a RLS non FORCEE : le proprietaire est exempte`);
  }
  const measured =
    f.connectionIsSuperuser !== null && f.connectionBypassesRls !== null && f.ownedUnforcedRlsTables !== null;
  const bypass =
    f.connectionIsSuperuser === true || f.connectionBypassesRls === true || (f.ownedUnforcedRlsTables ?? 0) > 0;
  return {
    mode: "guc-only",
    isolationGuaranteed: measured ? !bypass : null,
    reasons: measured && !bypass
      ? [...reasons, "le role de connexion est lui-meme soumis a RLS : les policies restent evaluees"]
      : reasons,
  };
}

/**
 * Mesure les faits avec une connexion. Ne modifie rien : le SET ROLE est session
 * (hors transaction) et immediatement annule. N'echoue jamais : un fait illisible vaut `null`.
 */
export async function inspectRlsFacts(client: Pick<PoolClient, "query">): Promise<RlsEnforcementFacts> {
  const facts: RlsEnforcementFacts = {
    appUserRoleExists: null,
    setRoleUsable: null,
    appUserBypassesRls: null,
    connectionRole: null,
    connectionIsSuperuser: null,
    connectionBypassesRls: null,
    ownedUnforcedRlsTables: null,
  };

  try {
    const r = await client.query(
      `SELECT r.rolname AS role, r.rolsuper AS su, r.rolbypassrls AS bypass,
              (SELECT count(*)::int
                 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r'
                  AND c.relrowsecurity AND NOT c.relforcerowsecurity
                  AND pg_has_role(current_user, c.relowner, 'USAGE')) AS owned_unforced
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const row = r.rows[0] as { role: string; su: boolean; bypass: boolean; owned_unforced: number } | undefined;
    if (row) {
      facts.connectionRole = row.role;
      facts.connectionIsSuperuser = row.su;
      facts.connectionBypassesRls = row.bypass;
      facts.ownedUnforcedRlsTables = Number(row.owned_unforced);
    }
  } catch { /* fait non mesure */ }

  try {
    const r = await client.query(
      `SELECT rolsuper AS su, rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'app_user'`,
    );
    const row = r.rows[0] as { su: boolean; bypass: boolean } | undefined;
    facts.appUserRoleExists = !!row;
    facts.appUserBypassesRls = row ? row.su || row.bypass : null;
  } catch { /* fait non mesure */ }

  if (facts.appUserRoleExists) {
    try {
      await client.query("SET ROLE app_user");
      await client.query("RESET ROLE");
      facts.setRoleUsable = true;
    } catch {
      facts.setRoleUsable = false;
      await client.query("RESET ROLE").catch(() => undefined);
    }
  } else if (facts.appUserRoleExists === false) {
    facts.setRoleUsable = false;
  }
  return facts;
}

// ── Politique de demarrage ────────────────────────────────────────────────────

export type RlsEnforcementPolicy = "strict" | "warn" | "off";

/**
 * RLS_ENFORCEMENT :
 *   strict : le demarrage ECHOUE si l'isolation par la base n'est pas garantie
 *            (et withOrgDb refuse de degrader en GUC-only a l'execution) ;
 *   warn   : DEFAUT. Erreur journalisee a chaque demarrage + etat expose par
 *            /api/admin/db-check, sans interrompre le service ;
 *   off    : silence les messages d'erreur (l'etat reste mesure et expose).
 *
 * Le defaut est `warn` et non `strict` : la production et Test-Replit tournent
 * aujourd'hui en GUC-only avec un role BYPASSRLS (mesure documentee dans
 * tables-pre-compte-rls-db.test.ts). Un defaut strict les ferait tomber au
 * prochain deploiement. Le passage en `strict` est une decision d'exploitation,
 * prise variable d'environnement a la main, apres revue des requetes brutes.
 */
export function resolveRlsEnforcementPolicy(env: Record<string, string | undefined> = process.env): RlsEnforcementPolicy {
  const v = (env["RLS_ENFORCEMENT"] ?? "").trim().toLowerCase();
  if (v === "strict" || v === "off") return v;
  return "warn";
}

// ── Etat observable ───────────────────────────────────────────────────────────

export interface RlsEnforcementStatus extends RlsEnforcementClassification {
  facts: RlsEnforcementFacts;
  policy: RlsEnforcementPolicy;
  probedAt: string | null;
  /** SET LOCAL ROLE a echoue pendant une requete (au lieu de la sonde de demarrage). */
  runtimeSetRoleFailure: boolean;
}

const EMPTY_FACTS: RlsEnforcementFacts = {
  appUserRoleExists: null, setRoleUsable: null, appUserBypassesRls: null,
  connectionRole: null, connectionIsSuperuser: null, connectionBypassesRls: null, ownedUnforcedRlsTables: null,
};

let _facts: RlsEnforcementFacts = { ...EMPTY_FACTS };
let _probedAt: string | null = null;
let _runtimeSetRoleFailure = false;

export function recordRlsFacts(facts: RlsEnforcementFacts): void {
  _facts = facts;
  _probedAt = new Date().toISOString();
}

export function recordRuntimeSetRoleFailure(): void {
  _runtimeSetRoleFailure = true;
}

export function getRlsEnforcementStatus(): RlsEnforcementStatus {
  const facts: RlsEnforcementFacts = _runtimeSetRoleFailure && _facts.setRoleUsable !== false
    ? { ..._facts, setRoleUsable: false }
    : _facts;
  return {
    ...classifyRlsEnforcement(facts),
    facts,
    policy: resolveRlsEnforcementPolicy(),
    probedAt: _probedAt,
    runtimeSetRoleFailure: _runtimeSetRoleFailure,
  };
}

/** Test uniquement. */
export function resetRlsEnforcementState(): void {
  _facts = { ...EMPTY_FACTS };
  _probedAt = null;
  _runtimeSetRoleFailure = false;
}

export class RlsEnforcementError extends Error {
  readonly code = "RLS_ENFORCEMENT_NOT_GUARANTEED";
  constructor(message: string) {
    super(message);
    this.name = "RlsEnforcementError";
  }
}

/**
 * Journalise l'etat ; en `strict`, leve si l'isolation n'est pas garantie.
 * Retourne l'etat. Les messages ne contiennent aucun secret : seul le NOM du role
 * de connexion apparait (pas son mot de passe, pas l'URL).
 */
export function reportRlsEnforcement(
  status: RlsEnforcementStatus = getRlsEnforcementStatus(),
  log: Pick<Console, "info" | "warn" | "error"> = console,
): RlsEnforcementStatus {
  if (status.mode === "enforced" && status.isolationGuaranteed === true) {
    log.info("[withOrgDb] app_user role present and usable — full RLS enforcement active");
    return status;
  }
  if (status.isolationGuaranteed === true) {
    log.warn("[withOrgDb] GUC-only RLS mode — the connection role is itself subject to RLS: policies stay enforced.");
    return status;
  }
  const detail = status.reasons.join(" | ");
  if (status.policy !== "off") {
    log.error(
      "[SECURITY][RLS] Database-level tenant isolation is NOT guaranteed. " +
      "Policies are not evaluated for orgDb queries: only the org_id filters written in each SQL statement isolate organizations. " +
      `mode=${status.mode} policy=${status.policy} reasons: ${detail}. ` +
      "Remedy: connect with a role without BYPASSRLS/superuser and GRANT app_user TO <that role>, " +
      "or set RLS_ENFORCEMENT=strict once the connection role is fixed. State: GET /api/admin/db-check (rls.enforcement).",
    );
  }
  if (status.policy === "strict") {
    throw new RlsEnforcementError(`RLS_ENFORCEMENT=strict: tenant isolation not guaranteed (${detail})`);
  }
  return status;
}
