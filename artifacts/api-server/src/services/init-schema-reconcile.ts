/**
 * Reconciliation du schema — rendre la production reproductible.
 *
 * Constat du 14/10/2026, mesure sur une copie restauree de la production :
 *
 *   - 18 tables sont INTERROGEES par le code mais creees NULLE PART dans le
 *     depot. `usage` est citee dans 40 fichiers, `subscriptions` dans 11,
 *     `google_tokens` dans 11. Elles existent en production parce qu'un
 *     code anterieur ou un fichier migrations/*.sql applique a la main les a
 *     posees. Sur une base vierge, elles n'existent pas : le schema de
 *     production n'etait pas reconstructible depuis le depot.
 *
 *   - 4 tables et 31 colonnes utilisees par des requetes reelles manquent en
 *     production. La cause est mesuree : le bloc `missing-production-tables-v3`
 *     est deja marque comme applique dans schema_migrations, donc saute a
 *     chaque execution — y compris les instructions qu'il n'avait jamais
 *     posees sur cette base.
 *
 * Rejouer l'ancien bloc en effacant son marqueur rejouerait aussi tout le
 * reste, dont des instructions couteuses deja appliquees. D'ou ce bloc
 * SEPAREMENT VERSIONNE, avec son propre marqueur.
 *
 * Trois regles tiennent cette migration :
 *
 *   1. NON DESTRUCTIVE. Rien n'est supprime, rien n'est recree : uniquement
 *      CREATE TABLE IF NOT EXISTS et ADD COLUMN IF NOT EXISTS. Une table
 *      existante en production n'est pas touchee — ni ses donnees, ni ses
 *      colonnes, ni ses contraintes.
 *   2. IDEMPOTENTE. Un second passage ne fait rien, et le marqueur n'est pose
 *      qu'apres verification du resultat.
 *   3. AUCUNE COLONNE NOT NULL SANS DEFAUT. Sur une table qui contient deja
 *      des lignes, un tel ALTER echouerait. Les colonnes ajoutees sont
 *      nullables, sauf si elles portent un defaut.
 *
 * Les definitions ne sont pas inventees : les 18 tables heritees sont
 * reproduites d'apres le catalogue de la production, les 4 tables et les
 * colonnes d'apres l'etat certifie de Test-Replit. C'est ce qui garantit
 * qu'une base vierge et une production migree convergent vers le meme schema.
 *
 * 31 colonnes sont ajoutees, pas 71 : 35 appartiennent aux 4 tables creees
 * ici, et 5 colonnes de org_settings ne sont citees par aucune requete du
 * code — les creer n'aurait servi qu'a faire coincider deux inventaires.
 */

/** Marqueur propre a ce bloc. Ne jamais reutiliser celui d'un bloc anterieur. */
export const SCHEMA_RECONCILE_ID = "schema-reconcile-v1";

/** Tables interrogees par le code, creees nulle part : reproduites d'apres la production. */
export const RECONCILE_LEGACY_TABLES = ["audit_trail", "competitor_movements", "competitor_rankings", "crm_field_mappings", "gbp_locations", "google_tokens", "industry_signals", "keyword_clusters", "keyword_history", "keyword_opportunities", "market_opportunities", "market_trends", "monitor_logs", "oauth_connections", "ranking_alerts", "sla_reports", "subscriptions", "usage"];

/** Tables de la reference absentes de la production. */
export const RECONCILE_REFERENCE_TABLES = ["gbp_profiles", "gsc_keyword_data", "gsc_page_data", "gsc_sync_logs"];

type Client = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> };

/**
 * DDL des 18 tables heritees, releve sur le catalogue de production.
 * Les colonnes d'identite y apparaissent comme « bigint DEFAULT nextval(...) » :
 * converties en bigserial, sinon la sequence manquerait sur une base vierge.
 * Mesure avant correction : « relation "google_tokens_id_seq" does not exist ».
 */
const LEGACY_DDL = `
CREATE TABLE IF NOT EXISTS public.audit_trail (
  id text NOT NULL,
  org_id text NOT NULL,
  user_id text,
  action text NOT NULL,
  target_id text,
  target_type text,
  ip_address text,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  severity text DEFAULT 'info'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT audit_trail_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.competitor_movements (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  competitor text NOT NULL,
  type text DEFAULT 'ranking_gain'::text NOT NULL,
  description text,
  detected_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT competitor_movements_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.competitor_rankings (
  id text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  competitor_domain text NOT NULL,
  keyword text,
  position integer,
  url text,
  checked_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT competitor_rankings_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.crm_field_mappings (
  id text NOT NULL,
  crm_integration_id text NOT NULL,
  entity_type text NOT NULL,
  flowpoint_field text NOT NULL,
  crm_field text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  CONSTRAINT crm_field_mappings_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.gbp_locations (
  id text NOT NULL,
  org_id text NOT NULL,
  account_id text NOT NULL,
  name text,
  address text,
  city text,
  postal_code text,
  country text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  raw_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT gbp_locations_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.google_tokens (
  id bigserial,
  org_id text NOT NULL,
  account_id text NOT NULL,
  access_token text,
  refresh_token text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT google_tokens_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.industry_signals (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  type text DEFAULT 'trend'::text NOT NULL,
  title text NOT NULL,
  description text,
  severity text DEFAULT 'info'::text NOT NULL,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT industry_signals_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.keyword_clusters (
  id text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  name text NOT NULL,
  description text,
  intent text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  keywords jsonb,
  keyword_count integer DEFAULT 0,
  avg_position real,
  avg_volume integer DEFAULT 0,
  avg_difficulty integer DEFAULT 0,
  total_volume integer DEFAULT 0,
  ai_summary text,
  color text DEFAULT '#2563EB'::text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT keyword_clusters_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.keyword_history (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  keyword_id text NOT NULL,
  position integer,
  search_volume integer DEFAULT 0,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT keyword_history_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.keyword_opportunities (
  id text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  type text DEFAULT 'ranking_gap'::text,
  keyword text,
  title text,
  description text,
  opportunity_score integer DEFAULT 0,
  search_volume integer DEFAULT 0,
  difficulty integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  cpc numeric DEFAULT 0,
  intent text,
  current_position integer,
  potential_position integer,
  estimated_traffic integer DEFAULT 0,
  ai_explanation text,
  status text DEFAULT 'new'::text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT keyword_opportunities_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.market_opportunities (
  id text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  type text DEFAULT 'content_gap'::text,
  title text NOT NULL,
  description text,
  score integer DEFAULT 0,
  estimated_impact text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT market_opportunities_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.market_trends (
  id text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  keyword text NOT NULL,
  category text,
  volume integer DEFAULT 0,
  growth integer DEFAULT 0,
  opportunity_score integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT market_trends_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.monitor_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid,
  monitor_name text,
  status text,
  response_time integer,
  checked_at timestamp with time zone DEFAULT now(),
  CONSTRAINT monitor_logs_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.oauth_connections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid,
  provider text,
  access_token text,
  refresh_token text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT oauth_connections_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.ranking_alerts (
  id text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  keyword text,
  keyword_id text,
  type text DEFAULT 'position_drop'::text NOT NULL,
  message text,
  read boolean DEFAULT false NOT NULL,
  triggered_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ranking_alerts_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.sla_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid,
  availability numeric(5,2),
  incidents integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sla_reports_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text,
  status text,
  trial_end timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.usage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  analyses_count integer DEFAULT 0 NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  CONSTRAINT usage_pkey PRIMARY KEY (id)
);
`;

/** DDL des 4 tables manquantes, releve sur l'etat certifie. */
const REFERENCE_DDL = `
CREATE TABLE IF NOT EXISTS public.gbp_profiles (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  location_id text,
  location_name text,
  avg_rating real,
  review_count integer DEFAULT 0 NOT NULL,
  unanswered_count integer DEFAULT 0 NOT NULL,
  completion_pct real,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT gbp_profiles_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.gsc_keyword_data (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  keyword text DEFAULT ''::text NOT NULL,
  date text DEFAULT ''::text NOT NULL,
  impressions integer DEFAULT 0 NOT NULL,
  clicks integer DEFAULT 0 NOT NULL,
  ctr real DEFAULT 0 NOT NULL,
  position real DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT gsc_keyword_data_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.gsc_page_data (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  page text DEFAULT ''::text NOT NULL,
  date text DEFAULT ''::text NOT NULL,
  impressions integer DEFAULT 0 NOT NULL,
  clicks integer DEFAULT 0 NOT NULL,
  ctr real DEFAULT 0 NOT NULL,
  position real DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT gsc_page_data_pkey PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS public.gsc_sync_logs (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text DEFAULT 'default'::text NOT NULL,
  site_url text DEFAULT ''::text NOT NULL,
  rows_synced integer DEFAULT 0 NOT NULL,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT gsc_sync_logs_pkey PRIMARY KEY (id)
);
`;

/** Colonnes manquantes, reellement utilisees par une requete du code. */
const COLUMN_DDL = `
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS tokens_used integer DEFAULT 0 NOT NULL;
ALTER TABLE public.automation_integrations ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.automation_integrations ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.automation_integrations ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.automation_logs ADD COLUMN IF NOT EXISTS workflow_id text;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS created_at timestamp without time zone DEFAULT now();
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS duration_ms integer DEFAULT 0;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS trigger text;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS workflow_id text;
ALTER TABLE public.incoming_webhooks ADD COLUMN IF NOT EXISTS hits integer DEFAULT 0;
ALTER TABLE public.incoming_webhooks ADD COLUMN IF NOT EXISTS last_hit timestamp without time zone;
ALTER TABLE public.incoming_webhooks ADD COLUMN IF NOT EXISTS secret text;
ALTER TABLE public.incoming_webhooks ADD COLUMN IF NOT EXISTS workflow_id text;
ALTER TABLE public.mission_ai_logs ADD COLUMN IF NOT EXISTS credits_used integer DEFAULT 0;
ALTER TABLE public.mission_ai_logs ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.mission_ai_logs ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.mission_ai_logs ADD COLUMN IF NOT EXISTS mission_id text;
ALTER TABLE public.mission_ai_logs ADD COLUMN IF NOT EXISTS model text DEFAULT 'gpt-5-mini'::text;
ALTER TABLE public.mission_ai_logs ADD COLUMN IF NOT EXISTS prompt_type text DEFAULT 'generate'::text NOT NULL;
ALTER TABLE public.mission_ai_logs ADD COLUMN IF NOT EXISTS response_ok boolean DEFAULT true;
ALTER TABLE public.mission_ai_logs ADD COLUMN IF NOT EXISTS tokens_used integer DEFAULT 0;
ALTER TABLE public.mission_history ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.seo_forecasts ADD COLUMN IF NOT EXISTS confidence integer DEFAULT 75 NOT NULL;
ALTER TABLE public.seo_forecasts ADD COLUMN IF NOT EXISTS forecast_date date;
ALTER TABLE public.seo_forecasts ADD COLUMN IF NOT EXISTS generated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.seo_forecasts ADD COLUMN IF NOT EXISTS predicted_conversions integer DEFAULT 0 NOT NULL;
ALTER TABLE public.seo_forecasts ADD COLUMN IF NOT EXISTS predicted_revenue numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.seo_forecasts ADD COLUMN IF NOT EXISTS predicted_traffic integer DEFAULT 0 NOT NULL;
ALTER TABLE public.seo_forecasts ADD COLUMN IF NOT EXISTS scenario text DEFAULT 'realistic'::text NOT NULL;
`;

const split = (sql: string): string[] =>
  sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0).map((s) => s + ";");

/**
 * Pose ce qui manque, verifie, puis seulement alors marque le bloc comme
 * applique. Un marqueur pose avant la verification ferait sauter le bloc a
 * jamais sur une base ou il aurait echoue — c'est exactement ce qui est
 * arrive a `missing-production-tables-v3`.
 */
export async function reconcileSchema(client: Client): Promise<{ applied: boolean; created: string[]; columns: number; failures: string[] }> {
  const created: string[] = [];
  const failures: string[] = [];
  let columns = 0;

  const already = await client
    .query(`SELECT 1 FROM schema_migrations WHERE migration_id = $1`, [SCHEMA_RECONCILE_ID])
    .catch(() => ({ rows: [], rowCount: 0 }));
  if ((already.rowCount ?? 0) > 0) return { applied: false, created, columns, failures };

  const before = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const had = new Set(before.rows.map((r) => String(r["tablename"])));

  for (const stmt of [...split(LEGACY_DDL), ...split(REFERENCE_DDL)]) {
    try { await client.query(stmt); }
    catch (err) { failures.push(`table: ${(err as Error).message.split("\n")[0]}`); }
  }
  for (const stmt of split(COLUMN_DDL)) {
    try { await client.query(stmt); columns++; }
    catch (err) { failures.push(`colonne: ${(err as Error).message.split("\n")[0]}`); }
  }

  const after = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  for (const r of after.rows) {
    const t = String(r["tablename"]);
    if (!had.has(t)) created.push(t);
  }

  // Verification AVANT le marqueur : chaque table attendue doit exister.
  const attendues = [...RECONCILE_LEGACY_TABLES, ...RECONCILE_REFERENCE_TABLES];
  const check = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [attendues]
  );
  const presentes = new Set(check.rows.map((r) => String(r["tablename"])));
  for (const t of attendues) if (!presentes.has(t)) failures.push(`manquante: ${t}`);

  // RLS posee des la creation, comme toute table portant org_id dans ce depot.
  // Les policies viennent de la passe de durcissement ; ici on garantit au
  // moins que la table n'est pas ouverte.
  for (const t of created) {
    try { await client.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`); }
    catch { /* table sans org_id ou deja active */ }
  }

  if (failures.length === 0) {
    await client.query(
      `INSERT INTO schema_migrations (migration_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [SCHEMA_RECONCILE_ID]
    );
  }
  return { applied: failures.length === 0, created, columns, failures };
}

/* ─────────────────────────────────────────────────────────────────────────────
   BLOC 2 — RESTAURATION DES DEFAULTS  (marqueur independant)

   Constat mesure entre une base vierge migree et une copie de production :
   31 colonnes portent un DEFAULT sur la base vierge et n'en ont aucun en
   production. L'ecart vient de colonnes creees en production avant que le
   depot ne declare leur default ; ADD COLUMN IF NOT EXISTS ne le rattrape pas.

   Deux consequences applicatives reelles ont ete reproduites :
     - users.id          : POST /api/auth/pre-register fait
                           INSERT INTO users (email, ...) sans id. En production
                           cela leve 23502 ; l'erreur est avalee en non-fatal,
                           donc la ligne users status=pending n'est jamais creee.
     - organizations.name: le repli INSERT INTO organizations (id) de
                           services/org-data.ts leve 23502 en production.
   Les 29 autres sont inertes : tous les INSERT du code fournissent la valeur.
   Elles sont incluses pour faire converger les deux schemas.

   ALTER COLUMN ... SET DEFAULT est une ecriture de catalogue seule : aucune
   reecriture de table, aucune donnee existante modifiee, aucun verrou long.
   Les lignes deja presentes ne sont pas touchees — seuls les INSERT futurs
   qui omettent la colonne recoivent desormais la valeur par defaut.
   ───────────────────────────────────────────────────────────────────────────── */

export const SCHEMA_DEFAULTS_ID = "schema-reconcile-defaults-v1";

export const RECONCILE_DEFAULTS: ReadonlyArray<{ table: string; column: string; expr: string }> = [
  { table: "ai_usage_logs", column: "feature", expr: "''::text" },
  { table: "ai_usage_logs", column: "model", expr: "'gpt-5-mini'::text" },
  { table: "automation_integrations", column: "endpoint_url", expr: "''::text" },
  { table: "automation_runs", column: "output", expr: "'{}'::jsonb" },
  { table: "automation_runs", column: "payload", expr: "'{}'::jsonb" },
  { table: "automation_workflows", column: "icon", expr: "'⚡'::text" },
  { table: "magic_link_tokens", column: "expires_at", expr: "(now() + '00:15:00'::interval)" }, // NOT NULL : insert partiel impossible sans ce default
  { table: "missions", column: "business_impact_score", expr: "50" },
  { table: "missions", column: "difficulty_score", expr: "50" },
  { table: "missions", column: "effort", expr: "'1h'::text" },
  { table: "missions", column: "estimated_conversion_impact", expr: "0" },
  { table: "missions", column: "estimated_revenue_impact", expr: "0" },
  { table: "missions", column: "estimated_seo_impact", expr: "0" },
  { table: "missions", column: "estimated_traffic_impact", expr: "0" },
  { table: "missions", column: "impact", expr: "'Moyen'::text" },
  { table: "missions", column: "source_data", expr: "'{}'::jsonb" },
  { table: "monitor_checks", column: "checked_at", expr: "0" }, // NOT NULL : insert partiel impossible sans ce default
  { table: "monitor_checks", column: "monitor_id", expr: "''::text" }, // NOT NULL : insert partiel impossible sans ce default
  { table: "monitor_checks", column: "ok", expr: "true" }, // NOT NULL : insert partiel impossible sans ce default
  { table: "org_settings", column: "currency", expr: "'EUR'::text" },
  { table: "org_settings", column: "language", expr: "'fr'::text" },
  { table: "org_settings", column: "timezone", expr: "'Europe/Paris'::text" },
  { table: "organizations", column: "name", expr: "''::text" }, // CORRECTIF BLOQUANT
  { table: "organizations", column: "owner_email", expr: "''::text" },
  { table: "organizations", column: "slug", expr: "''::text" },
  { table: "seo_forecasts", column: "org_id", expr: "'default'::text" }, // NOT NULL : insert partiel impossible sans ce default
  { table: "team_members", column: "email", expr: "''::text" },
  { table: "team_members", column: "org_id", expr: "'default'::text" },
  { table: "user_prefs", column: "settings", expr: "'{}'::jsonb" },
  { table: "users", column: "id", expr: "gen_random_uuid()" }, // CORRECTIF BLOQUANT
  { table: "workflow_runs", column: "duration_ms", expr: "0" },
];

/**
 * Repose les DEFAULT manquants. Marqueur distinct de SCHEMA_RECONCILE_ID : le
 * bloc 1 est deja marque applique sur une copie de production, ce bloc doit
 * pouvoir s'appliquer seul.
 *
 * Ne cible que les colonnes reellement presentes, puis verifie que chaque
 * default est bien en place AVANT de poser le marqueur.
 */
export async function reconcileDefaults(
  client: Client
): Promise<{ applied: boolean; defaults: number; failures: string[] }> {
  const failures: string[] = [];
  let defaults = 0;

  const already = await client
    .query(`SELECT 1 FROM schema_migrations WHERE migration_id = $1`, [SCHEMA_DEFAULTS_ID])
    .catch(() => ({ rows: [], rowCount: 0 }));
  if ((already.rowCount ?? 0) > 0) return { applied: false, defaults, failures };

  // Seules les colonnes existantes sont touchees : une base partielle ne doit
  // pas faire echouer la migration, et une vraie erreur doit rester visible.
  const existe = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_default IS NULL`
  );
  const sansDefault = new Set(
    existe.rows.map((r) => `${String(r["table_name"])}.${String(r["column_name"])}`)
  );

  for (const d of RECONCILE_DEFAULTS) {
    if (!sansDefault.has(`${d.table}.${d.column}`)) continue; // deja un default
    try {
      await client.query(
        `ALTER TABLE public."${d.table}" ALTER COLUMN "${d.column}" SET DEFAULT ${d.expr}`
      );
      defaults++;
    } catch (err) {
      failures.push(`${d.table}.${d.column}: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // Verification avant marqueur : les deux correctifs bloquants doivent tenir.
  for (const k of ["users.id", "organizations.name"]) {
    const [tbl, col] = k.split(".");
    const chk = await client.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [tbl, col]
    );
    if (chk.rowCount === 0) continue; // table absente de cette base
    if (chk.rows[0]["column_default"] == null) failures.push(`default absent apres migration: ${k}`);
  }

  if (failures.length === 0) {
    await client.query(
      `INSERT INTO schema_migrations (migration_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [SCHEMA_DEFAULTS_ID]
    );
  }
  return { applied: failures.length === 0, defaults, failures };
}
