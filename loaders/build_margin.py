"""Rebuild margin_mv — the precomputed acquisition-vs-reimbursement margin.

Grain: (ndc11, state, year, quarter). FFSU+MCOU combined by summing.
Rules (fixed by spec + review):
  - suppressed rows and zero-unit rows are EXCLUDED entirely, never zeros
  - XX national rows excluded (apps roll up states using the carried sums)
  - acq_per_unit = NADAC price in effect at the quarter midpoint (ASOF)
  - all division through Float64 (ClickHouse Decimal division traps scale)
Deterministic full rebuild via CREATE OR REPLACE TABLE ... AS SELECT.
"""

from lib import ch_client

SQL = """
CREATE OR REPLACE TABLE margin_mv
ENGINE = MergeTree
ORDER BY (ndc11, year, quarter, state)
AS
WITH sdud AS (
  SELECT ndc11, state, year, quarter,
         toFloat64(sum(units_reimbursed))         AS units,
         toFloat64(sum(total_amount_reimbursed))  AS total_reimb,
         sum(number_of_prescriptions)             AS rx_count,
         toDate(concat(toString(year), '-', lpad(toString(quarter * 3 - 1), 2, '0'), '-15')) AS quarter_mid
  FROM sdud_quarterly FINAL
  WHERE suppression_used = 0 AND units_reimbursed > 0 AND state != 'XX'
  GROUP BY ndc11, state, year, quarter
)
SELECT s.ndc11                                    AS ndc11,
       s.state                                    AS state,
       s.year                                     AS year,
       s.quarter                                  AS quarter,
       toFloat64(n.nadac_per_unit)                AS acq_per_unit,
       n.pricing_unit                             AS pricing_unit,
       s.total_reimb / s.units                    AS reimb_per_unit,
       s.total_reimb / s.units - toFloat64(n.nadac_per_unit)               AS margin_per_unit,
       (s.total_reimb / s.units - toFloat64(n.nadac_per_unit))
         / toFloat64(n.nadac_per_unit) * 100                               AS margin_pct,
       s.units                                    AS units,
       s.total_reimb                              AS total_reimb,
       s.rx_count                                 AS rx_count
FROM sdud s
ASOF JOIN (
  SELECT ndc11, effective_date, nadac_per_unit, pricing_unit
  FROM nadac_weekly FINAL
) n ON n.ndc11 = s.ndc11 AND n.effective_date <= s.quarter_mid
"""


def main() -> None:
    ch = ch_client()
    ch.command(SQL)
    stats = ch.query(
        """
        SELECT count() AS rows, uniqExact(ndc11) AS ndcs,
               round(countIf(margin_per_unit < 0) / count() * 100, 1) AS underwater_row_pct,
               round(uniqExactIf(ndc11, margin_per_unit < 0) / uniqExact(ndc11) * 100, 1) AS underwater_ndc_pct
        FROM margin_mv
        """
    ).first_row
    print(f"margin_mv: {stats[0]} rows, {stats[1]} NDCs, "
          f"{stats[2]}% rows underwater, {stats[3]}% NDCs ever underwater")


if __name__ == "__main__":
    main()
