"use client";

import { useState } from "react";

import { getProductAnalyticsSessionId } from "@/lib/product-events-client";

export default function WatchButton({
  ndc11,
  initialWatched,
}: {
  ndc11: string;
  initialWatched: boolean;
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const sessionId = getProductAnalyticsSessionId();
      if (watched) {
        const params = new URLSearchParams({ ndc11, session_id: sessionId });
        const res = await fetch(`/api/watchlist?${params}`, { method: "DELETE" });
        if (res.ok) setWatched(false);
      } else {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ndc11, session_id: sessionId }),
        });
        if (res.ok) setWatched(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
        watched
          ? "border-sky-600 bg-sky-950/60 text-sky-300"
          : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
      } disabled:opacity-50`}
    >
      {watched ? "✓ Watching" : "+ Watch this drug"}
    </button>
  );
}
