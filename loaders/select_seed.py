"""Select the seed NDCs for tier-1 loads.

Programmatic, per spec: top 50 NDCs by total Medicaid reimbursement in the
most recent SDUD quarter that also appear in the latest NADAC file, plus
every NDC matching the ten MFP drugs (so the 2026 marker has data under it).

Writes data/seed_ndcs.txt (one NDC-11 per line) and data/seed_summary.csv.
"""

import duckdb
import pandas as pd

from lib import DATA_RAW, REPO_ROOT, normalize_ndc11
from load_dim_drug import build_frame

OUT_LIST = REPO_ROOT / "data" / "seed_ndcs.txt"
OUT_SUMMARY = REPO_ROOT / "data" / "seed_summary.csv"


def top_sdud_in_nadac(n: int = 50) -> pd.DataFrame:
    con = duckdb.connect()
    df = con.execute(
        f"""
        WITH sdud AS (
          SELECT * FROM read_csv_auto('{DATA_RAW}/sdud_2025.csv', all_varchar=true)
        ),
        latest AS (
          SELECT Year, Quarter FROM sdud
          WHERE "Suppression Used" = 'false'
          GROUP BY 1, 2 ORDER BY Year DESC, Quarter DESC LIMIT 1
        ),
        spend AS (
          SELECT s.NDC AS ndc,
                 sum(CAST(s."Total Amount Reimbursed" AS DOUBLE)) AS total_reimbursed,
                 max(trim(s."Product Name")) AS product_name
          FROM sdud s JOIN latest l ON s.Year = l.Year AND s.Quarter = l.Quarter
          WHERE s.State <> 'XX'
            AND s."Suppression Used" = 'false'
            AND s."Total Amount Reimbursed" IS NOT NULL
            AND CAST(s."Units Reimbursed" AS DOUBLE) > 0
          GROUP BY 1
        ),
        nadac AS (
          SELECT DISTINCT NDC AS ndc
          FROM read_csv_auto('{DATA_RAW}/nadac_2026.csv', all_varchar=true)
        )
        SELECT spend.ndc, spend.product_name, spend.total_reimbursed
        FROM spend JOIN nadac ON lpad(spend.ndc, 11, '0') = lpad(nadac.ndc, 11, '0')
        ORDER BY spend.total_reimbursed DESC
        LIMIT {n}
        """
    ).df()
    df["ndc11"] = df["ndc"].map(normalize_ndc11)
    df["reason"] = "top_sdud_spend"
    return df[["ndc11", "product_name", "total_reimbursed", "reason"]]


def mfp_ndcs(crosswalk: pd.DataFrame, per_drug: int = 3) -> pd.DataFrame:
    """NDCs for the ten MFP drugs, matched by brand name against the
    crosswalk, kept only if they appear in NADAC (so charts have data)."""
    mfp = pd.read_csv(DATA_RAW / "mfp_2026.csv", dtype=str)
    nadac_ndcs = set(
        duckdb.connect().execute(
            f"SELECT DISTINCT lpad(NDC, 11, '0') FROM read_csv_auto('{DATA_RAW}/nadac_2026.csv', all_varchar=true)"
        ).df().iloc[:, 0]
    )
    cw = crosswalk.assign(
        brand_lc=crosswalk["brand_name"].str.lower(),
        ingr_lc=crosswalk["ingredient"].str.lower(),
    )
    rows = []
    for _, drug in mfp.iterrows():
        brands = [b.strip().lower() for b in drug["brand_name"].split("/")]
        generic = drug["generic_name"].strip().lower()
        hit = cw[
            cw["brand_lc"].isin(brands)
            | cw["ingr_lc"].str.contains(generic.split()[0], regex=False)
        ]
        hit = hit[hit["ndc11"].isin(nadac_ndcs)].head(per_drug)
        if hit.empty:
            print(f"  WARNING: no NADAC-covered NDC for MFP drug {drug['brand_name']}")
        for _, h in hit.iterrows():
            rows.append({
                "ndc11": h["ndc11"],
                "product_name": h["brand_name"],
                "total_reimbursed": None,
                "reason": f"mfp:{drug['brand_name']}",
            })
    return pd.DataFrame(rows)


def main() -> None:
    crosswalk = build_frame()
    top = top_sdud_in_nadac()
    mfp = mfp_ndcs(crosswalk)
    seeds = pd.concat([top, mfp]).drop_duplicates(subset="ndc11")

    # Gate: every seed must resolve through the crosswalk.
    known = set(crosswalk["ndc11"])
    unresolved = seeds[~seeds["ndc11"].isin(known)]
    if not unresolved.empty:
        print("UNRESOLVED SEEDS (not in dim_drug) — NDC normalization suspect:")
        print(unresolved.to_string())

    OUT_LIST.write_text("\n".join(seeds["ndc11"]) + "\n")
    seeds.to_csv(OUT_SUMMARY, index=False)
    print(f"{len(seeds)} seed NDCs ({len(top)} top-spend, {len(mfp)} MFP)")
    print(f"unresolved in crosswalk: {len(unresolved)}")


if __name__ == "__main__":
    main()
