CREATE TABLE IF NOT EXISTS nadac_weekly (
  ndc11 String, effective_date Date, nadac_per_unit Decimal(18,5),
  pricing_unit LowCardinality(String), classification LowCardinality(String),
  otc UInt8, explanation_code LowCardinality(String),
  corresponding_generic_per_unit Nullable(Decimal(18,5))
) ENGINE = ReplacingMergeTree ORDER BY (ndc11, effective_date);
