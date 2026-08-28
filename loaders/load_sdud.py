"""Load Medicaid State Drug Utilization Data (SDUD) into ClickHouse sdud_quarterly.

Reads the yearly CSV extracts (data/raw/sdud_*.csv, ~411 MB / ~5.3M rows each)
through duckdb — never pandas — dedupes on the ReplacingMergeTree key
(ndc11, year, quarter, state, utilization_type), and inserts in batches.

Grain: one row per (state, ndc11, quarter, utilization type). All states are
kept, including the XX national-total rows (queries exclude XX where needed).
Suppressed rows ("Suppression Used" = true) have blank numeric cells: they are
loaded as 0 with suppression_used = 1 — suppression_used, never a zero value,
is the signal that the cell was blanked.

Rerun is idempotent: identical rows collapse in the ReplacingMergeTree.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import duckdb

from lib import DATA_RAW, ch_client, normalize_ndc11

TABLE = "sdud_quarterly"
INSERT_COLS = [
    "ndc11", "state", "year", "quarter", "utilization_type",
    "units_reimbursed", "number_of_prescriptions",
    "total_amount_reimbursed", "medicaid_amount_reimbursed",
    "suppression_used",
]
# ClickHouse Cloud Mini can time out while sending this table's wide 100k-row
# Native blocks over HTTPS. 25k stays within the recommended 10k-100k range
# while keeping each request comfortably below the transport timeout.
BATCH_ROWS = 25_000
# Rows per batch whose SQL-normalized NDC is re-checked against normalize_ndc11().
NDC_ASSERT_SAMPLE = 1_000

# duckdb equivalent of lib.normalize_ndc11: strip, keep digits, zfill(11).
# Every batch asserts a sample of this against normalize_ndc11() itself.
NDC_DIGITS_SQL = """regexp_replace(trim("NDC"), '[^0-9]', '', 'g')"""


def _select_sql(files: list[Path], filtered: bool) -> str:
    paths = ", ".join("'" + str(f).replace("'", "''") + "'" for f in files)
    seed_clause = (
        "AND ndc11 IN (SELECT ndc11 FROM seed_filter)" if filtered else ""
    )
    # all_varchar: the sniffer must never see NDC as an integer, and blank
    # numeric cells (suppressed rows) must stay distinguishable from 0.
    return f"""
        WITH src AS (
            SELECT
                lpad({NDC_DIGITS_SQL}, 11, '0')                       AS ndc11,
                trim("NDC")                                           AS ndc_raw,
                trim("State")                                         AS state,
                TRY_CAST("Year" AS INTEGER)                           AS year,
                TRY_CAST("Quarter" AS INTEGER)                        AS quarter,
                trim("Utilization Type")                              AS utilization_type,
                COALESCE(TRY_CAST("Units Reimbursed" AS DECIMAL(18,3)), 0)
                                                                      AS units_reimbursed,
                GREATEST(COALESCE(TRY_CAST("Number of Prescriptions" AS BIGINT), 0), 0)
                                                                      AS number_of_prescriptions,
                COALESCE(TRY_CAST("Total Amount Reimbursed" AS DECIMAL(18,2)), 0)
                                                                      AS total_amount_reimbursed,
                COALESCE(TRY_CAST("Medicaid Amount Reimbursed" AS DECIMAL(18,2)), 0)
                                                                      AS medicaid_amount_reimbursed,
                CASE WHEN lower(trim("Suppression Used")) = 'true' THEN 1 ELSE 0 END
                                                                      AS suppression_used,
                CASE WHEN "Units Reimbursed" IS NULL OR trim("Units Reimbursed") = ''
                     THEN 1 ELSE 0 END                                AS units_blank
            FROM read_csv(
                [{paths}], header=true, all_varchar=true,
                strict_mode=false, null_padding=true
            )
            WHERE length({NDC_DIGITS_SQL}) BETWEEN 1 AND 11
              AND TRY_CAST("Year" AS INTEGER) IS NOT NULL
              AND TRY_CAST("Quarter" AS INTEGER) IS NOT NULL
        )
        SELECT ndc11, state, year, quarter, utilization_type,
               units_reimbursed, number_of_prescriptions,
               total_amount_reimbursed, medicaid_amount_reimbursed,
               suppression_used,
               ndc_raw, units_blank
        FROM src
        WHERE true {seed_clause}
        QUALIFY row_number() OVER (
            PARTITION BY ndc11, year, quarter, state, utilization_type
            ORDER BY suppression_used ASC, units_reimbursed DESC,
                     total_amount_reimbursed DESC
        ) = 1
    """


def load_sdud(files: list[Path], ndc_filter: set[str] | None = None) -> None:
    """Load SDUD CSVs into ClickHouse sdud_quarterly.

    Tier 1 passes the seed NDC set as ndc_filter; tier 2 passes None (all NDCs).
    """
    for f in files:
        if not f.exists():
            raise FileNotFoundError(f)

    con = duckdb.connect()
    if ndc_filter is not None:
        seeds = sorted({n for n in map(normalize_ndc11, ndc_filter) if n})
        con.execute("CREATE TEMP TABLE seed_filter (ndc11 VARCHAR)")
        con.executemany("INSERT INTO seed_filter VALUES (?)", [(n,) for n in seeds])
        print(f"filtering to {len(seeds)} seed NDCs")

    cur = con.execute(_select_sql(files, filtered=ndc_filter is not None))

    client = ch_client()
    t0 = time.time()
    inserted = 0
    blank_unsuppressed = 0
    while True:
        batch = cur.fetchmany(BATCH_ROWS)
        if not batch:
            break
        # Assert the SQL lpad normalization matches normalize_ndc11() on a
        # sample of real rows (row[-2] is the raw NDC, row[0] the SQL result).
        for row in batch[:NDC_ASSERT_SAMPLE]:
            expected = normalize_ndc11(row[-2])
            assert row[0] == expected, (
                f"SQL NDC normalization mismatch: raw={row[-2]!r} "
                f"sql={row[0]!r} normalize_ndc11={expected!r}"
            )
        blank_unsuppressed += sum(
            1 for row in batch if row[-1] == 1 and row[9] == 0
        )
        client.insert(TABLE, [row[:10] for row in batch], column_names=INSERT_COLS)
        inserted += len(batch)
        print(f"  inserted {inserted:,} rows ({time.time() - t0:.0f}s)")

    con.close()
    print(f"load_sdud done: {inserted:,} rows from {len(files)} file(s) "
          f"in {time.time() - t0:.0f}s")
    if blank_unsuppressed:
        print(f"  WARNING: {blank_unsuppressed:,} unsuppressed rows had blank "
              f"Units Reimbursed (loaded as 0, suppression_used=0)")


def report() -> None:
    """Print post-load sanity stats from ClickHouse (FINAL = post-replace state)."""
    client = ch_client()
    total = client.query(f"SELECT count() FROM {TABLE} FINAL").result_rows[0][0]
    ndcs = client.query(
        f"SELECT uniqExact(ndc11) FROM {TABLE} FINAL"
    ).result_rows[0][0]
    print(f"\ntotal rows: {total:,}")
    print(f"distinct ndc11: {ndcs}")

    print("\nrows per year/quarter:")
    for year, quarter, n in client.query(
        f"SELECT year, quarter, count() FROM {TABLE} FINAL "
        f"GROUP BY year, quarter ORDER BY year, quarter"
    ).result_rows:
        print(f"  {year} Q{quarter}: {n:,}")

    print("\nsample rows:")
    res = client.query(
        f"SELECT * FROM {TABLE} FINAL "
        f"WHERE state != 'XX' AND suppression_used = 0 LIMIT 3"
    )
    print(f"  ({', '.join(res.column_names)})")
    for row in res.result_rows:
        print(f"  {row}")


if __name__ == "__main__":
    seed_path = DATA_RAW.parent / "seed_ndcs.txt"
    seed_ndcs = {
        n for n in (
            normalize_ndc11(line) for line in seed_path.read_text().splitlines()
            if line.strip()
        ) if n
    }
    if not seed_ndcs:
        sys.exit(f"no seed NDCs found in {seed_path}")
    print(f"loaded {len(seed_ndcs)} seed NDCs from {seed_path}")

    load_sdud(
        [DATA_RAW / "sdud_2024.csv", DATA_RAW / "sdud_2025.csv"],
        ndc_filter=seed_ndcs,
    )
    report()
