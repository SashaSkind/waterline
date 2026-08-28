import { pg } from "./pg";
import {
  DEMO_USER_ID,
  recordProductEvent,
} from "./product-events";

// All writes go to Postgres. The single demo user is user_id 1 (no auth).

export async function addWatch(
  ndc11: string,
  thresholdPct = 5.0,
  sessionId: string | null = null,
): Promise<{ watch_id: number } | { already: true }> {
  const client = await pg().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT watch_id FROM watchlist WHERE user_id = $1 AND ndc11 = $2",
      [DEMO_USER_ID, ndc11],
    );
    if (existing.rows.length) {
      await client.query("COMMIT");
      return { already: true };
    }
    const res = await client.query(
      "INSERT INTO watchlist (user_id, ndc11, threshold_pct) VALUES ($1, $2, $3) RETURNING watch_id",
      [DEMO_USER_ID, ndc11, thresholdPct],
    );
    await recordProductEvent(
      {
        eventName: "watch_added",
        ndc11,
        sessionId,
        source: "web",
      },
      client,
    );
    await client.query("COMMIT");
    return { watch_id: Number(res.rows[0].watch_id) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeWatch(
  ndc11: string,
  sessionId: string | null = null,
): Promise<number> {
  const client = await pg().connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      "DELETE FROM watchlist WHERE user_id = $1 AND ndc11 = $2",
      [DEMO_USER_ID, ndc11],
    );
    if (res.rowCount) {
      await recordProductEvent(
        {
          eventName: "watch_removed",
          ndc11,
          sessionId,
          source: "web",
        },
        client,
      );
    }
    await client.query("COMMIT");
    return res.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function isWatched(ndc11: string): Promise<boolean> {
  const res = await pg().query(
    "SELECT 1 FROM watchlist WHERE user_id = $1 AND ndc11 = $2",
    [DEMO_USER_ID, ndc11],
  );
  return res.rows.length > 0;
}
