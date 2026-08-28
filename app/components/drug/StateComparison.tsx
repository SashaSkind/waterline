"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { StateComparison as StateComparisonData } from "@/lib/queries";
import { money } from "./format";

export default function StateComparison({
  comparison,
}: {
  comparison: StateComparisonData | null;
}) {
  if (!comparison || comparison.states.length === 0) return null;

  const acquisition = comparison.states[0].acq_per_unit;
  const chartHeight = Math.max(360, comparison.states.length * 27);
  const fullySuppressed = comparison.suppressed_states
    .filter((state) => state.visible_cells === 0)
    .map((state) => state.state);
  const partlySuppressed = comparison.suppressed_states
    .filter((state) => state.visible_cells > 0)
    .map((state) => state.state);

  return (
    <section className="mt-10 border-t border-neutral-800 pt-8">
      <h2 className="text-lg font-medium text-neutral-200">
        Reimbursement by state
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        {comparison.year} Q{comparison.quarter}, sorted lowest to highest · the
        dashed line is NADAC acquisition at {money(acquisition)} per unit
      </p>

      <div
        className="mt-5 w-full"
        style={{ height: chartHeight }}
        role="img"
        aria-label="Horizontal bar chart comparing Medicaid reimbursement by state"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={comparison.states}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 8, left: 2 }}
          >
            <CartesianGrid stroke="#262626" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(value) => money(Number(value))}
              tick={{ fill: "#737373", fontSize: 11 }}
              axisLine={{ stroke: "#404040" }}
              tickLine={false}
            />
            <YAxis
              dataKey="state"
              type="category"
              width={34}
              tick={{ fill: "#a3a3a3", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <Tooltip
              cursor={{ fill: "#262626", opacity: 0.5 }}
              contentStyle={{
                background: "#171717",
                border: "1px solid #404040",
                borderRadius: 8,
                color: "#e5e5e5",
                fontSize: 12,
              }}
              formatter={(value) => [money(Number(value)), "Reimbursement"]}
            />
            <ReferenceLine
              x={acquisition}
              stroke="#38bdf8"
              strokeDasharray="4 4"
            />
            <Bar dataKey="reimb_per_unit" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {comparison.states.map((state) => (
                <Cell
                  key={state.state}
                  fill={state.margin_per_unit < 0 ? "#ef4444" : "#10b981"}
                  fillOpacity={0.75}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 space-y-1 text-xs text-neutral-500">
        <p>
          Red states reimburse below acquisition; green states reimburse above
          it. FFS and managed-care claims are combined and weighted by units.
        </p>
        {fullySuppressed.length > 0 && (
          <p>Fully suppressed states, omitted: {fullySuppressed.join(", ")}.</p>
        )}
        {partlySuppressed.length > 0 && (
          <p>
            States with some suppressed utilization cells: {partlySuppressed.join(", ")}.
            Their visible bars exclude those cells.
          </p>
        )}
      </div>
    </section>
  );
}
