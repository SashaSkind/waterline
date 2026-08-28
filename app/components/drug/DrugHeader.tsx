import type { DrugRow } from "@/lib/queries";

export default function DrugHeader({ drug }: { drug: DrugRow }) {
  return (
    <header className="border-b border-neutral-800 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-50">
          {drug.brand_name}
        </h1>
        <span
          className={`rounded border px-2 py-0.5 text-xs uppercase tracking-wide ${
            drug.is_generic
              ? "border-emerald-800 text-emerald-400"
              : "border-sky-800 text-sky-400"
          }`}
        >
          {drug.is_generic ? "generic" : "brand"}
        </span>
      </div>
      <p className="mt-2 text-lg text-neutral-300">
        {drug.ingredient}
        {drug.strength && (
          <span className="text-neutral-400">
            {" "}
            · {drug.strength} {drug.strength_unit}
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        {[drug.dosage_form.toLowerCase(), drug.route.toLowerCase()]
          .filter(Boolean)
          .join(" · ")}
        {drug.labeler && ` · ${drug.labeler}`}
        {" · NDC "}
        <span className="font-mono">{drug.ndc11}</span>
      </p>
    </header>
  );
}
