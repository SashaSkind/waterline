import type { Metadata } from "next";

import MarginMapExplorer from "@/components/map/MarginMapExplorer";
import { getMarginMapMetadata } from "@/lib/margin-map";

export const metadata: Metadata = { title: "Margin map — Waterline" };
export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const metadata = await getMarginMapMetadata();

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-wave-600">
          Interactive margin map
        </p>
        <h1 className="mt-2 max-w-4xl text-4xl font-semibold tracking-tight text-wave-950 sm:text-5xl">
          Every drug, above or below the waterline.
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-wave-600">
          Pharmacy acquisition cost on the x-axis. Medicaid reimbursement on
          the y-axis. Both are logarithmic; the diagonal is zero gross margin.
        </p>
      </header>
      <MarginMapExplorer metadata={metadata} />
    </main>
  );
}
