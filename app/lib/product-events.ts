import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { pg } from "./pg";

export const DEMO_USER_ID = 1;

export type ProductEventName =
  | "user_signed_up"
  | "drug_viewed"
  | "watch_added"
  | "watch_removed";

export interface ProductEventInput {
  eventName: ProductEventName;
  userId?: number;
  sessionId?: string | null;
  ndc11?: string | null;
  source?: "web" | "server" | "schema_backfill";
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Insert one immutable analytics event. A caller with an open transaction can
 * pass its PoolClient so the business mutation and its event commit together. */
export async function recordProductEvent(
  event: ProductEventInput,
  executor: Pool | PoolClient = pg(),
): Promise<string> {
  const eventId = randomUUID();
  await executor.query(
    `INSERT INTO product_events
       (event_id, event_name, user_id, session_id, ndc11, source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      eventId,
      event.eventName,
      event.userId ?? DEMO_USER_ID,
      event.sessionId ?? null,
      event.ndc11 ?? null,
      event.source ?? "web",
    ],
  );
  return eventId;
}
