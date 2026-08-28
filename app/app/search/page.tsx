import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import SearchBox from "@/components/SearchBox";
import { searchDrugs } from "@/lib/queries";

export const metadata: Metadata = { title: "Search — Waterline" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const hits = q ? await searchDrugs(q) : [];
  if (hits.length === 1) redirect(`/drug/${hits[0].ndc11}`);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-8 flex flex-col gap-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-neutral-400 hover:text-neutral-200"
        >
          Waterline
        </Link>
        <SearchBox autoFocus={!q} />
      </div>

      {q === "" ? (
        <p className="text-neutral-500">
          Search by brand name, generic name, or NDC.
        </p>
      ) : hits.length === 0 ? (
        <p className="text-neutral-500">
          No drugs match <span className="text-neutral-300">&ldquo;{q}&rdquo;</span>.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-500">
            {hits.length} match{hits.length === 1 ? "" : "es"} for{" "}
            <span className="text-neutral-300">&ldquo;{q}&rdquo;</span>
          </p>
          <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
            {hits.map((hit) => (
              <li key={hit.ndc11}>
                <Link
                  href={`/drug/${hit.ndc11}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-neutral-900"
                >
                  <span className="font-medium text-neutral-100">
                    {hit.brand_name}
                  </span>
                  <span className="text-sm text-neutral-400">
                    {hit.ingredient}
                    {hit.strength && ` · ${hit.strength} ${hit.strength_unit}`}
                    {hit.dosage_form && ` · ${hit.dosage_form.toLowerCase()}`}
                  </span>
                  <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                    {hit.is_generic ? "generic" : "brand"}
                  </span>
                  {hit.has_margin === 0 && (
                    <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                      no pricing data
                    </span>
                  )}
                  <span className="ml-auto font-mono text-xs text-neutral-600">
                    {hit.ndc11}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
