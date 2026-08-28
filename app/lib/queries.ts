import { chRows } from "./clickhouse";

// ---------- types ----------

export interface DrugRow {
  ndc11: string;
  brand_name: string;
  ingredient: string;
  strength: string;
  strength_unit: string;
  dosage_form: string;
  route: string;
  labeler: string;
  is_generic: boolean;
  application_number: string;
}

export interface SearchHit extends DrugRow {
  has_margin: number; // 1 if the drug appears in margin_mv
}

export interface Acquisition {
  nadac_per_unit: number;
  pricing_unit: string;
  effective_date: string;
  classification: string;
  source: "nadac" | "price_event";
}

export interface MarginSummary {
  year: number;
  quarter: number;
  acq_per_unit: number;
  reimb_per_unit: number;
  margin_per_unit: number;
  margin_pct: number;
  units_per_rx: number;
  margin_per_fill: number;
  rx_count: number;
  state_count: number;
}

export interface PartDBenchmark {
  brand_name: string;
  generic_name: string;
  year: number;
  avg_spending_per_unit: number;
}

export interface FssBenchmark {
  fss_per_unit: number;
  big_four_price: number | null;
  package_size: number;
  vendor: string;
}

export interface MfpBadge {
  brand_name: string;
  generic_name: string;
  mfp: number;
  unit_description: string;
  effective_date: string;
}

export interface AcquisitionHistoryPoint {
  date: string;
  acq_per_unit: number;
}

export interface ReimbursementHistoryPoint {
  date: string;
  year: number;
  quarter: number;
  reimb_per_unit: number;
}

export interface PriceHistory {
  acquisition: AcquisitionHistoryPoint[];
  reimbursement: ReimbursementHistoryPoint[];
  first_generic_approval: string | null;
}

export interface StateComparisonRow {
  state: string;
  acq_per_unit: number;
  reimb_per_unit: number;
  margin_per_unit: number;
  rx_count: number;
}

export interface SuppressedState {
  state: string;
  visible_cells: number;
  suppressed_cells: number;
}

export interface StateComparison {
  year: number;
  quarter: number;
  states: StateComparisonRow[];
  suppressed_states: SuppressedState[];
}

export interface TopTenRow {
  ndc11: string;
  brand_name: string;
  ingredient: string;
  is_generic: boolean;
  year: number;
  quarter: number;
  pricing_unit: string;
  acq_per_unit: number;
  reimb_per_unit: number;
  margin_per_unit: number;
  margin_pct: number;
  rx_count: number;
}

// ---------- helpers ----------

/** 11-digit zero-padded NDC or null. Mirrors loaders/lib.normalize_ndc11. */
export function normalizeNdc(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits || digits.length > 11) return null;
  return digits.padStart(11, "0");
}

const looksLikeNdc = (q: string) => /^[\d\s-]{8,}$/.test(q.trim());

// Name normalization used for the fuzzy Part D / MFP joins: lowercase,
// strip everything but letters and digits. A miss is "no data", never an error.
const NORM = (col: string) => `replaceRegexpAll(lower(${col}), '[^a-z0-9]', '')`;

// ---------- F1: search ----------

export async function searchDrugs(q: string): Promise<SearchHit[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  if (looksLikeNdc(trimmed)) {
    const ndc11 = normalizeNdc(trimmed);
    if (!ndc11) return [];
    return chRows<SearchHit>(
      `SELECT d.ndc11, d.brand_name, d.ingredient, d.strength, d.strength_unit,
              d.dosage_form, d.route, d.labeler, d.is_generic, d.application_number,
              if(m.ndc11 != '', 1, 0) AS has_margin
       FROM dim_drug_v d
       LEFT JOIN (SELECT DISTINCT ndc11 FROM margin_mv) m ON m.ndc11 = d.ndc11
       WHERE d.ndc11 = {ndc11: String}`,
      { ndc11 },
    );
  }
  return chRows<SearchHit>(
    `SELECT d.ndc11, d.brand_name, d.ingredient, d.strength, d.strength_unit,
            d.dosage_form, d.route, d.labeler, d.is_generic, d.application_number,
            if(m.total_reimb > 0, 1, 0) AS has_margin
     FROM dim_drug_v d
     LEFT JOIN (
       SELECT ndc11, toFloat64(sum(total_reimb)) AS total_reimb
       FROM margin_mv GROUP BY ndc11
     ) m ON m.ndc11 = d.ndc11
     WHERE positionCaseInsensitive(d.brand_name, {q: String}) > 0
        OR positionCaseInsensitive(d.ingredient, {q: String}) > 0
     ORDER BY has_margin DESC, m.total_reimb DESC, d.brand_name, d.ndc11
     LIMIT 20`,
    { q: trimmed },
  );
}

// ---------- F2: drug page ----------

export async function getDrug(ndc11: string): Promise<DrugRow | null> {
  const rows = await chRows<DrugRow>(
    `SELECT ndc11, brand_name, ingredient, strength, strength_unit,
            dosage_form, route, labeler, is_generic, application_number
     FROM dim_drug_v WHERE ndc11 = {ndc11: String}`,
    { ndc11 },
  );
  return rows[0] ?? null;
}

/** Latest acquisition cost: newest of the NADAC file price and any live
 * price_event that CDC has delivered (the replay path). */
export async function getAcquisition(ndc11: string): Promise<Acquisition | null> {
  const rows = await chRows<Acquisition>(
    `SELECT toFloat64(nadac_per_unit) AS nadac_per_unit, pricing_unit,
            toString(effective_date) AS effective_date, classification, source
     FROM (
       SELECT nadac_per_unit, pricing_unit, effective_date, classification, 'nadac' AS source
       FROM nadac_weekly FINAL WHERE ndc11 = {ndc11: String}
       UNION ALL
       SELECT toDecimal64(nadac_per_unit, 5) AS nadac_per_unit,
              '' AS pricing_unit, effective_date, '' AS classification, 'price_event' AS source
       FROM price_events_v WHERE ndc11 = {ndc11: String}
     )
     ORDER BY effective_date DESC, source DESC LIMIT 1`,
    { ndc11 },
  );
  const hit = rows[0] ?? null;
  if (hit && hit.source === "price_event") {
    // Unit metadata rides on the NADAC row; graft it for display.
    const meta = await chRows<{ pricing_unit: string; classification: string }>(
      `SELECT pricing_unit, classification FROM nadac_weekly FINAL
       WHERE ndc11 = {ndc11: String} ORDER BY effective_date DESC LIMIT 1`,
      { ndc11 },
    );
    if (meta[0]) {
      hit.pricing_unit = meta[0].pricing_unit;
      hit.classification = meta[0].classification;
    }
  }
  return hit;
}

/** National margin for the most recent quarter with data for this NDC. */
export async function getMarginSummary(ndc11: string): Promise<MarginSummary | null> {
  const rows = await chRows<MarginSummary>(
    `SELECT year, quarter,
            acq_per_unit,
            sum_reimb / sum_units AS reimb_per_unit,
            reimb_per_unit - acq_per_unit AS margin_per_unit,
            margin_per_unit / acq_per_unit * 100 AS margin_pct,
            sum_units / sum_rx AS units_per_rx,
            margin_per_unit * units_per_rx AS margin_per_fill,
            toUInt32(sum_rx) AS rx_count,
            state_count
     FROM (
       SELECT year, quarter,
              toFloat64(any(acq_per_unit)) AS acq_per_unit,
              toFloat64(sum(total_reimb)) AS sum_reimb,
              toFloat64(sum(units)) AS sum_units,
              toFloat64(sum(rx_count)) AS sum_rx,
              toUInt32(uniqExact(state)) AS state_count
       FROM margin_mv WHERE ndc11 = {ndc11: String}
       GROUP BY year, quarter
       ORDER BY year DESC, quarter DESC LIMIT 1
     )`,
    { ndc11 },
  );
  return rows[0] ?? null;
}

export async function getPartD(ndc11: string): Promise<PartDBenchmark | null> {
  // No NDC in the CMS data: fuzzy name join, generic name first, then brand.
  const rows = await chRows<PartDBenchmark>(
    `WITH (SELECT ${NORM("ingredient")} FROM dim_drug_v WHERE ndc11 = {ndc11: String}) AS ing,
          (SELECT ${NORM("brand_name")} FROM dim_drug_v WHERE ndc11 = {ndc11: String}) AS brand
     SELECT brand_name, generic_name, year,
            toFloat64(avg_spending_per_unit) AS avg_spending_per_unit
     FROM partd_spending FINAL
     WHERE manufacturer = 'Overall' AND multi_route_flag = 0
       AND (${NORM("generic_name")} = ing OR ${NORM("brand_name")} = brand)
     ORDER BY ${NORM("generic_name")} = ing DESC, year DESC
     LIMIT 1`,
    { ndc11 },
  );
  return rows[0] ?? null;
}

export async function getFss(ndc11: string): Promise<FssBenchmark | null> {
  const rows = await chRows<FssBenchmark>(
    `SELECT toFloat64(fss_per_unit) AS fss_per_unit,
            toFloat64OrNull(toString(big_four_price)) AS big_four_price,
            toFloat64(package_size) AS package_size, vendor
     FROM fss_prices FINAL WHERE ndc11 = {ndc11: String} LIMIT 1`,
    { ndc11 },
  );
  const hit = rows[0] ?? null;
  // fss_per_unit = 0 is the loader's "package size unparseable" sentinel.
  return hit && hit.fss_per_unit > 0 ? hit : null;
}

export async function getMfp(ndc11: string): Promise<MfpBadge | null> {
  const rows = await chRows<MfpBadge>(
    `WITH (SELECT ${NORM("ingredient")} FROM dim_drug_v WHERE ndc11 = {ndc11: String}) AS ing,
          (SELECT ${NORM("brand_name")} FROM dim_drug_v WHERE ndc11 = {ndc11: String}) AS brand
     SELECT brand_name, generic_name, toFloat64(mfp) AS mfp,
            unit_description, toString(effective_date) AS effective_date
     FROM mfp_2026 FINAL
     WHERE arrayExists(b -> ${NORM("b")} = brand, splitByString('; ', brand_name))
        OR position(ing, ${NORM("generic_name")}) > 0
        OR position(${NORM("generic_name")}, ing) > 0
     LIMIT 1`,
    { ndc11 },
  );
  return rows[0] ?? null;
}

// ---------- F6: history chart ----------

/** Three years of acquisition history, quarterly national reimbursement,
 * and the first generic approval marker. The chart is assembled in the
 * client because Recharts needs a browser-sized rendering boundary. */
export async function getPriceHistory(ndc11: string): Promise<PriceHistory> {
  const [acquisition, reimbursement, genericApproval] = await Promise.all([
    chRows<AcquisitionHistoryPoint>(
      `WITH (
         SELECT max(effective_date) - INTERVAL 3 YEAR
         FROM nadac_weekly FINAL
         WHERE ndc11 = {ndc11: String}
       ) AS since
       SELECT toString(effective_date) AS date,
              toFloat64(nadac_per_unit) AS acq_per_unit
       FROM nadac_weekly FINAL
       WHERE ndc11 = {ndc11: String} AND effective_date >= since
       ORDER BY effective_date`,
      { ndc11 },
    ),
    chRows<ReimbursementHistoryPoint>(
      `SELECT toString(toDate(concat(
                toString(year), '-',
                lpad(toString(quarter * 3 - 1), 2, '0'), '-15'
              ))) AS date,
              year, quarter,
              toFloat64(sum(total_reimb) / sum(units)) AS reimb_per_unit
       FROM margin_mv
       WHERE ndc11 = {ndc11: String}
       GROUP BY year, quarter
       ORDER BY year, quarter`,
      { ndc11 },
    ),
    chRows<{ first_generic_approval: string }>(
      `SELECT toString(o.first_generic_approval) AS first_generic_approval
       FROM dim_drug_v d
       INNER JOIN (
         SELECT application_number, first_generic_approval
         FROM orange_book FINAL
       ) o
         ON o.application_number = d.application_number
       WHERE d.ndc11 = {ndc11: String}
       ORDER BY o.first_generic_approval
       LIMIT 1`,
      { ndc11 },
    ),
  ]);

  return {
    acquisition,
    reimbursement,
    first_generic_approval:
      genericApproval[0]?.first_generic_approval ?? null,
  };
}

// ---------- F7: state comparison ----------

/** State reimbursement for the latest available quarter. Suppressed SDUD
 * cells are reported separately because they are intentionally absent from
 * margin_mv and must never be rendered as zero. */
export async function getStateComparison(
  ndc11: string,
): Promise<StateComparison | null> {
  const rows = await chRows<StateComparisonRow & { year: number; quarter: number }>(
    `WITH latest AS (
       SELECT year, quarter
       FROM margin_mv
       WHERE ndc11 = {ndc11: String}
       ORDER BY year DESC, quarter DESC
       LIMIT 1
     )
     SELECT m.state AS state,
            toUInt16(m.year) AS year,
            toUInt8(m.quarter) AS quarter,
            toFloat64(m.acq_per_unit) AS acq_per_unit,
            toFloat64(m.reimb_per_unit) AS reimb_per_unit,
            toFloat64(m.margin_per_unit) AS margin_per_unit,
            toUInt32(m.rx_count) AS rx_count
     FROM margin_mv m
     INNER JOIN latest l ON m.year = l.year AND m.quarter = l.quarter
     WHERE m.ndc11 = {ndc11: String}
     ORDER BY reimb_per_unit ASC, state ASC`,
    { ndc11 },
  );
  if (!rows[0]) return null;

  const year = rows[0].year;
  const quarter = rows[0].quarter;
  const suppressedStates = await chRows<SuppressedState>(
    `SELECT state,
            toUInt32(countIf(suppression_used = 0 AND units_reimbursed > 0))
              AS visible_cells,
            toUInt32(countIf(suppression_used = 1)) AS suppressed_cells
     FROM sdud_quarterly FINAL
     WHERE ndc11 = {ndc11: String}
       AND year = {year: UInt16}
       AND quarter = {quarter: UInt8}
       AND state != 'XX'
     GROUP BY state
     HAVING suppressed_cells > 0
     ORDER BY state`,
    { ndc11, year, quarter },
  );

  return {
    year,
    quarter,
    states: rows.map(({ state, acq_per_unit, reimb_per_unit, margin_per_unit, rx_count }) => ({
      state,
      acq_per_unit,
      reimb_per_unit,
      margin_per_unit,
      rx_count,
    })),
    suppressed_states: suppressedStates,
  };
}

// ---------- F4: watchlist + alerts (all read from CDC-replicated tables) ----------

export interface WatchRow {
  watch_id: number;
  ndc11: string;
  threshold_pct: number;
  brand_name: string;
  ingredient: string;
  acq_per_unit: number | null;
  acq_date: string | null;
  reimb_per_unit: number | null;
  margin_per_unit: number | null;
}

export interface AlertRow {
  event_id: number;
  ndc11: string;
  brand_name: string;
  ingredient: string;
  effective_date: string;
  new_price: number;
  prev_price: number;
  pct_change: number;
  threshold_pct: number;
  flipped_negative: number;
  ingested_at: string;
}

export async function getWatchlist(): Promise<WatchRow[]> {
  return chRows<WatchRow>(
    `WITH watched AS (SELECT ndc11 FROM watchlist_v),
     acq AS (
       SELECT ndc11, argMax(price, effective_date) AS acq_per_unit,
              toString(max(effective_date)) AS acq_date
       FROM (
         SELECT ndc11, toFloat64(nadac_per_unit) AS price, effective_date
         FROM nadac_weekly FINAL WHERE ndc11 IN watched
         UNION ALL
         SELECT ndc11, toFloat64(nadac_per_unit), effective_date
         FROM price_events_v WHERE ndc11 IN watched
       ) GROUP BY ndc11
     ),
     reimb AS (
       SELECT ndc11, argMax(r, yq) AS reimb_per_unit
       FROM (
         SELECT ndc11, year * 10 + quarter AS yq,
                toFloat64(sum(total_reimb) / sum(units)) AS r
         FROM margin_mv WHERE ndc11 IN watched GROUP BY ndc11, year, quarter
       ) GROUP BY ndc11
     )
     SELECT toUInt32(w.watch_id) AS watch_id, w.ndc11 AS ndc11,
            toFloat64(w.threshold_pct) AS threshold_pct,
            d.brand_name, d.ingredient,
            a.acq_per_unit AS acq_per_unit, a.acq_date AS acq_date,
            r.reimb_per_unit AS reimb_per_unit,
            r.reimb_per_unit - a.acq_per_unit AS margin_per_unit
     FROM watchlist_v w
     INNER JOIN dim_drug_v d ON d.ndc11 = w.ndc11
     LEFT JOIN acq a ON a.ndc11 = w.ndc11
     LEFT JOIN reimb r ON r.ndc11 = w.ndc11
     ORDER BY w.added_at DESC`,
    {},
  );
}

export async function getAlerts(limit = 50): Promise<AlertRow[]> {
  return chRows<AlertRow>(
    `WITH reimb AS (
       SELECT ndc11, argMax(r, yq) AS reimb_per_unit
       FROM (
         SELECT ndc11, year * 10 + quarter AS yq,
                toFloat64(sum(total_reimb) / sum(units)) AS r
         FROM margin_mv WHERE ndc11 IN (SELECT ndc11 FROM watchlist_v)
         GROUP BY ndc11, year, quarter
       ) GROUP BY ndc11
     )
     SELECT toUInt32(e.event_id) AS event_id, e.ndc11 AS ndc11,
            d.brand_name, d.ingredient,
            toString(e.effective_date) AS effective_date,
            toFloat64(e.nadac_per_unit) AS new_price,
            toFloat64(e.prev_per_unit) AS prev_price,
            toFloat64(e.pct_change) AS pct_change,
            toFloat64(w.threshold_pct) AS threshold_pct,
            if(r.reimb_per_unit - toFloat64(e.nadac_per_unit) < 0
               AND r.reimb_per_unit - toFloat64(e.prev_per_unit) >= 0, 1, 0) AS flipped_negative,
            toString(e.ingested_at) AS ingested_at
     FROM (
       -- A re-run of the replay INSERTs the same (ndc11, effective_date)
       -- change under a fresh event_id; keep only the newest so the feed
       -- never shows one price change twice.
       SELECT * FROM price_events_v
       ORDER BY event_id DESC
       LIMIT 1 BY ndc11, effective_date
     ) e
     INNER JOIN watchlist_v w ON w.ndc11 = e.ndc11
        AND abs(toFloat64(e.pct_change)) >= toFloat64(w.threshold_pct)
     INNER JOIN dim_drug_v d ON d.ndc11 = e.ndc11
     LEFT JOIN reimb r ON r.ndc11 = e.ndc11
     ORDER BY e.ingested_at DESC
     LIMIT {limit: UInt32}`,
    { limit },
  );
}

// ---------- cohort stats panel ----------

export interface CohortStats {
  year: number;
  quarter: number;
  all_ndcs: number;
  all_pct: number;
  top50_pct: number;
  highvol_ndcs: number;
  highvol_pct: number;
  brand_ndcs: number;
  brand_pct: number;
  generic_ndcs: number;
  generic_pct: number;
  brand_spend_underwater_pct: number;
  dollars_below_acq: number;
}

/** Share of NDCs underwater in the latest quarter, per cohort, plus the
 * quarter's total dollars reimbursed below acquisition cost. */
export async function getCohortStats(): Promise<CohortStats | null> {
  const rows = await chRows<CohortStats>(
    `WITH qs AS (
       -- Two most recent quarters with completeness signals. The newest
       -- quarter is shown only if it matches the prior one's state coverage
       -- and reaches 95% of its fill volume; a still-filing quarter is
       -- biased by whichever states/claims arrived first.
       SELECT year AS y, quarter AS q, uniqExact(state) AS states,
              toFloat64(sum(rx_count)) AS rx
       FROM margin_mv GROUP BY year, quarter ORDER BY y DESC, q DESC LIMIT 2
     ),
     latest AS (
       SELECT yq.1 AS y, yq.2 AS q FROM (
         SELECT if(
           (SELECT count() FROM qs) = 1
           OR ((SELECT argMax(states, (y, q)) FROM qs) >= (SELECT argMin(states, (y, q)) FROM qs)
               AND (SELECT argMax(rx, (y, q)) FROM qs) >= 0.95 * (SELECT argMin(rx, (y, q)) FROM qs)),
           (SELECT max((y, q)) FROM qs),
           (SELECT min((y, q)) FROM qs)
         ) AS yq
       )
     ),
     nat AS (
       SELECT m.ndc11 AS ndc11,
              any(toFloat64(m.acq_per_unit)) AS acq,
              toFloat64(sum(m.total_reimb)) / toFloat64(sum(m.units)) AS reimb,
              toFloat64(sum(m.rx_count)) AS rx,
              toFloat64(sum(m.total_reimb)) AS spend,
              any(d.is_generic) AS is_gen
       FROM margin_mv m
       INNER JOIN latest l ON m.year = l.y AND m.quarter = l.q
       INNER JOIN dim_drug_v d ON d.ndc11 = m.ndc11
       GROUP BY m.ndc11
     ),
     ranked AS (
       SELECT *, row_number() OVER (ORDER BY spend DESC) AS spend_rank FROM nat
     )
     SELECT (SELECT y FROM latest) AS year,
            (SELECT q FROM latest) AS quarter,
            toUInt32(count()) AS all_ndcs,
            countIf(reimb < acq) / count() * 100 AS all_pct,
            countIf(spend_rank <= 50 AND reimb < acq) / 50 * 100 AS top50_pct,
            toUInt32(countIf(rx >= 10000)) AS highvol_ndcs,
            countIf(rx >= 10000 AND reimb < acq) / greatest(countIf(rx >= 10000), 1) * 100 AS highvol_pct,
            toUInt32(countIf(NOT is_gen)) AS brand_ndcs,
            countIf(NOT is_gen AND reimb < acq) / greatest(countIf(NOT is_gen), 1) * 100 AS brand_pct,
            toUInt32(countIf(is_gen)) AS generic_ndcs,
            countIf(is_gen AND reimb < acq) / greatest(countIf(is_gen), 1) * 100 AS generic_pct,
            sumIf(spend, NOT is_gen AND reimb < acq) / greatest(sumIf(spend, NOT is_gen), 1) * 100 AS brand_spend_underwater_pct,
            (SELECT toFloat64(abs(sumIf(m2.margin_per_unit * m2.units, m2.margin_per_unit < 0)))
             FROM margin_mv m2 INNER JOIN latest l2 ON m2.year = l2.y AND m2.quarter = l2.q
            ) AS dollars_below_acq
     FROM ranked`,
    {},
  );
  return rows[0] ?? null;
}

// ---------- F3: top ten worst margins ----------

export async function getTopTen(
  filter: "all" | "brand" | "generic" = "all",
): Promise<TopTenRow[]> {
  const filterSql =
    filter === "brand" ? "AND d.is_generic = false"
    : filter === "generic" ? "AND d.is_generic = true"
    : "";
  return chRows<TopTenRow>(
    `WITH latest AS (
       SELECT year, quarter FROM margin_mv ORDER BY year DESC, quarter DESC LIMIT 1
     )
     SELECT m.ndc11 AS ndc11, d.brand_name, d.ingredient, d.is_generic,
            toUInt16(any(m.year)) AS year, toUInt8(any(m.quarter)) AS quarter,
            any(m.pricing_unit) AS pricing_unit,
            toFloat64(any(m.acq_per_unit)) AS acq_per_unit,
            toFloat64(sum(m.total_reimb) / sum(m.units)) AS reimb_per_unit,
            reimb_per_unit - acq_per_unit AS margin_per_unit,
            margin_per_unit / acq_per_unit * 100 AS margin_pct,
            toUInt32(sum(m.rx_count)) AS rx_count
     FROM margin_mv m
     INNER JOIN latest l ON m.year = l.year AND m.quarter = l.quarter
     INNER JOIN dim_drug_v d ON d.ndc11 = m.ndc11
     WHERE 1 = 1 ${filterSql}
     GROUP BY m.ndc11, d.brand_name, d.ingredient, d.is_generic
     HAVING rx_count >= 100
     ORDER BY margin_per_unit ASC
     LIMIT 10`,
    {},
  );
}
