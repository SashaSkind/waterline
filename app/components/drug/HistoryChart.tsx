"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PriceHistory } from "@/lib/queries";
import { money, shortDate } from "./format";

interface ChartPoint {
  date: string;
  timestamp: number;
  acquisition: number | null;
  reimbursement: number | null;
  positive_band: [number, number] | null;
  underwater_band: [number, number] | null;
}

const timestamp = (date: string) => Date.parse(`${date}T00:00:00Z`);

const tickDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function mergeHistory(history: PriceHistory): ChartPoint[] {
  const acquisition = new Map(
    history.acquisition.map((point) => [point.date, point.acq_per_unit]),
  );
  const reimbursement = new Map(
    history.reimbursement.map((point) => [point.date, point.reimb_per_unit]),
  );
  const dates = Array.from(
    new Set([...acquisition.keys(), ...reimbursement.keys()]),
  ).sort();

  let currentAcquisition: number | null = null;
  let currentReimbursement: number | null = null;

  return dates.map((date) => {
    if (acquisition.has(date)) currentAcquisition = acquisition.get(date)!;
    if (reimbursement.has(date)) currentReimbursement = reimbursement.get(date)!;

    const both =
      currentAcquisition !== null && currentReimbursement !== null;
    const positive =
      both && currentReimbursement! >= currentAcquisition!;

    return {
      date,
      timestamp: timestamp(date),
      acquisition: currentAcquisition,
      reimbursement: currentReimbursement,
      positive_band:
        both && positive
          ? [currentAcquisition!, currentReimbursement!]
          : null,
      underwater_band:
        both && !positive
          ? [currentReimbursement!, currentAcquisition!]
          : null,
    };
  });
}

export default function HistoryChart({
  history,
  mfpDate,
}: {
  history: PriceHistory;
  mfpDate: string | null;
}) {
  const data = mergeHistory(history);
  if (data.length < 2) {
    return (
      <section className="mt-10 border-t border-neutral-800 pt-8">
        <h2 className="text-lg font-medium text-neutral-200">Price history</h2>
        <p className="mt-3 text-sm text-neutral-500">
          Not enough historical acquisition data to draw a trend.
        </p>
      </section>
    );
  }

  const first = data[0].timestamp;
  const last = data[data.length - 1].timestamp;
  const genericDate = history.first_generic_approval;
  const genericInRange =
    genericDate !== null &&
    timestamp(genericDate) >= first &&
    timestamp(genericDate) <= last;
  const mfpInRange =
    mfpDate !== null && timestamp(mfpDate) >= first && timestamp(mfpDate) <= last;

  return (
    <section className="mt-10 border-t border-neutral-800 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-neutral-200">Price history</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Acquisition cost versus national Medicaid reimbursement per unit
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-sky-400" /> NADAC acquisition
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-neutral-200" /> Medicaid reimbursement
          </span>
        </div>
      </div>

      <div
        className="mt-5 h-[360px] w-full"
        role="img"
        aria-label="Line chart comparing drug acquisition cost and Medicaid reimbursement over time"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 22, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value) => tickDate.format(new Date(Number(value)))}
              tick={{ fill: "#737373", fontSize: 11 }}
              axisLine={{ stroke: "#404040" }}
              tickLine={false}
              minTickGap={36}
            />
            <YAxis
              tickFormatter={(value) => money(Number(value))}
              tick={{ fill: "#737373", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={72}
              domain={["auto", "auto"]}
            />
            <Tooltip
              cursor={{ stroke: "#525252", strokeDasharray: "3 3" }}
              contentStyle={{
                background: "#171717",
                border: "1px solid #404040",
                borderRadius: 8,
                color: "#e5e5e5",
                fontSize: 12,
              }}
              labelFormatter={(value) =>
                shortDate(new Date(Number(value)).toISOString().slice(0, 10))
              }
              formatter={(value, name) => [money(Number(value)), name]}
            />
            <Area
              dataKey="positive_band"
              type="stepAfter"
              stroke="none"
              fill="#10b981"
              fillOpacity={0.12}
              connectNulls
              tooltipType="none"
              isAnimationActive={false}
            />
            <Area
              dataKey="underwater_band"
              type="stepAfter"
              stroke="none"
              fill="#ef4444"
              fillOpacity={0.16}
              connectNulls
              tooltipType="none"
              isAnimationActive={false}
            />
            <Line
              dataKey="acquisition"
              name="NADAC acquisition"
              type="stepAfter"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              dataKey="reimbursement"
              name="Medicaid reimbursement"
              type="stepAfter"
              stroke="#e5e5e5"
              strokeWidth={2}
              dot={{ r: 2, fill: "#e5e5e5" }}
              connectNulls
              isAnimationActive={false}
            />
            {genericInRange && (
              <ReferenceLine
                x={timestamp(genericDate)}
                stroke="#a78bfa"
                strokeDasharray="4 4"
                label={{ value: "first generic", fill: "#a78bfa", fontSize: 10, position: "insideTopLeft" }}
              />
            )}
            {mfpInRange && (
              <ReferenceLine
                x={timestamp(mfpDate)}
                stroke="#fbbf24"
                strokeDasharray="4 4"
                label={{ value: "2026 MFP", fill: "#fbbf24", fontSize: 10, position: "insideTopRight" }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 space-y-1 text-xs text-neutral-500">
        <p>
          <span className="text-red-400">Red shading</span> marks quarters
          where reimbursement is below acquisition; green is above water.
        </p>
        {genericDate && !genericInRange && (
          <p>
            First generic approval: {shortDate(genericDate)} (before available
            chart history).
          </p>
        )}
        {mfpDate && (
          <p>
            MFP is a 30-day-supply benchmark; its marker is contextual and is
            not used in per-unit margin math.
          </p>
        )}
      </div>
    </section>
  );
}
