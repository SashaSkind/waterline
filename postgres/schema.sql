-- Waterline Postgres schema (OLTP side).
-- Table groups:
--   Postgres only:            users, notes
--   Replicated to ClickHouse: dim_drug, watchlist, price_events, product_events
--                              (via ClickPipes CDC)

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

-- Append-only product telemetry. Known dimensions stay typed; no email,
-- note body, search text, IP address, or user-agent is copied to analytics.
-- NULL ndc11/session_id is meaningful for account-level or server events.
CREATE TABLE IF NOT EXISTS product_events (
  event_id     UUID PRIMARY KEY,
  event_name   TEXT NOT NULL CHECK (event_name IN (
    'user_signed_up',
    'drug_viewed',
    'watch_added',
    'watch_removed'
  )),
  user_id      BIGINT NOT NULL,
  session_id   UUID,
  ndc11        TEXT,
  source       TEXT NOT NULL DEFAULT 'web',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  CONSTRAINT product_events_ndc11_format
    CHECK (ndc11 IS NULL OR ndc11 ~ '^[0-9]{11}$')
);

-- CREATE TABLE IF NOT EXISTS does not add columns to an older deployment.
ALTER TABLE product_events
  ADD COLUMN IF NOT EXISTS event_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Account creation may eventually happen outside the current demo app. Keep
-- its PII-free analytics event in the same Postgres transaction regardless of
-- which server path inserts the user.
CREATE OR REPLACE FUNCTION append_user_signup_product_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  signup_at TIMESTAMPTZ := COALESCE(NEW.created_at, now());
BEGIN
  INSERT INTO product_events (
    event_id, event_name, user_id, source, occurred_at, event_date
  )
  VALUES (
    md5('waterline:user_signed_up:' || NEW.user_id::text)::uuid,
    'user_signed_up',
    NEW.user_id,
    'server',
    signup_at,
    signup_at::date
  )
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'users_append_signup_product_event'
      AND tgrelid = 'users'::regclass
  ) THEN
    CREATE TRIGGER users_append_signup_product_event
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION append_user_signup_product_event();
  END IF;
END;
$$;

-- Exactly one user, no auth.
INSERT INTO users (email)
SELECT 'demo@waterline.app'
WHERE NOT EXISTS (SELECT 1 FROM users);

-- Deterministically backfill one signup event for existing users. The UUID is
-- stable, so applying this idempotent schema never creates duplicate events.
INSERT INTO product_events (
  event_id, event_name, user_id, source, occurred_at, event_date
)
SELECT
  md5('waterline:user_signed_up:' || user_id::text)::uuid,
  'user_signed_up',
  user_id,
  'schema_backfill',
  created_at,
  created_at::date
FROM users
ON CONFLICT (event_id) DO NOTHING;
