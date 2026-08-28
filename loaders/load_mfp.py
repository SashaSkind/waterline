"""Load the ten IRA maximum fair prices into ClickHouse mfp_2026."""

from datetime import date

import pandas as pd

from lib import DATA_RAW, ch_client


def main() -> None:
    df = pd.read_csv(DATA_RAW / "mfp_2026.csv", dtype=str)
    rows = [
        (
            r["generic_name"].strip(),
            r["brand_name"].strip(),
            float(r["mfp_30day"]),
            r["unit_description"].strip(),
            date.fromisoformat(r["effective_date"]),
        )
        for _, r in df.iterrows()
    ]
    ch = ch_client()
    ch.insert(
        "mfp_2026",
        rows,
        column_names=["generic_name", "brand_name", "mfp", "unit_description", "effective_date"],
    )
    out = ch.query("SELECT brand_name, mfp FROM mfp_2026 FINAL ORDER BY mfp DESC").result_rows
    print(f"{len(out)} MFP rows:", out[:3], "...")


if __name__ == "__main__":
    main()
