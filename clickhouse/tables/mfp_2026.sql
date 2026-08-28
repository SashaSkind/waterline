CREATE TABLE IF NOT EXISTS mfp_2026 (
  generic_name String, brand_name String, mfp Decimal(18,2),
  unit_description String, effective_date Date
) ENGINE = ReplacingMergeTree ORDER BY generic_name;
