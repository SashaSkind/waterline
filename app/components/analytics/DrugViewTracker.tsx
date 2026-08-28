"use client";

import { useEffect, useRef } from "react";

import { trackDrugView } from "@/lib/product-events-client";

export default function DrugViewTracker({ ndc11 }: { ndc11: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackDrugView(ndc11);
  }, [ndc11]);

  return null;
}
