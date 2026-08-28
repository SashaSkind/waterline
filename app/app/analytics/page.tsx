import type { Metadata } from "next";
import Link from "next/link";

import { getProductAnalytics } from "@/lib/product-analytics";

export const metadata: Metadata = { title: "Product analytics — Waterline" };
export const dynamic = "force-dynamic";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export default async function AnalyticsPage() {
  const analytics = await getProductAnalytics(30).catch(() => null);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:py-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-wave-600">
            Product analytics
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-wave-950">
            What people investigate and watch.
          </h1>
          <p className="mt-3 max-w-2xl text-wave-600">
            Usage events are written to Postgres, copied by ClickPipes, and
            aggregated live in ClickHouse. No email or note content enters this layer.
          </p>
        </div>
        <Link href="/" className="text-sm text-wave-600 hover:text-wave-950">
          Back to Waterline
        </Link>
      </header>

      {!analytics ? (
        <section className="mt-10 rounded-xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="font-medium text-amber-900">Analytics pipeline not connected yet</h2>
          <p className="mt-2 max-w-2xl text-sm text-amber-800/80">
            Add <code>product_events</code> to the Postgres ClickPipe, then apply{" "}
            <code>clickhouse/views/product_analytics.sql</code>.
          </p>
        </section>
      ) : (
        <>
          <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Registered users", analytics.summary.total_users],
              ["Active users · " + analytics.days + "d", analytics.summary.active_users],
              ["Drug views · " + analytics.days + "d", analytics.summary.drug_views],
              ["Watch adds · " + analytics.days + "d", analytics.summary.watch_adds],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-wave-200 bg-white/70 p-5">
                <p className="text-sm text-wave-500">{label}</p>
                <p className="mt-2 text-3xl font-semibold text-wave-950">
                  {integer.format(Number(value))}
                </p>
              </div>
            ))}
          </section>

          <section className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <h2 className="text-lg font-medium text-wave-900">Most investigated drugs</h2>
              <div className="mt-4 overflow-hidden rounded-xl border border-wave-200 bg-white">
                {analytics.top_drugs.length === 0 ? (
                  <p className="p-5 text-sm text-wave-500">No drug activity yet.</p>
                ) : (
                  <ul className="divide-y divide-wave-100">
                    {analytics.top_drugs.map((drug) => (
                      <li key={drug.ndc11}>
                        <Link
                          href={"/drug/" + drug.ndc11}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 hover:bg-wave-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-wave-950">
                              {drug.brand_name}
                            </span>
                            <span className="block truncate text-xs text-wave-500">
                              {drug.ingredient || drug.ndc11}
                            </span>
                          </span>
                          <span className="text-right text-sm text-wave-800">
                            {integer.format(drug.views)} views
                          </span>
                          <span className="text-right text-sm text-wave-700">
                            {integer.format(drug.watch_adds)} watched
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <h2 className="text-lg font-medium text-wave-900">Recent active days</h2>
              <div className="mt-4 rounded-xl border border-wave-200 bg-white/70 p-4">
                {analytics.daily.length === 0 ? (
                  <p className="text-sm text-wave-500">No recent events yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {analytics.daily.slice(-10).reverse().map((day) => (
                      <li key={day.day} className="flex items-center justify-between gap-4 text-sm">
                        <span className="font-mono text-wave-500">{day.day}</span>
                        <span className="text-wave-800">
                          {integer.format(day.drug_views)} views ·{" "}
                          {integer.format(day.watch_adds)} watches
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="mt-3 text-xs text-wave-400">
                Raw immutable events remain available for ad hoc analysis.
              </p>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
