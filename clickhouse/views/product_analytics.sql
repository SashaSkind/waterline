-- Apply after clickhouse/databases/product_analytics.sql and after ClickPipes
-- has created default.product_events.
-- The raw table remains CDC-owned. Product events are immutable, so this
-- PII-free projection needs no latest-row window or mutation handling.

CREATE OR REPLACE VIEW product_analytics.events AS
SELECT
  event_id,
  toUInt64(user_id) AS user_id,
  ifNull(session_id, toUUID('00000000-0000-0000-0000-000000000000')) AS session_id,
  toLowCardinality(event_name) AS event_name,
  ifNull(ndc11, '') AS ndc11,
  toLowCardinality(source) AS source,
  occurred_at,
  event_date
FROM default.product_events
WHERE _peerdb_is_deleted = 0;
