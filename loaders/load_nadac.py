"""Load NADAC weekly prices into ClickHouse nadac_weekly.

Source: yearly NADAC CSVs from data.medicaid.gov (see data/raw/manifest.md §2).
Each file is a stack of weekly "As of Date" snapshots, so one (NDC, Effective
Date) pair recurs across many snapshots — and late-year effective dates recur
across the year boundary into the next year's file. We dedupe on the
ReplacingMergeTree key (ndc11, effective_date) across ALL input files, keeping
the row from the latest As of Date. Reruns are idempotent: identical keys
collapse in the ReplacingMergeTree.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pandas as pd

from lib import DATA_RAW, ch_client, normalize_ndc11

TABLE = "nadac_weekly"
BATCH_SIZE = 100_000

COLUMNS = [
    "ndc11", "effective_date", "nadac_per_unit", "pricing_unit",
    "classification", "otc", "explanation_code", "corresponding_generic_per_unit",
]

SOURCE_COLS = [
    "NDC", "NADAC Per Unit", "Effective Date", "Pricing Unit", "OTC",
    "Explanation Code", "Classification for Rate Setting",
    "Corresponding Generic Drug NADAC Per Unit", "As of Date",
]


def _read_one(path: Path, ndc_filter: set[str] | None) -> pd.DataFrame:
    df = pd.read_csv(
        path, usecols=SOURCE_COLS, dtype=str, keep_default_na=False,
    )
    df["ndc11"] = df["NDC"].map(normalize_ndc11)
    bad = int(df["ndc11"].isna().sum())
    if bad:
        print(f"{path.name}: dropping {bad} rows with unnormalizable NDC")
    df = df[df["ndc11"].notna()]
    if ndc_filter is not None:
        df = df[df["ndc11"].isin(ndc_filter)]
    return df


def load_nadac(files: list[Path], ndc_filter: set[str] | None = None) -> None:
    df = pd.concat(
        [_read_one(f, ndc_filter) for f in files], ignore_index=True
    )
    print(f"read {len(df)} snapshot rows from {len(files)} file(s)")

    # Keep the latest As-of snapshot's row per ReplacingMergeTree key.
    df["_as_of"] = pd.to_datetime(df["As of Date"], format="%m/%d/%Y")
    df = (
        df.sort_values("_as_of", kind="stable")
        .drop_duplicates(subset=["ndc11", "Effective Date"], keep="last")
    )
    print(f"{len(df)} rows after dedupe on (ndc11, effective_date)")

    otc = df["OTC"].map({"Y": 1, "N": 0})
    if otc.isna().any():
        raise ValueError(
            f"unexpected OTC values: {sorted(df.loc[otc.isna(), 'OTC'].unique())}"
        )

    def dec(v: str) -> Decimal | None:
        return Decimal(v) if v.strip() else None

    out = pd.DataFrame({
        "ndc11": df["ndc11"],
        "effective_date": pd.to_datetime(
            df["Effective Date"], format="%m/%d/%Y"
        ).dt.date,
        "nadac_per_unit": df["NADAC Per Unit"].map(dec),
        "pricing_unit": df["Pricing Unit"],
        "classification": df["Classification for Rate Setting"],
        "otc": otc.astype(int),
        "explanation_code": df["Explanation Code"],
        "corresponding_generic_per_unit": df[
            "Corresponding Generic Drug NADAC Per Unit"
        ].map(dec),
    })
    if out["nadac_per_unit"].isna().any():
        raise ValueError("empty NADAC Per Unit in source rows")

    client = ch_client()
    rows = list(out.itertuples(index=False, name=None))
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start:start + BATCH_SIZE]
        client.insert(TABLE, batch, column_names=COLUMNS)
        print(f"inserted {start + len(batch)}/{len(rows)}")


if __name__ == "__main__":
    seed_path = DATA_RAW.parent / "seed_ndcs.txt"
    seed = {
        n for line in seed_path.read_text().splitlines()
        if (n := normalize_ndc11(line))
    }
    print(f"seed set: {len(seed)} NDCs")

    load_nadac(
        [DATA_RAW / "nadac_2025.csv", DATA_RAW / "nadac_2026.csv"],
        ndc_filter=seed,
    )

    client = ch_client()
    total = client.query(f"SELECT count() FROM {TABLE} FINAL").result_rows[0][0]
    distinct = client.query(
        f"SELECT uniqExact(ndc11) FROM {TABLE} FINAL"
    ).result_rows[0][0]
    print(f"\nnadac_weekly: {total} rows, {distinct} distinct ndc11")
    sample = client.query(
        f"SELECT * FROM {TABLE} FINAL ORDER BY ndc11, effective_date LIMIT 3"
    )
    print(f"sample columns: {sample.column_names}")
    for row in sample.result_rows:
        print(row)
