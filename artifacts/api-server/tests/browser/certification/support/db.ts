import pg from "pg";
import { IS_LOCAL } from "./cible";

let pool: pg.Pool | null = null;
/** Pool vers la base JETABLE locale. Refuse toute autre base. */
export function db(): pg.Pool {
  if (!IS_LOCAL) throw new Error("db() n'est disponible qu'en local (base jetable).");
  const url = process.env["DATABASE_URL"] ?? "";
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("DATABASE_URL absente ou non locale : lancez run-local.sh puis exportez l'URL affichee (pg-jetable.sh url).");
  pool ??= new pg.Pool({ connectionString: url, max: 3 });
  return pool;
}
export async function closeDb(): Promise<void> { await pool?.end(); pool = null; }

export async function one<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db().query(sql, params); return (r.rows[0] as T) ?? null;
}
export async function all<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query(sql, params)).rows as T[];
}
