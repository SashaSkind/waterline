import { NextRequest, NextResponse } from "next/server";

import { addWatch, removeWatch } from "@/lib/mutations";
import { normalizeSessionId } from "@/lib/product-events";
import { getWatchlist, normalizeNdc } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getWatchlist());
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const ndc11 = normalizeNdc(String(body.ndc11 ?? ""));
  if (!ndc11) return NextResponse.json({ error: "bad ndc" }, { status: 400 });
  const threshold = Number(body.threshold_pct ?? 5.0);
  const result = await addWatch(
    ndc11,
    Number.isFinite(threshold) ? threshold : 5.0,
    normalizeSessionId(body.session_id),
  );
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const ndc11 = normalizeNdc(req.nextUrl.searchParams.get("ndc11") ?? "");
  if (!ndc11) return NextResponse.json({ error: "bad ndc" }, { status: 400 });
  return NextResponse.json({
    removed: await removeWatch(
      ndc11,
      normalizeSessionId(req.nextUrl.searchParams.get("session_id")),
    ),
  });
}
