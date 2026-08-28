import { NextResponse } from "next/server";

import { getAlerts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAlerts());
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
