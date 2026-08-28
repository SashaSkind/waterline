/** Display formatting shared by the drug-page components. */

/** $-formatted with a true minus sign; sub-dollar prices keep 4 decimals
 * so penny generics don't all render as $0.00–$0.05. */
export function money(v: number): string {
  const abs = Math.abs(v);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  const num = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
  return `${v < 0 ? "−" : ""}$${num}`;
}

/** "2026-08-19" -> "Aug 19, 2026" without timezone drift. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** Muted placeholder for any missing datum — never zero, never omitted. */
export function NoData() {
  return <span className="text-neutral-600">no data</span>;
}
