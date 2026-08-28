import { NextRequest, NextResponse } from "next/server";

import {
  getMarginMapBins,
  getMarginMapPoints,
  type MarginMapQuery,
  type MarginMapView,
} from "@/lib/margin-map";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const numeric = (params: URLSearchParams, name: string): number =>
  Number(params.get(name));

function parseRequest(req: NextRequest):
  | { query: MarginMapQuery; mode: "bins" | "points" }
  | { error: string } {
  const params = req.nextUrl.searchParams;
  const year = numeric(params, "year");
  const quarter = numeric(params, "quarter");
  const state = params.get("state")?.trim().toUpperCase() ?? "";
  const view: MarginMapView = {
    lx0: numeric(params, "lx0"),
    lx1: numeric(params, "lx1"),
    ly0: numeric(params, "ly0"),
    ly1: numeric(params, "ly1"),
  };

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error: "bad year" };
  }
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    return { error: "bad quarter" };
  }
  if (state !== "" && !/^[A-Z]{2}$/.test(state)) {
    return { error: "bad state" };
  }
  if (!Object.values(view).every(Number.isFinite)) {
    return { error: "bad viewport" };
  }
  if (
    view.lx0 < -8 || view.lx1 > 8 || view.ly0 < -8 || view.ly1 > 8 ||
    view.lx1 - view.lx0 < 0.08 || view.ly1 - view.ly0 < 0.08 ||
    view.lx1 <= view.lx0 || view.ly1 <= view.ly0
  ) {
    return { error: "viewport out of range" };
  }

  const binsX = Math.min(80, Math.max(12, Math.round(numeric(params, "bins_x") || 48)));
  const binsY = Math.min(60, Math.max(10, Math.round(numeric(params, "bins_y") || 32)));
  const mode = params.get("mode") === "points" ? "points" : "bins";

  return {
    mode,
    query: {
      year,
      quarter,
      state,
      view,
      bins_x: binsX,
      bins_y: binsY,
    },
  };
}

export async function GET(req: NextRequest) {
  const parsed = parseRequest(req);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const started = performance.now();
  try {
    if (parsed.mode === "points") {
      const points = await getMarginMapPoints(parsed.query);
      const totalPoints = points[0]?.total_points ?? 0;
      return NextResponse.json(
        {
          mode: "points",
          points,
          ndcs: totalPoints,
          source_rows: points[0]?.total_source_rows ?? 0,
          truncated: totalPoints > points.length,
          query_ms: Math.round(performance.now() - started),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const bins = await getMarginMapBins(parsed.query);
    return NextResponse.json(
      {
        mode: "bins",
        bins,
        ndcs: bins.reduce((sum, bin) => sum + bin.n, 0),
        source_rows: bins.reduce((sum, bin) => sum + bin.source_rows, 0),
        truncated: false,
        query_ms: Math.round(performance.now() - started),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("margin map query failed", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
