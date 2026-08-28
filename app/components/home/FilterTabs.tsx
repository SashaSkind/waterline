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
      className="inline-flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 p-1"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={
            tab.key === active
              ? "rounded-md bg-neutral-700/70 px-3 py-1.5 text-sm font-medium text-neutral-50"
              : "rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100"
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
