CREATE TABLE IF NOT EXISTS partd_spending (
  brand_name String, generic_name String, manufacturer String, year UInt16,
  total_spending Decimal(20,2), total_dosage_units Decimal(20,3),
  avg_spending_per_unit Decimal(18,5), total_claims UInt64, total_benes UInt64,
  multi_route_flag UInt8
) ENGINE = ReplacingMergeTree ORDER BY (generic_name, brand_name, manufacturer, year);
