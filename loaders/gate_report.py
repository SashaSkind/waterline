"""Phase-1 gate report: do the seed NDCs resolve everywhere they must?

Checks, independently of how the seeds were selected:
  1. membership in the REPLICATED dim_drug (ClickHouse dim_drug_v, via CDC)
  2. membership in the latest NADAC file (data/raw/nadac_2026.csv)
  3. membership in the latest full SDUD file (data/raw/sdud_2025.csv)
"""

import duckdb
import pandas as pd

from lib import DATA_RAW, REPO_ROOT, ch_client

seeds = pd.read_csv(REPO_ROOT / "data" / "seed_summary.csv", dtype=str)
seeds["group"] = seeds["reason"].map(
    lambda r: "top50" if r == "top_sdud_spend" else "mfp_forced"
)

ch = ch_client()
in_dim = {
    r[0]
    for r in ch.query(
        "SELECT ndc11 FROM dim_drug_v WHERE ndc11 IN {s:Array(String)}",
        parameters={"s": list(seeds["ndc11"])},
    ).result_rows
}

con = duckdb.connect()
in_nadac = set(
    con.execute(
        f"SELECT DISTINCT lpad(NDC, 11, '0') FROM read_csv_auto('{DATA_RAW}/nadac_2026.csv', all_varchar=true)"
    ).df().iloc[:, 0]
)
in_sdud = set(
    con.execute(
        f"SELECT DISTINCT lpad(NDC, 11, '0') FROM read_csv_auto('{DATA_RAW}/sdud_2025.csv', all_varchar=true)"
    ).df().iloc[:, 0]
)

for group, g in seeds.groupby("group"):
    n = len(g)
    dim = g["ndc11"].isin(in_dim).sum()
    nad = g["ndc11"].isin(in_nadac).sum()
    sd = g["ndc11"].isin(in_sdud).sum()
    both = (g["ndc11"].isin(in_nadac) & g["ndc11"].isin(in_sdud)).sum()
    print(f"{group}: {n} seeds | dim_drug(CH replica): {dim}/{n} | NADAC: {nad}/{n} | SDUD: {sd}/{n} | both: {both}/{n}")
    missing = g[~g["ndc11"].isin(in_dim)]
    if not missing.empty:
        print("  NOT in dim_drug:", missing[["ndc11", "product_name"]].to_dict("records"))
