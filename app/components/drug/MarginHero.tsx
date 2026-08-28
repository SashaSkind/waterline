import type { MarginSummary } from "@/lib/queries";
import { money } from "./format";

/** The hero of the page: margin per unit and per typical fill.
 * Red when the pharmacy is underwater. */
export default function MarginHero({
  margin,
  pricingUnit,
}: {
  margin: MarginSummary | null;
  pricingUnit: string | null;
}) {
  const unit = pricingUnit || "unit";

  if (!margin) {
    return (
      <section className="py-10">
        <p className="text-xs uppercase tracking-widest text-neutral-500">Margin</p>
        <p className="mt-2 text-6xl font-semibold tracking-tight text-neutral-700">
          no data
        </p>
        <p className="mt-3 text-sm text-neutral-500">
          No overlapping acquisition and Medicaid reimbursement data for this NDC.
        </p>
      </section>
    );
  }

  const underwater = margin.margin_per_unit < 0;
  const heroColor = underwater ? "text-red-400" : "text-emerald-400";
  const fillColor = margin.margin_per_fill < 0 ? "text-red-400" : "text-emerald-400";

  return (
    <section className="py-10">
      <p className="text-xs uppercase tracking-widest text-neutral-500">
        Margin{underwater && <span className="ml-2 text-red-400">underwater</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <p className={`text-7xl font-semibold tracking-tight tabular-nums ${heroColor}`}>
          {money(margin.margin_per_unit)}
          <span className="ml-3 text-2xl font-normal text-neutral-500">
            per {unit}
          </span>
        </p>
        <p className={`text-4xl font-semibold tracking-tight tabular-nums ${fillColor}`}>
          {money(margin.margin_per_fill)}
          <span className="ml-2 text-lg font-normal text-neutral-500">
            per fill
          </span>
        </p>
      </div>
      <p className="mt-3 text-sm text-neutral-400">
        per {unit}, {margin.state_count} states, {margin.year} Q{margin.quarter}
        <span className="text-neutral-600">
          {" "}
          · {margin.margin_pct >= 0 ? "+" : "−"}
          {Math.abs(margin.margin_pct).toFixed(1)}% ·{" "}
          {Math.round(margin.units_per_rx).toLocaleString("en-US")}{" "}
          {Math.round(margin.units_per_rx) === 1 ? "unit" : "units"}/fill ·{" "}
          {margin.rx_count.toLocaleString("en-US")} fills
        </span>
      </p>
      <p className="mt-4 max-w-2xl text-xs leading-relaxed text-neutral-500">
        Medicaid amounts are pre-rebate and include the dispensing fee, so this
        is gross margin. The gap also contains the PBM&apos;s spread, which no
        public data separates out.
      </p>
    </section>
  );
}
