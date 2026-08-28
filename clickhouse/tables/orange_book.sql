CREATE TABLE IF NOT EXISTS orange_book (
  application_number String, ingredient String, first_generic_approval Date
) ENGINE = ReplacingMergeTree ORDER BY application_number;
