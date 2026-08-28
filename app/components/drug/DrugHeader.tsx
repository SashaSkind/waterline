import type { DrugRow } from "@/lib/queries";

export default function DrugHeader({ drug }: { drug: DrugRow }) {
  return (
    <header className="border-b border-wave-200 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-wave-950">
          {drug.brand_name}
        </h1>
        <span
          className={`rounded border px-2 py-0.5 text-xs uppercase tracking-wide ${
            drug.is_generic
              ? "border-emerald-300 text-emerald-700"
              : "border-wave-300 text-wave-700"
          }`}
        >
          {drug.is_generic ? "generic" : "brand"}
        </span>
      </div>
      <p className="mt-2 text-lg text-wave-800">
        {drug.ingredient}
        {drug.strength && (
          <span className="text-wave-600">
            {" "}
            · {drug.strength} {drug.strength_unit}
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-wave-500">
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
