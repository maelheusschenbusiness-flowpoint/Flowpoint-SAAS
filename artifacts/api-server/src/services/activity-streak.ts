import { pool } from "@workspace/db";

export const DEFAULT_ACTIVITY_TIMEZONE = "Europe/Brussels";
const USER_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ActivityDb = (
  sql: string,
  values?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

export type StreakResult = {
  current: number;
  best: number;
  rowCount: number;
};

function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeActivityTimezone(timezone: unknown): string {
  return typeof timezone === "string" && isValidTimezone(timezone)
    ? timezone
    : DEFAULT_ACTIVITY_TIMEZONE;
}

export function dateKeyInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeActivityTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Shift a local calendar date without converting it through the local machine's
 * timezone. Noon UTC is safe for the date-only arithmetic used here, including
 * DST transitions in the user's configured timezone.
 */
export function shiftDateKey(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function calculateStreak(
  days: Iterable<string>,
  today = dateKeyInTimezone(new Date(), DEFAULT_ACTIVITY_TIMEZONE),
): Omit<StreakResult, "rowCount"> {
  const activeDays = new Set(
    Array.from(days)
      .map(day => String(day).slice(0, 10))
      .filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)),
  );
  if (activeDays.size === 0) return { current: 0, best: 0 };

  // A day without an entry is not a break until tomorrow: today's streak is
  // allowed to start from yesterday, matching the product's existing semantics.
  const startOffset = activeDays.has(today) ? 0 : 1;
  let current = 0;
  for (let offset = startOffset; offset < 365; offset += 1) {
    if (!activeDays.has(shiftDateKey(today, -offset))) break;
    current += 1;
  }

  const sortedDays = Array.from(activeDays).sort();
  let best = 0;
  let run = 0;
  for (let index = 0; index < sortedDays.length; index += 1) {
    const day = sortedDays[index]!;
    const previous = sortedDays[index - 1];
    run = index > 0 && previous && shiftDateKey(day, -1) === previous
      ? run + 1
      : 1;
    best = Math.max(best, run);
  }

  return { current, best: Math.max(best, current) };
}

export async function getActivityTimezone(
  db: ActivityDb,
  orgId: string,
): Promise<string> {
  try {
    const result = await db(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    const settings = result.rows[0]?.["settings"];
    const timezone = settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)["timezone"]
      : undefined;
    return normalizeActivityTimezone(timezone);
  } catch {
    try {
      const result = await pool.query(
        `SELECT settings FROM user_prefs WHERE org_id=$1 LIMIT 1`,
        [orgId],
      );
      const settings = result.rows[0]?.["settings"];
      const timezone = settings && typeof settings === "object"
        ? (settings as Record<string, unknown>)["timezone"]
        : undefined;
      return normalizeActivityTimezone(timezone);
    } catch {
      return DEFAULT_ACTIVITY_TIMEZONE;
    }
  }
}

function canonicalUserId(userId: string | undefined, orgId: string): string | null {
  if (
    !userId
    || !USER_ID_UUID_RE.test(userId)
    || userId === orgId
    || userId === "default"
    || userId === "service"
    || userId === "system"
    || userId.startsWith("apikey:")
  ) return null;
  return userId;
}

/**
 * Persist one canonical row for the authenticated user. Missing identity is
 * deliberately a no-op: an org-wide or org-id-as-user row cannot be safely
 * attributed to the owner or to an invited member.
 */
export async function recordActivityDay(
  db: ActivityDb,
  orgId: string,
  userId: string | undefined,
): Promise<boolean> {
  const user = canonicalUserId(userId, orgId);
  if (!user) return false;

  const timezone = await getActivityTimezone(db, orgId);
  const values = [orgId, user, timezone];
  const sql = `
    INSERT INTO user_activity_days (org_id, user_id, day)
    VALUES ($1, $2, (NOW() AT TIME ZONE $3)::date)
    ON CONFLICT (org_id, user_id, day) DO NOTHING
  `;

  try {
    await db(sql, values);
    return true;
  } catch {
    try {
      await pool.query(sql, values);
      return true;
    } catch {
      return false;
    }
  }
}

async function readActivityDays(
  db: ActivityDb,
  orgId: string,
  userId: string,
  timezone: string,
): Promise<string[]> {
  const values = [orgId, userId, timezone];
  const sql = `
    SELECT day::text AS d
    FROM user_activity_days
    WHERE org_id=$1
      AND user_id=$2
      AND day >= (NOW() AT TIME ZONE $3)::date - INTERVAL '365 days'
    ORDER BY day DESC
  `;

  try {
    const result = await db(sql, values);
    return result.rows.map(row => String(row["d"]).slice(0, 10));
  } catch {
    const result = await pool.query(sql, values);
    return result.rows.map(row => String(row["d"]).slice(0, 10));
  }
}

export async function computeUserStreak(
  db: ActivityDb,
  orgId: string,
  userId: string | undefined,
  timezone?: string,
): Promise<StreakResult> {
  const user = canonicalUserId(userId, orgId);
  if (!user) return { current: 0, best: 0, rowCount: 0 };

  const tz = typeof timezone === "string"
    ? normalizeActivityTimezone(timezone)
    : await getActivityTimezone(db, orgId);
  const days = await readActivityDays(db, orgId, user, tz);
  const result = calculateStreak(days, dateKeyInTimezone(new Date(), tz));
  return { ...result, rowCount: days.length };
}