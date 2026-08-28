"""Prove the CDC path: insert one row in Postgres, watch it land in ClickHouse.

Inserts a sentinel NDC into dim_drug, polls the replicated ClickHouse copy
until it appears, reports the latency, then removes the sentinel.
"""

import sys
import time

from lib import ch_client, pg_conn

SENTINEL = "99999999999"
TIMEOUT_S = 300


def main() -> None:
    ch = ch_client()
    with pg_conn() as pg:
        pg.execute(
            "INSERT INTO dim_drug (ndc11, brand_name, ingredient) "
            "VALUES (%s, 'ROUNDTRIP TEST', 'do not ship') "
            "ON CONFLICT (ndc11) DO UPDATE SET updated_at = now()",
            (SENTINEL,),
        )
    print("inserted sentinel into Postgres, polling ClickHouse...")
    t0 = time.time()
    while time.time() - t0 < TIMEOUT_S:
        try:
            n = ch.query(
                "SELECT count() FROM dim_drug WHERE ndc11 = {n:String}",
                parameters={"n": SENTINEL},
            ).result_rows[0][0]
        except Exception as e:  # table may not exist until snapshot finishes
            print(f"  ...{e.__class__.__name__} (table not ready?), waiting")
            n = 0
        if n:
            print(f"ROUND TRIP OK in {time.time() - t0:.1f}s")
            break
        time.sleep(3)
    else:
        print("TIMED OUT waiting for replication")
        sys.exit(1)

    with pg_conn() as pg:
        pg.execute("DELETE FROM dim_drug WHERE ndc11 = %s", (SENTINEL,))
    print("sentinel deleted from Postgres")


if __name__ == "__main__":
    main()
