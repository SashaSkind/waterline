"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WatchRow } from "@/lib/queries";

const fmt = (n: number | null) =>
  n === null || n === undefined
    ? "no data"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Polls /api/watchlist every 5s — reads come from the CDC-replicated copy. */
export default function WatchlistPanel() {
  const [rows, setRows] = useState<WatchRow[] | null>(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/watchlist");
        if (res.ok && !stop) setRows(await res.json());
      } catch {
        // transient
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="text-lg font-medium text-wave-900">Your watchlist</h2>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {rows.map((w) => (
          <li
            key={w.watch_id}
            className="rounded-lg border border-wave-200 bg-white/70 px-4 py-3"
          >
            <Link href={`/drug/${w.ndc11}`} className="block">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-wave-950">
                  {w.brand_name}
                </span>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    (w.margin_per_unit ?? 0) < 0 ? "text-red-600" : "text-wave-800"
                  }`}
                >
                  {w.margin_per_unit === null ? "no data" : `${fmt(w.margin_per_unit)}/unit`}
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-wave-500">
                <span className="truncate">{w.ingredient}</span>
                <span>alert at ±{w.threshold_pct}%</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
