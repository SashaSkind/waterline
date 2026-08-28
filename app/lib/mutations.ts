import { pg } from "./pg";

// All writes go to Postgres. The single demo user is user_id 1 (no auth).
const USER_ID = 1;

export async function addWatch(
  ndc11: string,
  thresholdPct = 5.0,
): Promise<{ watch_id: number } | { already: true }> {
  const existing = await pg().query(
    "SELECT watch_id FROM watchlist WHERE user_id = $1 AND ndc11 = $2",
    [USER_ID, ndc11],
  );
  if (existing.rows.length) return { already: true };
  const res = await pg().query(
    "INSERT INTO watchlist (user_id, ndc11, threshold_pct) VALUES ($1, $2, $3) RETURNING watch_id",
    [USER_ID, ndc11, thresholdPct],
  );
  return { watch_id: res.rows[0].watch_id };
}

export async function removeWatch(ndc11: string): Promise<number> {
  const res = await pg().query(
    "DELETE FROM watchlist WHERE user_id = $1 AND ndc11 = $2",
    [USER_ID, ndc11],
  );
  return res.rowCount ?? 0;
}

export async function isWatched(ndc11: string): Promise<boolean> {
  const res = await pg().query(
    "SELECT 1 FROM watchlist WHERE user_id = $1 AND ndc11 = $2",
    [USER_ID, ndc11],
  );
  return res.rows.length > 0;
}
