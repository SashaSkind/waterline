-- Waterline Postgres schema (OLTP side).
-- Table groups:
--   Postgres only:            users, notes
--   Replicated to ClickHouse: dim_drug, watchlist, price_events (via ClickPipes CDC)

CREATE TABLE IF NOT EXISTS dim_drug (
  ndc11               TEXT PRIMARY KEY,
  ndc_product         TEXT,
  ingredient          TEXT,
  strength            TEXT,
  strength_unit       TEXT,
  dosage_form         TEXT,
  route               TEXT,
  brand_name          TEXT,
  labeler             TEXT,
  is_generic          BOOLEAN,
  application_number  TEXT,
  start_marketing     DATE,
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  user_id     BIGSERIAL PRIMARY KEY,
  email       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist (
  watch_id      BIGSERIAL PRIMARY KEY,
  user_id       BIGINT,
  ndc11         TEXT,
  threshold_pct NUMERIC DEFAULT 5.0,
  added_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  note_id     BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  ndc11       TEXT,
  body        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_events (
  event_id        BIGSERIAL PRIMARY KEY,
  ndc11           TEXT,
  effective_date  DATE,
  nadac_per_unit  NUMERIC,
  prev_per_unit   NUMERIC,
  pct_change      NUMERIC,
  ingested_at     TIMESTAMPTZ DEFAULT now()
);

-- Exactly one user, no auth.
INSERT INTO users (email)
SELECT 'demo@waterline.app'
WHERE NOT EXISTS (SELECT 1 FROM users);
