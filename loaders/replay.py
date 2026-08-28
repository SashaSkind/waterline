"""F5 live replay: stream historical NADAC week-over-week changes into
Postgres price_events at accelerated speed. CDC carries them to ClickHouse;
the app's alert feed and drug pages update from there.

Usage:
  uv run python replay.py                     # last 8 weeks, 5s per week
  uv run python replay.py --weeks 12 --interval 2
  uv run python replay.py --ndcs data/seed_ndcs.txt   # restrict, for demo focus

Rows come from the NADAC comparison file (old/new price and percent change
precomputed). Only NDCs that exist in dim_drug are sent, so every event can
resolve to a drug page.
"""

import argparse
import time

import duckdb

from lib import DATA_RAW, REPO_ROOT, normalize_ndc11, pg_conn


def fetch_events(weeks: int, ndc_file: str | None):
    con = duckdb.connect()
    df = con.execute(
        f"""
        WITH src AS (
          SELECT lpad(regexp_replace(trim(NDC), '[^0-9]', '', 'g'), 11, '0') AS ndc11,
                 strptime("Effective Date", '%m/%d/%Y')::DATE AS effective_date,
                 CAST("New NADAC Per Unit" AS DOUBLE) AS new_price,
                 CAST("Old NADAC Per Unit" AS DOUBLE) AS old_price,
                 CAST("Percent Change" AS DOUBLE) AS pct_change
          FROM read_csv_auto('{DATA_RAW}/nadac_comparison.csv', all_varchar=true)
          WHERE "New NADAC Per Unit" IS NOT NULL AND "Old NADAC Per Unit" IS NOT NULL
        ),
        latest AS (SELECT max(effective_date) AS max_d FROM src)
        SELECT s.* FROM src s, latest
        WHERE s.effective_date > latest.max_d - INTERVAL {weeks * 7} DAY
        ORDER BY s.effective_date, s.ndc11
        """
    ).df()
    if ndc_file:
        keep = {
            normalize_ndc11(line)
            for line in open(ndc_file)
            if line.strip()
        }
        df = df[df["ndc11"].isin(keep)]
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=8, help="how many recent weeks to replay")
    ap.add_argument("--interval", type=float, default=5.0, help="seconds per replayed week")
    ap.add_argument("--ndcs", default=None, help="optional file of NDCs to restrict to")
    ap.add_argument("--reset", action="store_true",
                    help="clear price_events before replaying (CDC propagates the delete)")
    args = ap.parse_args()

    df = fetch_events(args.weeks, args.ndcs)
    weeks = sorted(df["effective_date"].unique())
    print(f"replaying {len(df)} price events across {len(weeks)} weeks "
          f"({args.interval}s per week)")

    with pg_conn() as conn:
        if args.reset:
            n = conn.execute("DELETE FROM price_events").rowcount
            conn.commit()
            print(f"reset: deleted {n} existing price events")
        # dim_drug membership check once, so every event resolves in the app
        known = {
            r[0] for r in conn.execute("SELECT ndc11 FROM dim_drug").fetchall()
        }
        for wk in weeks:
            batch = df[df["effective_date"] == wk]
            rows = [
                (r.ndc11, r.effective_date.date(), r.new_price, r.old_price, r.pct_change)
                for r in batch.itertuples()
                if r.ndc11 in known
            ]
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO price_events (ndc11, effective_date, nadac_per_unit,"
                    " prev_per_unit, pct_change) VALUES (%s, %s, %s, %s, %s)",
                    rows,
                )
            conn.commit()
            print(f"  {wk.date() if hasattr(wk, 'date') else wk}: {len(rows)} events")
            time.sleep(args.interval)
    print("replay complete")


if __name__ == "__main__":
    main()
