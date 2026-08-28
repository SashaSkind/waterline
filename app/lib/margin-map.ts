import { chRows } from "./clickhouse";

export interface MarginMapPeriod {
  year: number;
  quarter: number;
  source_rows: number;
  ndcs: number;
}

export interface MarginMapView {
  lx0: number;
  lx1: number;
  ly0: number;
  ly1: number;
}

export interface MarginMapMetadata {
  periods: MarginMapPeriod[];
  states: string[];
  initial_view: MarginMapView;
}

export interface MarginMapBin {
  bx: number;
  by: number;
  n: number;
  n_underwater: number;
  source_rows: number;
  worst_ndc: string;
  worst_name: string;
  worst_margin: number;
}

export interface MarginMapPoint {
  ndc11: string;
  brand_name: string;
  ingredient: string;
  pricing_unit: string;
  is_generic: boolean;
  lx: number;
  ly: number;
  acq_per_unit: number;
  reimb_per_unit: number;
  margin_per_unit: number;
  rx_count: number;
  source_rows: number;
  total_points: number;
  total_source_rows: number;
}

export interface MarginMapQuery {
  year: number;
  quarter: number;
  state: string;
  view: MarginMapView;
  bins_x: number;
  bins_y: number;
}

const MAP_QUERY_SETTINGS = {
  max_execution_time: 8,
  timeout_before_checking_execution_speed: 0,
  max_rows_to_read: "50000000",
  max_result_rows: "5000",
} as const;

function paddedBounds(row: {
  lx_low: number;
  lx_high: number;
  ly_low: number;
  ly_high: number;
}): MarginMapView {
  const pad = 0.25;
  const lx0 = Math.max(-6, Math.floor((row.lx_low - pad) * 2) / 2);
  const lx1 = Math.min(7, Math.ceil((row.lx_high + pad) * 2) / 2);
  const ly0 = Math.max(-6, Math.floor((row.ly_low - pad) * 2) / 2);
  const ly1 = Math.min(7, Math.ceil((row.ly_high + pad) * 2) / 2);
  return {
    lx0,
    lx1: Math.max(lx0 + 1, lx1),
    ly0,
    ly1: Math.max(ly0 + 1, ly1),
  };
}

export async function getMarginMapMetadata(): Promise<MarginMapMetadata> {
  interface MetadataRow {
    kind: "period" | "state";
    year: number;
    quarter: number;
    state: string;
    source_rows: number;
    ndcs: number;
    lx_low: number;
    lx_high: number;
    ly_low: number;
    ly_high: number;
  }

  const rows = await chRows<MetadataRow>(
    `SELECT 'period' AS kind,
            toUInt16(m.year) AS year, toUInt8(m.quarter) AS quarter,
            '' AS state, toUInt32(source_rows) AS source_rows,
            toUInt32(ndcs) AS ndcs,
            toFloat64(lx_low) AS lx_low, toFloat64(lx_high) AS lx_high,
            toFloat64(ly_low) AS ly_low, toFloat64(ly_high) AS ly_high
     FROM margin_map_meta AS m
     WHERE m.state = ''

     UNION ALL

     SELECT 'state' AS kind, toUInt16(0) AS year, toUInt8(0) AS quarter,
            m.state AS state, toUInt32(0) AS source_rows, toUInt32(0) AS ndcs,
            toFloat64(0) AS lx_low, toFloat64(0) AS lx_high,
            toFloat64(0) AS ly_low, toFloat64(0) AS ly_high
     FROM margin_map_meta AS m
     WHERE m.state != ''
     GROUP BY m.state`,
    {},
    MAP_QUERY_SETTINGS,
  );

  const periodRows = rows
    .filter((row) => row.kind === "period")
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter);
  const latestBounds = periodRows.at(-1);
  const periods: MarginMapPeriod[] = periodRows.map((row) => ({
    year: row.year,
    quarter: row.quarter,
    source_rows: row.source_rows,
    ndcs: row.ndcs,
  }));

  return {
    periods,
    states: rows
      .filter((row) => row.kind === "state")
      .map((row) => row.state)
      .sort(),
    initial_view: latestBounds
      ? paddedBounds(latestBounds)
      : { lx0: -3, lx1: 4, ly0: -3, ly1: 4 },
  };
}

const NATIONAL_POINTS_CTE = `
WITH points AS (
  SELECT ndc11,
         any(brand_name) AS brand_name,
         any(ingredient) AS ingredient,
         any(pricing_unit) AS pricing_unit,
         any(is_generic) AS is_generic,
         toFloat64(any(acq_per_unit)) AS acq_per_unit,
         toFloat64(sum(total_reimb) / sum(units)) AS reimb_per_unit,
         reimb_per_unit - acq_per_unit AS margin_per_unit,
         toUInt64(sum(rx_count)) AS rx_count,
         toUInt64(count()) AS source_rows
  FROM margin_map
  PREWHERE year = {year: UInt16}
    AND quarter = {quarter: UInt8}
  GROUP BY ndc11
  HAVING acq_per_unit > 0 AND reimb_per_unit > 0
),
visible AS (
  SELECT *, log10(acq_per_unit) AS lx, log10(reimb_per_unit) AS ly
  FROM points
  WHERE lx >= {lx0: Float64} AND lx < {lx1: Float64}
    AND ly >= {ly0: Float64} AND ly < {ly1: Float64}
)
`;

const STATE_POINTS_CTE = `
WITH points AS (
  SELECT ndc11, brand_name, ingredient, pricing_unit, is_generic,
         toFloat64(acq_per_unit) AS acq_per_unit,
         toFloat64(reimb_per_unit) AS reimb_per_unit,
         toFloat64(margin_per_unit) AS margin_per_unit,
         toUInt64(rx_count) AS rx_count,
         toUInt64(1) AS source_rows
  FROM margin_map
  PREWHERE year = {year: UInt16}
    AND quarter = {quarter: UInt8}
    AND state = {state: String}
  WHERE acq_per_unit > 0 AND reimb_per_unit > 0
),
visible AS (
  SELECT *, log10(acq_per_unit) AS lx, log10(reimb_per_unit) AS ly
  FROM points
  WHERE lx >= {lx0: Float64} AND lx < {lx1: Float64}
    AND ly >= {ly0: Float64} AND ly < {ly1: Float64}
)
`;

function pointsCte(state: string): string {
  return state === "" ? NATIONAL_POINTS_CTE : STATE_POINTS_CTE;
}

function queryParams(query: MarginMapQuery) {
  return {
    year: query.year,
    quarter: query.quarter,
    state: query.state,
    lx0: query.view.lx0,
    lx1: query.view.lx1,
    ly0: query.view.ly0,
    ly1: query.view.ly1,
  };
}

export async function getMarginMapBins(
  query: MarginMapQuery,
): Promise<MarginMapBin[]> {
  const stepX = (query.view.lx1 - query.view.lx0) / query.bins_x;
  const stepY = (query.view.ly1 - query.view.ly0) / query.bins_y;
  const limit = Math.min(5000, query.bins_x * query.bins_y);

  return chRows<MarginMapBin>(
    `${pointsCte(query.state)}
     SELECT {lx0: Float64} + (ix + 0.5) * {step_x: Float64} AS bx,
            {ly0: Float64} + (iy + 0.5) * {step_y: Float64} AS by,
            toUInt32(count()) AS n,
            toUInt32(countIf(margin_per_unit < 0)) AS n_underwater,
            toUInt32(sum(source_rows)) AS source_rows,
            argMin(ndc11, (margin_per_unit, ndc11)) AS worst_ndc,
            argMin(brand_name, (margin_per_unit, ndc11)) AS worst_name,
            toFloat64(min(margin_per_unit)) AS worst_margin
     FROM (
       SELECT *,
              floor((lx - {lx0: Float64}) / {step_x: Float64}) AS ix,
              floor((ly - {ly0: Float64}) / {step_y: Float64}) AS iy
       FROM visible
     )
     GROUP BY ix, iy
     ORDER BY n DESC
     LIMIT {limit: UInt32}`,
    {
      ...queryParams(query),
      step_x: stepX,
      step_y: stepY,
      limit,
    },
    MAP_QUERY_SETTINGS,
  );
}

export async function getMarginMapPoints(
  query: MarginMapQuery,
  limit = 1501,
): Promise<MarginMapPoint[]> {
  return chRows<MarginMapPoint>(
    `${pointsCte(query.state)}
     SELECT ndc11, brand_name, ingredient, pricing_unit, is_generic,
            toFloat64(lx) AS lx, toFloat64(ly) AS ly,
            acq_per_unit, reimb_per_unit, margin_per_unit,
            toUInt32(rx_count) AS rx_count,
            toUInt32(source_rows) AS source_rows,
            toUInt32(count() OVER ()) AS total_points,
            toUInt32(sum(source_rows) OVER ()) AS total_source_rows
     FROM visible
     ORDER BY abs(margin_per_unit) DESC
     LIMIT {limit: UInt32}`,
    { ...queryParams(query), limit },
    MAP_QUERY_SETTINGS,
  );
}
