import { NextRequest, NextResponse } from "next/server";

import { getProductAnalytics } from "@/lib/product-analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  try {
    return NextResponse.json(await getProductAnalytics(days), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("product analytics query failed", error);
    return NextResponse.json(
      { error: "product analytics is not configured" },
      { status: 503 },
    );
  }
}
