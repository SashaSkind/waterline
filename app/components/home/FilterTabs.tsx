import Link from "next/link";

export type TopTenFilter = "all" | "brand" | "generic";

const TABS: { key: TopTenFilter; label: string; href: string }[] = [
  { key: "all", label: "All", href: "/" },
  { key: "brand", label: "Brand", href: "/?filter=brand" },
  { key: "generic", label: "Generic", href: "/?filter=generic" },
];

/** Brand/generic filter as plain links; the server component reads ?filter=. */
export default function FilterTabs({ active }: { active: TopTenFilter }) {
  return (
    <nav
      aria-label="Filter by brand or generic"
      className="inline-flex items-center gap-1 rounded-lg border border-wave-200 bg-white/70 p-1"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={
            tab.key === active
              ? "rounded-md bg-wave-100 px-3 py-1.5 text-sm font-medium text-wave-900"
              : "rounded-md px-3 py-1.5 text-sm text-wave-600 hover:text-wave-950"
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
