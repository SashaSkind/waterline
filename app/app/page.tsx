import Link from "next/link";

import SearchBox from "@/components/SearchBox";
import FilterTabs, { type TopTenFilter } from "@/components/home/FilterTabs";
import TopTenTable from "@/components/home/TopTenTable";
import AlertFeed from "@/components/live/AlertFeed";
import WatchlistPanel from "@/components/live/WatchlistPanel";
import { getTopTen } from "@/lib/queries";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.filter) ? sp.filter[0] : sp.filter;
  const filter: TopTenFilter =
    raw === "brand" || raw === "generic" ? raw : "all";
  const rows = await getTopTen(filter);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:py-14">
      <section>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-neutral-50 sm:text-5xl">
          Drugs where pharmacies lose money on every fill.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-neutral-400">
          The waterline is where margin crosses zero &mdash; reimbursement no
          longer covers what the pharmacy paid the wholesaler.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <SearchBox />
          <Link
            href="/explore"
            className="rounded-lg border border-sky-800 bg-sky-950/40 px-4 py-3 text-sm font-medium text-sky-300 transition-colors hover:border-sky-600"
          >
            Explore every drug →
          </Link>
        </div>
      </section>

      <section className="mt-12 sm:mt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-neutral-200">
              Ten worst margins
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              {rows[0]
                ? `${rows[0].year} Q${rows[0].quarter} Medicaid claims`
                : "Latest quarter of Medicaid claims"}{" "}
              &middot; gross margin per unit
            </p>
          </div>
          <FilterTabs active={filter} />
        </div>
        <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/40">
          <TopTenTable rows={rows} />
        </div>
      </section>

      <AlertFeed />
      <WatchlistPanel />

      <footer className="mt-12 border-t border-neutral-800/80 pt-5 text-xs text-neutral-500">
        <p>
          Medicaid amounts are pre-rebate and include the dispensing fee, so
          these are gross margins &mdash; the gap also contains the
          PBM&rsquo;s spread.
        </p>
        <p className="mt-1.5 text-neutral-600">
          Data: NADAC, Medicaid SDUD, CMS, VA FSS, FDA
        </p>
      </footer>
    </main>
  );
}
