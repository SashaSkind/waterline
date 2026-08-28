import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import SearchBox from "@/components/SearchBox";
import DrugViewTracker from "@/components/analytics/DrugViewTracker";
import DrugHeader from "@/components/drug/DrugHeader";
import HistoryChart from "@/components/drug/HistoryChart";
import HowToRead from "@/components/drug/HowToRead";
import MarginHero from "@/components/drug/MarginHero";
import MfpBadge from "@/components/drug/MfpBadge";
import PriceStack from "@/components/drug/PriceStack";
import StateComparison from "@/components/drug/StateComparison";
import WatchButton from "@/components/live/WatchButton";
import { isWatched } from "@/lib/mutations";
import {
  getAcquisition,
  getDrug,
  getFss,
  getMarginSummary,
  getMfp,
  getPartD,
  getPriceHistory,
  getStateComparison,
  normalizeNdc,
} from "@/lib/queries";

// Deduped between generateMetadata and the page render.
const cachedDrug = cache(getDrug);

type Props = { params: Promise<{ ndc: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ndc } = await params;
  const ndc11 = normalizeNdc(ndc);
  const drug = ndc11 ? await cachedDrug(ndc11) : null;
  return { title: drug ? `${drug.brand_name} — Waterline` : "Waterline" };
}

export default async function DrugPage({ params }: Props) {
  const { ndc } = await params;
  const ndc11 = normalizeNdc(ndc);
  if (!ndc11) notFound();

  const drug = await cachedDrug(ndc11);
  if (!drug) notFound();

  const [acquisition, margin, partd, fss, mfp, watched, history, states] = await Promise.all([
    getAcquisition(ndc11),
    getMarginSummary(ndc11),
    getPartD(ndc11),
    getFss(ndc11),
    getMfp(ndc11),
    isWatched(ndc11).catch(() => false),
    getPriceHistory(ndc11),
    getStateComparison(ndc11),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <DrugViewTracker ndc11={ndc11} />
      <div className="mb-8 flex flex-wrap items-center gap-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-neutral-400 hover:text-neutral-200"
        >
          Waterline
        </Link>
        <SearchBox />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <DrugHeader drug={drug} />
        <WatchButton ndc11={ndc11} initialWatched={watched} />
      </div>
      <MarginHero margin={margin} pricingUnit={acquisition?.pricing_unit ?? null} />
      {mfp && (
        <div className="mb-6">
          <MfpBadge mfp={mfp} />
        </div>
      )}
      <PriceStack
        acquisition={acquisition}
        margin={margin}
        partd={partd}
        fss={fss}
      />
      <HistoryChart history={history} mfpDate={mfp?.effective_date ?? null} />
      <StateComparison comparison={states} />
      <div className="mt-8">
        <HowToRead />
      </div>
    </main>
  );
}
