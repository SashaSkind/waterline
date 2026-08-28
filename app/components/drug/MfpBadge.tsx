import type { MfpBadge as MfpBadgeData } from "@/lib/queries";
import { money } from "./format";

/** Distinct badge for the ten IRA-negotiated drugs. */
export default function MfpBadge({ mfp }: { mfp: MfpBadgeData }) {
  return (
    <div className="flex items-baseline gap-3 rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-3">
      <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
        IRA
      </span>
      <p className="text-sm text-amber-200">
        Medicare negotiated price:{" "}
        <span className="font-semibold tabular-nums">{money(mfp.mfp)}</span> per
        30-day supply, effective Jan 1 2026
      </p>
    </div>
  );
}
