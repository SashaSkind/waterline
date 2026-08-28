"use client";

const SESSION_KEY = "waterline.analytics.session";

export function getProductAnalyticsSessionId(): string {
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const sessionId = window.crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_KEY, sessionId);
  return sessionId;
}

export function trackDrugView(ndc11: string): void {
  const sessionId = getProductAnalyticsSessionId();
  void fetch("/api/product-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "drug_viewed",
      ndc11,
      session_id: sessionId,
    }),
    keepalive: true,
  }).catch(() => {
    // Analytics is best-effort and must never break the drug page.
  });
}
