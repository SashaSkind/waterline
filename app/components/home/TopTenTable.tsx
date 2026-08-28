import Link from "next/link";
import type { TopTenRow } from "@/lib/queries";

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const intFmt = new Intl.NumberFormat("en-US");

/** Currency with a true minus sign, so negatives read cleanly at a glance. */
const usd = (v: number) => usdFmt.format(v).replace("-", "−");

const pct = (v: number) =>
  `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}%`;

// One grid template shared by the header and every row keeps columns aligned.
const COLS =
  "grid grid-cols-[2.5rem_minmax(14rem,1.7fr)_5.5rem_7.5rem_8.5rem_9.5rem_6rem] items-center gap-x-4 px-4";

function Chip({ isGeneric }: { isGeneric: boolean }) {
  return (
    <span
      className={
        isGeneric
          ? "inline-block rounded-full border border-sky-500/30 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-sky-400"
          : "inline-block rounded-full border border-amber-500/30 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-400"
      }
    >
      {isGeneric ? "generic" : "brand"}
    </span>
  );
}

/** The homepage top-ten list. Every row is a link to its drug page. */
export default function TopTenTable({ rows }: { rows: TopTenRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-neutral-500">
        No drugs match this filter in the latest quarter.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[52rem]">
        <div
          className={`${COLS} border-b border-neutral-800 py-2.5 text-[11px] font-medium uppercase tracking-wider text-neutral-500`}
        >
          <span>#</span>
          <span>Drug</span>
          <span />
          <span className="text-right">Acquisition</span>
          <span className="text-right">Reimbursement</span>
          <span className="text-right">Margin / unit</span>
          <span className="text-right">Rx</span>
        </div>
        <ol>
          {rows.map((row, i) => {
            const underwater = row.margin_per_unit < 0;
            return (
              <li key={row.ndc11}>
                <Link
                  href={`/drug/${row.ndc11}`}
                  className={`${COLS} border-b border-neutral-800/60 py-4 transition-colors last:border-b-0 hover:bg-neutral-900`}
                >
                  <span className="font-mono text-sm text-neutral-600">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-medium text-neutral-100">
                      {row.brand_name}
                    </span>
                    <span className="block truncate text-sm text-neutral-500">
                      {row.ingredient}
                    </span>
                  </span>
                  <span>
                    <Chip isGeneric={row.is_generic} />
                  </span>
                  <span className="text-right text-[15px] tabular-nums text-neutral-300">
                    {usd(row.acq_per_unit)}
                  </span>
                  <span className="text-right text-[15px] tabular-nums text-neutral-300">
                    {usd(row.reimb_per_unit)}
                  </span>
                  <span className="text-right">
                    <span
                      className={`block text-2xl font-semibold tabular-nums ${
                        underwater ? "text-red-400" : "text-neutral-50"
                      }`}
                    >
                      {usd(row.margin_per_unit)}
                    </span>
                    <span
                      className={`block text-xs tabular-nums ${
                        underwater ? "text-red-400/70" : "text-neutral-500"
                      }`}
                    >
                      {pct(row.margin_pct)} per {row.pricing_unit}
                    </span>
                  </span>
                  <span className="text-right text-[15px] tabular-nums text-neutral-300">
                    {intFmt.format(row.rx_count)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
