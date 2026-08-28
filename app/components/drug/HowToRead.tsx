/** Collapsible explainer of what each number in the stack can and cannot see. */
export default function HowToRead() {
  const steps: Array<{ step: string; visibility: string; seen: boolean }> = [
    {
      step: "Pharmacy buys from wholesaler",
      visibility: "NADAC sees this",
      seen: true,
    },
    {
      step: "Payer reimburses pharmacy",
      visibility: "SDUD and Part D see this",
      seen: true,
    },
    {
      step: "Manufacturer rebates payer",
      visibility: "confidential",
      seen: false,
    },
    {
      step: "Wholesaler pays manufacturer",
      visibility: "not public",
      seen: false,
    },
  ];
  return (
    <details className="group rounded-lg border border-wave-200">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm text-wave-600 hover:text-wave-900">
        How to read this
      </summary>
      <ul className="border-t border-wave-200 px-4 py-3">
        {steps.map((s) => (
          <li
            key={s.step}
            className="flex items-baseline justify-between gap-4 py-1.5 text-sm"
          >
            <span className="text-wave-800">{s.step}</span>
            <span className={s.seen ? "text-wave-700" : "text-wave-400"}>
              {s.visibility}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
