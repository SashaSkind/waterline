"""Load the FDA NDC Directory into Postgres dim_drug (the crosswalk).

dim_drug is CDC-owned downstream: written here in Postgres only, replicated
to ClickHouse by ClickPipes. Package-level grain: one row per NDC-11.
"""

import io

import pandas as pd

from lib import DATA_RAW, dashed_to_ndc11, pg_conn

COLS = [
    "ndc11", "ndc_product", "ingredient", "strength", "strength_unit",
    "dosage_form", "route", "brand_name", "labeler", "is_generic",
    "application_number", "start_marketing",
]


def build_frame() -> pd.DataFrame:
    product = pd.read_csv(
        DATA_RAW / "ndc" / "product.txt", sep="\t", dtype=str,
        encoding="cp1252", keep_default_na=False,
    )
    package = pd.read_csv(
        DATA_RAW / "ndc" / "package.txt", sep="\t", dtype=str,
        keep_default_na=False,
    )
    product = product[product["NDC_EXCLUDE_FLAG"] != "E"]
    package = package[package["NDC_EXCLUDE_FLAG"] != "E"]

    df = package[["PRODUCTID", "NDCPACKAGECODE"]].merge(product, on="PRODUCTID")
    df["ndc11"] = df["NDCPACKAGECODE"].map(dashed_to_ndc11)
    df = df[df["ndc11"].notna()].drop_duplicates(subset="ndc11")

    out = pd.DataFrame({
        "ndc11": df["ndc11"],
        "ndc_product": df["PRODUCTNDC"],
        "ingredient": df["NONPROPRIETARYNAME"],
        "strength": df["ACTIVE_NUMERATOR_STRENGTH"],
        "strength_unit": df["ACTIVE_INGRED_UNIT"],
        "dosage_form": df["DOSAGEFORMNAME"],
        "route": df["ROUTENAME"],
        "brand_name": df["PROPRIETARYNAME"],
        "labeler": df["LABELERNAME"],
        "is_generic": df["MARKETINGCATEGORYNAME"].str.upper().eq("ANDA"),
        "application_number": df["APPLICATIONNUMBER"],
        "start_marketing": pd.to_datetime(
            df["STARTMARKETINGDATE"], format="%Y%m%d", errors="coerce"
        ).dt.date,
    })
    return out


def load(df: pd.DataFrame) -> None:
    buf = io.StringIO()
    df.to_csv(buf, index=False, header=False, sep="\t", na_rep="\\N")
    buf.seek(0)
    with pg_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "CREATE TEMP TABLE dim_drug_stage (LIKE dim_drug INCLUDING DEFAULTS) ON COMMIT DROP"
        )
        with cur.copy(
            f"COPY dim_drug_stage ({', '.join(COLS)}) FROM STDIN WITH (FORMAT text, NULL '\\N')"
        ) as copy:
            copy.write(buf.read())
        cur.execute(f"""
            INSERT INTO dim_drug ({', '.join(COLS)})
            SELECT {', '.join(COLS)} FROM dim_drug_stage
            ON CONFLICT (ndc11) DO UPDATE SET
              {', '.join(f'{c} = EXCLUDED.{c}' for c in COLS if c != 'ndc11')},
              updated_at = now()
        """)
        n = conn.execute("SELECT count(*) FROM dim_drug").fetchone()[0]
    print(f"dim_drug rows: {n}")


if __name__ == "__main__":
    df = build_frame()
    print(f"prepared {len(df)} package-level rows")
    load(df)
