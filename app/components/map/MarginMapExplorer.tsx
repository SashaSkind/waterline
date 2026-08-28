"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type {
  MarginMapBin,
  MarginMapMetadata,
  MarginMapPoint,
  MarginMapView,
} from "@/lib/margin-map";

interface BinsResponse {
  mode: "bins";
  bins: MarginMapBin[];
  ndcs: number;
  source_rows: number;
  truncated: false;
  query_ms: number;
}

interface PointsResponse {
  mode: "points";
  points: MarginMapPoint[];
  ndcs: number;
  source_rows: number;
  truncated: boolean;
  query_ms: number;
}

type MapResponse = BinsResponse | PointsResponse;
type Target =
  | { kind: "bin"; key: string; value: MarginMapBin }
  | { kind: "point"; key: string; value: MarginMapPoint };

interface HitTarget {
  x: number;
  y: number;
  radius: number;
  target: Target;
}

interface Hovered {
  x: number;
  y: number;
  target: Target;
}

const PLOT = { left: 72, right: 18, top: 20, bottom: 56 };
// Keep the viewport binned until it is narrow enough that named point payloads
// stay small. A 0.4-decade window is about a 2.5x range on each axis.
const POINT_MODE_SPAN = 0.4;

const money = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  });

const compact = new Intl.NumberFormat("en-US", { notation: "compact" });

function logTick(log: number): string {
  const value = 10 ** log;
  if (value >= 1000) return `$${compact.format(value)}`;
  if (value >= 1) return `$${value.toFixed(0)}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(1)}`;
}

function constrainView(view: MarginMapView): MarginMapView {
  const min = -8;
  const max = 8;
  const shift = (low: number, high: number): [number, number] => {
    const span = high - low;
    if (low < min) return [min, min + span];
    if (high > max) return [max - span, max];
    return [low, high];
  };
  const [lx0, lx1] = shift(view.lx0, view.lx1);
  const [ly0, ly1] = shift(view.ly0, view.ly1);
  return { lx0, lx1, ly0, ly1 };
}

function targetNdc(target: Target): string {
  return target.kind === "point" ? target.value.ndc11 : target.value.worst_ndc;
}

export default function MarginMapExplorer({
  metadata,
}: {
  metadata: MarginMapMetadata;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hitsRef = useRef<HitTarget[]>([]);
  const dragRef = useRef<{
    x: number;
    y: number;
    view: MarginMapView;
    moved: boolean;
  } | null>(null);

  const [periodIndex, setPeriodIndex] = useState(metadata.periods.length - 1);
  const [state, setState] = useState("");
  const [view, setView] = useState(metadata.initial_view);
  const [size, setSize] = useState({ width: 960, height: 620 });
  const [response, setResponse] = useState<MapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<Hovered | null>(null);

  const period = metadata.periods[periodIndex];
  const spanX = view.lx1 - view.lx0;
  const spanY = view.ly1 - view.ly0;
  const requestMode = Math.max(spanX, spanY) <= POINT_MODE_SPAN ? "points" : "bins";

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(420, Math.round(entry.contentRect.height)),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!period) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        year: String(period.year),
        quarter: String(period.quarter),
        state,
        lx0: String(view.lx0),
        lx1: String(view.lx1),
        ly0: String(view.ly0),
        ly1: String(view.ly1),
        bins_x: String(Math.min(72, Math.max(24, Math.round(size.width / 17)))),
        bins_y: String(Math.min(52, Math.max(18, Math.round(size.height / 17)))),
        mode: requestMode,
      });
      try {
        const result = await fetch(`/api/margin-map?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!result.ok) throw new Error(`query returned ${result.status}`);
        setResponse((await result.json()) as MapResponse);
      } catch (queryError) {
        if (queryError instanceof DOMException && queryError.name === "AbortError") return;
        setError("The map query failed. Pan, zoom, or change the quarter to retry.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 120);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [period, requestMode, size.height, size.width, state, view]);

  const coordinates = useCallback(
    (lx: number, ly: number) => {
      const plotWidth = size.width - PLOT.left - PLOT.right;
      const plotHeight = size.height - PLOT.top - PLOT.bottom;
      return {
        x: PLOT.left + ((lx - view.lx0) / (view.lx1 - view.lx0)) * plotWidth,
        y: PLOT.top + ((view.ly1 - ly) / (view.ly1 - view.ly0)) * plotHeight,
      };
    },
    [size.height, size.width, view],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);

    const plotWidth = size.width - PLOT.left - PLOT.right;
    const plotHeight = size.height - PLOT.top - PLOT.bottom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PLOT.left, PLOT.top, plotWidth, plotHeight);
    ctx.clip();

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e4e1d8";
    ctx.fillStyle = "#2d7f96";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let tick = Math.ceil(view.lx0); tick <= Math.floor(view.lx1); tick += 1) {
      const { x } = coordinates(tick, view.ly0);
      ctx.beginPath();
      ctx.moveTo(x, PLOT.top);
      ctx.lineTo(x, PLOT.top + plotHeight);
      ctx.stroke();
    }
    for (let tick = Math.ceil(view.ly0); tick <= Math.floor(view.ly1); tick += 1) {
      const { y } = coordinates(view.lx0, tick);
      ctx.beginPath();
      ctx.moveTo(PLOT.left, y);
      ctx.lineTo(PLOT.left + plotWidth, y);
      ctx.stroke();
    }

    const lineLow = Math.max(view.lx0, view.ly0);
    const lineHigh = Math.min(view.lx1, view.ly1);
    if (lineLow < lineHigh) {
      const from = coordinates(lineLow, lineLow);
      const to = coordinates(lineHigh, lineHigh);
      ctx.strokeStyle = "#0e6378";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#0e6378";
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("waterline", Math.min(to.x + 6, size.width - 72), Math.max(to.y - 14, 8));
    }

    const hits: HitTarget[] = [];
    if (response?.mode === "bins") {
      const maxN = Math.max(1, ...response.bins.map((bin) => bin.n));
      for (const bin of response.bins) {
        const { x, y } = coordinates(bin.bx, bin.by);
        const radius = 3 + Math.sqrt(bin.n / maxN) * 16;
        const underwater = bin.n_underwater / Math.max(1, bin.n);
        // Interpolate wave-700 teal rgb(14, 99, 120) → red-700 rgb(185, 28, 28)
        // as the underwater share goes 0 → 1.
        const red = Math.round(14 + underwater * 171);
        const green = Math.round(99 - underwater * 71);
        const blue = Math.round(120 - underwater * 92);
        const target: Target = {
          kind: "bin",
          key: `${bin.bx}:${bin.by}`,
          value: bin,
        };
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.78)`;
        ctx.fill();
        if (hovered?.target.key === target.key) {
          ctx.strokeStyle = "#0a4c5c";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        hits.push({ x, y, radius: radius + 4, target });
      }
    } else if (response?.mode === "points") {
      for (const point of response.points) {
        const { x, y } = coordinates(point.lx, point.ly);
        const radius = hovered?.target.key === point.ndc11 ? 5 : 3.25;
        const target: Target = { kind: "point", key: point.ndc11, value: point };
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = point.margin_per_unit < 0 ? "#dc2626" : "#0e6378";
        ctx.globalAlpha = 0.82;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (hovered?.target.key === target.key) {
          ctx.strokeStyle = "#0a4c5c";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        hits.push({ x, y, radius: 7, target });
      }
    }
    hitsRef.current = hits;
    ctx.restore();

    ctx.strokeStyle = "#b9d4dc";
    ctx.lineWidth = 1;
    ctx.strokeRect(PLOT.left, PLOT.top, plotWidth, plotHeight);
    ctx.fillStyle = "#2d7f96";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let tick = Math.ceil(view.lx0); tick <= Math.floor(view.lx1); tick += 1) {
      const { x } = coordinates(tick, view.ly0);
      ctx.fillText(logTick(tick), x, PLOT.top + plotHeight + 9);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let tick = Math.ceil(view.ly0); tick <= Math.floor(view.ly1); tick += 1) {
      const { y } = coordinates(view.lx0, tick);
      ctx.fillText(logTick(tick), PLOT.left - 9, y);
    }
    ctx.fillStyle = "#0a4c5c";
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Pharmacy acquisition cost per unit · log scale", PLOT.left + plotWidth / 2, size.height - 15);
    ctx.save();
    ctx.translate(15, PLOT.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Medicaid reimbursement per unit · log scale", 0, 0);
    ctx.restore();
  }, [coordinates, hovered?.target.key, response, size.height, size.width, view]);

  const pointInCanvas = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
  };

  const findTarget = (x: number, y: number): HitTarget | null => {
    let best: HitTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const hit of hitsRef.current) {
      const distance = Math.hypot(x - hit.x, y - hit.y);
      if (distance <= hit.radius && distance < bestDistance) {
        best = hit;
        bestDistance = distance;
      }
    }
    return best;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointInCanvas(event.clientX, event.clientY);
    dragRef.current = { x: point.x, y: point.y, view, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointInCanvas(event.clientX, event.clientY);
    const drag = dragRef.current;
    if (drag) {
      const dx = point.x - drag.x;
      const dy = point.y - drag.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      const plotWidth = size.width - PLOT.left - PLOT.right;
      const plotHeight = size.height - PLOT.top - PLOT.bottom;
      const logDx = (dx / plotWidth) * (drag.view.lx1 - drag.view.lx0);
      const logDy = (dy / plotHeight) * (drag.view.ly1 - drag.view.ly0);
      setView(constrainView({
        lx0: drag.view.lx0 - logDx,
        lx1: drag.view.lx1 - logDx,
        ly0: drag.view.ly0 + logDy,
        ly1: drag.view.ly1 + logDy,
      }));
      return;
    }
    const hit = findTarget(point.x, point.y);
    setHovered(hit ? { x: hit.x, y: hit.y, target: hit.target } : null);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointInCanvas(event.clientX, event.clientY);
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag?.moved) {
      const hit = findTarget(point.x, point.y);
      if (hit) router.push(`/drug/${targetNdc(hit.target)}`);
    }
  };

  const zoomAt = useCallback((factor: number, xFraction = 0.5, yFraction = 0.5) => {
    setView((current) => {
      const nextSpanX = Math.min(16, Math.max(0.08, (current.lx1 - current.lx0) * factor));
      const nextSpanY = Math.min(16, Math.max(0.08, (current.ly1 - current.ly0) * factor));
      const anchorX = current.lx0 + (current.lx1 - current.lx0) * xFraction;
      const anchorY = current.ly1 - (current.ly1 - current.ly0) * yFraction;
      return constrainView({
        lx0: anchorX - nextSpanX * xFraction,
        lx1: anchorX + nextSpanX * (1 - xFraction),
        ly0: anchorY - nextSpanY * (1 - yFraction),
        ly1: anchorY + nextSpanY * yFraction,
      });
    });
  }, []);

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = pointInCanvas(event.clientX, event.clientY);
    const plotWidth = size.width - PLOT.left - PLOT.right;
    const plotHeight = size.height - PLOT.top - PLOT.bottom;
    const xFraction = Math.min(1, Math.max(0, (point.x - PLOT.left) / plotWidth));
    const yFraction = Math.min(1, Math.max(0, (point.y - PLOT.top) / plotHeight));
    zoomAt(Math.exp(event.deltaY * 0.0015), xFraction, yFraction);
  };

  const tooltip = useMemo(() => {
    if (!hovered) return null;
    if (hovered.target.kind === "bin") {
      const bin = hovered.target.value;
      return (
        <>
          <p className="font-medium text-wave-950">
            {bin.n.toLocaleString()} drug{bin.n === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-wave-600">
            {Math.round((bin.n_underwater / Math.max(1, bin.n)) * 100)}% underwater
          </p>
          <p className="mt-2 border-t border-wave-200 pt-2 text-wave-600">
            Worst: <span className="text-wave-900">{bin.worst_name || bin.worst_ndc}</span>
          </p>
          <p className="tabular-nums text-red-600">{money(bin.worst_margin)} per unit</p>
          <p className="mt-2 text-wave-400">Click to open the worst drug</p>
        </>
      );
    }
    const point = hovered.target.value;
    return (
      <>
        <p className="font-medium text-wave-950">{point.brand_name || point.ndc11}</p>
        <p className="text-wave-500">{point.ingredient}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
          <dt className="text-wave-500">Acquisition</dt>
          <dd className="text-right text-wave-900">{money(point.acq_per_unit)}</dd>
          <dt className="text-wave-500">Reimbursement</dt>
          <dd className="text-right text-wave-900">{money(point.reimb_per_unit)}</dd>
          <dt className="text-wave-500">Margin</dt>
          <dd className={`text-right ${point.margin_per_unit < 0 ? "text-red-600" : "text-emerald-700"}`}>
            {money(point.margin_per_unit)}
          </dd>
        </dl>
        <p className="mt-2 text-wave-400">Click to open this drug</p>
      </>
    );
  }, [hovered]);

  if (!period) {
    return <p className="text-wave-500">No margin-map periods are available.</p>;
  }

  return (
    <div>
      <div className="grid gap-4 rounded-xl border border-wave-200 bg-white/70 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="quarter" className="text-sm font-medium text-wave-800">
              Quarter
            </label>
            <span className="font-mono text-sm font-semibold text-wave-950">
              {period.year} Q{period.quarter}
            </span>
          </div>
          <input
            id="quarter"
            type="range"
            min={0}
            max={Math.max(0, metadata.periods.length - 1)}
            value={periodIndex}
            onChange={(event) => setPeriodIndex(Number(event.target.value))}
            className="mt-3 w-full accent-wave-600"
          />
          <div className="mt-1 flex justify-between text-[10px] text-wave-400">
            <span>{metadata.periods[0]?.year} Q{metadata.periods[0]?.quarter}</span>
            <span>{metadata.periods.at(-1)?.year} Q{metadata.periods.at(-1)?.quarter}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-wave-500">
            State
            <select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="h-9 rounded-md border border-wave-300 bg-white px-3 text-sm text-wave-900 outline-none focus:border-wave-600"
            >
              <option value="">All states</option>
              {metadata.states.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => zoomAt(0.65)}
            className="h-9 rounded-md border border-wave-300 px-3 text-sm text-wave-800 hover:border-wave-500"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomAt(1.5)}
            className="h-9 rounded-md border border-wave-300 px-3 text-sm text-wave-800 hover:border-wave-500"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setView(metadata.initial_view)}
            className="h-9 rounded-md border border-wave-300 px-3 text-xs text-wave-600 hover:border-wave-500"
          >
            Reset view
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-wave-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-wave-200 px-4 py-2 text-xs">
          <div className="flex items-center gap-3 text-wave-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-600" /> underwater</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-wave-700" /> above water</span>
            <span className="text-wave-400">drag to pan · scroll to zoom · click to open</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-wave-500">
            {response && (
              <>
                <span>{response.ndcs.toLocaleString()} NDCs</span>
                <span>·</span>
                <span>{response.source_rows.toLocaleString()} rows</span>
                <span>·</span>
                <span>{response.query_ms} ms</span>
                <span className="rounded bg-wave-100 px-1.5 py-0.5 text-[10px] uppercase text-wave-600">
                  {response.mode}
                </span>
              </>
            )}
            {loading && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-wave-500" />}
          </div>
        </div>

        <div ref={wrapperRef} className="relative h-[520px] w-full sm:h-[620px]">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => { dragRef.current = null; }}
            onPointerLeave={() => { if (!dragRef.current) setHovered(null); }}
            onWheel={handleWheel}
            onDoubleClick={() => setView(metadata.initial_view)}
            className="h-full w-full cursor-crosshair touch-none"
            aria-label="Interactive log-scale scatter plot of pharmacy acquisition cost versus Medicaid reimbursement"
          />
          {tooltip && hovered && (
            <div
              className="pointer-events-none absolute z-10 min-w-48 max-w-64 rounded-lg border border-wave-200 bg-white/95 px-3 py-2 text-xs shadow-xl"
              style={{
                left: Math.min(size.width - 260, Math.max(8, hovered.x + 14)),
                top: Math.min(size.height - 170, Math.max(8, hovered.y + 14)),
              }}
            >
              {tooltip}
            </div>
          )}
          {error && (
            <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-md border border-red-300 bg-red-100/95 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          {response?.mode === "points" && response.truncated && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-md border border-amber-300 bg-amber-100/95 px-3 py-2 text-xs text-amber-800">
              More than 1,500 drugs here — zoom in further for every drug.
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-wave-500 sm:grid-cols-3">
        <p>
          <span className="font-medium text-wave-800">The diagonal is zero margin.</span>{" "}
          Every mark below it is a drug package where Medicaid reimbursement did not cover acquisition.
        </p>
        <p>
          <span className="font-medium text-wave-800">Every move is a new ClickHouse query.</span>{" "}
          The server re-aggregates the visible state-drug rows into a bounded set of log-space bins.
        </p>
        <p>
          <span className="font-medium text-wave-800">Zoom reveals individual NDCs.</span>{" "}
          Until then, circle size is drug count and color is the share underwater. EA, ML, and GM pricing units are mixed.
        </p>
      </div>
    </div>
  );
}
