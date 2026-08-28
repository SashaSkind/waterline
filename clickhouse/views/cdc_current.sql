-- Latest-version views over the CDC-owned tables. ClickPipes lands every
-- Postgres change as a new row with _peerdb_version and _peerdb_is_deleted;
-- the app must always read through these views, never the raw tables.

CREATE OR REPLACE VIEW dim_drug_v AS
SELECT * EXCEPT (rn)
FROM (
  SELECT *, row_number() OVER (PARTITION BY ndc11 ORDER BY _peerdb_version DESC) AS rn
  FROM dim_drug
)
WHERE rn = 1 AND _peerdb_is_deleted = 0;

CREATE OR REPLACE VIEW watchlist_v AS
SELECT * EXCEPT (rn)
FROM (
  SELECT *, row_number() OVER (PARTITION BY watch_id ORDER BY _peerdb_version DESC) AS rn
  FROM watchlist
)
WHERE rn = 1 AND _peerdb_is_deleted = 0;

CREATE OR REPLACE VIEW price_events_v AS
SELECT * EXCEPT (rn)
FROM (
  SELECT *, row_number() OVER (PARTITION BY event_id ORDER BY _peerdb_version DESC) AS rn
  FROM price_events
)
WHERE rn = 1 AND _peerdb_is_deleted = 0;
