import type {
  Acquisition,
  FssBenchmark,
  MarginSummary,
  PartDBenchmark,
} from "@/lib/queries";
import { money, NoData, shortDate } from "./format";

function Row({
  label,
  sub,
  children,
  primary = false,
}: {
  label: string;
  sub: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-5">
      <div className="min-w-48">
        <p
          className={`font-medium ${primary ? "text-wave-900" : "text-wave-600"}`}
        >
          {label}
        </p>
        <p className="text-xs text-wave-400">{sub}</p>
      </div>
      <div className="text-right">{children}</div>
    </div>
  );
}

export default function PriceStack({
  acquisition,
  margin,
  partd,
  fss,
}: {
  acquisition: Acquisition | null;
  margin: MarginSummary | null;
  partd: PartDBenchmark | null;
  fss: FssBenchmark | null;
}) {
  const unit = acquisition?.pricing_unit || "unit";
  return (
    <section className="divide-y divide-wave-200 border-y border-wave-200">
      <Row label="Acquisition · NADAC" sub="pharmacy pays the wholesaler" primary>
        {acquisition ? (
          <>
            <p className="text-3xl font-semibold tabular-nums text-wave-950">
              {money(acquisition.nadac_per_unit)}
              <span className="ml-2 text-base font-normal text-wave-500">
                per {unit}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-wave-500">
              effective {shortDate(acquisition.effective_date)}
              {acquisition.source === "price_event" && (
                <span className="ml-2 inline-flex items-center gap-1 text-emerald-700">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  live
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="text-3xl font-semibold">
            <NoData />
          </p>
        )}
      </Row>

      <Row
        label="Medicaid reimbursement"
        sub="payer pays the pharmacy back"
        primary
      >
        {margin ? (
          <>
            <p className="text-3xl font-semibold tabular-nums text-wave-950">
              {money(margin.reimb_per_unit)}
              <span className="ml-2 text-base font-normal text-wave-500">
                per {unit}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-wave-500">
              {margin.year} Q{margin.quarter}, all states, pre-rebate
            </p>
          </>
        ) : (
          <p className="text-3xl font-semibold">
            <NoData />
          </p>
        )}
      </Row>

      <Row label="Part D benchmark" sub="Medicare average spending">
        {partd ? (
          <>
            <p className="text-2xl font-semibold tabular-nums text-wave-800">
              {money(partd.avg_spending_per_unit)}
              <span className="ml-2 text-sm font-normal text-wave-500">
                {partd.year}
              </span>
            </p>
            <p className="mt-0.5 max-w-xs text-xs text-wave-500">
              per dosage unit — CMS collapses strengths, not comparable to NADAC
              unit
            </p>
          </>
        ) : (
          <p className="text-2xl font-semibold">
            <NoData />
          </p>
        )}
      </Row>

      <Row label="VA FSS" sub="what the VA negotiated">
        {fss ? (
          <>
            <p className="text-2xl font-semibold tabular-nums text-wave-800">
              {money(fss.fss_per_unit)}
              <span className="ml-2 text-sm font-normal text-wave-500">
                per unit
              </span>
            </p>
            {fss.big_four_price !== null && fss.package_size > 0 ? (
              <p className="mt-0.5 text-xs tabular-nums text-wave-500">
                Big Four {money(fss.big_four_price / fss.package_size)} per unit
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-wave-500">
                Big Four <NoData />
              </p>
            )}
          </>
        ) : (
          <p className="text-2xl font-semibold">
            <NoData />
          </p>
        )}
      </Row>
    </section>
  );
}
