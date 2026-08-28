import type { ClickHouseSettings } from "@clickhouse/client";

import { chRows } from "./clickhouse";

export interface ProductAnalyticsSummary {
  total_users: number;
  active_users: number;
  drug_views: number;
  watch_adds: number;
  watch_removes: number;
  watch_conversion_pct: number;
}

export interface ProductAnalyticsDrug {
  ndc11: string;
  brand_name: string;
  ingredient: string;
  views: number;
  unique_viewers: number;
  watch_adds: number;
}

export interface ProductAnalyticsDay {
  day: string;
  active_users: number;
  drug_views: number;
  watch_adds: number;
  watch_removes: number;
}

export interface ProductAnalyticsSnapshot {
  days: number;
  summary: ProductAnalyticsSummary;
  top_drugs: ProductAnalyticsDrug[];
  daily: ProductAnalyticsDay[];
}

function safeWindowDays(days: number): number {
  if (!Number.isFinite(days)) return 30;
  return Math.min(365, Math.max(1, Math.floor(days)));
}

const QUERY_LIMITS: ClickHouseSettings = {
  max_execution_time: 10,
  max_rows_to_read: "10000000",
  timeout_before_checking_execution_speed: 0,
};

/** Product usage from the PII-free ClickHouse view. Query values use native
 * ClickHouse parameters; interpolating request values into SQL is an SQL
 * injection risk. */
export async function getProductAnalytics(
  windowDays = 30,
): Promise<ProductAnalyticsSnapshot> {
  const days = safeWindowDays(windowDays);
  const params = { days };

  const [summaryRows, topDrugs, daily] = await Promise.all([
    chRows<ProductAnalyticsSummary>(
      `WITH subtractDays(now(), {days: UInt16}) AS since
       SELECT
         total_users,
         active_users,
         drug_views,
         watch_adds,
         watch_removes,
         if(drug_views = 0, 0,
            toFloat64(watch_adds) / toFloat64(drug_views) * 100
         ) AS watch_conversion_pct
       FROM (
         SELECT
           toUInt32((
             SELECT uniqExact(user_id)
             FROM product_analytics.events
             WHERE event_name = 'user_signed_up'
           )) AS total_users,
           toUInt32(uniqExactIf(
             user_id,
             event_name != 'user_signed_up'
           )) AS active_users,
           toUInt32(countIf(event_name = 'drug_viewed')) AS drug_views,
           toUInt32(countIf(event_name = 'watch_added')) AS watch_adds,
           toUInt32(countIf(event_name = 'watch_removed')) AS watch_removes
         FROM product_analytics.events
         WHERE event_name IN ('drug_viewed', 'watch_added', 'watch_removed')
           AND event_date >= toDate(since)
           AND occurred_at >= since
       )
       LIMIT 1`,
      params,
      QUERY_LIMITS,
    ),
    chRows<ProductAnalyticsDrug>(
      `WITH subtractDays(now(), {days: UInt16}) AS since
       SELECT
         e.ndc11 AS ndc11,
         if(d.brand_name = '', e.ndc11, d.brand_name) AS brand_name,
         d.ingredient AS ingredient,
         toUInt32(countIf(e.event_name = 'drug_viewed')) AS views,
         toUInt32(uniqExactIf(e.user_id, e.event_name = 'drug_viewed')) AS unique_viewers,
         toUInt32(countIf(e.event_name = 'watch_added')) AS watch_adds
       FROM product_analytics.events e
       LEFT JOIN default.dim_drug_v d ON d.ndc11 = e.ndc11
       WHERE e.event_name IN ('drug_viewed', 'watch_added')
         AND e.event_date >= toDate(since)
         AND e.occurred_at >= since
         AND e.ndc11 != ''
       GROUP BY e.ndc11, d.brand_name, d.ingredient
       HAVING views > 0 OR watch_adds > 0
       ORDER BY views DESC, watch_adds DESC, e.ndc11
       LIMIT 10`,
      params,
      QUERY_LIMITS,
    ),
    chRows<ProductAnalyticsDay>(
      `WITH subtractDays(today(), {days: UInt16} - 1) AS since
       SELECT
         toString(event_date) AS day,
         toUInt32(uniqExactIf(
           user_id,
           event_name != 'user_signed_up'
         )) AS active_users,
         toUInt32(countIf(event_name = 'drug_viewed')) AS drug_views,
         toUInt32(countIf(event_name = 'watch_added')) AS watch_adds,
         toUInt32(countIf(event_name = 'watch_removed')) AS watch_removes
       FROM product_analytics.events
       WHERE event_name IN ('drug_viewed', 'watch_added', 'watch_removed')
         AND event_date >= since
       GROUP BY event_date
       ORDER BY event_date
       LIMIT {days: UInt16}`,
      params,
      QUERY_LIMITS,
    ),
  ]);

  return {
    days,
    summary: summaryRows[0] ?? {
      total_users: 0,
      active_users: 0,
      drug_views: 0,
      watch_adds: 0,
      watch_removes: 0,
      watch_conversion_pct: 0,
    },
    top_drugs: topDrugs,
    daily,
  };
}
