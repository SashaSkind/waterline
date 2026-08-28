"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Placeholder search box: submit navigates to /search?q=. The drug-page
 * workstream owns and will enhance this component (autocomplete etc). */
export default function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="w-full max-w-xl"
    >
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Brand name, generic name, or NDC"
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-500 focus:border-sky-500 focus:outline-none"
      />
    </form>
  );
}
