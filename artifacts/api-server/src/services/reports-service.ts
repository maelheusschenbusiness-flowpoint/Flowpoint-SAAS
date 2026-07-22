import { pool } from "@workspace/db";

export interface ReportRow {
  id: string;
  name: string;
  type: string;
  date: string;
  pages: number | null;
  shared: boolean;
  client: string | null;
  audit_id: string | null;
  white_label: boolean;
  pdf_ready: boolean;
  date_start: string | null;
  date_end: string | null;
}

export async function listReports(orgId: string, limit = 200): Promise<ReportRow[]> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT id, name, type, date, pages, shared, client, audit_id, white_label, pdf_ready, date_start, date_end
       FROM reports WHERE org_id=$1 ORDER BY date DESC LIMIT $2`,
      [orgId, limit]
    );
    return (r.rows ?? []).map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      type: String(row.type ?? "PDF"),
      date: row.date ? new Date(row.date as string).toLocaleDateString("fr-FR") : "—",
      pages: row.pages != null ? Number(row.pages) : null,
      shared: !!row.shared,
      client: row.client ? String(row.client) : null,
      audit_id: row.audit_id ? String(row.audit_id) : null,
      white_label: !!row.white_label,
      pdf_ready: !!row.pdf_ready,
      date_start: row.date_start ? String(row.date_start) : null,
      date_end: row.date_end ? String(row.date_end) : null,
    }));
  } catch {
    return [];
  } finally {
    client.release();
  }
}

export async function getReportStats(orgId: string): Promise<{
  total: number;
  shared: number;
  client_type: number;
  last_created: string | null;
}> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE shared=true) as shared,
       COUNT(*) FILTER (WHERE type='client') as client_type, MAX(date) as last_created
       FROM reports WHERE org_id=$1`,
      [orgId]
    );
    const row = r.rows?.[0] ?? {};
    return {
      total: Number(row.total ?? 0),
      shared: Number(row.shared ?? 0),
      client_type: Number(row.client_type ?? 0),
      last_created: row.last_created ? String(row.last_created) : null,
    };
  } catch {
    return { total: 0, shared: 0, client_type: 0, last_created: null };
  } finally {
    client.release();
  }
}
