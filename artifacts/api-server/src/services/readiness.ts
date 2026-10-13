/**
 * Sonde de disponibilite — ce que Render doit interroger, et rien d'autre.
 *
 * Les deux sondes existantes sont inutilisables comme health check :
 *
 *  - `/api/healthz` ne touche pas la base. Un serveur dont toute
 *    l'initialisation de schema a echoue — chaque etape est non fatale — est
 *    declare sain et mis en ligne.
 *  - `/api/healthz/deep` renvoie 503 des qu'un seul controle est `down`, et ses
 *    controles incluent Stripe, OpenAI, BetterStack, DataForSEO, Resend et la
 *    joignabilite de Google OAuth. Une 401 chez Stripe ou une panne DataForSEO
 *    rendrait l'instance « non saine » et Render la redemarrerait alors que
 *    FlowPoint fonctionne. Elle declenche en plus six appels sortants a chaque
 *    interrogation.
 *
 * Cette sonde ne regarde que ce qui determine la capacite a servir :
 *
 *  1. PostgreSQL repond, dans un delai borne. Aucun appel a un tiers.
 *  2. Le schema est valide — tables et colonnes dont le code depend, et
 *     isolation inter-organisations.
 *
 * Les deux echecs n'ont pas la meme nature, donc pas le meme traitement :
 *
 *  - une base qui ne repond pas est souvent passagere (bascule du fournisseur,
 *    saturation du pool, coupure reseau de deux secondes). Repondre 503 au
 *    premier echec ferait redemarrer l'instance pour une coupure dont elle
 *    serait sortie seule. La sonde tolere donc un nombre d'echecs CONSECUTIFS
 *    avant de se declarer indisponible, et le compteur retombe a zero au
 *    premier succes ;
 *  - un schema invalide n'est jamais passager. Il ne se repare pas en
 *    attendant, et servir du trafic dessus abime des donnees. La sonde repond
 *    503 immediatement.
 *
 * La validite du schema est mise en cache : la sonde est interrogee en boucle,
 * et interroger les catalogues a chaque appel serait du gaspillage. Le ping de
 * la base, lui, est fait a chaque appel — c'est tout l'interet d'une sonde.
 */

import { logger } from "../lib/logger.js";

export type Queryable = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

/** Delai au-dela duquel la base est consideree muette. */
export const DB_PROBE_TIMEOUT_MS = 2_000;
/** Echecs consecutifs toleres avant de se declarer indisponible. */
export const DB_FAILURE_THRESHOLD = 3;
/** Duree de validite du verdict de schema. */
export const SCHEMA_CACHE_TTL_MS = 60_000;

/** Tables dont l'absence rend l'authentification ou la facturation inoperantes. */
const REQUIRED_TABLES = [
  "organizations",
  "org_settings",
  "users",
  "organization_members",
  "user_sessions",
] as const;

/** Colonnes ajoutees par la V1 et lues par le controle d'acces. */
const REQUIRED_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["organizations", "subscription_status"],
  ["organizations", "current_period_end"],
  ["organizations", "cancel_at_period_end"],
];

export type DbProbe = { ok: boolean; latencyMs: number; detail: string };
export type SchemaVerdict = {
  valid: boolean;
  missingTables: string[];
  missingColumns: string[];
  isolationGaps: string[];
  checkedAt: number;
};

type State = {
  consecutiveDbFailures: number;
  schema: SchemaVerdict | null;
};

const state: State = { consecutiveDbFailures: 0, schema: null };

/** Remet la sonde a son etat initial — utilise par les tests. */
export function resetReadinessState(): void {
  state.consecutiveDbFailures = 0;
  state.schema = null;
}

/** Un `SELECT 1` qui ne peut pas pendre : la sonde doit repondre, toujours. */
export async function probeDatabase(db: Queryable, timeoutMs = DB_PROBE_TIMEOUT_MS): Promise<DbProbe> {
  const start = Date.now();
  try {
    await Promise.race([
      db.query("SELECT 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout apres ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    return { ok: true, latencyMs: Date.now() - start, detail: "SELECT 1" };
  } catch (err) {
    // Le message d'erreur de la base peut contenir des elements de connexion :
    // on ne retient que la classe du probleme.
    const code = (err as { code?: string } | null)?.code;
    const detail = code ? `echec (${code})` : (err as Error)?.message?.slice(0, 60) ?? "echec";
    return { ok: false, latencyMs: Date.now() - start, detail };
  }
}

/** Tables, colonnes, isolation — en trois requetes de catalogue, pas plus. */
export async function inspectSchema(db: Queryable): Promise<SchemaVerdict> {
  const tables = await db.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`,
    [[...REQUIRED_TABLES]]
  );
  const present = new Set(tables.rows.map((r) => String(r["name"])));
  const missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));

  const cols = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [[...new Set(REQUIRED_COLUMNS.map(([t]) => t))]]
  );
  const presentCols = new Set(cols.rows.map((r) => `${r["table_name"]}.${r["column_name"]}`));
  const missingColumns = REQUIRED_COLUMNS
    .map(([t, c]) => `${t}.${c}`)
    .filter((key) => !presentCols.has(key));

  const gaps = await db.query(`
    WITH sensibles AS (
      SELECT c.relname AS table_name, c.relrowsecurity AS rls
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN information_schema.columns col
          ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'org_id'
       WHERE n.nspname = 'public' AND c.relkind = 'r'
    ), pol AS (
      SELECT tablename,
             COUNT(*)::int AS policies,
             BOOL_OR(COALESCE(qual,'') || COALESCE(with_check,'') ~ 'org_id') AS isolated
        FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename
    )
    SELECT s.table_name
      FROM sensibles s LEFT JOIN pol p ON p.tablename = s.table_name
     WHERE NOT s.rls OR COALESCE(p.policies,0) = 0 OR NOT COALESCE(p.isolated,false)
     ORDER BY s.table_name
  `);
  const isolationGaps = gaps.rows.map((r) => String(r["table_name"]));

  return {
    valid: missingTables.length === 0 && missingColumns.length === 0 && isolationGaps.length === 0,
    missingTables: [...missingTables],
    missingColumns,
    isolationGaps,
    checkedAt: Date.now(),
  };
}

export type Readiness = {
  httpStatus: 200 | 503;
  body: {
    status: "ready" | "not_ready";
    database: DbProbe & { consecutiveFailures: number; threshold: number };
    schema: Omit<SchemaVerdict, "checkedAt"> & { checkedAt: string } | { status: "unknown" };
    uptime: number;
  };
};

/**
 * Verdict complet. Jamais d'exception : une sonde qui leve est une sonde qui
 * mentit sur l'etat du service.
 */
export async function evaluateReadiness(
  db: Queryable,
  opts?: { timeoutMs?: number; threshold?: number; schemaTtlMs?: number; now?: number }
): Promise<Readiness> {
  const threshold = opts?.threshold ?? DB_FAILURE_THRESHOLD;
  const now = opts?.now ?? Date.now();
  const probe = await probeDatabase(db, opts?.timeoutMs ?? DB_PROBE_TIMEOUT_MS);

  if (!probe.ok) {
    state.consecutiveDbFailures += 1;
    const tolerated = state.consecutiveDbFailures < threshold;
    if (tolerated) {
      logger.warn(
        { consecutiveFailures: state.consecutiveDbFailures, threshold },
        "[readiness] PostgreSQL muet — tolere, l'instance reste declaree disponible"
      );
    } else {
      logger.error(
        { consecutiveFailures: state.consecutiveDbFailures, threshold },
        "[readiness] PostgreSQL muet au-dela du seuil — instance declaree indisponible"
      );
    }
    return {
      httpStatus: tolerated ? 200 : 503,
      body: {
        status: tolerated ? "ready" : "not_ready",
        database: { ...probe, consecutiveFailures: state.consecutiveDbFailures, threshold },
        // Sans base, on ne sait rien du schema : on ne l'invente pas.
        schema: { status: "unknown" },
        uptime: Math.round(process.uptime()),
      },
    };
  }

  state.consecutiveDbFailures = 0;

  const ttl = opts?.schemaTtlMs ?? SCHEMA_CACHE_TTL_MS;
  let schema = state.schema;
  if (!schema || now - schema.checkedAt > ttl) {
    try {
      schema = await inspectSchema(db);
      state.schema = schema;
      if (!schema.valid) {
        logger.error(
          {
            missingTables: schema.missingTables,
            missingColumns: schema.missingColumns,
            isolationGaps: schema.isolationGaps,
          },
          "[readiness] schema invalide — instance declaree indisponible (un schema abime ne se repare pas en attendant)"
        );
      }
    } catch (err) {
      // La base repond mais les catalogues sont illisibles : anomalie reelle,
      // qu'on ne transforme pas en verdict de disponibilite.
      logger.warn({ err }, "[readiness] inspection du schema impossible — verdict precedent conserve");
    }
  }

  const schemaBody = schema
    ? {
        valid: schema.valid,
        missingTables: schema.missingTables,
        missingColumns: schema.missingColumns,
        isolationGaps: schema.isolationGaps,
        checkedAt: new Date(schema.checkedAt).toISOString(),
      }
    : ({ status: "unknown" } as const);

  const ready = schema ? schema.valid : true;
  return {
    httpStatus: ready ? 200 : 503,
    body: {
      status: ready ? "ready" : "not_ready",
      database: { ...probe, consecutiveFailures: 0, threshold },
      schema: schemaBody,
      uptime: Math.round(process.uptime()),
    },
  };
}
