CREATE TABLE IF NOT EXISTS sdud_quarterly (
  ndc11 String, state LowCardinality(String), year UInt16, quarter UInt8,
  utilization_type LowCardinality(String),
  units_reimbursed Decimal(18,3), number_of_prescriptions UInt32,
  total_amount_reimbursed Decimal(18,2),
  medicaid_amount_reimbursed Decimal(18,2), suppression_used UInt8
) ENGINE = ReplacingMergeTree ORDER BY (ndc11, year, quarter, state, utilization_type);
