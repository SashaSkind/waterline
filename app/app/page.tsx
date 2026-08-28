import Link from "next/link";

import SearchBox from "@/components/SearchBox";
import CohortPanel from "@/components/home/CohortPanel";
import FilterTabs, { type TopTenFilter } from "@/components/home/FilterTabs";
import TopTenTable from "@/components/home/TopTenTable";
import AlertFeed from "@/components/live/AlertFeed";
import WatchlistPanel from "@/components/live/WatchlistPanel";
import { getCohortStats, getTopTen } from "@/lib/queries";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.filter) ? sp.filter[0] : sp.filter;
  const filter: TopTenFilter =
    raw === "brand" || raw === "generic" ? raw : "all";
  const [rows, stats] = await Promise.all([
    getTopTen(filter),
    getCohortStats().catch(() => null),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:py-14">
      <section>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-wave-950 sm:text-5xl">
          Drugs where pharmacies lose money on every fill.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-wave-600">
          The waterline is where margin crosses zero &mdash; reimbursement no
          longer covers what the pharmacy paid the wholesaler.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <SearchBox />
          <Link
            href="/explore"
            className="rounded-lg border border-wave-300 bg-wave-50 px-4 py-3 text-sm font-medium text-wave-700 transition-colors hover:border-wave-500"
          >
            Explore every drug →
          </Link>
        </div>
      </section>

      <CohortPanel stats={stats} />

      <section className="mt-12 sm:mt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-wave-900">
              Ten worst margins
            </h2>
            <p className="mt-1 text-sm text-wave-500">
              {rows[0]
                ? `${rows[0].year} Q${rows[0].quarter} Medicaid claims`
                : "Latest quarter of Medicaid claims"}{" "}
              &middot; gross margin per unit
            </p>
          </div>
          <FilterTabs active={filter} />
        </div>
        <div className="mt-4 rounded-xl border border-wave-200 bg-white/70">
          <TopTenTable rows={rows} />
        </div>
      </section>

      <AlertFeed />
      <WatchlistPanel />

      <footer className="mt-12 border-t border-wave-200 pt-5 text-xs text-wave-500">
        <p>
          Medicaid amounts are pre-rebate and include the dispensing fee, so
          these are gross margins &mdash; the gap also contains the
          PBM&rsquo;s spread.
        </p>
        <p className="mt-1.5 text-wave-400">
          Data: NADAC, Medicaid SDUD, CMS, VA FSS, FDA
        </p>
      </footer>
    </main>
  );
}
