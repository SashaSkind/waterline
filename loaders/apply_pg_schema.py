"""Apply postgres/schema.sql to the managed Postgres service."""

from lib import REPO_ROOT, pg_conn


def main() -> None:
    sql = (REPO_ROOT / "postgres" / "schema.sql").read_text()
    with pg_conn() as conn:
        conn.execute(sql)
        tables = conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1"
        ).fetchall()
    print("tables:", [t[0] for t in tables])


if __name__ == "__main__":
    main()
