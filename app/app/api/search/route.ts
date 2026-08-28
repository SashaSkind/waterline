import { searchDrugs } from "@/lib/queries";

/** GET /api/search?q= — autocomplete backend for SearchBox. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json([]);
  try {
    return Response.json(await searchDrugs(q));
  } catch {
    return Response.json([], { status: 500 });
  }
}
