"""Shared helpers for all Waterline loaders.

Every NDC that enters any table MUST pass through normalize_ndc11() or
dashed_to_ndc11(). Inconsistent NDC formatting silently breaks every join.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_RAW = REPO_ROOT / "data" / "raw"

load_dotenv(REPO_ROOT / ".env")


def normalize_ndc11(raw: str | int | None) -> str | None:
    """Normalize an undashed NDC to the canonical 11-digit zero-padded string.

    Handles NADAC (bare integer, leading zeros stripped) and SDUD (already
    padded). Returns None for anything that can't be a valid NDC-11.
    """
    if raw is None:
        return None
    digits = "".join(c for c in str(raw).strip() if c.isdigit())
    if not digits or len(digits) > 11:
        return None
    return digits.zfill(11)


def dashed_to_ndc11(raw: str | None) -> str | None:
    """Convert a dashed FDA package code (4-4-2 / 5-3-2 / 5-4-1 / 5-4-2)
    to NDC-11 by zero-padding segments to 5-4-2."""
    if not raw:
        return None
    parts = str(raw).strip().split("-")
    if len(parts) != 3:
        return None
    labeler, product, package = parts
    if len(labeler) > 5 or len(product) > 4 or len(package) > 2:
        return None
    if not (labeler.isdigit() and product.isdigit() and package.isdigit()):
        return None
    return labeler.zfill(5) + product.zfill(4) + package.zfill(2)


def pg_conn():
    import psycopg

    return psycopg.connect(
        host=os.environ["PG_HOST"],
        port=int(os.environ.get("PG_PORT", "5432")),
        dbname=os.environ.get("PG_DATABASE", "postgres"),
        user=os.environ.get("PG_USER", "postgres"),
        password=os.environ["PG_PASSWORD"],
        sslmode="require",
    )


def ch_client():
    import clickhouse_connect

    return clickhouse_connect.get_client(
        host=os.environ["CLICKHOUSE_HOST"],
        port=int(os.environ.get("CLICKHOUSE_PORT", "8443")),
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ["CLICKHOUSE_PASSWORD"],
        secure=True,
        # Full-history rebuilds execute inside ClickHouse and can legitimately
        # outlive the driver's five-minute default response timeout.
        send_receive_timeout=900,
    )


if __name__ == "__main__":
    # Self-check: the NDC traps from each source, per data/raw/manifest.md.
    assert normalize_ndc11("2143380") == "00002143380"  # NADAC stripped int
    assert normalize_ndc11("00002143380") == "00002143380"  # SDUD padded
    assert normalize_ndc11(2143380) == "00002143380"
    assert normalize_ndc11("") is None
    assert normalize_ndc11(None) is None
    assert normalize_ndc11("123456789012") is None  # too long
    assert dashed_to_ndc11("0002-0152-01") == "00002015201"  # 4-4-2
    assert dashed_to_ndc11("42291-414-30") == "42291041430"  # 5-3-2
    assert dashed_to_ndc11("42291-0414-30") == "42291041430"  # 5-4-2
    assert dashed_to_ndc11("0002-0152") is None  # product code, not package
    assert dashed_to_ndc11(None) is None
    print("lib.py self-check OK")
