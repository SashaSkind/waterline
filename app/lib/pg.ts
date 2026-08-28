import { Pool } from "pg";

// Operational writes (watchlist, price_events replay reads its own path).
// The managed Postgres uses a private CA; provide it via PG_CA_CERT in prod,
// otherwise fall back to encrypted-but-unverified (hackathon tradeoff).
let pool: Pool | undefined;

export function pg(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT ?? 5432),
      database: process.env.PG_DATABASE ?? "postgres",
      user: process.env.PG_USER ?? "postgres",
      password: process.env.PG_PASSWORD,
      ssl: process.env.PG_CA_CERT
        ? { ca: process.env.PG_CA_CERT }
        : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}
