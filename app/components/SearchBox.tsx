"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "@/lib/queries";

/** Search box with debounced autocomplete against /api/search.
 * Selecting a hit navigates to its drug page; plain submit falls back
 * to the full results page at /search?q=. */
export default function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);

  const reset = (value: string) => {
    setQ(value);
    if (value.trim().length < 2) {
      abortRef.current?.abort();
      setHits([]);
      setOpen(false);
      setActive(-1);
    }
  };

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: SearchHit[] = await res.json();
        setHits(data);
        setOpen(data.length > 0);
        setActive(-1);
      } catch {
        // aborted or offline — keep whatever is showing
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    router.push(`/drug/${hit.ndc11}`);
  };

  const submit = () => {
    if (open && active >= 0 && hits[active]) {
      go(hits[active]);
    } else if (q.trim()) {
      setOpen(false);
      router.push(`/search?q=${encodeURIComponent(q.trim())}`);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative w-full max-w-xl"
    >
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => reset(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && hits.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % hits.length);
          } else if (e.key === "ArrowUp" && hits.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a <= 0 ? hits.length - 1 : a - 1));
          } else if (e.key === "Escape") {
            setOpen(false);
            setActive(-1);
          }
        }}
        placeholder="Brand name, generic name, or NDC"
        role="combobox"
        aria-expanded={open}
        aria-controls="search-hits"
        aria-autocomplete="list"
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-500 focus:border-sky-500 focus:outline-none"
      />
      {open && (
        <ul
          id="search-hits"
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-2 max-h-96 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl shadow-black/50"
        >
          {hits.map((hit, i) => (
            <li key={hit.ndc11} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => {
                  // fire before the input's blur closes the dropdown
                  e.preventDefault();
                  go(hit);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline gap-2 px-4 py-2.5 text-left ${
                  i === active ? "bg-neutral-800" : ""
                }`}
              >
                <span className="truncate font-medium text-neutral-100">
                  {hit.brand_name}
                </span>
                <span className="truncate text-sm text-neutral-400">
                  {hit.ingredient}
                  {hit.strength && ` · ${hit.strength} ${hit.strength_unit}`}
                </span>
                {hit.has_margin === 0 && (
                  <span className="ml-auto shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                    no pricing data
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
