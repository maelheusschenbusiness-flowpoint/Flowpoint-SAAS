/**
 * AI Workspace Launch — historique des lancements d'une organisation.
 *
 * Avant ce module, seule la derniere session etait retrouvable, et seulement dans
 * le navigateur qui l'avait generee (`localStorage`). Strategies et missions sont
 * pourtant persistees en base : un autre appareil, un cache vide ou un autre
 * membre de l'equipe ne retrouvait rien. La liste vient de la base, bornee a
 * l'organisation, et n'expose que des champs de resume.
 */
export const AWL_HISTORY_LIMIT = 20;

export type AwlQuery = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export interface AwlHistoryItem {
  sessionId: string;
  status: string;
  siteUrl: string | null;
  businessName: string | null;
  niche: string | null;
  location: string | null;
  startedAt: string | null;
  missionCount: number;
}

export const AWL_HISTORY_SQL = `
  SELECT s.id, s.status, s.site_url, s.business_name, s.niche, s.location, s.started_at,
         (SELECT COUNT(*)::int FROM ai_generated_missions m
            JOIN ai_workspace_profiles p ON p.id = m.profile_id AND p.org_id = m.org_id
           WHERE m.org_id = s.org_id AND p.session_id = s.id) AS mission_count
    FROM onboarding_sessions s
   WHERE s.org_id = $1
     AND EXISTS (SELECT 1 FROM ai_workspace_profiles p WHERE p.session_id = s.id AND p.org_id = s.org_id)
   ORDER BY s.started_at DESC, s.id DESC
   LIMIT ${AWL_HISTORY_LIMIT}`;

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

export async function listWorkspaceLaunches(query: AwlQuery, orgId: string): Promise<AwlHistoryItem[]> {
  const { rows } = await query(AWL_HISTORY_SQL, [orgId]);
  return rows.map(row => ({
    sessionId: String(row["id"]),
    status: String(row["status"] ?? ""),
    siteUrl: text(row["site_url"]),
    businessName: text(row["business_name"]),
    niche: text(row["niche"]),
    location: text(row["location"]),
    startedAt: row["started_at"] instanceof Date ? row["started_at"].toISOString() : text(row["started_at"]),
    missionCount: Number(row["mission_count"]) || 0,
  }));
}
