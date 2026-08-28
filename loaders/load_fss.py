"""Load VA Federal Supply Schedule pharmaceutical prices into ClickHouse fss_prices.

Source: data/raw/fss_prices.xlsx, sheet "Prices" (manifest section 6).
Prices are PER PACKAGE. fss_per_unit = fss_price / package_size where the
package size (count of dispensable units) is parseable from PackageDescription;
package_size=0 AND fss_per_unit=0 mean "unknown" (the app treats 0 as no-data
for benchmarks).

Rules applied (see report in __main__ output):
- PriceType pivot: FSS -> fss_price, Big4 -> big_four_price. NC (National
  Contract, 964 rows) is neither and is dropped.
- Multiple contracts / price periods per (ndc11, vendor): keep the lowest
  price of each type.
- Big4-only (ndc11, vendor) pairs are skipped (fss_price is non-nullable).
- Final grain is one row per ndc11 (ReplacingMergeTree ORDER BY ndc11):
  keep the vendor row with the lowest fss_price.
"""

from __future__ import annotations

import re
from decimal import Decimal

import pandas as pd

from lib import DATA_RAW, ch_client, dashed_to_ndc11

SEED_FILE = DATA_RAW.parent / "seed_ndcs.txt"

# Package size = count of dispensable units, e.g. "30" (tabs), "473ML",
# "60GM", "25X1ML" (25 x 1 mL vials = 25 mL), "10X10" (100 units),
# "100UD", "3X28", "10VIALS", "1 KIT", "10X1ML VI".
# Deliberately NOT matched: strength-like descriptions (500MG, 125MCG,
# 1000IU, 10MCI, "1X50MG/0.5ML") — no defensible unit count.
_PKG_RE = re.compile(
    r"^(\d+(?:\.\d+)?)"          # count (or count of sub-packages)
    r"(?:\s*X\s*(\d+(?:\.\d+)?))?"  # optional "X units-per-sub-package"
    r"\s*(?:ML|GM|G|EA|UD|TAB|CAP|CP|TB|PKT|KIT|VIALS?|VI)?"
    r"(?:\s+(?:VIALS?|VI))?$",
    re.IGNORECASE,
)


def parse_package_size(desc) -> Decimal:
    """Parse the dispensable-unit count from PackageDescription.

    Returns Decimal(0) when no defensible count can be parsed.
    """
    if desc is None:
        return Decimal(0)
    s = str(desc).strip().upper().replace(",", "")
    m = _PKG_RE.match(s)
    if not m:
        return Decimal(0)
    size = Decimal(m.group(1))
    if m.group(2):
        size *= Decimal(m.group(2))
    return size.quantize(Decimal("0.001"))


def build_rows(ndc_filter: set[str] | None = None) -> tuple[list[list], dict]:
    df = pd.read_excel(DATA_RAW / "fss_prices.xlsx", sheet_name="Prices")
    df["ndc11"] = df["NDCWithDashes"].map(dashed_to_ndc11)
    df = df[df["ndc11"].notna()]
    if ndc_filter is not None:
        df = df[df["ndc11"].isin(ndc_filter)]

    stats = {"nc_dropped": int((df["PriceType"] == "NC").sum())}
    df = df[df["PriceType"].isin(["FSS", "Big4"])].copy()

    # Pivot to one candidate row per (ndc11, vendor): lowest FSS price wins;
    # lowest Big4 price attached where present.
    fss = (
        df[df["PriceType"] == "FSS"]
        .sort_values("Price")
        .drop_duplicates(subset=["ndc11", "VendorName"], keep="first")
    )
    big4 = (
        df[df["PriceType"] == "Big4"]
        .sort_values("Price")
        .drop_duplicates(subset=["ndc11", "VendorName"], keep="first")
        [["ndc11", "VendorName", "Price"]]
        .rename(columns={"Price": "big4_price"})
    )
    stats["big4_only_pairs_skipped"] = len(
        big4.merge(fss[["ndc11", "VendorName"]], on=["ndc11", "VendorName"],
                   how="left", indicator=True)
        .query("_merge == 'left_only'")
    )
    merged = fss.merge(big4, on=["ndc11", "VendorName"], how="left")

    # Collapse to one row per ndc11: lowest fss_price (vendor as tiebreak).
    merged = (
        merged.sort_values(["Price", "VendorName"])
        .drop_duplicates(subset="ndc11", keep="first")
        .sort_values("ndc11")
    )

    rows: list[list] = []
    parsed = 0
    for r in merged.itertuples(index=False):
        pkg = parse_package_size(r.PackageDescription)
        fss_price = Decimal(str(r.Price)).quantize(Decimal("0.0001"))
        big4_price = (
            None if pd.isna(r.big4_price)
            else Decimal(str(r.big4_price)).quantize(Decimal("0.0001"))
        )
        if pkg > 0:
            parsed += 1
            per_unit = (fss_price / pkg).quantize(Decimal("0.00001"))
        else:
            per_unit = Decimal(0)  # 0 = unknown / no-data
        name = str(r.TradeName).strip() or str(r.Generic).strip()
        rows.append([r.ndc11, name, str(r.VendorName).strip(), pkg,
                     fss_price, big4_price, per_unit])

    stats["rows"] = len(rows)
    stats["package_parsed"] = parsed
    stats["with_big4"] = sum(1 for r in rows if r[5] is not None)
    return rows, stats


def load_fss(ndc_filter: set[str] | None = None) -> None:
    rows, stats = build_rows(ndc_filter)
    client = ch_client()
    if rows:
        client.insert(
            "fss_prices", rows,
            column_names=["ndc11", "product_name", "vendor", "package_size",
                          "fss_price", "big_four_price", "fss_per_unit"],
        )
    # ReplacingMergeTree: force the dedupe so re-runs stay idempotent.
    client.command("OPTIMIZE TABLE fss_prices FINAL")
    hit = stats["package_parsed"] / stats["rows"] if stats["rows"] else 0.0
    print(
        f"fss_prices: inserted {stats['rows']} rows "
        f"({stats['with_big4']} with Big4 price); "
        f"package_size parsed for {stats['package_parsed']}/{stats['rows']} "
        f"({hit:.1%}); dropped {stats['nc_dropped']} NC rows; "
        f"skipped {stats['big4_only_pairs_skipped']} Big4-only (ndc,vendor) pairs"
    )


if __name__ == "__main__":
    seeds = set(SEED_FILE.read_text().split())
    print(f"loading FSS prices filtered to {len(seeds)} seed NDCs")
    load_fss(seeds)

    client = ch_client()
    n = client.command("SELECT count() FROM fss_prices FINAL")
    print(f"fss_prices row count: {n}")
    samples = client.query(
        """
        SELECT * FROM (
            SELECT *, row_number() OVER
                (ORDER BY big_four_price IS NULL, ndc11) AS rn
            FROM fss_prices FINAL
        ) WHERE rn <= 3
        """
    )
    for row in samples.result_rows:
        (ndc11, name, vendor, pkg, fss, big4, per_unit, _rn) = row
        print(f"  {ndc11} | {name} | {vendor} | pkg={pkg} | "
              f"fss={fss} | big4={big4} | per_unit={per_unit}")
