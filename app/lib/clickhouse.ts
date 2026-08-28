import { createClient, type ClickHouseClient } from "@clickhouse/client";

// Analytical reads. All CDC-owned tables are read through their *_v dedupe
// views (dim_drug_v, watchlist_v, price_events_v) — never the raw copies.
let client: ClickHouseClient | undefined;

export function ch(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: `https://${process.env.CLICKHOUSE_HOST}:${process.env.CLICKHOUSE_PORT ?? "8443"}`,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD,
      application: "waterline",
      // Drug pages fan several independent reads into a Mini service. Keep
      // the pool deliberately small so those reads queue instead of opening
      // a burst of TLS connections that the service/load balancer may reset.
      max_open_connections: 3,
      keep_alive: {
        eagerly_destroy_stale_sockets: true,
      },
      clickhouse_settings: {
        // 64-bit ints as JSON strings would complicate the UI; every query
        // casts aggregates to Float64/UInt32 instead, so this stays default.
      },
    });
  }
  return client;
}

export async function chRows<T>(
  query: string,
  query_params: Record<string, unknown> = {},
): Promise<T[]> {
  const rs = await ch().query({ query, query_params, format: "JSONEachRow" });
  return rs.json<T>();
}
