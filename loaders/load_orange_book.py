"""Load FDA Orange Book first-generic-approval dates into ClickHouse orange_book.

One row per distinct application number (NDA and ANDA) in products.txt,
carrying the earliest ANDA approval date of its (Ingredient, DF;Route)
group — the date the first generic appeared, where the price collapses.
Applications whose group has no ANDA at all are skipped: no generic
exists, so the chart draws no marker.

The app joins dim_drug.application_number (NDA217806 / ANDA078123) to
this table, so application_number is built as Appl_Type (N→NDA, A→ANDA)
+ Appl_No zero-padded to 6 — verified against NDC Directory values.
"""

from datetime import date, datetime

import pandas as pd

from lib import DATA_RAW, REPO_ROOT, ch_client

PRIOR_1982 = "Approved Prior to Jan 1, 1982"
PREFIX = {"N": "NDA", "A": "ANDA"}


def parse_approval(raw: str) -> date:
    raw = raw.strip()
    if raw == PRIOR_1982:
        return date(1982, 1, 1)
    return datetime.strptime(raw, "%b %d, %Y").date()


def build_frame() -> pd.DataFrame:
    df = pd.read_csv(
        DATA_RAW / "orange_book" / "products.txt", sep="~", dtype=str,
        keep_default_na=False,
    )
    for col in ("Ingredient", "DF;Route", "Appl_Type", "Appl_No", "Approval_Date"):
        df[col] = df[col].str.strip()

    unknown = set(df["Appl_Type"]) - set(PREFIX)
    if unknown:
        raise ValueError(f"unexpected Appl_Type values: {unknown}")

    df["application_number"] = df["Appl_Type"].map(PREFIX) + df["Appl_No"].str.zfill(6)
    df["approval"] = df["Approval_Date"].map(parse_approval)

    # Earliest ANDA approval per (Ingredient, DF;Route) group.
    first_generic = (
        df[df["Appl_Type"] == "A"]
        .groupby(["Ingredient", "DF;Route"])["approval"]
        .min()
        .rename("first_generic_approval")
    )

    out = df.merge(first_generic, on=["Ingredient", "DF;Route"], how="inner")
    # One row per application: an application can span multiple
    # strengths/products (and occasionally DF;Route groups) — keep the
    # earliest group date, deterministically, so reloads are idempotent.
    out = (
        out.sort_values(["first_generic_approval", "Ingredient"])
        .drop_duplicates(subset="application_number", keep="first")
    )
    return out[["application_number", "Ingredient", "first_generic_approval"]].rename(
        columns={"Ingredient": "ingredient"}
    )


def load(df: pd.DataFrame) -> None:
    ch = ch_client()
    ch.command((REPO_ROOT / "clickhouse" / "tables" / "orange_book.sql").read_text())
    ch.insert(
        "orange_book",
        list(df.itertuples(index=False, name=None)),
        column_names=["application_number", "ingredient", "first_generic_approval"],
    )


def report() -> None:
    ch = ch_client()
    total = ch.query("SELECT count() FROM orange_book FINAL").result_rows[0][0]
    print(f"orange_book rows: {total}")
    samples = ch.query(
        "SELECT * FROM orange_book FINAL ORDER BY application_number LIMIT 3"
    ).result_rows
    for row in samples:
        print("  sample:", row)

    # Spot check: Eliquis (apixaban). Its application number comes from the
    # NDC Directory, the same source the app's dim_drug join uses.
    ndc = pd.read_csv(
        DATA_RAW / "ndc" / "product.txt", sep="\t", dtype=str,
        encoding="cp1252", keep_default_na=False,
    )
    eliquis = sorted(
        ndc.loc[
            ndc["PROPRIETARYNAME"].str.upper().eq("ELIQUIS"), "APPLICATIONNUMBER"
        ].unique()
    )
    print(f"Eliquis application number(s) in NDC directory: {eliquis}")
    rows = ch.query(
        "SELECT * FROM orange_book FINAL WHERE application_number IN %(a)s",
        parameters={"a": eliquis},
    ).result_rows
    print(f"Eliquis rows in orange_book: {rows}")
    for _, _, d in rows:
        plausible = date(2019, 10, 1) <= d <= date(2020, 3, 1)
        print(f"  first_generic_approval {d}: "
              f"{'plausible' if plausible else 'NOT plausible'} vs ~Dec 2019")


if __name__ == "__main__":
    frame = build_frame()
    print(f"prepared {len(frame)} application-level rows")
    load(frame)
    report()
