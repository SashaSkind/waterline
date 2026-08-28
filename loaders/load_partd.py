"""Load Medicare Part D Spending by Drug (CMS, wide 2020-2024) into ClickHouse.

Unpivots data/raw/partd_spending.csv — one row per (Brnd_Name, Gnrc_Name,
Mftr_Name) with per-year column blocks — into the long `partd_spending` fact
table: one row per (brand, generic, manufacturer, year).

This dataset has NO NDC; it joins downstream by (brand_name, generic_name).
ALL manufacturer rows are kept, including Mftr_Name = "Overall" — downstream
queries pick manufacturer = 'Overall' for drug-level numbers (Overall rows
aggregate across manufacturers, so summing all rows would double count).

Asterisk convention (per the CMS data dictionary / build spec): a trailing
"*" on Brnd_Name marks drugs whose average-spending-per-unit figure mixes
multiple routes of administration. In the file it appears as a bare trailing
"*" with no space (e.g. "Acetic Acid*"), only ever in Brnd_Name. We set
multi_route_flag = 1 for those rows and store the name with the asterisk
stripped. Outlier_Flag_YYYY is a different, per-year signal (it disagrees
with the asterisk in both directions) and is not loaded.

Year-rows where every measure is empty (drug not on the market that year)
are dropped. Empty numerics load as 0, except that a year-row with no
spending at all (empty avg + empty spending; ~237 benes-only cells) is
skipped entirely. Idempotent: ReplacingMergeTree ORDER BY (generic_name,
brand_name, manufacturer, year) collapses re-runs; the batch is deduped on
that key before insert and counts are read with FINAL.
"""

from __future__ import annotations

import csv
from decimal import Decimal

from lib import DATA_RAW, ch_client

SOURCE = DATA_RAW / "partd_spending.csv"
YEARS = range(2020, 2025)

TABLE = "partd_spending"
COLUMNS = [
    "brand_name", "generic_name", "manufacturer", "year",
    "total_spending", "total_dosage_units", "avg_spending_per_unit",
    "total_claims", "total_benes", "multi_route_flag",
]

DDL = """
CREATE TABLE IF NOT EXISTS partd_spending (
  brand_name String, generic_name String, manufacturer String, year UInt16,
  total_spending Decimal(20,2), total_dosage_units Decimal(20,3),
  avg_spending_per_unit Decimal(18,5), total_claims UInt64, total_benes UInt64,
  multi_route_flag UInt8
) ENGINE = ReplacingMergeTree ORDER BY (generic_name, brand_name, manufacturer, year)
"""


def _dec(cell: str) -> Decimal:
    """Empty numeric -> 0 (per build spec)."""
    cell = cell.strip()
    return Decimal(cell) if cell else Decimal(0)


def build_rows() -> list[tuple]:
    """Unpivot the wide CSV to long (brand, generic, manufacturer, year) rows."""
    out: dict[tuple, tuple] = {}  # keyed on ORDER BY key: dedupe before insert
    with open(SOURCE, newline="", encoding="utf-8-sig") as f:
        for rec in csv.DictReader(f):
            brand = rec["Brnd_Name"].strip()
            multi_route = 1 if brand.endswith("*") else 0
            brand = brand.rstrip("*").strip()
            generic = rec["Gnrc_Name"].strip()
            mftr = rec["Mftr_Name"].strip()

            for year in YEARS:
                spend = rec[f"Tot_Spndng_{year}"].strip()
                units = rec[f"Tot_Dsg_Unts_{year}"].strip()
                avg = rec[f"Avg_Spnd_Per_Dsg_Unt_Wghtd_{year}"].strip()
                clms = rec[f"Tot_Clms_{year}"].strip()
                benes = rec[f"Tot_Benes_{year}"].strip()

                if not any((spend, units, avg, clms, benes)):
                    continue  # drug didn't exist that year
                if not avg and not spend:
                    continue  # no spending at all (benes-only cell): skip

                key = (generic, brand, mftr, year)
                out[key] = (
                    brand, generic, mftr, year,
                    _dec(spend), _dec(units), _dec(avg),
                    int(_dec(clms)), int(_dec(benes)), multi_route,
                )
    return list(out.values())


def load() -> None:
    rows = build_rows()
    print(f"prepared {len(rows)} long rows from {SOURCE.name}")

    client = ch_client()
    client.command(DDL)
    client.insert(TABLE, rows, column_names=COLUMNS)

    total = client.command(f"SELECT count() FROM {TABLE} FINAL")
    distinct = client.command(
        f"SELECT uniqExact(brand_name, generic_name) FROM {TABLE} FINAL"
    )
    print(f"{TABLE} rows: {total}")
    print(f"distinct (brand, generic): {distinct}")

    sample = client.query(
        f"""
        SELECT brand_name, generic_name, manufacturer, year, total_spending,
               total_dosage_units, avg_spending_per_unit, total_claims,
               total_benes, multi_route_flag
        FROM {TABLE} FINAL
        WHERE manufacturer = 'Overall' AND year = 2024
        ORDER BY total_spending DESC
        LIMIT 3
        """
    )
    print("sample rows:")
    for row in sample.result_rows:
        print("  ", row)


if __name__ == "__main__":
    load()
