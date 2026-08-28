import type { CohortStats } from "@/lib/queries";

const pct = (n: number) => `${n.toFixed(1)}%`;
const compactMoney = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`;

function Tile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-neutral-900/40 px-4 py-3 ${
        accent ? "border-red-900/70" : "border-neutral-800"
      }`}
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-50">{value}</div>
      <div className="mt-0.5 text-[11px] text-neutral-600">{sub}</div>
    </div>
  );
}

/** Share of drugs underwater in the latest quarter, by cohort. The rate
 * depends heavily on who you count — that's the point of showing all five. */
export default function CohortPanel({ stats }: { stats: CohortStats | null }) {
  if (!stats) return null;
  const n = (x: number) => x.toLocaleString("en-US");
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-neutral-200">
          Who&rsquo;s underwater
        </h2>
        <span className="text-sm text-neutral-500">
          <span className="text-neutral-300">
            {compactMoney(stats.dollars_below_acq)}
          </span>{" "}
          reimbursed below acquisition cost in {stats.year} Q{stats.quarter}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile
          label="Brand drugs"
          value={pct(stats.brand_pct)}
          sub={`of ${n(stats.brand_ndcs)} NDCs`}
          accent
        />
        <Tile
          label="Generic drugs"
          value={pct(stats.generic_pct)}
          sub={`of ${n(stats.generic_ndcs)} NDCs`}
        />
        <Tile
          label="Top 50 by spend"
          value={pct(stats.top50_pct)}
          sub="highest Medicaid spend"
        />
        <Tile
          label="High volume"
          value={pct(stats.highvol_pct)}
          sub={`≥10k fills · ${n(stats.highvol_ndcs)} NDCs`}
        />
        <Tile
          label="All drugs"
          value={pct(stats.all_pct)}
          sub={`${n(stats.all_ndcs)} NDCs with data`}
        />
      </div>
      <p className="mt-2 text-xs text-red-300/90">
        {stats.brand_spend_underwater_pct.toFixed(0)}% of brand-drug Medicaid
        spend flows through drugs reimbursed below what the pharmacy paid.
      </p>
      <p className="mt-1 text-[11px] text-neutral-600">
        Rates cover the {stats.all_ndcs.toLocaleString("en-US")} NDCs with a
        surveyed NADAC price, usable Medicaid claims, and a current FDA
        listing; NADAC surveys retail pharmacies only, so clinic-administered
        drugs are out of scope.
      </p>
    </section>
  );
}
