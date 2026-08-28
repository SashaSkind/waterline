import { NextRequest, NextResponse } from "next/server";

import {
  normalizeSessionId,
  recordProductEvent,
} from "@/lib/product-events";
import { normalizeNdc } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.event_name !== "drug_viewed") {
      return NextResponse.json({ error: "unsupported event" }, { status: 400 });
    }
    const ndc11 = normalizeNdc(String(body.ndc11 ?? ""));
    if (!ndc11) {
      return NextResponse.json({ error: "bad ndc" }, { status: 400 });
    }

    const eventId = await recordProductEvent({
      eventName: "drug_viewed",
      ndc11,
      sessionId: normalizeSessionId(body.session_id),
      source: "web",
    });
    return NextResponse.json({ event_id: eventId }, { status: 201 });
  } catch (error) {
    console.error("product event insert failed", error);
    return NextResponse.json({ error: "event insert failed" }, { status: 500 });
  }
}
