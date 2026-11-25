/**
 * Behavioral AI / AI CRO / Revenue Leak : tables absentes de la production.
 *
 * Le code (routes/behavioral.ts, cro.ts, revenue-leak.ts, services associes, snippet
 * public) lit et ecrit behavior_events, behavior_sessions, behavior_insights,
 * behavior_site_tokens, cro_recommendations, cro_experiments et
 * revenue_leak_resolutions. Seul migrations/002_dashboard_tables.sql les cree (dans une
 * forme historique site_id/url/data), et la production n'applique pas ce fichier :
 * chaque appel renvoyait « relation absente ».
 *
 * Tout est additif et idempotent (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS,
 * aucun DROP de table ni de colonne, aucune cle etrangere sur org_id). Les bases qui
 * portent encore la forme historique de la migration 002 convergent vers le schema
 * courant sans perte. Schema identique a celui de la branche Test-Replit (beta).
 *
 * RLS : ENABLE + 4 politiques tenant (comme applyTenantRls de init-data-tables.ts).
 *  - FORCE uniquement pour les tables lues/ecrites exclusivement via req.orgDb
 *    (cro_recommendations, revenue_leak_resolutions).
 *  - behavior_events / behavior_sessions / behavior_insights / cro_experiments sont
 *    ecrites par l'ingestion publique (aucun contexte d'organisation : l'org est
 *    deduite du jeton de site) : pas de FORCE, comme les autres tables ecrites par
 *    pool brut.
 *  - behavior_site_tokens : pas de RLS. Le jeton est resolu AVANT toute authentification
 *    (echange de jeton public) ; seule l'empreinte SHA-256 est stockee.
 */
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

// Type structurel (pg n'est pas hoiste hors de @workspace/db) : meme approche que init-data-tables.ts.
interface Client {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T extends Record<string, unknown> = Record<string, unknown>>(queryText: string, values?: any[]): Promise<{ rows: T[]; rowCount: number | null }>;
  release(err?: boolean | Error): void;
}

async function run(client: Client, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (err: unknown) {
    logger.warn(
      { sqlMsg: err instanceof Error ? err.message : String(err), sqlStmt: sql.replace(/\s+/g, " ").trim().slice(0, 120) },
      "[init-behavioral-cro-tables] Non-fatal SQL warn",
    );
  }
}

async function applyTenantRls(client: Client, t: string, force: boolean): Promise<void> {
  const GUC = `current_setting('app.current_org_id', true)`;
  await run(client, `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
  if (force) await run(client, `ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`);
  // Anciennes politiques *_isolation (init-data-tables.ts) : remplacees par les 4 politiques tenant.
  await run(client, `DROP POLICY IF EXISTS "${t}_isolation" ON "${t}"`);
  for (const [op, cmd] of [
    ["select", `FOR SELECT USING     (COALESCE(org_id,'default') = ${GUC})`],
    ["insert", `FOR INSERT WITH CHECK (COALESCE(org_id,'default') = ${GUC})`],
    ["update", `FOR UPDATE USING     (COALESCE(org_id,'default') = ${GUC})`],
    ["delete", `FOR DELETE USING     (COALESCE(org_id,'default') = ${GUC})`],
  ] as [string, string][]) {
    await run(client, `DROP   POLICY IF EXISTS "tenant_${op}" ON "${t}"`);
    await run(client, `CREATE POLICY           "tenant_${op}" ON "${t}" ${cmd}`);
  }
}

export async function initBehavioralCroTables(): Promise<void> {
  const client = (await pool.connect()) as unknown as Client;
  try {
    // ── behavior_events ──────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS behavior_events (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'default',
        session_id TEXT NOT NULL DEFAULT '',
        site_url TEXT NOT NULL DEFAULT '',
        page TEXT NOT NULL DEFAULT '/',
        event_type TEXT NOT NULL DEFAULT '',
        element TEXT,
        x_pos INTEGER,
        y_pos INTEGER,
        scroll_depth INTEGER,
        time_on_page INTEGER,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await run(client, `
      ALTER TABLE behavior_events
        ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default',
        ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS site_url TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS page TEXT NOT NULL DEFAULT '/',
        ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS element TEXT,
        ADD COLUMN IF NOT EXISTS x_pos INTEGER,
        ADD COLUMN IF NOT EXISTS y_pos INTEGER,
        ADD COLUMN IF NOT EXISTS scroll_depth INTEGER,
        ADD COLUMN IF NOT EXISTS time_on_page INTEGER,
        ADD COLUMN IF NOT EXISTS metadata JSONB,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);
    // Forme historique (migration 002) : on ne perd rien, on recopie vers les colonnes courantes.
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_events' AND column_name='site_id') THEN
          EXECUTE 'UPDATE behavior_events SET site_url=site_id WHERE site_url='''' AND site_id IS NOT NULL';
          EXECUTE 'ALTER TABLE behavior_events ALTER COLUMN site_id SET DEFAULT ''''';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_events' AND column_name='url') THEN
          EXECUTE 'UPDATE behavior_events SET page=url WHERE (page='''' OR page=''/'') AND url IS NOT NULL AND url<>''''';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_events' AND column_name='data') THEN
          EXECUTE 'UPDATE behavior_events SET metadata=data WHERE metadata IS NULL';
        END IF;
      END $$;
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS behavior_events_org_site_created_idx ON behavior_events(org_id,site_url,created_at DESC)`);
    await run(client, `CREATE INDEX IF NOT EXISTS behavior_events_org_id_idx ON behavior_events(org_id)`);
    await applyTenantRls(client, "behavior_events", false);

    // ── behavior_sessions ────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS behavior_sessions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'default',
        site_url TEXT NOT NULL DEFAULT '',
        user_agent TEXT,
        device_type TEXT DEFAULT 'desktop',
        country TEXT,
        page_views INTEGER NOT NULL DEFAULT 1,
        bounce BOOLEAN NOT NULL DEFAULT true,
        engagement_score INTEGER NOT NULL DEFAULT 0,
        rage_clicks INTEGER NOT NULL DEFAULT 0,
        exit_page TEXT,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ
      )
    `);
    await run(client, `
      ALTER TABLE behavior_sessions
        ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default',
        ADD COLUMN IF NOT EXISTS site_url TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS user_agent TEXT,
        ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'desktop',
        ADD COLUMN IF NOT EXISTS country TEXT,
        ADD COLUMN IF NOT EXISTS page_views INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS bounce BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS engagement_score INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS rage_clicks INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS exit_page TEXT,
        ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_sessions' AND column_name='site_id') THEN
          EXECUTE 'UPDATE behavior_sessions SET site_url=site_id WHERE site_url='''' AND site_id IS NOT NULL';
          EXECUTE 'ALTER TABLE behavior_sessions ALTER COLUMN site_id SET DEFAULT ''''';
        END IF;
      END $$;
    `);
    // Cle primaire par organisation : l'identifiant de session est genere cote navigateur du
    // site client, donc deux organisations peuvent legitimement recevoir le meme id. Avec
    // PRIMARY KEY (id) seule, la session de la 2e organisation etait silencieusement perdue
    // (ON CONFLICT DO NOTHING). Passage a PRIMARY KEY (org_id, id) : aucune ligne modifiee ni
    // supprimee, idempotent (ne fait rien si la cle est deja composite), verrou pris avant la
    // verification pour que deux instances qui demarrent ensemble ne se marchent pas dessus.
    await run(client, `
      DO $$
      DECLARE pk_name text; pk_cols text[];
      BEGIN
        IF to_regclass('public.behavior_sessions') IS NULL THEN RETURN; END IF;
        LOCK TABLE public.behavior_sessions IN ACCESS EXCLUSIVE MODE;
        SELECT c.conname, array_agg(a.attname::text ORDER BY k.ord)
          INTO pk_name, pk_cols
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conrelid = 'public.behavior_sessions'::regclass AND c.contype = 'p'
         GROUP BY c.conname;
        IF pk_cols IS NULL OR pk_cols <> ARRAY['org_id','id'] THEN
          IF pk_name IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.behavior_sessions DROP CONSTRAINT %I', pk_name);
          END IF;
          ALTER TABLE public.behavior_sessions ADD PRIMARY KEY (org_id, id);
        END IF;
      END $$;
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS behavior_sessions_org_site_idx ON behavior_sessions(org_id,site_url)`);
    await run(client, `CREATE INDEX IF NOT EXISTS behavior_sessions_org_id_idx ON behavior_sessions(org_id)`);
    await applyTenantRls(client, "behavior_sessions", false);

    // ── behavior_insights ────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS behavior_insights (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'default',
        site_url TEXT NOT NULL DEFAULT '',
        insight_type TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'medium',
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        affected_pages JSONB DEFAULT '[]',
        estimated_impact TEXT,
        ai_suggestion TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await run(client, `
      ALTER TABLE behavior_insights
        ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default',
        ADD COLUMN IF NOT EXISTS site_url TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS insight_type TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'medium',
        ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS affected_pages JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS estimated_impact TEXT,
        ADD COLUMN IF NOT EXISTS ai_suggestion TEXT,
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_insights' AND column_name='site_id') THEN
          EXECUTE 'UPDATE behavior_insights SET site_url=site_id WHERE site_url='''' AND site_id IS NOT NULL';
          EXECUTE 'ALTER TABLE behavior_insights ALTER COLUMN site_id SET DEFAULT ''''';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_insights' AND column_name='type') THEN
          EXECUTE 'UPDATE behavior_insights SET insight_type=type WHERE insight_type='''' AND type IS NOT NULL';
          EXECUTE 'ALTER TABLE behavior_insights ALTER COLUMN type SET DEFAULT ''''';
        END IF;
      END $$;
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS behavior_insights_org_site_created_idx ON behavior_insights(org_id,site_url,created_at DESC)`);
    await run(client, `CREATE INDEX IF NOT EXISTS behavior_insights_org_id_idx ON behavior_insights(org_id)`);
    await applyTenantRls(client, "behavior_insights", false);

    // ── behavior_nonces : anti-rejeu partage entre instances (ingestion publique) ──
    // Aucune donnee client : couple (site, nonce) + echeance. Purge des lignes expirees
    // par le service (behavioral-session-auth.ts). Pas de RLS : ecrite avant tout contexte d'org.
    await run(client, `
      CREATE TABLE IF NOT EXISTS behavior_nonces (
        site_url TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (site_url, nonce)
      )
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS behavior_nonces_expires_idx ON behavior_nonces(expires_at)`);

    // ── behavior_site_tokens (empreinte SHA-256 uniquement) ──────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS behavior_site_tokens (
        token_hash TEXT NOT NULL,
        site_url TEXT NOT NULL,
        org_id TEXT NOT NULL DEFAULT 'default',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      )
    `);
    await run(client, `
      ALTER TABLE behavior_site_tokens
        ADD COLUMN IF NOT EXISTS token_hash TEXT,
        ADD COLUMN IF NOT EXISTS site_url TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default',
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ
    `);
    // Forme historique (token en clair, domain, site_id) : migration sans perte vers token_hash.
    try {
      const cols = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_site_tokens'`,
      );
      const names = new Set(cols.rows.map(r => r.column_name));
      if (names.has("token")) {
        const siteParts = ["NULLIF(site_url, '')"];
        if (names.has("domain")) siteParts.push("NULLIF(domain, '')");
        if (names.has("site_id")) siteParts.push("NULLIF(site_id, '')");
        const activeExpr = names.has("active") ? "active" : "true";
        const legacy = await client.query<{ token: string | null; site_url: string | null; active: boolean }>(
          `SELECT token, COALESCE(${siteParts.join(", ")}) AS site_url, ${activeExpr} AS active
             FROM behavior_site_tokens WHERE token_hash IS NULL`,
        );
        for (const row of legacy.rows) {
          if (!row.token || !row.site_url) continue; // jamais de suppression : la ligne reste, signalee ci-dessous
          const siteUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(row.site_url) ? row.site_url : `https://${row.site_url}`;
          const tokenHash = createHash("sha256").update(row.active === false ? `revoked:${row.token}` : row.token).digest("hex");
          await client.query(
            `UPDATE behavior_site_tokens SET token_hash=$1, site_url=$2, token='migrated:' || $1
              WHERE token_hash IS NULL AND token=$3`,
            [tokenHash, siteUrl, row.token],
          );
        }
      }
      const unresolved = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM behavior_site_tokens WHERE token_hash IS NULL OR site_url=''`,
      );
      if ((unresolved.rows[0]?.n ?? 0) > 0) {
        // Aucune suppression : on laisse la contrainte NOT NULL de cote et on le signale.
        logger.error({ rows: unresolved.rows[0]?.n }, "[init-behavioral-cro-tables] behavior_site_tokens: lignes historiques non convertibles, conservees telles quelles");
      } else {
        await run(client, `ALTER TABLE behavior_site_tokens ALTER COLUMN token_hash SET NOT NULL`);
        await run(client, `ALTER TABLE behavior_site_tokens ALTER COLUMN site_url SET NOT NULL`);
      }
    } catch (err) {
      logger.warn({ err }, "[init-behavioral-cro-tables] behavior_site_tokens legacy upgrade skipped");
    }
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_site_tokens' AND column_name='site_id') THEN
          EXECUTE 'ALTER TABLE behavior_site_tokens ALTER COLUMN site_id SET DEFAULT gen_random_uuid()::text';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_site_tokens' AND column_name='token') THEN
          EXECUTE 'ALTER TABLE behavior_site_tokens ALTER COLUMN token SET DEFAULT (''migrated:'' || gen_random_uuid()::text)';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='behavior_site_tokens' AND column_name='domain') THEN
          EXECUTE 'ALTER TABLE behavior_site_tokens ALTER COLUMN domain SET DEFAULT ''''';
        END IF;
      END $$;
    `);
    // site_url unique : cible du ON CONFLICT (site_url) de GET /behavioral/snippet.
    await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS behavior_site_tokens_site_url_uidx ON behavior_site_tokens(site_url)`);
    await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS behavior_site_tokens_token_hash_uidx ON behavior_site_tokens(token_hash)`);
    await run(client, `CREATE INDEX IF NOT EXISTS behavior_site_tokens_org_id_idx ON behavior_site_tokens(org_id)`);

    // ── cro_recommendations ──────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS cro_recommendations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'default',
        site_url TEXT NOT NULL,
        page TEXT NOT NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        title TEXT NOT NULL,
        description TEXT,
        implementation TEXT,
        estimated_uplift REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        ai_generated BOOLEAN DEFAULT false,
        source TEXT DEFAULT 'rules',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Forme historique (migration 002 : id, site_url, type, title, description, impact, effort,
    // status, updated_at, created_at) : on ajoute les colonnes que le code lit et ecrit.
    await run(client, `
      ALTER TABLE cro_recommendations
        ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default',
        ADD COLUMN IF NOT EXISTS page TEXT NOT NULL DEFAULT '/',
        ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium',
        ADD COLUMN IF NOT EXISTS implementation TEXT,
        ADD COLUMN IF NOT EXISTS estimated_uplift REAL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'rules',
        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS cro_recommendations_org_id_idx ON cro_recommendations(org_id)`);
    await run(client, `CREATE INDEX IF NOT EXISTS cro_recommendations_org_site_idx ON cro_recommendations(org_id, site_url, updated_at DESC)`);
    await applyTenantRls(client, "cro_recommendations", true);

    // ── cro_experiments (lue par le snippet public : assignation de variantes) ──
    await run(client, `
      CREATE TABLE IF NOT EXISTS cro_experiments (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'default',
        site_url TEXT NOT NULL DEFAULT '',
        page TEXT NOT NULL DEFAULT '/',
        name TEXT NOT NULL DEFAULT '',
        hypothesis TEXT,
        variant_a JSONB DEFAULT '{}',
        variant_b JSONB DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft',
        winner TEXT,
        conversion_a REAL,
        conversion_b REAL,
        confidence REAL,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await run(client, `
      ALTER TABLE cro_experiments
        ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default',
        ADD COLUMN IF NOT EXISTS site_url TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS page TEXT NOT NULL DEFAULT '/',
        ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS hypothesis TEXT,
        ADD COLUMN IF NOT EXISTS variant_a JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS variant_b JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
        ADD COLUMN IF NOT EXISTS winner TEXT,
        ADD COLUMN IF NOT EXISTS conversion_a REAL,
        ADD COLUMN IF NOT EXISTS conversion_b REAL,
        ADD COLUMN IF NOT EXISTS confidence REAL,
        ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS cro_experiments_org_id_idx ON cro_experiments(org_id)`);
    await applyTenantRls(client, "cro_experiments", false);

    // ── revenue_leak_resolutions (revenue_leaks existe deja en production) ────
    await run(client, `
      CREATE TABLE IF NOT EXISTS revenue_leak_resolutions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'default',
        site_url TEXT NOT NULL DEFAULT '',
        page TEXT NOT NULL DEFAULT '/',
        event_type TEXT NOT NULL DEFAULT 'conversion',
        resolved_observed_events INTEGER NOT NULL DEFAULT 0,
        resolved_affected_sessions INTEGER NOT NULL DEFAULT 0,
        resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS revenue_leak_resolutions_org_id_idx ON revenue_leak_resolutions(org_id)`);
    await applyTenantRls(client, "revenue_leak_resolutions", true);

    logger.info("[startup] behavioral / CRO / revenue-leak tables ensured");
  } finally {
    client.release();
  }
}
