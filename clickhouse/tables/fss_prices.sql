CREATE TABLE IF NOT EXISTS fss_prices (
  ndc11 String, product_name String, vendor String, package_size Decimal(18,3),
  fss_price Decimal(18,4), big_four_price Nullable(Decimal(18,4)),
  fss_per_unit Decimal(18,5)
) ENGINE = ReplacingMergeTree ORDER BY ndc11;
