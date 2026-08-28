"""Rebuild the acquisition-vs-reimbursement margin tables.

margin_mv keeps the NDC-first sort used by drug pages. margin_map is a
denormalized, period-first copy for interactive viewport aggregation.

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

MAP_SQL = """
CREATE OR REPLACE TABLE margin_map
ENGINE = MergeTree
ORDER BY (year, quarter, state, ndc11)
AS
SELECT m.ndc11                              AS ndc11,
       m.state                              AS state,
       m.year                               AS year,
       m.quarter                            AS quarter,
       m.acq_per_unit                       AS acq_per_unit,
       m.pricing_unit                       AS pricing_unit,
       m.reimb_per_unit                     AS reimb_per_unit,
       m.margin_per_unit                    AS margin_per_unit,
       m.margin_pct                         AS margin_pct,
       m.units                              AS units,
       m.total_reimb                        AS total_reimb,
       m.rx_count                           AS rx_count,
       ifNull(d.brand_name, '')             AS brand_name,
       ifNull(d.ingredient, '')             AS ingredient,
       ifNull(d.is_generic, false)          AS is_generic
FROM margin_mv m
LEFT ANY JOIN (
  SELECT ndc11, brand_name, ingredient, is_generic
  FROM dim_drug_v
) d ON d.ndc11 = m.ndc11
"""

MAP_META_SQL = """
CREATE OR REPLACE TABLE margin_map_meta
ENGINE = MergeTree
ORDER BY (year, quarter, state)
AS
WITH points AS (
  SELECT year, quarter, '' AS state, ndc11,
         any(acq_per_unit) AS acq_per_unit,
         sum(total_reimb) / sum(units) AS reimb_per_unit,
         count() AS source_rows
  FROM margin_map
  GROUP BY year, quarter, ndc11

  UNION ALL

  SELECT year, quarter, state, ndc11,
         acq_per_unit, reimb_per_unit, toUInt64(1) AS source_rows
  FROM margin_map
)
SELECT year, quarter, state,
       toUInt64(sum(source_rows)) AS source_rows,
       toUInt32(count()) AS ndcs,
       quantileTDigest(0.005)(log10(acq_per_unit)) AS lx_low,
       quantileTDigest(0.995)(log10(acq_per_unit)) AS lx_high,
       quantileTDigest(0.005)(log10(reimb_per_unit)) AS ly_low,
       quantileTDigest(0.995)(log10(reimb_per_unit)) AS ly_high
FROM points
WHERE acq_per_unit > 0 AND reimb_per_unit > 0
GROUP BY year, quarter, state
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

    ch.command(MAP_SQL)
    map_stats = ch.query(
        """
        SELECT count() AS rows, uniqExact(ndc11) AS ndcs,
               min((year, quarter)) AS first_period,
               max((year, quarter)) AS last_period
        FROM margin_map
        """
    ).first_row
    print(f"margin_map: {map_stats[0]} rows, {map_stats[1]} NDCs, "
          f"{map_stats[2]} through {map_stats[3]}")

    ch.command(MAP_META_SQL)
    meta_rows = ch.query("SELECT count() FROM margin_map_meta").first_row[0]
    print(f"margin_map_meta: {meta_rows} period/state rows")


if __name__ == "__main__":
    main()
