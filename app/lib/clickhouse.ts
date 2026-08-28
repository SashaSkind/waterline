import {
  createClient,
  type ClickHouseClient,
  type ClickHouseSettings,
} from "@clickhouse/client";

// Analytical reads. All CDC-owned tables are read through their *_v dedupe
// views (dim_drug_v, watchlist_v, price_events_v) — never the raw copies.
let client: ClickHouseClient | undefined;

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_SOCKET",
]);

function isTransientNetworkError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== "object") return false;
    const candidate = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      typeof candidate.code === "string" &&
      TRANSIENT_NETWORK_CODES.has(candidate.code)
    ) {
      return true;
    }
    if (
      typeof candidate.message === "string" &&
      /timeout|socket (?:disconnected|hang up)|fetch failed/i.test(candidate.message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

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
      request_timeout: 15_000,
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
  clickhouse_settings: ClickHouseSettings = {},
): Promise<T[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rs = await ch().query({
        query,
        query_params,
        clickhouse_settings,
        format: "JSONEachRow",
      });
      return await rs.json<T>();
    } catch (error) {
      if (attempt > 0 || !isTransientNetworkError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("ClickHouse query retry exhausted");
}
