"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AlertRow } from "@/lib/queries";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

/** Polls /api/alerts every 2s. Alerts originate as Postgres price_events
 * rows and arrive here through ClickPipes CDC — this feed is the proof the
 * pipe is load-bearing. */
export default function AlertFeed() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/alerts");
        if (!res.ok) return;
        const rows: AlertRow[] = await res.json();
        if (stop) return;
        const newIds = rows
          .map((r) => r.event_id)
          .filter((id) => !seen.current.has(id));
        if (seen.current.size > 0 && newIds.length > 0) {
          setFresh(new Set(newIds));
          setTimeout(() => setFresh(new Set()), 4000);
        }
        rows.forEach((r) => seen.current.add(r.event_id));
        setAlerts(rows);
      } catch {
        // transient — next poll retries
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (alerts.length === 0) return null;

  return (
    <section className="mt-12">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-medium text-wave-900">Price alerts</h2>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="text-xs text-wave-500">
          live from Postgres via ClickPipes CDC
        </span>
      </div>
      <ul className="mt-4 space-y-2">
        {alerts.slice(0, 8).map((a) => {
          const up = a.new_price > a.prev_price;
          return (
            <li
              key={a.event_id}
              className={`rounded-lg border px-4 py-3 transition-colors duration-700 ${
                fresh.has(a.event_id)
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-wave-200 bg-white/70"
              }`}
            >
              <Link href={`/drug/${a.ndc11}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-wave-950">{a.brand_name}</span>
                <span className="text-sm text-wave-600">{a.ingredient}</span>
                <span className="text-sm tabular-nums text-wave-800">
                  {fmt(a.prev_price)} → {fmt(a.new_price)}
                </span>
                <span
                  className={`text-sm font-medium tabular-nums ${
                    up ? "text-red-600" : "text-emerald-700"
                  }`}
                >
                  {up ? "+" : ""}
                  {a.pct_change.toFixed(1)}%
                </span>
                {a.flipped_negative === 1 && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                    margin flipped negative
                  </span>
                )}
                <span className="ml-auto text-xs text-wave-400">
                  eff. {a.effective_date}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
