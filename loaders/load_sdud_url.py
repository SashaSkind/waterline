"""Load missing SDUD years directly from official Medicaid CSV extracts.

The historical local extracts for 2020, 2021, and 2023 are truncated. This
loader has ClickHouse Cloud read the official data.medicaid.gov files through
the url() table function, avoiding a slow multi-gigabyte client upload.

Reruns are safe: sdud_quarterly is a ReplacingMergeTree keyed by
(ndc11, year, quarter, state, utilization_type), and every overlapping row
comes from the same canonical extract.
"""

from __future__ import annotations

import argparse
import time

from lib import ch_client


DATASET_IDS = {
    2020: "cc318bfb-a9b2-55f3-a924-d47376b32ea3",
    2021: "eec7fbe6-c4c4-5915-b3d0-be5828ef4e9d",
    2023: "d890d3a9-6b00-43fd-8b31-fcba4c8e2909",
    2026: "2957a7f9-9a15-453e-9afd-3bbdcbac8fd3",
}

# Medicaid's download endpoint advertises byte ranges but occasionally rejects
# ClickHouse's speculative parallel range reads. Sequential parsing is still
# server-to-server and is reliable for these yearly files.
URL_SETTINGS = {
    "input_format_parallel_parsing": 0,
    "max_download_threads": 1,
}

SOURCE_STRUCTURE = ", ".join(
    [
        "`Utilization Type` String",
        "State String",
        "NDC String",
        "`Labeler Code` String",
        "`Product Code` String",
        "`Package Size` String",
        "Year String",
        "Quarter String",
        "`Suppression Used` String",
        "`Product Name` String",
        "`Units Reimbursed` String",
        "`Number of Prescriptions` String",
        "`Total Amount Reimbursed` String",
        "`Medicaid Amount Reimbursed` String",
        "`Non Medicaid Amount Reimbursed` String",
    ]
)

SOURCE_SQL = """
FROM url({source_url: String}, CSVWithNames, {source_structure: String})
WHERE length(replaceRegexpAll(trim(NDC), '[^0-9]', '')) BETWEEN 1 AND 11
  AND toUInt16OrZero(Year) = {year: UInt16}
  AND toUInt8OrZero(Quarter) BETWEEN 1 AND 4
"""

CHECK_SQL = f"""
SELECT trim(NDC), upper(trim(State)), toUInt16OrZero(Year),
       toUInt8OrZero(Quarter), trim(`Utilization Type`)
{SOURCE_SQL}
LIMIT 1
"""

INSERT_SQL = f"""
INSERT INTO sdud_quarterly (
  ndc11, state, year, quarter, utilization_type,
  units_reimbursed, number_of_prescriptions,
  total_amount_reimbursed, medicaid_amount_reimbursed, suppression_used
)
SELECT
  leftPad(replaceRegexpAll(trim(NDC), '[^0-9]', ''), 11, '0') AS ndc11,
  upper(trim(State)) AS state,
  toUInt16OrZero(Year) AS year,
  toUInt8OrZero(Quarter) AS quarter,
  trim(`Utilization Type`) AS utilization_type,
  toDecimal64OrZero(trim(`Units Reimbursed`), 3) AS units_reimbursed,
  toUInt32(greatest(toInt64OrZero(trim(`Number of Prescriptions`)), 0))
    AS number_of_prescriptions,
  toDecimal64OrZero(trim(`Total Amount Reimbursed`), 2)
    AS total_amount_reimbursed,
  toDecimal64OrZero(trim(`Medicaid Amount Reimbursed`), 2)
    AS medicaid_amount_reimbursed,
  toUInt8(lower(trim(`Suppression Used`)) = 'true') AS suppression_used
{SOURCE_SQL}
"""


def source_url(year: int) -> str:
    dataset_id = DATASET_IDS[year]
    return (
        "https://data.medicaid.gov/api/1/datastore/query/"
        f"{dataset_id}/0/download?format=csv"
    )


def params(year: int) -> dict[str, str | int]:
    return {
        "source_url": source_url(year),
        "source_structure": SOURCE_STRUCTURE,
        "year": year,
    }


def check_source(year: int) -> None:
    ch = ch_client()
    row = ch.query(
        CHECK_SQL,
        parameters=params(year),
        settings={**URL_SETTINGS, "max_execution_time": 120},
    ).first_row
    if not row or row[2] != year:
        raise RuntimeError(f"official {year} extract did not return a valid row")
    print(f"{year} source OK: NDC {row[0]}, {row[1]}, Q{row[3]}, {row[4]}")


def load_year(year: int) -> None:
    ch = ch_client()
    before = ch.query(
        "SELECT count() FROM sdud_quarterly FINAL WHERE year = {year: UInt16}",
        parameters={"year": year},
    ).first_row[0]
    print(f"{year}: {before:,} rows before load")

    started = time.time()
    ch.command(
        INSERT_SQL,
        parameters=params(year),
        settings={**URL_SETTINGS, "max_execution_time": 1800},
    )

    after = ch.query(
        "SELECT count() FROM sdud_quarterly FINAL WHERE year = {year: UInt16}",
        parameters={"year": year},
        settings={"max_execution_time": 300},
    ).first_row[0]
    print(f"{year}: {after:,} rows after load ({time.time() - started:.0f}s)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "years",
        nargs="+",
        type=int,
        choices=sorted(DATASET_IDS),
        help="official SDUD years to load",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="validate each source without inserting rows",
    )
    args = parser.parse_args()

    for year in args.years:
        check_source(year)
        if not args.check_only:
            load_year(year)


if __name__ == "__main__":
    main()
